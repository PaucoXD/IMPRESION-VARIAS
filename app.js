/* Impresión Varias: junta varios archivos, permite eliminar hojas e imprime todo de una vez.
   Todo se procesa en el navegador; ningún archivo sale del equipo. */
(() => {
  "use strict";

  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  const { PDFDocument } = PDFLib;

  // Tamaño A4 en puntos para colocar las imágenes.
  const A4 = [595.28, 841.89];
  const IMAGE_MARGIN = 18;
  const THUMB_WIDTH = 160;

  // Cada documento: { id, name, kind: "pdf" | "image", bytes, pages: [{ removed }], pdfjs?, image? }
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

    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = { id: nextId++, name: file.name, kind: isPdf ? "pdf" : "image", pages: [] };

    if (isPdf) {
      // pdf.js se queda con el buffer que recibe, así que le pasamos una copia.
      doc.pdfjs = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      doc.bytes = bytes;
      for (let i = 0; i < doc.pdfjs.numPages; i++) doc.pages.push({ removed: false });
    } else {
      doc.image = await normalizeImage(file, bytes);
      doc.pages.push({ removed: false });
    }
    return doc;
  }

  // pdf-lib solo incrusta JPG y PNG; el resto de formatos se convierte a PNG con un canvas.
  async function normalizeImage(file, bytes) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Imagen no válida"));
        el.src = url;
      });
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (file.type === "image/jpeg") return { type: "jpg", bytes, width, height, url };
      if (file.type === "image/png") return { type: "png", bytes, width, height, url };

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      return { type: "png", bytes: new Uint8Array(await blob.arrayBuffer()), width, height, url };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  // ---------- Interfaz ----------

  function renderDoc(doc) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = doc.id;
    node.querySelector(".doc-name").textContent = doc.name;
    const pagesEl = node.querySelector(".pages");

    doc.pages.forEach((page, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "page";
      btn.dataset.index = i;
      btn.title = `Hoja ${i + 1} — clic para eliminar o restaurar`;
      btn.innerHTML = `<span class="num">${i + 1}</span><span class="x">✕</span>`;
      if (doc.kind === "image") {
        const img = document.createElement("img");
        img.src = doc.image.url;
        img.alt = doc.name;
        btn.prepend(img);
      } else {
        thumbObserver.observe(btn);
      }
      btn.addEventListener("click", () => {
        page.removed = !page.removed;
        refreshDoc(doc);
      });
      pagesEl.appendChild(btn);
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
      if (act === "up" || act === "down") moveDoc(doc, act === "up" ? -1 : 1);
      if (act === "remove") removeDoc(doc);
    });

    docsEl.appendChild(node);
    refreshDoc(doc);
  }

  async function onThumbVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const btn = entry.target;
      thumbObserver.unobserve(btn);
      const doc = docs.find((d) => d.id === Number(btn.closest(".doc").dataset.id));
      if (!doc) continue;
      try {
        const page = await doc.pdfjs.getPage(Number(btn.dataset.index) + 1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (THUMB_WIDTH * (window.devicePixelRatio || 1)) / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        btn.prepend(canvas);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function refreshDoc(doc) {
    const node = docsEl.querySelector(`.doc[data-id="${doc.id}"]`);
    if (!node) return;
    node.querySelectorAll(".page").forEach((btn) => {
      btn.classList.toggle("removed", doc.pages[btn.dataset.index].removed);
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
    disposeDoc(doc);
    docsEl.querySelector(`.doc[data-id="${doc.id}"]`)?.remove();
    updateSummary();
  }

  function disposeDoc(doc) {
    doc.pdfjs?.destroy();
    if (doc.image) URL.revokeObjectURL(doc.image.url);
  }

  btnClear.addEventListener("click", () => {
    if (!confirm("¿Quitar todos los archivos?")) return;
    docs.forEach(disposeDoc);
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

  // ---------- Unir e imprimir ----------

  async function buildMergedPdf() {
    const out = await PDFDocument.create();
    for (const doc of docs) {
      const keep = doc.pages.map((p, i) => (p.removed ? -1 : i)).filter((i) => i >= 0);
      if (!keep.length) continue;

      if (doc.kind === "pdf") {
        const src = await PDFDocument.load(doc.bytes, { ignoreEncryption: true });
        const copied = await out.copyPages(src, keep);
        copied.forEach((p) => out.addPage(p));
      } else {
        const { type, bytes, width, height } = doc.image;
        const img = type === "jpg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        const [pw, ph] = width > height ? [A4[1], A4[0]] : A4;
        const scale = Math.min((pw - IMAGE_MARGIN * 2) / width, (ph - IMAGE_MARGIN * 2) / height, 1);
        const w = width * scale;
        const h = height * scale;
        const page = out.addPage([pw, ph]);
        page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
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
