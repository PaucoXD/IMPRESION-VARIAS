/* Impresión Varias: junta varios archivos, permite eliminar, girar y editar hojas e imprime todo de una vez.
   Todo se procesa en el navegador; ningún archivo sale del equipo. */
(() => {
  "use strict";

  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  const {
    PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream, degrees,
    pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject: drawXObject,
  } = PDFLib;

  // Tamaño A4 en puntos para colocar las imágenes.
  const A4 = [595.28, 841.89];
  const IMAGE_MARGIN = 18;
  const THUMB_WIDTH = 160;
  // Resolución máxima (lado largo, en píxeles) de la capa de edición al generar el PDF.
  const EXPORT_MAX_PX = 2400;
  const FONT = "Helvetica, Arial, sans-serif";
  const LINE_HEIGHT = 1.2;
  // Límites del zoom del editor (1 = hoja ajustada a la pantalla) y del tamaño del canvas.
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 6;
  const MAX_EDITOR_PIXELS = 24e6;

  // Cada documento: { id, name, bytes, pdfjs, pages: [{ removed, rotation, edits, textRemovals }] }
  // textRemovals: textos originales del PDF que se quitaron de verdad del contenido de la hoja.
  // Las imágenes se convierten al cargarlas en un PDF de una hoja, así todo se trata igual.
  let docs = [];
  let nextId = 1;
  let lastPrintUrl = null;

  const $ = (sel) => document.querySelector(sel);
  const docsEl = $("#docs");
  const fileInput = $("#file-input");
  const dropzone = $("#dropzone");
  const template = $("#doc-template");
  const btnPrint = $("#btn-print");
  const btnDownload = $("#btn-download");
  const btnClear = $("#btn-clear");
  const summaryEl = $("#summary");
  const hintEl = $("#hint");
  const busyEl = $("#busy");
  const busyText = $("#busy-text");
  const printFrame = $("#print-frame");

  const thumbObserver = new IntersectionObserver(onThumbVisible, { rootMargin: "300px" });

  // ---------- Matrices afines [a, b, c, d, e, f] (mismo formato que canvas y pdf.js) ----------

  // compose(A, B) aplica primero B y luego A.
  function compose(A, B) {
    return [
      A[0] * B[0] + A[2] * B[1],
      A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3],
      A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4],
      A[1] * B[4] + A[3] * B[5] + A[5],
    ];
  }
  function invert(M) {
    const det = M[0] * M[3] - M[1] * M[2];
    return [
      M[3] / det, -M[1] / det, -M[2] / det, M[0] / det,
      (M[2] * M[5] - M[3] * M[4]) / det, (M[1] * M[4] - M[0] * M[5]) / det,
    ];
  }
  function apply(M, x, y) {
    return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  }

  // Las ediciones se guardan en el "marco base" de la hoja: puntos PDF, con la rotación
  // propia del PDF pero sin el giro del usuario. Esta matriz lleva del marco base a un viewport.
  function baseTo(pdfPage, viewport) {
    const base = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate });
    return compose(viewport.transform, invert(base.transform));
  }

  // ---------- Carga de archivos ----------

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("over");
    })
  );
  dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
  // Evita que soltar un archivo fuera de la zona lo abra en la pestaña.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const failed = [];
    showBusy("Cargando archivos…");
    try {
      for (const file of files) {
        try {
          const doc = await loadFile(file);
          docs.push(doc);
          renderDoc(doc);
        } catch (err) {
          console.error(err);
          if (err.userMessage) alert(err.userMessage);
          else failed.push(file.name);
        }
      }
    } finally {
      hideBusy();
      updateSummary();
    }
    if (failed.length) {
      alert("No se pudieron abrir estos archivos:\n\n" + failed.join("\n") +
        "\n\nSolo se admiten PDF e imágenes.");
    }
  }

  async function loadFile(file) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) throw new Error("Tipo no soportado: " + file.type);

    let bytes = isPdf ? new Uint8Array(await file.arrayBuffer()) : await imageToPdf(file);
    // PDF con contraseña: se pide y se quita (seguridad.js), así se puede unir y editar.
    if (isPdf) bytes = await PdfSeguridad.unlockForApp(bytes, file.name);
    // pdf.js se queda con el buffer que recibe, así que le pasamos una copia.
    const pdfjs = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const pages = [];
    for (let i = 0; i < pdfjs.numPages; i++) pages.push({ removed: false, rotation: 0, edits: [], textRemovals: [] });
    return { id: nextId++, name: file.name, bytes, pdfjs, pages };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Imagen no válida"));
      el.src = src;
    });
  }

  // Coloca la imagen centrada en una hoja A4 (vertical u horizontal según la imagen).
  async function imageToPdf(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const out = await PDFDocument.create();
      let embedded;
      if (file.type === "image/jpeg") {
        embedded = await out.embedJpg(new Uint8Array(await file.arrayBuffer()));
      } else if (file.type === "image/png") {
        embedded = await out.embedPng(new Uint8Array(await file.arrayBuffer()));
      } else {
        // pdf-lib solo incrusta JPG y PNG; el resto de formatos se convierte a PNG con un canvas.
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
        embedded = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
      }
      const [pw, ph] = width > height ? [A4[1], A4[0]] : A4;
      const scale = Math.min((pw - IMAGE_MARGIN * 2) / width, (ph - IMAGE_MARGIN * 2) / height, 1);
      const w = width * scale;
      const h = height * scale;
      const page = out.addPage([pw, ph]);
      page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      return out.save();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- Texto original del PDF ----------
  // Para cambiar un texto que ya trae el PDF se quita de verdad del contenido de la hoja
  // (no se tapa) y en su lugar se dibuja el texto nuevo.

  const latin = (bytes, a, b) => String.fromCharCode(...bytes.subarray(a, b));
  const isSpace = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
  const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 ||
    c === 123 || c === 125 || c === 47 || c === 37;
  const SHOW_OPS = new Set(["Tj", "TJ", "'", '"']);

  // Recorre el contenido de una hoja y devuelve los operadores que muestran texto,
  // con el rango de bytes que ocupan (operandos incluidos).
  function parseShowOps(bytes) {
    const ops = [];
    const n = bytes.length;
    let i = 0;
    let opStart = -1;
    let operands = [];
    while (i < n) {
      const c = bytes[i];
      if (isSpace(c)) { i++; continue; }
      if (c === 37) { // comentario
        while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++;
        continue;
      }
      const s = i;
      let regular = false;
      if (c === 40) { // cadena literal (con paréntesis anidados y escapes)
        let depth = 0;
        for (; i < n; i++) {
          const d = bytes[i];
          if (d === 92) i++;
          else if (d === 40) depth++;
          else if (d === 41 && --depth === 0) { i++; break; }
        }
      } else if (c === 60) {
        if (bytes[i + 1] === 60) i += 2;
        else { while (i < n && bytes[i] !== 62) i++; i++; }
      } else if (c === 62) {
        i += bytes[i + 1] === 62 ? 2 : 1;
      } else if (c === 91 || c === 93 || c === 123 || c === 125 || c === 41) {
        i++;
      } else if (c === 47) {
        i++;
        while (i < n && !isSpace(bytes[i]) && !isDelim(bytes[i])) i++;
      } else {
        while (i < n && !isSpace(bytes[i]) && !isDelim(bytes[i])) i++;
        regular = true;
      }
      if (opStart < 0) opStart = s;
      const word = regular ? latin(bytes, s, i) : "";
      if (!regular || /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) || word === "true" || word === "false" || word === "null") {
        operands.push(latin(bytes, s, Math.min(i, s + 32)));
        continue;
      }
      if (word === "ID") {
        // Imagen en línea: datos binarios hasta "EI".
        i++;
        while (i < n && !(isSpace(bytes[i - 1]) && bytes[i] === 69 && bytes[i + 1] === 73 &&
          (i + 2 >= n || isSpace(bytes[i + 2]) || isDelim(bytes[i + 2])))) i++;
        i = Math.min(n, i + 2);
      } else if (SHOW_OPS.has(word)) {
        ops.push({ start: opStart, end: i, op: word, operands });
      }
      opStart = -1;
      operands = [];
    }
    return ops;
  }

  // Reescribe el contenido sustituyendo algunos operadores de texto.
  function rewriteContent(content, replace) {
    const enc = new TextEncoder();
    const parts = [];
    let pos = 0;
    content.ops.forEach((o, k) => {
      const r = replace(o, k);
      if (r == null) return;
      parts.push(content.bytes.subarray(pos, o.start), enc.encode(r));
      pos = o.end;
    });
    parts.push(content.bytes.subarray(pos));
    const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  // Quita los textos indicados. En su lugar se deja un desplazamiento vacío del mismo ancho,
  // así el resto de la línea no se mueve.
  function contentWithout(content, removals) {
    if (!removals.length) return content.bytes;
    const adv = new Map(removals.map((r) => [r.op, r.advance]));
    return rewriteContent(content, (o, k) => {
      if (!adv.has(k)) return null;
      const shift = `[${adv.get(k)}] TJ`;
      if (o.op === "'") return ` T* ${shift} `;
      if (o.op === '"') return ` ${o.operands[0]} Tw ${o.operands[1]} Tc T* ${shift} `;
      return ` ${shift} `;
    });
  }

  function libDoc(doc) {
    if (!doc.lib) doc.lib = PDFDocument.load(doc.bytes, { ignoreEncryption: true });
    return doc.lib;
  }

  // Contenido (descomprimido y unido) de una hoja y sus operadores de texto.
  function pageContent(doc, index) {
    const state = doc.pages[index];
    if (!state.content) {
      state.content = (async () => {
        const lib = await libDoc(doc);
        const node = lib.getPage(index).node;
        const contents = node.Contents();
        const streams = !contents ? [] : contents instanceof PDFArray
          ? contents.asArray().map((ref) => lib.context.lookup(ref)) : [contents];
        const chunks = streams.map((st) =>
          st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getUnencodedContents());
        const bytes = new Uint8Array(chunks.reduce((t, c) => t + c.length + 1, 0));
        let off = 0;
        for (const c of chunks) { bytes.set(c, off); off += c.length; bytes[off++] = 10; }
        return { bytes, ops: parseShowOps(bytes) };
      })();
    }
    return state.content;
  }

  function setContents(pdf, page, bytes) {
    page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(bytes)));
  }

  // Crea un PDF de una sola hoja con el contenido indicado.
  async function singlePagePdf(doc, index, bytes) {
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(await libDoc(doc), [index]);
    out.addPage(page);
    setContents(out, page, bytes);
    return out.save();
  }

  const removalsKey = (removals) => removals.map((r) => r.op).sort((a, b) => a - b).join(",");

  // Hoja de pdf.js para dibujar: la original o, si se quitaron textos, una copia sin ellos.
  async function pageFor(doc, index, removals = doc.pages[index].textRemovals) {
    if (!removals.length) return doc.pdfjs.getPage(index + 1);
    const state = doc.pages[index];
    const cache = (state.alt ||= new Map());
    const key = removalsKey(removals);
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const content = await pageContent(doc, index);
        const bytes = await singlePagePdf(doc, index, contentWithout(content, removals));
        return pdfjsLib.getDocument({ data: bytes }).promise;
      })());
      // Se guardan pocas versiones (las más recientes, para deshacer rápido).
      if (cache.size > 4) {
        const [oldKey, old] = cache.entries().next().value;
        cache.delete(oldKey);
        old.then((pdf) => setTimeout(() => pdf.destroy(), 5000)).catch(() => {});
      }
    }
    return (await cache.get(key)).getPage(1);
  }

  function releasePages(doc) {
    for (const state of doc.pages) {
      state.alt?.forEach((p) => p.then((pdf) => pdf.destroy()).catch(() => {}));
      state.alt = null;
    }
  }

  // Nombre de la tipografía del PDF -> fuentes CSS parecidas instaladas en el equipo.
  function cssFamily(name, generic) {
    const raw = (name || "").replace(/^[A-Z]{6}\+/, "").split(/[-,]/)[0].replace(/(PS)?MT$|PS$/, "").trim();
    const fallback = generic === "serif" || generic === "monospace" ? generic : "sans-serif";
    if (!raw || /[^\w ]/.test(raw)) return `${FONT.replace(/, sans-serif$/, "")}, ${fallback}`;
    const alias = { Helvetica: "Helvetica, Arial", Times: '"Times New Roman", Times', Courier: '"Courier New", Courier' };
    // "TimesNewRoman" -> "Times New Roman"; "DejaVuSerif" -> "DejaVu Serif".
    const names = new Set([raw, raw.replace(/([a-z])([A-Z])/g, "$1 $2"), raw.replace(/([a-z])([A-Z][a-z]*)$/, "$1 $2")]);
    return `${alias[raw] || [...names].map((n) => `"${n}"`).join(", ")}, ${fallback}`;
  }

  // Tipografía de un texto del PDF. Si viene incrustada se registra para dibujar con ella
  // (solo trae las letras usadas; las demás salen de la fuente parecida).
  let fontSeq = 0;
  async function pdfFont(page, id, generic) {
    let f = null;
    try { if (page.commonObjs.has(id)) f = page.commonObjs.get(id); } catch (e) { /* sin datos */ }
    const name = f?.name || "";
    const font = {
      family: cssFamily(name, generic),
      bold: !!f?.bold || /bold|black|heavy|semibold|demi/i.test(name),
      italic: !!f?.italic || /italic|oblique/i.test(name),
      embedded: null,
    };
    if (f?.data && !f.isType3Font && typeof FontFace === "function") {
      try {
        const family = `ivf${++fontSeq}`;
        const face = new FontFace(family, f.data, {
          weight: font.bold ? "700" : "400", style: font.italic ? "italic" : "normal",
        });
        document.fonts.add(await face.load());
        font.embedded = family;
      } catch (e) { /* se usa la fuente parecida */ }
    }
    return font;
  }

  // La fuente incrustada solo sirve si dibuja el texto original con sus letras y su ancho reales
  // (algunos PDF guardan las letras con códigos propios).
  function embeddedFits(font, text, size, width) {
    if (!font.embedded || !width) return false;
    const style = `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}${size}px "${font.embedded}"`;
    measureCtx.font = `${style}, monospace`;
    const a = measureCtx.measureText(text).width;
    measureCtx.font = `${style}, serif`;
    const b = measureCtx.measureText(text).width;
    return Math.abs(a - b) < 0.01 && Math.abs(a - width) / width < 0.05;
  }

  // Detecta los textos de la hoja y los agrupa en líneas editables.
  // Para saber qué operador del contenido dibuja cada texto, se marca cada uno con
  // contenido marcado (/IVn BMC … EMC) y se le pregunta a pdf.js.
  function textBlocks(doc, index) {
    const state = doc.pages[index];
    if (!state.blocks) {
      state.blocks = (async () => {
        const content = await pageContent(doc, index);
        if (!content.ops.length) return [];
        const tagged = rewriteContent(content, (o, k) =>
          ` /IV${k} BMC ${latin(content.bytes, o.start, o.end)} EMC `);
        const pdf = await pdfjsLib.getDocument({
          data: await singlePagePdf(doc, index, tagged),
          fontExtraProperties: true, // conserva los datos de las tipografías incrustadas
        }).promise;
        try {
          const page = await pdf.getPage(1);
          const tc = await page.getTextContent({ includeMarkedContent: true });
          // Las tipografías llegan al cargar la lista de operadores; sirven para saber si es negrita, etc.
          await page.getOperatorList().catch(() => {});
          const stack = [];
          const items = [];
          for (const it of tc.items) {
            if (it.type === "beginMarkedContent" || it.type === "beginMarkedContentProps") {
              const m = /^IV(\d+)$/.exec(it.tag || "");
              stack.push(m ? Number(m[1]) : null);
            } else if (it.type === "endMarkedContent") {
              stack.pop();
            } else if (it.str && stack.length && stack[stack.length - 1] != null && !tc.styles[it.fontName]?.vertical) {
              items.push({ ...it, op: stack[stack.length - 1] });
            }
          }
          const fonts = {};
          for (const id of new Set(items.map((it) => it.fontName))) {
            fonts[id] = await pdfFont(page, id, tc.styles[id]?.fontFamily);
          }
          return groupLines(items, page, (id) => fonts[id]);
        } finally {
          pdf.destroy();
        }
      })();
    }
    return state.blocks;
  }

  function groupLines(items, page, fontOf) {
    const B = page.getViewport({ scale: 1, rotation: page.rotate }).transform;
    const lines = [];
    let cur = null;
    for (const it of items) {
      const t = it.transform;
      const h = Math.hypot(t[2], t[3]);
      const blank = !it.str.trim();
      if (!h || (blank && !cur)) continue;
      if (cur) {
        const [u, v] = [cur.u, cur.v];
        const dx = t[4] - cur.o[0];
        const dy = t[5] - cur.o[1];
        const along = dx * u[0] + dy * u[1];
        const perp = dx * v[0] + dy * v[1];
        const sameDir = (t[0] * u[0] + t[1] * u[1]) / (Math.hypot(t[0], t[1]) || 1) > 0.99;
        const near = sameDir && Math.abs(perp) < cur.h * 0.3 && Math.abs(h - cur.h) < cur.h * 0.25 &&
          along > cur.end - cur.h && along < cur.end + cur.h * 1.5;
        // Los espacios (a veces añadidos por pdf.js) solo separan palabras; no deciden qué se quita.
        if (blank) {
          if (near && !/\s$/.test(cur.text)) cur.text += " ";
          continue;
        }
        // Un cambio de tipografía (p. ej. una palabra en negrita) empieza otro bloque para conservarla.
        if (cur.ops.has(it.op) || (near && it.fontName === cur.fontName)) {
          const gap = along - cur.end;
          if (gap > cur.h * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += " ";
          cur.text += it.str;
          cur.end = Math.max(cur.end, along + it.width);
          cur.ops.add(it.op);
          cur.items.push({ it, along });
          continue;
        }
      }
      const len = Math.hypot(t[0], t[1]);
      cur = {
        o: [t[4], t[5]], u: [t[0] / len, t[1] / len], v: [t[2] / h, t[3] / h], h,
        text: it.str, end: it.width, ops: new Set([it.op]), items: [{ it, along: 0 }],
        fontName: it.fontName, font: fontOf(it.fontName),
      };
      lines.push(cur);
    }
    // Un mismo operador nunca debe quedar repartido entre dos líneas.
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if ([...lines[j].ops].some((op) => lines[i].ops.has(op))) {
          lines[i].text += " " + lines[j].text;
          lines[j].ops.forEach((op) => lines[i].ops.add(op));
          lines[i].items.push(...lines[j].items.map((x) => ({ ...x, along: x.along + lines[i].end + lines[i].h })));
          lines.splice(j--, 1);
        }
      }
    }
    return lines.filter((l) => l.text.trim()).map((l) => {
      // Ancho que avanzaba cada operador, para dejar el hueco igual al quitarlo.
      const removals = [];
      for (const op of l.ops) {
        const own = l.items.filter((x) => x.it.op === op);
        const t = own[0].it.transform;
        const start = own[0].along;
        const end = Math.max(...own.map((x) => x.along + x.it.width));
        removals.push({ op, advance: Math.round((-(end - start) * 1000 / Math.hypot(t[0], t[1])) * 100) / 100 });
      }
      // Pasa a coordenadas del marco base (como las ediciones).
      const [px, py] = apply(B, l.o[0], l.o[1]);
      const ex = [B[0] * l.u[0] + B[2] * l.u[1], B[1] * l.u[0] + B[3] * l.u[1]];
      const angle = Math.atan2(ex[1], ex[0]);
      const ey = [-Math.sin(angle), Math.cos(angle)];
      const top = l.h * 0.95;
      return {
        text: l.text.replace(/\s+/g, " ").trim(),
        removals,
        size: l.h,
        font: embeddedFits(l.font, l.text, l.h, l.end)
          ? { ...l.font, family: `"${l.font.embedded}", ${l.font.family}` } : l.font,
        baseline: [px, py],
        angle,
        frame: { x: px - ey[0] * top, y: py - ey[1] * top, angle, w: l.end, h: l.h * 1.25 },
      };
    });
  }

  // ---------- Digitalizar (reconocer letras de hojas que son imagen) ----------
  // Usa Tesseract.js incluido en vendor/tesseract; se carga solo la primera vez que se usa.

  let ocrWorker = null;
  let ocrProgress = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error("no se pudo cargar " + src));
      document.head.appendChild(el);
    });
  }

  function getOcrWorker() {
    if (!ocrWorker) {
      ocrWorker = (async () => {
        await loadScript("vendor/tesseract/tesseract.min.js");
        const base = new URL("vendor/tesseract/", location.href).href;
        return Tesseract.createWorker("spa", 1, {
          workerPath: base + "worker.min.js",
          corePath: base,
          langPath: base,
          logger: (m) => m.status === "recognizing text" && ocrProgress?.(m.progress),
        });
      })();
      ocrWorker.catch(() => (ocrWorker = null));
    }
    return ocrWorker;
  }

  let ocrSeq = 0;

  // Reconoce las letras de la hoja (tal como se ve, sin las ediciones) y devuelve
  // bloques de texto en el marco base, como los de textBlocks.
  async function ocrPage(doc, index, removals, onProgress) {
    const worker = await getOcrWorker();
    const page = await pageFor(doc, index, removals);
    const unit = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = Math.min(5, 3200 / Math.max(unit.width, unit.height));
    const viewport = page.getViewport({ scale, rotation: page.rotate });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    ocrProgress = onProgress;
    let data;
    try {
      ({ data } = await worker.recognize(canvas, {}, { blocks: true, text: false }));
    } finally {
      ocrProgress = null;
    }
    const out = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) out.push(...ocrLine(line, scale));
      }
    }
    // Negrita: los textos con bastante más tinta (para su tamaño) que el resto de la hoja.
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (const o of out) {
      const [x0, y0, x1, y1] = o.px;
      let ink = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * canvas.width + x) * 4;
          if (img[i] + img[i + 1] + img[i + 2] < 384) ink++;
        }
      }
      o.ink = ink / Math.max(1, (x1 - x0) * o.size * scale);
    }
    const inks = out.map((o) => o.ink).sort((a, b) => a - b);
    const median = inks[Math.floor(inks.length / 2)] || 0;
    for (const o of out) {
      o.font.bold = o.ink > median * 1.3;
      delete o.px;
      delete o.ink;
    }
    return out;
  }

  // Una línea reconocida se parte donde hay mucho espacio entre palabras (columnas, tablas).
  function ocrLine(line, scale) {
    const words = line.words.filter((w) => w.text.trim() && w.confidence > 50);
    if (!words.length) return [];
    const lineH = line.bbox.y1 - line.bbox.y0;
    const groups = [];
    for (const w of words) {
      const g = groups[groups.length - 1];
      if (g && w.bbox.x0 - g[g.length - 1].bbox.x1 < lineH * 1.2) g.push(w);
      else groups.push([w]);
    }
    const b = line.baseline;
    const slope = b.x1 !== b.x0 ? (b.y1 - b.y0) / (b.x1 - b.x0) : 0;
    const angle = Math.abs(Math.atan(slope)) < 0.15 ? Math.atan(slope) : 0;
    return groups.map((g) => {
      const x0 = Math.min(...g.map((w) => w.bbox.x0));
      const x1 = Math.max(...g.map((w) => w.bbox.x1));
      const y0 = Math.min(...g.map((w) => w.bbox.y0));
      const y1 = Math.max(...g.map((w) => w.bbox.y1));
      const baseY = b.y0 + slope * (x0 - b.x0);
      const text = g.map((w) => w.text).join(" ");
      // Tamaño de letra a partir de lo que sube sobre la línea base: mayúsculas y números
      // miden ~0.72 del tamaño; si solo hay minúsculas bajas, ~0.52.
      const rise = Math.max(1, baseY - y0);
      const size = rise / (/[A-ZÁÉÍÓÚÑ0-9bdfhklt]/.test(text) ? 0.72 : 0.52);
      const pad = size * 0.12;
      return {
        id: `ocr${++ocrSeq}`,
        ocr: true,
        text,
        removals: [],
        size: size / scale,
        px: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
        font: { family: FONT, bold: false, italic: false },
        baseline: [x0 / scale, baseY / scale],
        angle,
        frame: {
          x: (x0 - pad) / scale, y: (y0 - pad) / scale, angle: 0,
          w: (x1 - x0 + pad * 2) / scale, h: (y1 - y0 + pad * 2) / scale,
        },
      };
    });
  }

  // ---------- Dibujo de las ediciones ----------

  const measureCtx = document.createElement("canvas").getContext("2d");

  // Los textos sacados del PDF guardan su tipografía; los nuevos usan la de siempre.
  function fontCss(obj) {
    return `${obj.italic ? "italic " : ""}${obj.bold ? "bold " : ""}${obj.size}px ${obj.family || FONT}`;
  }

  function textBox(obj) {
    measureCtx.font = fontCss(obj);
    const lines = obj.text.split("\n");
    const w = Math.max(...lines.map((l) => measureCtx.measureText(l).width), obj.size / 2);
    return { w, h: lines.length * obj.size * LINE_HEIGHT };
  }

  function drawObject(ctx, obj) {
    ctx.save();
    if (obj.type === "path") {
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = obj.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      obj.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (obj.points.length === 1) ctx.lineTo(obj.points[0][0] + 0.01, obj.points[0][1]);
      ctx.stroke();
    } else if (obj.type === "rect") {
      ctx.globalAlpha = obj.alpha;
      ctx.fillStyle = obj.color;
      ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
    } else if (obj.type === "text") {
      ctx.translate(obj.x, obj.y);
      ctx.rotate(obj.angle);
      ctx.fillStyle = obj.color;
      ctx.font = fontCss(obj);
      ctx.textBaseline = "top";
      obj.text.split("\n").forEach((line, i) => ctx.fillText(line, 0, i * obj.size * LINE_HEIGHT));
    } else if (obj.type === "image") {
      ctx.translate(obj.x, obj.y);
      ctx.rotate(obj.angle);
      ctx.drawImage(obj.img, 0, 0, obj.w, obj.h);
    }
    ctx.restore();
  }

  function drawObjects(ctx, objects, M) {
    ctx.save();
    ctx.setTransform(...M);
    objects.forEach((o) => !o.hidden && drawObject(ctx, o));
    ctx.restore();
  }

  // Renderiza una hoja (con su giro y sus ediciones) en un canvas nuevo.
  async function renderPage(doc, index, scale) {
    const state = doc.pages[index];
    const pdfPage = await pageFor(doc, index);
    const viewport = pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + state.rotation) % 360 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    if (state.edits.length) drawObjects(ctx, state.edits, baseTo(pdfPage, viewport));
    return { canvas, pdfPage, viewport };
  }

  // ---------- Interfaz ----------

  function renderDoc(doc) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = doc.id;
    node.querySelector(".doc-name").textContent = doc.name;
    const pagesEl = node.querySelector(".pages");

    doc.pages.forEach((page, i) => {
      const el = document.createElement("div");
      el.className = "page";
      el.dataset.index = i;
      el.innerHTML = `
        <div class="thumb" title="Clic para editar la hoja ${i + 1}">
          <span class="num">${i + 1}</span><span class="badge"></span>
        </div>
        <div class="page-tools">
          <button type="button" class="icon-btn" data-act="rotl" title="Girar a la izquierda">↺</button>
          <button type="button" class="icon-btn" data-act="rotr" title="Girar a la derecha">↻</button>
          <button type="button" class="icon-btn" data-act="edit" title="Editar hoja">✎</button>
          <button type="button" class="icon-btn del" data-act="del" title="Eliminar o restaurar hoja">✕</button>
        </div>`;
      el.querySelector(".thumb").addEventListener("click", () => openEditor(doc, i));
      el.querySelector(".page-tools").addEventListener("click", (e) => {
        const act = e.target.closest("button")?.dataset.act;
        if (act === "rotl" || act === "rotr") {
          page.rotation = (page.rotation + (act === "rotr" ? 90 : 270)) % 360;
          refreshThumb(doc, i);
        }
        if (act === "edit") openEditor(doc, i);
        if (act === "del") {
          page.removed = !page.removed;
          refreshDoc(doc);
        }
      });
      thumbObserver.observe(el);
      pagesEl.appendChild(el);
    });

    const rangeInput = node.querySelector(".range-input");
    rangeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") removeRange(doc, rangeInput);
    });

    node.querySelector(".doc-tools").addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act === "range") removeRange(doc, rangeInput);
      if (act === "restore") {
        doc.pages.forEach((p) => (p.removed = false));
        refreshDoc(doc);
      }
      if (act === "rotate-all") {
        doc.pages.forEach((p, i) => {
          p.rotation = (p.rotation + 90) % 360;
          refreshThumb(doc, i);
        });
      }
      if (act === "up" || act === "down") moveDoc(doc, act === "up" ? -1 : 1);
      if (act === "remove") removeDoc(doc);
    });

    docsEl.appendChild(node);
    refreshDoc(doc);
  }

  function pageEl(doc, index) {
    return docsEl.querySelector(`.doc[data-id="${doc.id}"] .page[data-index="${index}"]`);
  }

  function onThumbVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      thumbObserver.unobserve(entry.target);
      const doc = docs.find((d) => d.id === Number(entry.target.closest(".doc").dataset.id));
      if (doc) refreshThumb(doc, Number(entry.target.dataset.index));
    }
  }

  async function refreshThumb(doc, index) {
    const el = pageEl(doc, index);
    if (!el) return;
    const state = doc.pages[index];
    const token = (state.thumbToken = (state.thumbToken || 0) + 1);
    const badges = [];
    if (state.rotation) badges.push(`${state.rotation}°`);
    if (state.edits.length || state.textRemovals.length) badges.push("✎");
    el.querySelector(".badge").textContent = badges.join(" ");
    try {
      const pdfPage = await doc.pdfjs.getPage(index + 1);
      const width = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + state.rotation) % 360 }).width;
      const { canvas } = await renderPage(doc, index, (THUMB_WIDTH * (window.devicePixelRatio || 1)) / width);
      // Si mientras tanto se pidió otra miniatura más nueva, se descarta esta.
      if (token !== state.thumbToken) return;
      el.querySelector(".thumb canvas")?.remove();
      el.querySelector(".thumb").prepend(canvas);
    } catch (err) {
      console.error(err);
    }
  }

  function refreshDoc(doc) {
    const node = docsEl.querySelector(`.doc[data-id="${doc.id}"]`);
    if (!node) return;
    node.querySelectorAll(".page").forEach((el) => {
      el.classList.toggle("removed", doc.pages[el.dataset.index].removed);
    });
    const kept = doc.pages.filter((p) => !p.removed).length;
    const total = doc.pages.length;
    node.querySelector(".doc-count").textContent =
      kept === total ? `${total} ${total === 1 ? "hoja" : "hojas"}` : `${kept} de ${total} hojas se imprimirán`;
    updateSummary();
  }

  // Interpreta "2, 4-6, 9" como índices base 0.
  function parseRange(text, max) {
    const result = new Set();
    for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return null;
      let a = Number(m[1]);
      let b = m[2] ? Number(m[2]) : a;
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > max) return null;
      for (let i = a; i <= b; i++) result.add(i - 1);
    }
    return result;
  }

  function removeRange(doc, input) {
    const set = parseRange(input.value.trim(), doc.pages.length);
    if (!set || !set.size) {
      alert(`Escribe hojas válidas entre 1 y ${doc.pages.length}, por ejemplo: 2, 4-6`);
      return;
    }
    set.forEach((i) => (doc.pages[i].removed = true));
    input.value = "";
    refreshDoc(doc);
  }

  function moveDoc(doc, delta) {
    const i = docs.indexOf(doc);
    const j = i + delta;
    if (j < 0 || j >= docs.length) return;
    [docs[i], docs[j]] = [docs[j], docs[i]];
    const node = docsEl.querySelector(`.doc[data-id="${doc.id}"]`);
    const other = docsEl.querySelector(`.doc[data-id="${docs[i].id}"]`);
    if (delta < 0) docsEl.insertBefore(node, other);
    else docsEl.insertBefore(other, node);
  }

  function removeDoc(doc) {
    docs = docs.filter((d) => d !== doc);
    doc.pdfjs.destroy();
    releasePages(doc);
    docsEl.querySelector(`.doc[data-id="${doc.id}"]`)?.remove();
    updateSummary();
  }

  btnClear.addEventListener("click", () => {
    if (!confirm("¿Quitar todos los archivos?")) return;
    docs.forEach((d) => {
      d.pdfjs.destroy();
      releasePages(d);
    });
    docs = [];
    docsEl.innerHTML = "";
    updateSummary();
  });

  function updateSummary() {
    const total = docs.reduce((n, d) => n + d.pages.length, 0);
    const kept = docs.reduce((n, d) => n + d.pages.filter((p) => !p.removed).length, 0);
    if (!docs.length) summaryEl.textContent = "Sin archivos";
    else summaryEl.textContent =
      `${docs.length} ${docs.length === 1 ? "archivo" : "archivos"} · ${kept} de ${total} hojas`;
    btnPrint.disabled = kept === 0;
    btnDownload.disabled = kept === 0;
    btnClear.disabled = docs.length === 0;
    hintEl.hidden = docs.length === 0;
    document.body.classList.toggle("has-docs", docs.length > 0);
    document.dispatchEvent(new CustomEvent("docs-change", { detail: { files: docs.length, pages: kept } }));
  }

  // ---------- Editor de hojas ----------

  const editorEl = $("#editor");
  const edTitle = $("#ed-title");
  const edStage = editorEl.querySelector(".editor-stage");
  const edWrap = $("#ed-wrap");
  const edBg = $("#ed-bg");
  const edOverlay = $("#ed-overlay");
  const edColor = $("#ed-color");
  const edSize = $("#ed-size");
  const edDelete = $("#ed-delete");
  const edNote = $("#ed-note");
  const edNoteText = $("#ed-note-text");
  const edOcr = $("#ed-ocr");
  const edZoomFit = $("#ed-zoom-fit");
  const edImageInput = $("#ed-image-input");
  const edCtx = edOverlay.getContext("2d");

  const ed = {
    doc: null,
    index: 0,
    objects: [],
    removals: [], // textos originales del PDF quitados en esta edición
    blocks: null, // textos detectados en la hoja (herramienta "Editar texto")
    ocrBlocks: [], // textos reconocidos con "Digitalizar"
    undo: [],
    tool: "pen",
    // Cada herramienta recuerda su color.
    colors: { text: "#000000", pen: "#000000", highlight: "#ffeb3b" },
    selected: null,
    drag: null, // acción en curso con el puntero
    pointers: new Map(), // dedos/punteros apoyados, para pellizcar
    toCanvas: null, // marco base -> píxeles del canvas
    toBase: null, // píxeles del canvas -> marco base
    fit: 1, // escala CSS con la que la hoja cabe en pantalla
    zoom: 1,
    natural: null, // tamaño de la hoja (girada) en puntos
    renderToken: 0,
    zoomTimer: 0,
    textInput: null,
    pdfPage: null,
  };

  function cloneObjects(list) {
    return list.map((o) => ({ ...o, points: o.points?.map((p) => [...p]) }));
  }

  // Ángulo que hace falta para que un texto o imagen se vea derecho en la vista actual.
  function uprightAngle() {
    return -Math.atan2(ed.toCanvas[1], ed.toCanvas[0]);
  }

  // Píxeles CSS por píxel del canvas (cambia al hacer zoom, antes de volver a dibujar la hoja).
  function cssPerPixel() {
    return edWrap.getBoundingClientRect().width / edOverlay.width;
  }

  async function openEditor(doc, index) {
    showBusy("Abriendo editor…");
    try {
      const state = doc.pages[index];
      const pdfPage = await doc.pdfjs.getPage(index + 1);
      const natural = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + state.rotation) % 360 });
      editorEl.hidden = false;
      edTitle.textContent = `${doc.name} — hoja ${index + 1}`;
      document.body.style.overflow = "hidden";
      const pad = window.innerWidth < 600 ? 16 : 32;
      Object.assign(ed, {
        doc,
        index,
        objects: cloneObjects(state.edits),
        removals: state.textRemovals.slice(),
        blocks: null,
        ocrBlocks: state.ocr || [],
        undo: [],
        selected: null,
        drag: null,
        natural: { width: natural.width, height: natural.height },
        fit: Math.min((edStage.clientWidth - pad) / natural.width, (edStage.clientHeight - pad) / natural.height, 2.5),
        zoom: 1,
      });
      edDelete.disabled = true;
      setNote("");
      updateZoomLabel();
      await renderEditor();
      setTool(ed.tool === "image" ? "move" : ed.tool);
    } catch (err) {
      console.error(err);
      closeEditor();
      alert("No se pudo abrir el editor: " + err.message);
    } finally {
      hideBusy();
    }
  }

  // Dibuja la hoja en el editor con el zoom actual (y sin los textos quitados).
  async function renderEditor() {
    const token = ++ed.renderToken;
    const { doc, index } = ed;
    const pdfPage = await pageFor(doc, index, ed.removals);
    const rotation = (pdfPage.rotate + doc.pages[index].rotation) % 360;
    const unit = pdfPage.getViewport({ scale: 1, rotation });
    const scale = Math.min(
      ed.fit * ed.zoom * (window.devicePixelRatio || 1),
      Math.sqrt(MAX_EDITOR_PIXELS / (unit.width * unit.height))
    );
    const viewport = pdfPage.getViewport({ scale, rotation });
    const tmp = document.createElement("canvas");
    tmp.width = Math.ceil(viewport.width);
    tmp.height = Math.ceil(viewport.height);
    await pdfPage.render({ canvasContext: tmp.getContext("2d"), viewport }).promise;
    if (token !== ed.renderToken || ed.doc !== doc) return;
    for (const c of [edBg, edOverlay]) {
      c.width = tmp.width;
      c.height = tmp.height;
    }
    edBg.getContext("2d").drawImage(tmp, 0, 0);
    ed.pdfPage = pdfPage;
    ed.toCanvas = baseTo(pdfPage, viewport);
    ed.toBase = invert(ed.toCanvas);
    applyWrapSize();
    redraw();
  }

  function applyWrapSize() {
    edWrap.style.width = `${ed.natural.width * ed.fit * ed.zoom}px`;
    edWrap.style.height = `${ed.natural.height * ed.fit * ed.zoom}px`;
  }

  function updateZoomLabel() {
    edZoomFit.textContent = `${Math.round(ed.zoom * 100)}%`;
  }

  // Cambia el zoom manteniendo quieto el punto (clientX, clientY) de la pantalla.
  // La hoja se estira al momento y se vuelve a dibujar nítida un instante después.
  function setZoom(zoom, clientX, clientY) {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    if (!ed.doc || Math.abs(zoom - ed.zoom) < 1e-3) return;
    commitText();
    const stageRect = edStage.getBoundingClientRect();
    if (clientX == null) {
      clientX = stageRect.left + stageRect.width / 2;
      clientY = stageRect.top + stageRect.height / 2;
    }
    const r = edWrap.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    ed.zoom = zoom;
    applyWrapSize();
    const r2 = edWrap.getBoundingClientRect();
    edStage.scrollLeft += r2.left + fx * r2.width - clientX;
    edStage.scrollTop += r2.top + fy * r2.height - clientY;
    updateZoomLabel();
    clearTimeout(ed.zoomTimer);
    ed.zoomTimer = setTimeout(() => renderEditor().catch(console.error), 150);
  }

  $("#ed-zoom-in").addEventListener("click", () => setZoom(ed.zoom * 1.25));
  $("#ed-zoom-out").addEventListener("click", () => setZoom(ed.zoom / 1.25));
  edZoomFit.addEventListener("click", () => setZoom(1));
  edStage.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(ed.zoom * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
  }, { passive: false });

  function setNote(text, ocrButton = false) {
    edNoteText.textContent = text;
    edNote.hidden = !text;
    edOcr.hidden = !ocrButton;
  }

  function closeEditor() {
    commitText(true);
    clearTimeout(ed.zoomTimer);
    ed.renderToken++;
    editorEl.hidden = true;
    document.body.style.overflow = "";
    ed.doc = null;
    ed.pointers.clear();
  }

  function setTool(tool) {
    commitText();
    if (ed.colors[ed.tool]) ed.colors[ed.tool] = edColor.value;
    ed.tool = tool;
    if (ed.colors[tool]) edColor.value = ed.colors[tool];
    if (tool !== "move") select(null);
    editorEl.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    edOverlay.className = tool === "move" ? "move" : tool === "text" || tool === "edittext" ? "text" : "";
    if (tool === "image") edImageInput.click();
    if (tool === "edittext") loadBlocks();
    else setNote("");
    redraw();
  }

  async function loadBlocks() {
    const { doc, index } = ed;
    if (ed.blocks) {
      noteBlocks();
      return;
    }
    setNote("Buscando el texto de la hoja…");
    try {
      const blocks = await textBlocks(doc, index);
      if (ed.doc !== doc || ed.index !== index) return;
      ed.blocks = blocks;
    } catch (err) {
      console.error(err);
      if (ed.doc !== doc || ed.index !== index) return;
      ed.blocks = [];
    }
    if (ed.tool === "edittext") noteBlocks();
    redraw();
  }

  function noteBlocks() {
    if (ed.ocrBlocks.length) {
      setNote("Haz clic en un texto marcado en azul para cambiarlo. Revisa lo digitalizado: puede tener errores.");
    } else if (ed.blocks.length) {
      setNote("Haz clic en un texto marcado en azul para cambiarlo. Si lo dejas vacío, se borra. ¿Falta algún texto?", true);
    } else {
      setNote("Esta hoja no trae texto (es una imagen, un escaneo o letras dibujadas). Puedes digitalizarla para reconocer las letras.", true);
    }
  }

  edOcr.addEventListener("click", async () => {
    const { doc, index } = ed;
    commitText();
    edOcr.disabled = true;
    setNote("Preparando el reconocimiento de letras…");
    try {
      const found = await ocrPage(doc, index, ed.removals, (p) => {
        if (ed.doc === doc) setNote(`Digitalizando la hoja… ${Math.round(p * 100)}%`);
      });
      // Lo que ya es texto del PDF no se repite.
      const blocks = found.filter((o) => !(ed.blocks || []).some((b) =>
        inFrame(b.frame, o.frame.x + o.frame.w / 2, o.frame.y + o.frame.h / 2)));
      doc.pages[index].ocr = blocks;
      if (ed.doc !== doc || ed.index !== index) return;
      ed.ocrBlocks = blocks;
      if (blocks.length) noteBlocks();
      else setNote("No se reconoció ninguna letra en esta hoja.");
    } catch (err) {
      console.error(err);
      if (ed.doc === doc) setNote("No se pudo digitalizar la hoja: " + err.message);
    } finally {
      edOcr.disabled = false;
      redraw();
    }
  });

  function select(obj) {
    ed.selected = obj;
    edDelete.disabled = !obj;
    redraw();
  }

  function pushUndo() {
    ed.undo.push({ objects: cloneObjects(ed.objects), removals: ed.removals.slice() });
    if (ed.undo.length > 100) ed.undo.shift();
  }

  // Caja del objeto en su propio marco: origen, ángulo, ancho y alto.
  function objectFrame(o) {
    if (o.type === "rect") return { x: o.x, y: o.y, angle: 0, w: o.w, h: o.h };
    if (o.type === "image") return { x: o.x, y: o.y, angle: o.angle, w: o.w, h: o.h };
    if (o.type === "text") return { x: o.x, y: o.y, angle: o.angle, ...textBox(o) };
    const xs = o.points.map((p) => p[0]);
    const ys = o.points.map((p) => p[1]);
    const m = o.width / 2 + 2;
    const x = Math.min(...xs) - m;
    const y = Math.min(...ys) - m;
    return { x, y, angle: 0, w: Math.max(...xs) + m - x, h: Math.max(...ys) + m - y };
  }

  function inFrame(f, x, y) {
    const dx = x - f.x;
    const dy = y - f.y;
    const lx = dx * Math.cos(-f.angle) - dy * Math.sin(-f.angle);
    const ly = dx * Math.sin(-f.angle) + dy * Math.cos(-f.angle);
    const tol = 4;
    return lx >= -tol && ly >= -tol && lx <= f.w + tol && ly <= f.h + tol;
  }

  function hitTest(x, y, types) {
    for (let i = ed.objects.length - 1; i >= 0; i--) {
      const o = ed.objects[i];
      if (types && !types.includes(o.type)) continue;
      if (inFrame(objectFrame(o), x, y)) return o;
    }
    return null;
  }

  // Textos del PDF que todavía no se han cambiado.
  function liveBlocks() {
    if (!ed.blocks) return [];
    const gone = new Set(ed.removals.map((r) => r.op));
    const covered = new Set(ed.objects.map((o) => o.fromBlock).filter(Boolean));
    return ed.blocks.filter((b) => !b.removals.some((r) => gone.has(r.op)))
      .concat(ed.ocrBlocks.filter((b) => !covered.has(b.id)));
  }

  function strokeFrame(f, color, dash) {
    edCtx.save();
    edCtx.setTransform(...ed.toCanvas);
    edCtx.translate(f.x, f.y);
    edCtx.rotate(f.angle);
    edCtx.strokeStyle = color;
    edCtx.setLineDash(dash);
    edCtx.lineWidth = 1 / (Math.hypot(ed.toCanvas[0], ed.toCanvas[1]) * cssPerPixel());
    edCtx.strokeRect(-2, -2, f.w + 4, f.h + 4);
    edCtx.restore();
  }

  function redraw() {
    if (!ed.toCanvas) return;
    edCtx.setTransform(1, 0, 0, 1, 0, 0);
    edCtx.clearRect(0, 0, edOverlay.width, edOverlay.height);
    if (ed.tool === "edittext") {
      const editing = ed.textInput?.block;
      for (const b of liveBlocks()) {
        if (b === editing) continue;
        edCtx.save();
        edCtx.setTransform(...ed.toCanvas);
        edCtx.translate(b.frame.x, b.frame.y);
        edCtx.rotate(b.frame.angle);
        edCtx.fillStyle = "rgba(37, 99, 235, 0.08)";
        edCtx.fillRect(-2, -2, b.frame.w + 4, b.frame.h + 4);
        edCtx.restore();
        strokeFrame(b.frame, "rgba(37, 99, 235, 0.55)", []);
      }
    }
    drawObjects(edCtx, ed.objects, ed.toCanvas);
    const d = ed.drag;
    if (d && (d.kind === "highlight" || d.kind === "whiteout")) {
      const r = rectFromDrag(d);
      drawObjects(edCtx, [r], ed.toCanvas);
      strokeFrame({ ...r, x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4, angle: 0 }, "#2563eb", []);
    }
    if (ed.selected) strokeFrame(objectFrame(ed.selected), "#2563eb", [4, 3]);
  }

  function rectFromDrag(d) {
    const whiteout = d.kind === "whiteout";
    return {
      type: "rect",
      x: Math.min(d.x0, d.x1),
      y: Math.min(d.y0, d.y1),
      w: Math.abs(d.x1 - d.x0),
      h: Math.abs(d.y1 - d.y0),
      color: whiteout ? "#ffffff" : edColor.value,
      alpha: whiteout ? 1 : 0.35,
    };
  }

  function pointerBase(e) {
    const r = edOverlay.getBoundingClientRect();
    const k = edOverlay.width / r.width;
    return apply(ed.toBase, (e.clientX - r.left) * k, (e.clientY - r.top) * k);
  }

  // Con dos dedos sobre la hoja se hace zoom (pellizcar) y se desplaza.
  function pinchInfo() {
    const [a, b] = [...ed.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function startPinch() {
    const d = ed.drag;
    // Se descarta lo que hubiera empezado el primer dedo.
    if (d?.kind === "pen") {
      ed.objects = ed.objects.filter((o) => o !== d.obj);
      ed.undo.pop();
    } else if (d?.kind === "move" && d.moved) {
      ed.objects = ed.undo.pop().objects;
      select(null);
    }
    commitText(true);
    const p = pinchInfo();
    ed.drag = { kind: "pinch", dist: p.dist || 1, zoom: ed.zoom, x: p.x, y: p.y };
    redraw();
  }

  edOverlay.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    if (!ed.toCanvas) return;
    ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    edOverlay.setPointerCapture(e.pointerId);
    if (ed.pointers.size === 2) {
      startPinch();
      return;
    }
    if (ed.pointers.size > 2 || ed.drag) return;
    const [x, y] = pointerBase(e);

    if (ed.tool === "text" || ed.tool === "edittext") {
      if (ed.textInput) {
        commitText();
        return;
      }
      const existing = hitTest(x, y, ["text"]);
      if (existing) openTextInput(existing);
      else if (ed.tool === "text") openTextInput(null, x, y);
      else {
        const block = liveBlocks().find((b) => inFrame(b.frame, x, y));
        if (block) openTextInput(null, x, y, block);
      }
      return;
    }

    if (ed.tool === "move" || ed.tool === "image") {
      const hit = hitTest(x, y);
      select(hit);
      if (hit) ed.drag = { kind: "move", x, y, moved: false };
    } else if (ed.tool === "pen") {
      pushUndo();
      const obj = { type: "path", points: [[x, y]], color: edColor.value, width: Math.max(1, edSize.value / 5) };
      ed.objects.push(obj);
      ed.drag = { kind: "pen", obj };
      redraw();
    } else if (ed.tool === "highlight" || ed.tool === "whiteout") {
      ed.drag = { kind: ed.tool, x0: x, y0: y, x1: x, y1: y };
    }
  });

  edOverlay.addEventListener("pointermove", (e) => {
    if (ed.pointers.has(e.pointerId)) ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = ed.drag;
    if (!d) return;
    if (d.kind === "pinch") {
      if (ed.pointers.size < 2) return;
      const p = pinchInfo();
      edStage.scrollLeft -= p.x - d.x;
      edStage.scrollTop -= p.y - d.y;
      d.x = p.x;
      d.y = p.y;
      setZoom(d.zoom * (p.dist / d.dist), p.x, p.y);
      return;
    }
    if (d.kind === "none") return;
    const [x, y] = pointerBase(e);
    if (d.kind === "pen") {
      d.obj.points.push([x, y]);
    } else if (d.kind === "move") {
      if (!d.moved) pushUndo();
      d.moved = true;
      moveObject(ed.selected, x - d.x, y - d.y);
      d.x = x;
      d.y = y;
    } else {
      d.x1 = x;
      d.y1 = y;
    }
    redraw();
  });

  function endDrag(e) {
    ed.pointers.delete(e.pointerId);
    const d = ed.drag;
    if (d?.kind === "pinch" || d?.kind === "none") {
      // Tras pellizcar se ignora el dedo que quede hasta que se levante.
      ed.drag = ed.pointers.size ? { kind: "none" } : null;
      return;
    }
    ed.drag = null;
    if (d && (d.kind === "highlight" || d.kind === "whiteout")) {
      const r = rectFromDrag(d);
      if (r.w > 2 && r.h > 2) {
        pushUndo();
        ed.objects.push(r);
      }
    }
    redraw();
  }
  edOverlay.addEventListener("pointerup", endDrag);
  edOverlay.addEventListener("pointercancel", endDrag);

  function moveObject(o, dx, dy) {
    if (o.type === "path") o.points.forEach((p) => { p[0] += dx; p[1] += dy; });
    else { o.x += dx; o.y += dy; }
  }

  // Píxeles de la hoja dibujada dentro de una caja del marco base.
  function framePixels(frame) {
    const corners = [[0, 0], [frame.w, 0], [0, frame.h], [frame.w, frame.h]].map(([lx, ly]) =>
      apply(ed.toCanvas,
        frame.x + lx * Math.cos(frame.angle) - ly * Math.sin(frame.angle),
        frame.y + lx * Math.sin(frame.angle) + ly * Math.cos(frame.angle)));
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const w = Math.min(edBg.width, Math.ceil(Math.max(...xs))) - x0;
    const h = Math.min(edBg.height, Math.ceil(Math.max(...ys))) - y0;
    if (w < 1 || h < 1) return null;
    return edBg.getContext("2d").getImageData(x0, y0, w, h).data;
  }

  const hex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

  // Color del fondo: el más repetido dentro de la caja (las letras son minoría).
  function sampleBackground(frame) {
    const px = framePixels(frame);
    if (!px) return "#ffffff";
    const count = new Map();
    let best = 0;
    let color = "#ffffff";
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
      const n = (count.get(key) || 0) + 1;
      count.set(key, n);
      if (n > best) {
        best = n;
        color = hex(px[i], px[i + 1], px[i + 2]);
      }
    }
    return color;
  }

  // Color del texto original: el píxel más oscuro dentro de su caja en la hoja dibujada.
  function sampleColor(frame) {
    const px = framePixels(frame);
    if (!px) return "#000000";
    let best = 765;
    let color = "#000000";
    for (let i = 0; i < px.length; i += 4) {
      const lum = px[i] + px[i + 1] + px[i + 2];
      if (px[i + 3] > 200 && lum < best) {
        best = lum;
        color = hex(px[i], px[i + 1], px[i + 2]);
      }
    }
    return best > 600 ? "#000000" : color;
  }

  // Texto equivalente a uno del PDF, colocado sobre su línea base.
  function textFromBlock(block) {
    const obj = {
      type: "text", text: block.text, size: block.size, color: sampleColor(block.frame), angle: block.angle,
      family: block.font.family, bold: block.font.bold, italic: block.font.italic, x: 0, y: 0,
    };
    measureCtx.font = fontCss(obj);
    measureCtx.textBaseline = "top";
    const m = measureCtx.measureText("H");
    measureCtx.textBaseline = "alphabetic";
    const ascent = Math.abs(m.alphabeticBaseline) || obj.size * 0.8;
    obj.x = block.baseline[0] + Math.sin(block.angle) * ascent;
    obj.y = block.baseline[1] - Math.cos(block.angle) * ascent;
    return obj;
  }

  // Cuadro de texto flotante para escribir, editar un texto añadido o cambiar uno del PDF (block).
  function openTextInput(existing, x, y, block) {
    const obj = existing || (block ? textFromBlock(block) : {
      type: "text", x, y, text: "", size: Number(edSize.value), color: edColor.value, angle: uprightAngle(),
    });
    const k = cssPerPixel();
    const scale = Math.hypot(ed.toCanvas[0], ed.toCanvas[1]) * k;
    const [cx, cy] = apply(ed.toCanvas, obj.x, obj.y);
    const ta = document.createElement("textarea");
    ta.className = "ed-text";
    ta.value = obj.text;
    ta.rows = Math.max(1, obj.text.split("\n").length);
    ta.style.left = `${cx * k}px`;
    ta.style.top = `${cy * k}px`;
    ta.style.font = fontCss({ ...obj, size: obj.size * scale });
    ta.style.lineHeight = String(LINE_HEIGHT);
    ta.style.color = obj.color;
    if (obj.text) {
      ta.wrap = "off";
      ta.style.width = `${textBox(obj).w * scale + 24}px`;
    }
    if (block) ta.style.background = "#fff";
    ta.placeholder = "Escribe aquí…";
    edWrap.appendChild(ta);
    ed.textInput = { ta, obj, existing: !!existing, block };
    if (existing) {
      // Se oculta mientras se edita para no verlo duplicado.
      existing.hidden = true;
    }
    redraw();
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitText();
      } else if (e.key === "Escape") {
        commitText(true);
      }
    });
    ta.focus();
    if (block) ta.select();
  }

  function commitText(cancel = false) {
    const t = ed.textInput;
    if (!t) return;
    ed.textInput = null;
    const text = t.ta.value.replace(/\s+$/, "");
    t.ta.remove();
    if (t.block?.ocr) {
      // Un texto digitalizado es parte de la imagen: se cubre con el color del fondo.
      if (!cancel && text !== t.block.text) {
        pushUndo();
        const f = t.block.frame;
        ed.objects.push({
          type: "rect", x: f.x - 1, y: f.y - 1, w: f.w + 2, h: f.h + 2,
          color: sampleBackground(f), alpha: 1, fromBlock: t.block.id,
        });
        if (text) {
          t.obj.text = text;
          t.obj.fromBlock = t.block.id;
          ed.objects.push(t.obj);
        }
      }
    } else if (t.block) {
      // Solo si el texto cambió se quita el original del PDF.
      if (!cancel && text !== t.block.text) {
        pushUndo();
        ed.removals = ed.removals.concat(t.block.removals);
        if (text) {
          t.obj.text = text;
          ed.objects.push(t.obj);
        }
        renderEditor().catch(console.error);
      }
    } else if (t.existing) {
      delete t.obj.hidden;
      if (!cancel && text !== t.obj.text) {
        pushUndo();
        if (text) t.obj.text = text;
        else ed.objects = ed.objects.filter((o) => o !== t.obj);
      }
    } else if (!cancel && text) {
      pushUndo();
      t.obj.text = text;
      ed.objects.push(t.obj);
    }
    redraw();
  }

  edImageInput.addEventListener("change", async () => {
    const file = edImageInput.files[0];
    edImageInput.value = "";
    if (!file || !ed.doc) return;
    try {
      const src = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const img = await loadImage(src);
      const angle = uprightAngle();
      // Ancho visible de la hoja en el marco base, para dar un tamaño inicial razonable.
      const page = ed.pdfPage.getViewport({ scale: 1, rotation: ed.pdfPage.rotate });
      const vertical = Math.abs(Math.sin(angle)) > 0.5;
      const pageW = vertical ? page.height : page.width;
      const w = Math.min(pageW * 0.4, img.naturalWidth);
      const h = (w * img.naturalHeight) / img.naturalWidth;
      // Se centra en la hoja: el centro del objeto girado debe caer en el centro de la página.
      const cx = page.width / 2;
      const cy = page.height / 2;
      const x = cx - (Math.cos(angle) * w - Math.sin(angle) * h) / 2;
      const y = cy - (Math.sin(angle) * w + Math.cos(angle) * h) / 2;
      pushUndo();
      const obj = { type: "image", x, y, w, h, angle, img };
      ed.objects.push(obj);
      setTool("move");
      select(obj);
    } catch (err) {
      console.error(err);
      alert("No se pudo cargar la imagen.");
    }
  });

  function deleteSelected() {
    if (!ed.selected) return;
    pushUndo();
    ed.objects = ed.objects.filter((o) => o !== ed.selected);
    select(null);
  }

  // Aplica un estado (objetos y textos quitados); si cambian los textos, se redibuja la hoja.
  function restore(snapshot) {
    const changed = removalsKey(snapshot.removals) !== removalsKey(ed.removals);
    ed.objects = snapshot.objects;
    ed.removals = snapshot.removals;
    select(null);
    if (changed) renderEditor().catch(console.error);
  }

  function undo() {
    commitText(true);
    if (ed.undo.length) restore(ed.undo.pop());
  }

  editorEl.querySelectorAll(".tool").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
  edDelete.addEventListener("click", deleteSelected);
  $("#ed-undo").addEventListener("click", undo);
  $("#ed-clear").addEventListener("click", () => {
    commitText(true);
    if (!ed.objects.length && !ed.removals.length) return;
    pushUndo();
    restore({ objects: [], removals: [] });
  });
  $("#ed-cancel").addEventListener("click", closeEditor);
  $("#ed-save").addEventListener("click", () => {
    commitText();
    const { doc, index } = ed;
    doc.pages[index].edits = ed.objects;
    doc.pages[index].textRemovals = ed.removals;
    closeEditor();
    refreshThumb(doc, index);
  });

  // Cambiar color o tamaño afecta también al elemento seleccionado.
  edColor.addEventListener("input", () => {
    const o = ed.selected;
    if (!o || o.type === "image" || (o.type === "rect" && o.alpha === 1)) return;
    pushUndo();
    o.color = edColor.value;
    redraw();
  });
  edSize.addEventListener("change", () => {
    const o = ed.selected;
    if (!o) return;
    if (o.type !== "text" && o.type !== "path") return;
    pushUndo();
    if (o.type === "text") o.size = Number(edSize.value);
    else o.width = Math.max(1, edSize.value / 5);
    redraw();
  });

  document.addEventListener("keydown", (e) => {
    if (editorEl.hidden || ed.textInput) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if ((e.key === "Delete" || e.key === "Backspace") && ed.selected) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key.toLowerCase() === "z" && ctrl) {
      e.preventDefault();
      undo();
    } else if (ctrl && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      setZoom(ed.zoom * 1.25);
    } else if (ctrl && e.key === "-") {
      e.preventDefault();
      setZoom(ed.zoom / 1.25);
    } else if (ctrl && e.key === "0") {
      e.preventDefault();
      setZoom(1);
    }
  });

  // ---------- Unir e imprimir ----------

  // Dibuja las ediciones de una hoja en una imagen transparente que cubre la hoja sin girar.
  // Se incrusta a mano (color + máscara de transparencia) en vez de como PNG: en el PNG los
  // píxeles transparentes son negros y algunos visores dejan un borde gris alrededor de lo tapado.
  async function drawEdits(out, page, doc, index) {
    const pdfPage = await doc.pdfjs.getPage(index + 1);
    const unit = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const scale = Math.min(4, EXPORT_MAX_PX / Math.max(unit.width, unit.height));
    const viewport = pdfPage.getViewport({ scale, rotation: 0 });
    const w = Math.ceil(viewport.width);
    const h = Math.ceil(viewport.height);
    const layer = document.createElement("canvas");
    layer.width = w;
    layer.height = h;
    drawObjects(layer.getContext("2d"), doc.pages[index].edits, baseTo(pdfPage, viewport));
    const alpha = layer.getContext("2d").getImageData(0, 0, w, h).data;
    // Color: las ediciones sobre blanco, así los bordes y lo transparente quedan claros.
    const flat = document.createElement("canvas");
    flat.width = w;
    flat.height = h;
    const fctx = flat.getContext("2d");
    fctx.fillStyle = "#fff";
    fctx.fillRect(0, 0, w, h);
    fctx.drawImage(layer, 0, 0);
    const color = fctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    const mask = new Uint8Array(w * h);
    for (let i = 0, j = 0, k = 0; i < color.length; i += 4, j += 3, k++) {
      rgb[j] = color[i];
      rgb[j + 1] = color[i + 1];
      rgb[j + 2] = color[i + 2];
      mask[k] = alpha[i + 3];
    }
    const ctx = out.context;
    const image = { Type: "XObject", Subtype: "Image", Width: w, Height: h, BitsPerComponent: 8 };
    const smask = ctx.register(ctx.flateStream(mask, { ...image, ColorSpace: "DeviceGray" }));
    const ref = ctx.register(ctx.flateStream(rgb, { ...image, ColorSpace: "DeviceRGB", SMask: smask }));
    const name = page.node.newXObject("Ed", ref);
    const [x1, y1, x2, y2] = pdfPage.view;
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(x2 - x1, 0, 0, y2 - y1, x1, y1),
      drawXObject(name),
      popGraphicsState()
    );
  }

  async function buildMergedPdf() {
    const out = await PDFDocument.create();
    for (const doc of docs) {
      const keep = doc.pages.map((p, i) => (p.removed ? -1 : i)).filter((i) => i >= 0);
      if (!keep.length) continue;
      const copied = await out.copyPages(await libDoc(doc), keep);
      for (let k = 0; k < copied.length; k++) {
        const page = copied[k];
        const state = doc.pages[keep[k]];
        out.addPage(page);
        if (state.textRemovals.length) {
          setContents(out, page, contentWithout(await pageContent(doc, keep[k]), state.textRemovals));
        }
        if (state.edits.length) {
          await drawEdits(out, page, doc, keep[k]);
        }
        if (state.rotation) {
          page.setRotation(degrees((page.getRotation().angle + state.rotation) % 360));
        }
      }
    }
    return out.save();
  }

  async function makePdfUrl() {
    const bytes = await buildMergedPdf();
    if (lastPrintUrl) URL.revokeObjectURL(lastPrintUrl);
    lastPrintUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    return lastPrintUrl;
  }

  btnPrint.addEventListener("click", async () => {
    showBusy("Preparando impresión…");
    let url;
    try {
      url = await makePdfUrl();
    } catch (err) {
      console.error(err);
      hideBusy();
      alert("No se pudo generar el PDF para imprimir: " + err.message);
      return;
    }
    printFrame.onload = () => {
      hideBusy();
      // Se da un momento al visor de PDF del navegador para terminar de cargar.
      setTimeout(() => {
        try {
          printFrame.contentWindow.focus();
          printFrame.contentWindow.print();
        } catch (err) {
          // Algunos navegadores (p. ej. Safari en iPhone) no imprimen PDFs desde un iframe.
          window.open(url, "_blank");
        }
      }, 300);
    };
    printFrame.src = url;
  });

  btnDownload.addEventListener("click", async () => {
    showBusy("Generando PDF…");
    try {
      const url = await makePdfUrl();
      const a = document.createElement("a");
      a.href = url;
      a.download = "impresion.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error(err);
      alert("No se pudo generar el PDF: " + err.message);
    } finally {
      hideBusy();
    }
  });

  function showBusy(text) {
    busyText.textContent = text;
    busyEl.hidden = false;
  }
  function hideBusy() {
    busyEl.hidden = true;
  }

  // Lo que usan las herramientas (tools.js): todas trabajan sobre el PDF unido, con las hojas
  // eliminadas, giradas y editadas tal como están en la lista.
  window.ImpresionApp = {
    addFiles,
    buildMergedPdf,
    showBusy,
    hideBusy,
    fileNames: () => docs.map((d) => d.name),
  };

  updateSummary();
})();
