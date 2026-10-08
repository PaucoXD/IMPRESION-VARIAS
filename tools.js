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
    { id: "ordenar", cat: "organizar", icon: "order", kind: "panel", ownView: true, name: "Ordenar páginas",
      desc: "Arrastra las hojas para cambiar su orden, aunque vengan de archivos distintos.",
      help: "Arrastra cada hoja a su lugar (en el celular, mantén el dedo sobre la hoja y luego muévela) o usa ◀ ▶." },
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
    { id: "recortar", cat: "editar", icon: "crop", kind: "panel", name: "Recortar PDF",
      desc: "Quita los márgenes en blanco de las hojas o recorta los milímetros que elijas." },
    { id: "marca-agua", cat: "editar", icon: "water", kind: "panel", name: "Marca de agua",
      desc: "Pon un texto como CONFIDENCIAL o COPIA en todas las hojas." },
    { id: "numeros", cat: "editar", icon: "numbers", kind: "panel", name: "Números de página",
      desc: "Numera las hojas eligiendo la posición, el formato y el tamaño." },
    { id: "censurar", cat: "seguridad", icon: "redact", kind: "panel", ownView: true, name: "Censurar PDF",
      desc: "Borra para siempre textos y datos privados: nombres, números de cuenta, firmas…",
      help: "Busca un texto para tacharlo en todas las hojas o arrastra sobre la hoja para tapar lo que quieras." },
    { id: "proteger", cat: "seguridad", icon: "lock", kind: "panel", name: "Proteger PDF",
      desc: "Pon una contraseña para que nadie más pueda abrir el PDF." },
    { id: "desbloquear", cat: "seguridad", icon: "unlock", kind: "lista", name: "Desbloquear PDF",
      desc: "Quita la contraseña de un PDF del que la conoces.",
      help: "Agrega el PDF y escribe su contraseña cuando te la pida. Luego pulsa Descargar PDF: se guarda sin contraseña." },
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
    document.body.classList.toggle("own-view", !!tool?.ownView);
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

  // Las herramientas con vista propia (ordenar, censurar) se vuelven a armar si cambia la lista.
  let refreshTimer = null;
  document.addEventListener("docs-change", (e) => {
    pageCount = e.detail.pages;
    updatePanelState();
    const def = current && PANELS[current.id];
    if (def?.init) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => def.init(panel.querySelector("form")), 250);
    }
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
        <label class="field" data-show="split-mode:ranges extract">Hojas
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
    recortar: {
      action: "Recortar PDF",
      html: `
        <fieldset class="opt-group">
          <legend>¿Qué quieres recortar?</legend>
          <label class="opt"><input type="radio" name="crop-mode" value="auto" checked> Quitar los márgenes en blanco (automático)</label>
          <label class="opt"><input type="radio" name="crop-mode" value="manual"> Recortar los milímetros que yo elija</label>
        </fieldset>
        <div class="field-row" data-show="crop-mode:manual">
          <label class="field">Arriba (mm) <input type="number" name="crop-top" value="10" min="0" step="1"></label>
          <label class="field">Abajo (mm) <input type="number" name="crop-bottom" value="10" min="0" step="1"></label>
          <label class="field">Izquierda (mm) <input type="number" name="crop-left" value="10" min="0" step="1"></label>
          <label class="field">Derecha (mm) <input type="number" name="crop-right" value="10" min="0" step="1"></label>
        </div>
        <p class="panel-note">Se aplica a todas las hojas, tal como se ven (con su giro).</p>`,
      run: cropPdf,
    },
    ordenar: {
      action: "Descargar PDF ordenado",
      html: `
        <div class="panel-tools">
          <button type="button" class="btn small ghost" data-act="reverse">Invertir el orden</button>
          <button type="button" class="btn small ghost" data-act="reset">Orden original</button>
        </div>
        <div class="sort-grid" aria-label="Hojas en orden"></div>`,
      init: initSort,
      run: sortPdf,
    },
    censurar: {
      action: "Censurar y descargar",
      html: `
        <div class="field-row">
          <label class="field">Buscar texto para tacharlo en todas las hojas
            <input type="text" name="redact-find" placeholder="ej. nombre, número de cuenta…" autocomplete="off">
          </label>
          <button type="button" class="btn small" data-act="find">Marcar</button>
          <button type="button" class="btn small ghost" data-act="clear">Quitar todas las marcas</button>
        </div>
        <p class="panel-note">Arrastra sobre la hoja para tapar una zona (en el celular, mantén el dedo y luego arrastra);
          toca ✕ para quitar una marca. Las hojas con marcas se guardan como imagen para que lo tapado no se pueda recuperar.</p>
        <div class="redact-pages"></div>`,
      init: initRedact,
      run: redactPdf,
    },
    proteger: {
      action: "Proteger PDF",
      html: `
        <div class="field-row">
          <label class="field">Contraseña <input type="password" name="pw1" autocomplete="new-password"></label>
          <label class="field">Repite la contraseña <input type="password" name="pw2" autocomplete="new-password"></label>
        </div>
        <p class="panel-note">Se cifra con AES de 256 bits. Guarda bien la contraseña: si la olvidas, nadie podrá abrir el PDF.</p>`,
      run: protectPdf,
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
    // data-show="grupo:valor1 valor2" muestra el elemento solo con esas opciones elegidas.
    const syncVisible = () => {
      form.querySelectorAll("[data-show]").forEach((el) => {
        const [group, values] = el.dataset.show.split(":");
        el.hidden = !values.split(" ").includes(form.elements[group]?.value);
      });
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
    def.init?.(form);
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

  // ---------- Arrastrar (con ratón al momento; con el dedo tras mantenerlo un instante,
  // para que deslizar siga moviendo la página) ----------

  function holdDrag(container, { canStart, start, move, end }) {
    let pending = null;
    let active = false;
    let timer = null;
    const begin = (e) => {
      active = true;
      start(pending.target, e);
    };
    const stop = (e, ok) => {
      clearTimeout(timer);
      if (active) end(e, ok);
      pending = null;
      active = false;
    };
    container.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      const target = canStart(e);
      if (!target) return;
      pending = { target, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === "touch", down: e };
      if (pending.touch) timer = setTimeout(() => pending && begin(pending.down), 280);
    });
    window.addEventListener("pointermove", (e) => {
      if (!pending || e.pointerId !== pending.id) return;
      if (!active) {
        const d = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
        if (pending.touch) {
          if (d > 10) stop(e, false);
          return;
        }
        if (d < 4) return;
        begin(pending.down);
      }
      move(e);
    });
    window.addEventListener("pointerup", (e) => pending && e.pointerId === pending.id && stop(e, true));
    window.addEventListener("pointercancel", (e) => pending && e.pointerId === pending.id && stop(e, false));
    // Mientras se arrastra con el dedo, la página no se desplaza.
    container.addEventListener("touchmove", (e) => active && e.preventDefault(), { passive: false });
    container.addEventListener("contextmenu", (e) => (pending || active) && e.preventDefault());
  }

  // Cada vez que cambia la lista se vuelve a armar la vista; las vistas viejas se descartan.
  let viewToken = 0;

  async function renderThumb(page, box, width, rotation) {
    const unit = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({ scale: (width * (window.devicePixelRatio || 1)) / unit.width, rotation });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    box.replaceChildren(canvas);
  }

  // ---------- Ordenar páginas ----------

  let sortState = null;

  async function initSort(form) {
    const grid = form.querySelector(".sort-grid");
    const token = ++viewToken;
    sortState = null;
    if (!form.dataset.wired) {
      form.dataset.wired = "1";
      form.querySelector(".panel-tools").addEventListener("click", (e) => {
        const act = e.target.closest("button")?.dataset.act;
        const items = [...grid.querySelectorAll(".sort-item")];
        if (act === "reverse") items.reverse().forEach((el) => grid.appendChild(el));
        if (act === "reset") items.sort((a, b) => a.dataset.index - b.dataset.index).forEach((el) => grid.appendChild(el));
        renumber(grid);
      });
      grid.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-move]");
        if (!btn) return;
        const item = btn.closest(".sort-item");
        if (btn.dataset.move === "-1" && item.previousElementSibling) grid.insertBefore(item, item.previousElementSibling);
        if (btn.dataset.move === "1" && item.nextElementSibling) grid.insertBefore(item.nextElementSibling, item);
        renumber(grid);
      });
      let dragged = null;
      holdDrag(grid, {
        canStart: (e) => !e.target.closest("button") && e.target.closest(".sort-item"),
        start: (item) => {
          dragged = item;
          item.classList.add("dragging");
        },
        move: (e) => {
          const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".sort-item");
          if (!over || over === dragged) return;
          const r = over.getBoundingClientRect();
          grid.insertBefore(dragged, e.clientX < r.left + r.width / 2 ? over : over.nextElementSibling);
        },
        end: () => {
          dragged.classList.remove("dragging");
          dragged = null;
          renumber(grid);
        },
      });
    }
    if (!pageCount) {
      grid.innerHTML = '<p class="panel-note">Agrega tus archivos para ver aquí sus hojas.</p>';
      return;
    }
    grid.innerHTML = '<p class="panel-note">Cargando hojas…</p>';
    const bytes = await app.buildMergedPdf();
    if (token !== viewToken) return;
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    sortState = { bytes };
    grid.innerHTML = "";
    const boxes = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const item = document.createElement("div");
      item.className = "sort-item";
      item.dataset.index = i;
      item.title = `Hoja ${i + 1} del documento`;
      item.innerHTML = `<div class="sort-thumb"></div>
        <div class="sort-bar">
          <button type="button" class="icon-btn" data-move="-1" title="Mover antes">◀</button>
          <span class="sort-num"></span>
          <button type="button" class="icon-btn" data-move="1" title="Mover después">▶</button>
        </div>`;
      grid.appendChild(item);
      boxes.push(item.querySelector(".sort-thumb"));
    }
    renumber(grid);
    try {
      for (let i = 0; i < pdf.numPages && token === viewToken; i++) {
        await renderThumb(await pdf.getPage(i + 1), boxes[i], 120);
      }
    } finally {
      pdf.destroy();
    }
  }

  function renumber(grid) {
    grid.querySelectorAll(".sort-item").forEach((el, k) => {
      el.querySelector(".sort-num").textContent = k + 1;
      el.classList.toggle("moved", Number(el.dataset.index) !== k);
    });
  }

  async function sortPdf(form) {
    if (!sortState) throw userError("Espera a que se carguen las hojas.");
    const order = [...form.querySelectorAll(".sort-item")].map((el) => Number(el.dataset.index));
    const src = await PDFDocument.load(sortState.bytes);
    const out = await PDFDocument.create();
    (await out.copyPages(src, order)).forEach((p) => out.addPage(p));
    download(await out.save(), `${baseName()}-ordenado.pdf`, "application/pdf");
    return "Listo: se descargó el PDF con el nuevo orden.";
  }

  // ---------- Recortar ----------

  const MM = 72 / 25.4;

  // Márgenes en blanco de cada hoja (en puntos, tal como se ve): [arriba, abajo, izquierda, derecha].
  async function blankMargins(bytes) {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const result = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        app.showBusy(`Buscando márgenes: hoja ${i} de ${pdf.numPages}…`);
        const page = await pdf.getPage(i);
        const unit = page.getViewport({ scale: 1 });
        const scale = Math.min(1.5, Math.sqrt(4e6 / (unit.width * unit.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const w = (canvas.width = Math.ceil(viewport.width));
        const h = (canvas.height = Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const data = ctx.getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0, k = y * w * 4; x < w; x++, k += 4) {
            if (data[k] < 235 || data[k + 1] < 235 || data[k + 2] < 235) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        const pad = 8;
        result.push(maxX < 0 ? [0, 0, 0, 0] : [
          Math.max(0, minY / scale - pad), Math.max(0, unit.height - (maxY + 1) / scale - pad),
          Math.max(0, minX / scale - pad), Math.max(0, unit.width - (maxX + 1) / scale - pad),
        ]);
        page.cleanup();
      }
    } finally {
      pdf.destroy();
    }
    return result;
  }

  async function cropPdf(form) {
    const bytes = await app.buildMergedPdf();
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages();
    let margins;
    if (form.elements["crop-mode"].value === "manual") {
      const mm = (n) => Math.max(0, Number(form.elements[n].value) || 0) * MM;
      const m = [mm("crop-top"), mm("crop-bottom"), mm("crop-left"), mm("crop-right")];
      margins = pages.map(() => m);
    } else {
      margins = await blankMargins(bytes);
    }
    let cropped = 0;
    pages.forEach((page, i) => {
      const f = visualFrame(page);
      const [t, b, l, r] = margins[i];
      if (l + r > f.W - 36 || t + b > f.H - 36) {
        throw userError(`Los márgenes son más grandes que la hoja ${i + 1}. Usa medidas más pequeñas.`);
      }
      if (!(t || b || l || r)) return;
      const [ax, ay] = f.toUser(l, b);
      const [bx, by] = f.toUser(f.W - r, f.H - t);
      const box = [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
      page.setMediaBox(...box);
      page.setCropBox(...box);
      cropped++;
    });
    if (!cropped) return "Las hojas no tienen márgenes en blanco que quitar.";
    download(await pdf.save(), `${baseName()}-recortado.pdf`, "application/pdf");
    return `Listo: se ${cropped === 1 ? "recortó 1 hoja" : `recortaron ${cropped} hojas`}.`;
  }

  // ---------- Censurar ----------
  // Las marcas se guardan en fracciones de la hoja tal como se ve (0 a 1).

  let redact = null;

  async function initRedact(form) {
    const wrap = form.querySelector(".redact-pages");
    const token = ++viewToken;
    redact?.pdf.destroy();
    redact = null;
    if (!form.dataset.wired) {
      form.dataset.wired = "1";
      form.addEventListener("click", (e) => {
        const act = e.target.closest("button")?.dataset.act;
        if (act === "find") findAndMark(form);
        if (act === "clear" && redact) {
          redact.pages.forEach((p) => (p.boxes = []));
          redact.pages.forEach(drawBoxes);
        }
        const x = e.target.closest(".redact-x");
        if (x && redact) {
          const page = redact.pages[Number(x.closest(".redact-page").dataset.index)];
          page.boxes.splice(Number(x.dataset.box), 1);
          drawBoxes(page);
        }
      });
      form.elements["redact-find"].addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          findAndMark(form);
        }
      });
      let drawing = null;
      const frac = (page, e) => {
        const r = page.el.getBoundingClientRect();
        return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
      };
      holdDrag(wrap, {
        canStart: (e) => !e.target.closest(".redact-x") && e.target.closest(".redact-page"),
        start: (el, e) => {
          const page = redact?.pages[Number(el.dataset.index)];
          if (!page) return;
          const [x, y] = frac(page, e);
          drawing = { page, box: { x, y, w: 0, h: 0 }, x0: x, y0: y };
          page.boxes.push(drawing.box);
        },
        move: (e) => {
          if (!drawing) return;
          const [x, y] = frac(drawing.page, e);
          Object.assign(drawing.box, {
            x: Math.min(x, drawing.x0), y: Math.min(y, drawing.y0),
            w: Math.abs(x - drawing.x0), h: Math.abs(y - drawing.y0),
          });
          drawBoxes(drawing.page);
        },
        end: (e, ok) => {
          if (!drawing) return;
          const { page, box } = drawing;
          if (!ok || box.w < 0.005 || box.h < 0.003) page.boxes.splice(page.boxes.indexOf(box), 1);
          drawBoxes(page);
          drawing = null;
        },
      });
    }
    if (!pageCount) {
      wrap.innerHTML = '<p class="panel-note">Agrega tus archivos para ver aquí sus hojas.</p>';
      return;
    }
    wrap.innerHTML = '<p class="panel-note">Cargando hojas…</p>';
    const bytes = await app.buildMergedPdf();
    if (token !== viewToken) return;
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    if (token !== viewToken) {
      pdf.destroy();
      return;
    }
    redact = { bytes, pdf, pages: [] };
    wrap.innerHTML = "";
    const width = Math.min(760, wrap.clientWidth || 760);
    for (let i = 0; i < pdf.numPages; i++) {
      const el = document.createElement("div");
      el.className = "redact-page";
      el.dataset.index = i;
      el.innerHTML = `<div class="redact-canvas"></div><div class="redact-boxes"></div><span class="redact-num">${i + 1}</span>`;
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      el.style.aspectRatio = `${vp.width} / ${vp.height}`;
      wrap.appendChild(el);
      redact.pages.push({ el, boxes: [] });
    }
    for (let i = 0; i < pdf.numPages && token === viewToken; i++) {
      await renderThumb(await pdf.getPage(i + 1), redact.pages[i].el.querySelector(".redact-canvas"), width);
    }
  }

  function drawBoxes(page) {
    page.el.querySelector(".redact-boxes").innerHTML = page.boxes.map((b, k) =>
      `<div class="redact-box" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%">` +
      `<button type="button" class="redact-x" data-box="${k}" title="Quitar esta marca">✕</button></div>`).join("");
  }

  const measureCtx = document.createElement("canvas").getContext("2d");
  function textWidth(str) {
    measureCtx.font = "100px Helvetica, Arial, sans-serif";
    return measureCtx.measureText(str).width || 1;
  }

  async function findAndMark(form) {
    const result = form.querySelector(".panel-result");
    const query = form.elements["redact-find"].value.trim().toLocaleLowerCase();
    if (!redact || !query) return;
    let found = 0;
    for (let i = 0; i < redact.pages.length; i++) {
      const page = await redact.pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      for (const item of items) {
        const text = (item.str || "").toLocaleLowerCase();
        if (!text || text.length !== item.str.length) continue;
        const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
        const fontH = Math.hypot(tx[2], tx[3]);
        const len = Math.hypot(tx[0], tx[1]);
        if (!fontH || !len) continue;
        // Dirección del renglón y "hacia arriba" de las letras, en la hoja vista.
        const dir = [tx[0] / len, tx[1] / len];
        const up = [-tx[2] / fontH, -tx[3] / fontH];
        const width = item.width * vp.scale;
        for (let at = text.indexOf(query); at >= 0; at = text.indexOf(query, at + query.length)) {
          // Posición aproximada dentro del renglón según el ancho de cada letra; se deja un poco
          // de margen porque al censurar es mejor tapar de más que de menos.
          const full = textWidth(item.str);
          const a = (width * textWidth(item.str.slice(0, at))) / full - fontH * 0.15;
          const b = (width * textWidth(item.str.slice(0, at + query.length))) / full + fontH * 0.15;
          const corners = [];
          for (const s of [a, b]) {
            for (const t of [-0.28, 0.95]) {
              corners.push([tx[4] + dir[0] * s - up[0] * t * fontH, tx[5] + dir[1] * s - up[1] * t * fontH]);
            }
          }
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          const x = Math.min(...xs) - 1;
          const y = Math.min(...ys) - 1;
          redact.pages[i].boxes.push({
            x: x / vp.width, y: y / vp.height,
            w: (Math.max(...xs) + 1 - x) / vp.width, h: (Math.max(...ys) + 1 - y) / vp.height,
          });
          found++;
        }
      }
      drawBoxes(redact.pages[i]);
    }
    result.textContent = found
      ? `${found === 1 ? "Se marcó 1 coincidencia" : `Se marcaron ${found} coincidencias`}. Revisa las hojas y pulsa Censurar y descargar.`
      : "No se encontró ese texto. Si la hoja es escaneada, tápalo arrastrando sobre ella.";
  }

  async function redactPdf() {
    if (!redact) throw userError("Espera a que se carguen las hojas.");
    const marked = redact.pages.filter((p) => p.boxes.length).length;
    if (!marked) throw userError("Primero marca lo que quieres tapar: busca un texto o arrastra sobre la hoja.");
    const src = await PDFDocument.load(redact.bytes);
    const out = await PDFDocument.create();
    for (let i = 0; i < redact.pages.length; i++) {
      const { boxes } = redact.pages[i];
      if (!boxes.length) {
        const [copy] = await out.copyPages(src, [i]);
        out.addPage(copy);
        continue;
      }
      app.showBusy(`Censurando hoja ${i + 1}…`);
      const page = await redact.pdf.getPage(i + 1);
      const unit = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(200 / 72, Math.sqrt(16e6 / (unit.width * unit.height))) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      ctx.fillStyle = "#000";
      for (const b of boxes) ctx.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      out.addPage([unit.width, unit.height]).drawImage(img, { x: 0, y: 0, width: unit.width, height: unit.height });
    }
    download(await out.save(), `${baseName()}-censurado.pdf`, "application/pdf");
    return `Listo: se ${marked === 1 ? "censuró 1 hoja" : `censuraron ${marked} hojas`}.`;
  }

  // ---------- Proteger ----------

  async function protectPdf(form) {
    const pw = form.elements.pw1.value;
    if (!pw) throw userError("Escribe una contraseña.");
    if (pw !== form.elements.pw2.value) throw userError("Las dos contraseñas no son iguales.");
    const bytes = await PdfSeguridad.encrypt(await app.buildMergedPdf(), pw);
    download(bytes, `${baseName()}-protegido.pdf`, "application/pdf");
    return "Listo: se descargó el PDF con contraseña.";
  }

  renderGrid();
  route();
})();
