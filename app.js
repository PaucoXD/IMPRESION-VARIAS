/* Impresión Varias: junta varios archivos, permite eliminar, girar y editar hojas e imprime todo de una vez.
   Todo se procesa en el navegador; ningún archivo sale del equipo. */
(() => {
  "use strict";

  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  const { PDFDocument, degrees } = PDFLib;

  // Tamaño A4 en puntos para colocar las imágenes.
  const A4 = [595.28, 841.89];
  const IMAGE_MARGIN = 18;
  const THUMB_WIDTH = 160;
  // Resolución máxima (lado largo, en píxeles) de la capa de edición al generar el PDF.
  const EXPORT_MAX_PX = 2400;
  const FONT = "Helvetica, Arial, sans-serif";
  const LINE_HEIGHT = 1.2;

  // Cada documento: { id, name, bytes, pdfjs, pages: [{ removed, rotation, edits }] }
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
          failed.push(file.name);
        }
      }
    } finally {
      hideBusy();
      updateSummary();
    }
    if (failed.length) {
      alert("No se pudieron abrir estos archivos:\n\n" + failed.join("\n") +
        "\n\nSolo se admiten PDF e imágenes (PDF protegidos con contraseña no son compatibles).");
    }
  }

  async function loadFile(file) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) throw new Error("Tipo no soportado: " + file.type);

    const bytes = isPdf ? new Uint8Array(await file.arrayBuffer()) : await imageToPdf(file);
    // pdf.js se queda con el buffer que recibe, así que le pasamos una copia.
    const pdfjs = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const pages = [];
    for (let i = 0; i < pdfjs.numPages; i++) pages.push({ removed: false, rotation: 0, edits: [] });
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

  // ---------- Dibujo de las ediciones ----------

  const measureCtx = document.createElement("canvas").getContext("2d");

  function textBox(obj) {
    measureCtx.font = `${obj.size}px ${FONT}`;
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
      ctx.font = `${obj.size}px ${FONT}`;
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
    const pdfPage = await doc.pdfjs.getPage(index + 1);
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
    if (state.edits.length) badges.push("✎");
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
    docsEl.querySelector(`.doc[data-id="${doc.id}"]`)?.remove();
    updateSummary();
  }

  btnClear.addEventListener("click", () => {
    if (!confirm("¿Quitar todos los archivos?")) return;
    docs.forEach((d) => d.pdfjs.destroy());
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
  }

  // ---------- Editor de hojas ----------

  const editorEl = $("#editor");
  const edTitle = $("#ed-title");
  const edWrap = $("#ed-wrap");
  const edBg = $("#ed-bg");
  const edOverlay = $("#ed-overlay");
  const edColor = $("#ed-color");
  const edSize = $("#ed-size");
  const edDelete = $("#ed-delete");
  const edImageInput = $("#ed-image-input");
  const edCtx = edOverlay.getContext("2d");

  const ed = {
    doc: null,
    index: 0,
    objects: [],
    undo: [],
    tool: "pen",
    // Cada herramienta recuerda su color.
    colors: { text: "#000000", pen: "#000000", highlight: "#ffeb3b" },
    selected: null,
    drag: null, // acción en curso con el puntero
    toCanvas: null, // marco base -> píxeles del canvas
    toBase: null, // píxeles CSS -> marco base
    dpr: 1,
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

  async function openEditor(doc, index) {
    showBusy("Abriendo editor…");
    try {
      const state = doc.pages[index];
      const pdfPage = await doc.pdfjs.getPage(index + 1);
      const rotation = (pdfPage.rotate + state.rotation) % 360;
      const natural = pdfPage.getViewport({ scale: 1, rotation });
      editorEl.hidden = false;
      edTitle.textContent = `${doc.name} — hoja ${index + 1}`;
      document.body.style.overflow = "hidden";
      const stage = editorEl.querySelector(".editor-stage");
      const pad = window.innerWidth < 600 ? 16 : 32;
      const cssScale = Math.min(
        (stage.clientWidth - pad) / natural.width,
        (stage.clientHeight - pad) / natural.height,
        2.5
      );
      ed.dpr = window.devicePixelRatio || 1;
      const viewport = pdfPage.getViewport({ scale: cssScale * ed.dpr, rotation });

      for (const c of [edBg, edOverlay]) {
        c.width = Math.ceil(viewport.width);
        c.height = Math.ceil(viewport.height);
      }
      edWrap.style.width = `${viewport.width / ed.dpr}px`;
      edWrap.style.height = `${viewport.height / ed.dpr}px`;
      edBg.style.width = edOverlay.style.width = "100%";
      edBg.style.height = edOverlay.style.height = "100%";
      await pdfPage.render({ canvasContext: edBg.getContext("2d"), viewport }).promise;

      Object.assign(ed, {
        doc,
        index,
        pdfPage,
        objects: cloneObjects(state.edits),
        undo: [],
        selected: null,
        drag: null,
        toCanvas: baseTo(pdfPage, viewport),
      });
      ed.toBase = compose(invert(ed.toCanvas), [ed.dpr, 0, 0, ed.dpr, 0, 0]);
      setTool(ed.tool === "image" ? "move" : ed.tool);
      redraw();
    } catch (err) {
      console.error(err);
      closeEditor();
      alert("No se pudo abrir el editor: " + err.message);
    } finally {
      hideBusy();
    }
  }

  function closeEditor() {
    commitText();
    editorEl.hidden = true;
    document.body.style.overflow = "";
    ed.doc = null;
  }

  function setTool(tool) {
    commitText();
    if (ed.colors[ed.tool]) ed.colors[ed.tool] = edColor.value;
    ed.tool = tool;
    if (ed.colors[tool]) edColor.value = ed.colors[tool];
    if (tool !== "move") select(null);
    editorEl.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    edOverlay.className = tool === "move" ? "move" : tool === "text" ? "text" : "";
    if (tool === "image") edImageInput.click();
  }

  function select(obj) {
    ed.selected = obj;
    edDelete.disabled = !obj;
    redraw();
  }

  function pushUndo() {
    ed.undo.push(cloneObjects(ed.objects));
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

  function hitTest(x, y, types) {
    for (let i = ed.objects.length - 1; i >= 0; i--) {
      const o = ed.objects[i];
      if (types && !types.includes(o.type)) continue;
      const f = objectFrame(o);
      const dx = x - f.x;
      const dy = y - f.y;
      const lx = dx * Math.cos(-f.angle) - dy * Math.sin(-f.angle);
      const ly = dx * Math.sin(-f.angle) + dy * Math.cos(-f.angle);
      const tol = 4;
      if (lx >= -tol && ly >= -tol && lx <= f.w + tol && ly <= f.h + tol) return o;
    }
    return null;
  }

  function redraw() {
    edCtx.setTransform(1, 0, 0, 1, 0, 0);
    edCtx.clearRect(0, 0, edOverlay.width, edOverlay.height);
    drawObjects(edCtx, ed.objects, ed.toCanvas);
    const d = ed.drag;
    if (d && (d.kind === "highlight" || d.kind === "whiteout")) {
      drawObjects(edCtx, [rectFromDrag(d)], ed.toCanvas);
      edCtx.save();
      edCtx.setTransform(...ed.toCanvas);
      const r = rectFromDrag(d);
      edCtx.strokeStyle = "#2563eb";
      edCtx.lineWidth = 1;
      edCtx.strokeRect(r.x, r.y, r.w, r.h);
      edCtx.restore();
    }
    if (ed.selected) {
      const f = objectFrame(ed.selected);
      edCtx.save();
      edCtx.setTransform(...ed.toCanvas);
      edCtx.translate(f.x, f.y);
      edCtx.rotate(f.angle);
      edCtx.strokeStyle = "#2563eb";
      edCtx.setLineDash([4, 3]);
      edCtx.lineWidth = 1;
      edCtx.strokeRect(-2, -2, f.w + 4, f.h + 4);
      edCtx.restore();
    }
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
    return apply(ed.toBase, e.clientX - r.left, e.clientY - r.top);
  }

  edOverlay.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const [x, y] = pointerBase(e);

    if (ed.tool === "text") {
      if (ed.textInput) {
        commitText();
        return;
      }
      const existing = hitTest(x, y, ["text"]);
      openTextInput(existing, x, y);
      return;
    }

    edOverlay.setPointerCapture(e.pointerId);
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
    const d = ed.drag;
    if (!d) return;
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

  function endDrag() {
    const d = ed.drag;
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

  // Cuadro de texto flotante para escribir (o editar un texto existente).
  function openTextInput(existing, x, y) {
    const scale = Math.hypot(ed.toCanvas[0], ed.toCanvas[1]) / ed.dpr;
    const obj = existing || {
      type: "text", x, y, text: "", size: Number(edSize.value), color: edColor.value, angle: uprightAngle(),
    };
    const [cx, cy] = apply(ed.toCanvas, obj.x, obj.y);
    const ta = document.createElement("textarea");
    ta.className = "ed-text";
    ta.value = obj.text;
    ta.rows = Math.max(1, obj.text.split("\n").length);
    ta.style.left = `${cx / ed.dpr}px`;
    ta.style.top = `${cy / ed.dpr}px`;
    ta.style.fontSize = `${obj.size * scale}px`;
    ta.style.color = obj.color;
    ta.placeholder = "Escribe aquí…";
    edWrap.appendChild(ta);
    ed.textInput = { ta, obj, existing: !!existing };
    if (existing) {
      // Se oculta mientras se edita para no verlo duplicado.
      existing.hidden = true;
      redraw();
    }
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
  }

  function commitText(cancel = false) {
    const t = ed.textInput;
    if (!t) return;
    ed.textInput = null;
    const text = t.ta.value.replace(/\s+$/, "");
    t.ta.remove();
    if (t.existing) {
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

  function undo() {
    commitText(true);
    if (!ed.undo.length) return;
    ed.objects = ed.undo.pop();
    select(null);
  }

  editorEl.querySelectorAll(".tool").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
  edDelete.addEventListener("click", deleteSelected);
  $("#ed-undo").addEventListener("click", undo);
  $("#ed-clear").addEventListener("click", () => {
    commitText(true);
    if (!ed.objects.length) return;
    pushUndo();
    ed.objects = [];
    select(null);
  });
  $("#ed-cancel").addEventListener("click", closeEditor);
  $("#ed-save").addEventListener("click", () => {
    commitText();
    const { doc, index } = ed;
    doc.pages[index].edits = ed.objects;
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
    if ((e.key === "Delete" || e.key === "Backspace") && ed.selected) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      undo();
    }
  });

  // ---------- Unir e imprimir ----------

  // Dibuja las ediciones de una hoja en un PNG transparente que cubre la hoja sin girar.
  async function editsToPng(doc, index) {
    const pdfPage = await doc.pdfjs.getPage(index + 1);
    const unit = pdfPage.getViewport({ scale: 1, rotation: 0 });
    const scale = Math.min(4, EXPORT_MAX_PX / Math.max(unit.width, unit.height));
    const viewport = pdfPage.getViewport({ scale, rotation: 0 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    drawObjects(canvas.getContext("2d"), doc.pages[index].edits, baseTo(pdfPage, viewport));
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const [x1, y1, x2, y2] = pdfPage.view;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  async function buildMergedPdf() {
    const out = await PDFDocument.create();
    for (const doc of docs) {
      const keep = doc.pages.map((p, i) => (p.removed ? -1 : i)).filter((i) => i >= 0);
      if (!keep.length) continue;
      const src = await PDFDocument.load(doc.bytes, { ignoreEncryption: true });
      const copied = await out.copyPages(src, keep);
      for (let k = 0; k < copied.length; k++) {
        const page = copied[k];
        const state = doc.pages[keep[k]];
        out.addPage(page);
        if (state.edits.length) {
          const png = await editsToPng(doc, keep[k]);
          const img = await out.embedPng(png.bytes);
          page.drawImage(img, { x: png.x, y: png.y, width: png.width, height: png.height });
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

  updateSummary();
})();
