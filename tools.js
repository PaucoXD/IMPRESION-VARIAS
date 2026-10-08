/* Herramientas: página de inicio con la cuadrícula de herramientas y las que generan un archivo
   nuevo (dividir, comprimir, PDF a JPG, marca de agua y números de página).
   Todas parten del PDF unido de la lista, así respetan las hojas eliminadas, giradas y editadas. */
(() => {
  "use strict";

  const app = window.ImpresionApp;
  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
  const $ = (sel) => document.querySelector(sel);

  const CATEGORIES = [
    ["todas", "Todas"],
    ["organizar", "Organizar"],
    ["optimizar", "Optimizar"],
    ["convertir", "Convertir"],
    ["editar", "Editar"],
    ["seguridad", "Seguridad"],
  ];

  const ICONS = {
    merge: "M4 6h7M4 12h7M4 18h7M15 6l5 6-5 6",
    split: "M12 3v18M4 7l4 5-4 5M20 7l-4 5 4 5",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
    rotate: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
    order: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
    compress: "M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M4 12h16",
    ocr: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 12h8M8 15h5",
    image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
    toImage: "M4 4h9l4 4v4M4 4v16h6M8 12h4M8 16h2M13 15h8v6h-8zM13 20l3-3 2 2 3-3",
    edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
    sign: "M3 17c3-1 4-6 6-6s0 6 2 6 3-3 4-3 2 2 3 2M3 21h18",
    water: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z",
    numbers: "M5 5l3-1v16M5 20h6M14 8a3 3 0 1 1 5 2l-5 6h6",
    print: "M7 9V3h10v6M7 17H4v-7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7h-3M7 14h10v7H7z",
    crop: "M6 2v16h16M2 6h16v16",
    lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
    unlock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2",
    redact: "M4 5h16v4H4zM4 13h7M4 17h12",
  };

  const COLORS = {
    organizar: "#0b2a9a",
    optimizar: "#4fa82f",
    convertir: "#1f6fd1",
    editar: "#0e7c86",
    seguridad: "#041a71",
  };

  // kind: "lista" = se hace en la lista de hojas (unir, girar, editar…); "panel" = genera un archivo
  // nuevo con opciones; "pronto" = todavía no disponible.
  const TOOLS = [
    { id: "unir", cat: "organizar", icon: "merge", kind: "lista", name: "Unir e imprimir",
      desc: "Junta varios PDF e imágenes en uno solo y mándalo a imprimir de una vez.",
      help: "Agrega tus archivos, ordénalos con ↑ ↓ y pulsa Descargar PDF o Imprimir todo." },
    { id: "dividir", cat: "organizar", icon: "split", kind: "panel", name: "Dividir PDF",
      desc: "Separa cada hoja en un PDF aparte, divide por rangos o extrae solo las hojas que quieras." },
    { id: "eliminar", cat: "organizar", icon: "trash", kind: "lista", name: "Eliminar páginas",
      desc: "Quita las hojas que no necesitas antes de guardar o imprimir.",
      help: "Pulsa ✕ bajo cada hoja que quieras quitar, o escribe un rango (ej. 2, 4-6) en Eliminar hojas." },
    { id: "rotar", cat: "organizar", icon: "rotate", kind: "lista", name: "Rotar PDF",
      desc: "Gira una hoja o todas las hojas del documento.",
      help: "Usa ↺ ↻ bajo cada hoja o ↻ Girar todas para el archivo completo." },
    { id: "ordenar", cat: "organizar", icon: "order", kind: "pronto", name: "Ordenar páginas",
      desc: "Arrastra las hojas para cambiar su orden dentro del documento." },
    { id: "comprimir", cat: "optimizar", icon: "compress", kind: "panel", name: "Comprimir PDF",
      desc: "Reduce el peso del PDF para enviarlo por correo o WhatsApp." },
    { id: "ocr", cat: "optimizar", icon: "ocr", kind: "lista", name: "Digitalizar (OCR)",
      desc: "Reconoce las letras de hojas escaneadas o fotos para poder cambiarlas.",
      help: "Abre una hoja con ✎, elige Editar texto y pulsa Digitalizar." },
    { id: "jpg-a-pdf", cat: "convertir", icon: "image", kind: "lista", name: "JPG a PDF", accept: "image/*",
      desc: "Convierte fotos e imágenes (JPG, PNG, WEBP…) en un PDF.",
      help: "Agrega tus imágenes; cada una queda en una hoja A4. Luego pulsa Descargar PDF." },
    { id: "pdf-a-jpg", cat: "convertir", icon: "toImage", kind: "panel", name: "PDF a JPG",
      desc: "Convierte cada hoja del PDF en una imagen JPG." },
    { id: "editar", cat: "editar", icon: "edit", kind: "lista", name: "Editar PDF",
      desc: "Cambia el texto que ya trae, escribe, dibuja, resalta o tapa partes de la hoja.",
      help: "Haz clic en una hoja (o en ✎) para abrir el editor." },
    { id: "firmar", cat: "editar", icon: "sign", kind: "lista", name: "Firmar PDF",
      desc: "Firma a mano o pon la imagen de tu firma en cualquier hoja.",
      help: "Abre la hoja con ✎ y usa Dibujar para firmar a mano, o Imagen para poner la foto de tu firma." },
    { id: "marca-agua", cat: "editar", icon: "water", kind: "panel", name: "Marca de agua",
      desc: "Pon un texto como CONFIDENCIAL o COPIA en todas las hojas." },
    { id: "numeros", cat: "editar", icon: "numbers", kind: "panel", name: "Números de página",
      desc: "Numera las hojas eligiendo la posición, el formato y el tamaño." },
    { id: "recortar", cat: "editar", icon: "crop", kind: "pronto", name: "Recortar PDF",
      desc: "Quita los márgenes de las hojas o deja solo una parte." },
    { id: "censurar", cat: "seguridad", icon: "redact", kind: "pronto", name: "Censurar PDF",
      desc: "Borra para siempre textos y datos privados del documento." },
    { id: "proteger", cat: "seguridad", icon: "lock", kind: "pronto", name: "Proteger PDF",
      desc: "Pon una contraseña para que nadie más pueda abrir el PDF." },
    { id: "desbloquear", cat: "seguridad", icon: "unlock", kind: "pronto", name: "Desbloquear PDF",
      desc: "Quita la contraseña de un PDF del que la conoces." },
  ];

  const svgIcon = (name) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${ICONS[name]}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ---------- Inicio: cuadrícula de herramientas ----------

  const grid = $("#tools-grid");
  const chips = $("#tool-chips");
  let category = "todas";

  chips.innerHTML = CATEGORIES.map(([id, label]) =>
    `<button type="button" class="chip" data-cat="${id}">${label}</button>`).join("");
  chips.addEventListener("click", (e) => {
    const cat = e.target.closest(".chip")?.dataset.cat;
    if (!cat) return;
    category = cat;
    renderGrid();
  });

  function renderGrid() {
    chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.cat === category));
    grid.innerHTML = "";
    for (const t of TOOLS) {
      if (category !== "todas" && t.cat !== category) continue;
      const soon = t.kind === "pronto";
      const card = document.createElement(soon ? "div" : "a");
      card.className = "tool-card" + (soon ? " soon" : "");
      if (!soon) card.href = "#" + t.id;
      else card.setAttribute("aria-disabled", "true");
      card.style.setProperty("--tool-color", COLORS[t.cat]);
      card.innerHTML = `<span class="tool-icon">${svgIcon(t.icon)}</span>
        ${soon ? '<span class="soon-badge">Pronto</span>' : ""}
        <strong></strong><span class="tool-desc"></span>`;
      card.querySelector("strong").textContent = t.name;
      card.querySelector(".tool-desc").textContent = t.desc;
      grid.appendChild(card);
    }
  }

  // ---------- Navegación (#herramienta en la dirección) ----------

  const toolHead = $("#tool-head");
  const panel = $("#tool-panel");
  const fileInput = $("#file-input");
  const dropText = $("#drop-formats");
  let current = null;
  let pageCount = 0;

  function route() {
    const tool = TOOLS.find((t) => t.id === location.hash.slice(1) && t.kind !== "pronto") || null;
    current = tool;
    document.body.classList.toggle("view-home", !tool);
    document.body.classList.toggle("view-tool", !!tool);
    if (!tool) {
      document.title = "Impresión Varias · A&C Group";
      return;
    }
    document.title = `${tool.name} · Impresión Varias`;
    toolHead.style.setProperty("--tool-color", COLORS[tool.cat]);
    toolHead.querySelector(".tool-icon").innerHTML = svgIcon(tool.icon);
    toolHead.querySelector("h2").textContent = tool.name;
    toolHead.querySelector("p").textContent = tool.help || tool.desc;
    fileInput.accept = tool.accept || "application/pdf,image/*";
    dropText.textContent = tool.accept ? "JPG, PNG, WEBP, GIF…" : "PDF, JPG, PNG, WEBP, GIF…";
    renderPanel(tool);
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);

  // En el inicio, soltar archivos en cualquier parte abre "Unir e imprimir" con ellos.
  window.addEventListener("drop", (e) => {
    if (current || !e.dataTransfer?.files?.length) return;
    location.hash = "unir";
    app.addFiles(e.dataTransfer.files);
  });

  document.addEventListener("docs-change", (e) => {
    pageCount = e.detail.pages;
    updatePanelState();
  });

  // ---------- Panel de opciones de cada herramienta ----------

  const PANELS = {
    dividir: {
      action: "Dividir PDF",
      html: `
        <fieldset class="opt-group">
          <legend>¿Cómo quieres dividirlo?</legend>
          <label class="opt"><input type="radio" name="split-mode" value="each" checked> Cada hoja en un PDF aparte</label>
          <label class="opt"><input type="radio" name="split-mode" value="ranges"> Por rangos (cada rango, un PDF)</label>
          <label class="opt"><input type="radio" name="split-mode" value="extract"> Extraer hojas en un solo PDF</label>
        </fieldset>
        <label class="field" data-show="ranges extract">Hojas
          <input type="text" name="split-pages" placeholder="ej. 1-3, 4-6, 9" autocomplete="off">
        </label>
        <p class="panel-note">Las hojas se cuentan como quedan en la lista, sin las eliminadas.
          Si salen varios PDF se descargan juntos en un archivo ZIP.</p>`,
      run: splitPdf,
    },
    comprimir: {
      action: "Comprimir PDF",
      html: `
        <fieldset class="opt-group">
          <legend>Nivel de compresión</legend>
          <label class="opt"><input type="radio" name="level" value="low"> Poca: mejor calidad</label>
          <label class="opt"><input type="radio" name="level" value="mid" checked> Recomendada: buena calidad y menos peso</label>
          <label class="opt"><input type="radio" name="level" value="high"> Extrema: el menor peso posible</label>
        </fieldset>
        <p class="panel-note">Las hojas se guardan como imagen: el PDF pesa menos, pero sus letras ya no
          se pueden seleccionar ni buscar.</p>`,
      run: compressPdf,
    },
    "pdf-a-jpg": {
      action: "Convertir a JPG",
      html: `
        <fieldset class="opt-group">
          <legend>Calidad de las imágenes</legend>
          <label class="opt"><input type="radio" name="dpi" value="150" checked> Normal (150 ppp)</label>
          <label class="opt"><input type="radio" name="dpi" value="300"> Alta (300 ppp, para imprimir)</label>
        </fieldset>
        <p class="panel-note">Cada hoja se guarda como una imagen JPG. Si son varias, se descargan juntas en un ZIP.</p>`,
      run: pdfToJpg,
    },
    "marca-agua": {
      action: "Poner marca de agua",
      html: `
        <label class="field">Texto <input type="text" name="wm-text" value="CONFIDENCIAL" maxlength="80"></label>
        <label class="field">Posición
          <select name="wm-pos">
            <option value="diagonal">Diagonal en el centro</option>
            <option value="center">Centro</option>
            <option value="top">Arriba</option>
            <option value="bottom">Abajo</option>
          </select>
        </label>
        <div class="field-row">
          <label class="field">Color <input type="color" name="wm-color" value="#d92d2d"></label>
          <label class="field">Tamaño <input type="range" name="wm-size" min="16" max="140" value="64"></label>
          <label class="field">Transparencia <input type="range" name="wm-opacity" min="5" max="100" value="25"></label>
        </div>`,
      run: watermarkPdf,
    },
    numeros: {
      action: "Numerar páginas",
      html: `
        <label class="field">Posición
          <select name="num-pos">
            <option value="bottom-center">Abajo al centro</option>
            <option value="bottom-right">Abajo a la derecha</option>
            <option value="bottom-left">Abajo a la izquierda</option>
            <option value="top-center">Arriba al centro</option>
            <option value="top-right">Arriba a la derecha</option>
            <option value="top-left">Arriba a la izquierda</option>
          </select>
        </label>
        <label class="field">Formato
          <select name="num-format">
            <option value="n">1</option>
            <option value="page">Página 1</option>
            <option value="page-of">Página 1 de 9</option>
            <option value="slash">1 / 9</option>
          </select>
        </label>
        <div class="field-row">
          <label class="field">Numerar desde la hoja <input type="number" name="num-from" value="1" min="1"></label>
          <label class="field">Primer número <input type="number" name="num-start" value="1" min="0"></label>
        </div>
        <div class="field-row">
          <label class="field">Color <input type="color" name="num-color" value="#000000"></label>
          <label class="field">Tamaño <input type="range" name="num-size" min="7" max="28" value="11"></label>
        </div>`,
      run: numberPages,
    },
  };

  function renderPanel(tool) {
    const def = PANELS[tool.id];
    panel.hidden = !def;
    if (!def) return;
    panel.innerHTML = `<form class="panel-form">${def.html}
      <div class="panel-actions">
        <button type="submit" class="btn primary">${def.action}</button>
        <span class="panel-result" role="status"></span>
      </div></form>`;
    const form = panel.querySelector("form");
    const syncVisible = () => {
      const mode = form.elements["split-mode"]?.value;
      form.querySelectorAll("[data-show]").forEach((el) => (el.hidden = !el.dataset.show.split(" ").includes(mode)));
    };
    form.addEventListener("change", syncVisible);
    syncVisible();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!pageCount) return;
      const result = form.querySelector(".panel-result");
      result.textContent = "";
      app.showBusy("Procesando…");
      try {
        result.textContent = (await def.run(form)) || "";
      } catch (err) {
        console.error(err);
        alert(err.userMessage || "No se pudo completar: " + err.message);
      } finally {
        app.hideBusy();
      }
    });
    updatePanelState();
  }

  function updatePanelState() {
    const btn = panel.querySelector("button[type=submit]");
    if (btn) {
      btn.disabled = !pageCount;
      btn.title = pageCount ? "" : "Primero agrega un archivo";
    }
  }

  const userError = (msg) => Object.assign(new Error(msg), { userMessage: msg });

  // ---------- Utilidades ----------

  function baseName() {
    const names = app.fileNames();
    const first = (names[0] || "documento").replace(/\.[^.]+$/, "");
    return names.length > 1 ? first + "-y-mas" : first;
  }

  function download(data, name, type) {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
  }

  // "1-3, 5" -> [[0,1,2],[4]] (cada grupo separado por coma).
  function parseGroups(text, max) {
    const groups = [];
    for (const part of text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) return null;
      let a = Number(m[1]);
      let b = m[2] ? Number(m[2]) : a;
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > max) return null;
      const g = [];
      for (let i = a; i <= b; i++) g.push(i - 1);
      groups.push(g);
    }
    return groups.length ? groups : null;
  }

  // ZIP sin compresión (los PDF y JPG ya vienen comprimidos).
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.bytes);
      const size = f.bytes.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // nombres en UTF-8
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      parts.push(local, name, f.bytes);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(cd, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  // Renderiza cada hoja del PDF unido como JPG; onPage recibe la imagen y el tamaño de la hoja en puntos.
  async function rasterize(bytes, dpi, quality, onPage) {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        app.showBusy(`Procesando hoja ${i} de ${pdf.numPages}…`);
        const page = await pdf.getPage(i);
        const unit = page.getViewport({ scale: 1 });
        // Límite de píxeles para no agotar la memoria en hojas muy grandes.
        const scale = Math.min(dpi / 72, Math.sqrt(16e6 / (unit.width * unit.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
        canvas.width = canvas.height = 0;
        await onPage(new Uint8Array(await blob.arrayBuffer()), unit.width, unit.height, i);
        page.cleanup();
      }
    } finally {
      pdf.destroy();
    }
  }

  // Para escribir sobre una hoja tal como se ve (con su giro): convierte coordenadas "visuales"
  // (desde la esquina inferior izquierda de la hoja vista) a las del PDF.
  function visualFrame(page) {
    const { x, y, width, height } = page.getCropBox();
    const r = ((page.getRotation().angle % 360) + 360) % 360;
    const toUser = (u, v) =>
      r === 90 ? [x + width - v, y + u] :
      r === 180 ? [x + width - u, y + height - v] :
      r === 270 ? [x + v, y + height - u] : [x + u, y + v];
    return { W: r % 180 ? height : width, H: r % 180 ? width : height, r, toUser };
  }

  // Dibuja un texto con su punto de anclaje (izquierda, centro o derecha, centrado en vertical) en
  // (u, v) de la hoja vista, girado "angle" grados.
  function drawLabel(page, frame, font, text, opts) {
    const { u, v, size, color, opacity = 1, angle = 0, align = "center" } = opts;
    const w = font.widthOfTextAtSize(text, size);
    const capH = font.heightAtSize(size, { descender: false }) * 0.72;
    const dx = align === "left" ? 0 : align === "right" ? -w : -w / 2;
    const dy = -capH / 2;
    const a = (angle * Math.PI) / 180;
    const [x, y] = frame.toUser(u + dx * Math.cos(a) - dy * Math.sin(a), v + dx * Math.sin(a) + dy * Math.cos(a));
    page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees(angle + frame.r) });
  }

  function hexColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // Las fuentes estándar del PDF solo tienen letras latinas (incluye acentos y ñ).
  function checkLatin(font, text) {
    try {
      font.encodeText(text);
    } catch {
      throw userError("El texto tiene letras o símbolos que no se pueden usar (por ejemplo emojis). Usa letras, números y signos comunes.");
    }
  }

  // ---------- Herramientas ----------

  async function splitPdf(form) {
    const bytes = await app.buildMergedPdf();
    const src = await PDFDocument.load(bytes);
    const total = src.getPageCount();
    const mode = form.elements["split-mode"].value;
    let groups;
    if (mode === "each") {
      groups = src.getPageIndices().map((i) => [i]);
    } else {
      groups = parseGroups(form.elements["split-pages"].value, total);
      if (!groups) throw userError(`Escribe hojas válidas entre 1 y ${total}, por ejemplo: 1-3, 4-6, 9`);
      if (mode === "extract") groups = [[...new Set(groups.flat())]];
    }
    const base = baseName();
    const files = [];
    for (const g of groups) {
      const out = await PDFDocument.create();
      (await out.copyPages(src, g)).forEach((p) => out.addPage(p));
      const label = g.length === 1 ? `hoja-${g[0] + 1}` :
        mode === "extract" ? "extracto" : `hojas-${g[0] + 1}-${g[g.length - 1] + 1}`;
      files.push({ name: `${base}-${label}.pdf`, bytes: await out.save() });
    }
    if (files.length === 1) {
      download(files[0].bytes, files[0].name, "application/pdf");
      return "Listo: se descargó 1 PDF.";
    }
    download(makeZip(files), `${base}-dividido.zip`);
    return `Listo: ${files.length} PDF en un ZIP.`;
  }

  const LEVELS = { low: [150, 0.75], mid: [110, 0.6], high: [80, 0.42] };

  async function compressPdf(form) {
    const bytes = await app.buildMergedPdf();
    const [dpi, quality] = LEVELS[form.elements.level.value];
    const out = await PDFDocument.create();
    await rasterize(bytes, dpi, quality, async (jpg, w, h) => {
      const img = await out.embedJpg(jpg);
      out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    });
    const result = await out.save();
    const before = formatSize(bytes.length);
    if (result.length >= bytes.length * 0.95) {
      return `Este PDF ya está bien comprimido (${before}); no se pudo reducir más. Prueba la compresión extrema.`;
    }
    download(result, `${baseName()}-comprimido.pdf`, "application/pdf");
    const saved = Math.round((1 - result.length / bytes.length) * 100);
    return `Listo: de ${before} a ${formatSize(result.length)} (${saved}% menos).`;
  }

  async function pdfToJpg(form) {
    const bytes = await app.buildMergedPdf();
    const dpi = Number(form.elements.dpi.value);
    const base = baseName();
    const files = [];
    await rasterize(bytes, dpi, 0.9, (jpg, w, h, n) => files.push({ name: `${base}-hoja-${n}.jpg`, bytes: jpg }));
    if (files.length === 1) {
      download(files[0].bytes, files[0].name, "image/jpeg");
      return "Listo: se descargó la imagen.";
    }
    download(makeZip(files), `${base}-jpg.zip`);
    return `Listo: ${files.length} imágenes en un ZIP.`;
  }

  async function watermarkPdf(form) {
    const text = form.elements["wm-text"].value.trim();
    if (!text) throw userError("Escribe el texto de la marca de agua.");
    const pdf = await PDFDocument.load(await app.buildMergedPdf());
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    checkLatin(font, text);
    const pos = form.elements["wm-pos"].value;
    const color = hexColor(form.elements["wm-color"].value);
    const opacity = Number(form.elements["wm-opacity"].value) / 100;
    const wanted = Number(form.elements["wm-size"].value);
    for (const page of pdf.getPages()) {
      const f = visualFrame(page);
      const angle = pos === "diagonal" ? (Math.atan2(f.H, f.W) * 180) / Math.PI : 0;
      // Que el texto quepa en la hoja: más pequeño si no entra.
      const room = pos === "diagonal" ? Math.hypot(f.W, f.H) * 0.8 : f.W * 0.9;
      const size = Math.min(wanted, (wanted * room) / font.widthOfTextAtSize(text, wanted));
      const v = pos === "top" ? f.H - size * 1.2 : pos === "bottom" ? size * 1.2 : f.H / 2;
      drawLabel(page, f, font, text, { u: f.W / 2, v, size, color, opacity, angle });
    }
    download(await pdf.save(), `${baseName()}-marca-de-agua.pdf`, "application/pdf");
    return "Listo: se descargó el PDF con la marca de agua.";
  }

  async function numberPages(form) {
    const pdf = await PDFDocument.load(await app.buildMergedPdf());
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const [vert, horiz] = form.elements["num-pos"].value.split("-");
    const format = form.elements["num-format"].value;
    const from = Math.max(1, Math.floor(Number(form.elements["num-from"].value) || 1));
    const start = Math.floor(Number(form.elements["num-start"].value) || 0);
    const size = Number(form.elements["num-size"].value);
    const color = hexColor(form.elements["num-color"].value);
    const pages = pdf.getPages();
    if (from > pages.length) throw userError(`El documento tiene ${pages.length} hojas; elige una hoja entre 1 y ${pages.length}.`);
    const last = start + pages.length - from;
    const margin = 28;
    pages.forEach((page, i) => {
      if (i + 1 < from) return;
      const n = start + i + 1 - from;
      const text = format === "page" ? `Página ${n}` : format === "page-of" ? `Página ${n} de ${last}` :
        format === "slash" ? `${n} / ${last}` : String(n);
      const f = visualFrame(page);
      const u = horiz === "left" ? margin : horiz === "right" ? f.W - margin : f.W / 2;
      const v = vert === "top" ? f.H - margin : margin;
      drawLabel(page, f, font, text, { u, v, size, color, align: horiz });
    });
    download(await pdf.save(), `${baseName()}-numerado.pdf`, "application/pdf");
    return "Listo: se descargó el PDF numerado.";
  }

  renderGrid();
  route();
})();
