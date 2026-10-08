/* Contraseñas de PDF: proteger (cifrado AES-256, el más seguro del estándar) y quitar la
   contraseña de un PDF del que se conoce (RC4 de 40/128 bits, AES-128 y AES-256).
   pdf-lib no cifra ni descifra, así que aquí se implementa el "Standard Security Handler" del
   estándar PDF sobre los objetos que lee pdf-lib. Todo ocurre en el navegador. */
(() => {
  "use strict";

  const {
    PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, PDFStream,
    PDFNumber, PDFBool, PDFRef, PDFParser, PDFObjectStreamParser, PDFContext,
  } = PDFLib;
  const subtle = crypto.subtle;
  const EMPTY = new Uint8Array(0);
  const ZERO_IV = new Uint8Array(16);

  const concat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

  // ---------- Cifrados ----------

  async function sha(alg, data) {
    return new Uint8Array(await subtle.digest(alg, data));
  }

  const keyCache = new Map();
  function aesKey(raw, usage) {
    const id = usage + toHex(raw);
    if (!keyCache.has(id)) {
      if (keyCache.size > 64) keyCache.clear();
      keyCache.set(id, subtle.importKey("raw", raw, "AES-CBC", false, [usage]));
    }
    return keyCache.get(id);
  }
  async function aesEncrypt(key, iv, data) {
    return new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, await aesKey(key, "encrypt"), data));
  }
  async function aesDecrypt(key, iv, data) {
    return new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv }, await aesKey(key, "decrypt"), data));
  }
  // El navegador siempre agrega relleno; sin relleno basta quitar el último bloque.
  async function aesEncryptRaw(key, iv, data) {
    return (await aesEncrypt(key, iv, data)).subarray(0, data.length);
  }
  // Para descifrar sin relleno se agrega un bloque que al descifrarse da un relleno válido.
  async function aesDecryptRaw(key, iv, data) {
    const last = data.subarray(data.length - 16);
    const extra = (await aesEncrypt(key, last, new Uint8Array(16).fill(16))).subarray(0, 16);
    return aesDecrypt(key, iv, concat(data, extra));
  }

  function rc4(key, data) {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 255;
      [s[i], s[j]] = [s[j], s[i]];
    }
    const out = new Uint8Array(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) {
      i = (i + 1) & 255;
      j = (j + s[i]) & 255;
      [s[i], s[j]] = [s[j], s[i]];
      out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
    }
    return out;
  }

  // MD5 (lo usan los PDF con cifrado antiguo; el navegador no lo trae).
  const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  function md5(data) {
    const len = data.length;
    const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
    padded.set(data);
    padded[len] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const m = new Uint32Array(16);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
        else { f = c ^ (b | ~d); g = (7 * i) & 15; }
        const s = MD5_S[(i >> 4) * 4 + (i & 3)];
        const t = (a + f + MD5_K[i] + m[g]) >>> 0;
        a = d; d = c; c = b;
        b = (b + ((t << s) | (t >>> (32 - s)))) >>> 0;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    [a0, b0, c0, d0].forEach((w, i) => ov.setUint32(i * 4, w, true));
    return out;
  }

  // ---------- Claves del estándar PDF ----------

  const PAD = Uint8Array.from([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
  ]);
  const padPassword = (pw) => concat(pw.subarray(0, 32), PAD).subarray(0, 32);

  // Algoritmo 2.B (AES-256, revisión 6).
  async function hash6(pw, salt, udata) {
    let k = await sha("SHA-256", concat(pw, salt, udata));
    for (let i = 0; ; i++) {
      const block = concat(pw, k, udata);
      const k1 = new Uint8Array(block.length * 64);
      for (let j = 0; j < 64; j++) k1.set(block, j * block.length);
      const e = await aesEncryptRaw(k.subarray(0, 16), k.subarray(16, 32), k1);
      let sum = 0;
      for (let j = 0; j < 16; j++) sum += e[j];
      k = await sha(["SHA-256", "SHA-384", "SHA-512"][sum % 3], e);
      if (i >= 63 && e[e.length - 1] <= i - 31) break;
    }
    return k.subarray(0, 32);
  }
  const hashFor = (R) => (R === 5 ? (pw, salt, u) => sha("SHA-256", concat(pw, salt, u)) : hash6);

  // Clave del archivo con cifrado antiguo (algoritmo 2).
  function legacyKey(padded, enc) {
    const p = new Uint8Array(4);
    new DataView(p.buffer).setInt32(0, enc.P, true);
    const extra = enc.R >= 4 && !enc.encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : EMPTY;
    let h = md5(concat(padded, enc.O.subarray(0, 32), p, enc.id0, extra));
    if (enc.R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, enc.n));
    return h.subarray(0, enc.n);
  }
  function legacyUserOk(key, enc) {
    if (enc.R === 2) return equal(rc4(key, PAD), enc.U.subarray(0, 32));
    let x = md5(concat(PAD, enc.id0));
    for (let i = 0; i < 20; i++) x = rc4(key.map((b) => b ^ i), x);
    return equal(x, enc.U.subarray(0, 16));
  }
  // Con la contraseña del propietario se recupera la del usuario (algoritmo 7).
  function legacyUserFromOwner(ownerPadded, enc) {
    let h = md5(ownerPadded);
    if (enc.R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
    const key = h.subarray(0, enc.n);
    let user = enc.O.subarray(0, 32);
    if (enc.R === 2) return rc4(key, user);
    for (let i = 19; i >= 0; i--) user = rc4(key.map((b) => b ^ i), user);
    return user;
  }

  async function fileKey(enc, password) {
    const pw = new TextEncoder().encode(password).subarray(0, 127);
    if (enc.R >= 5) {
      const hash = hashFor(enc.R);
      const U = enc.U.subarray(0, 48);
      if (equal(await hash(pw, U.subarray(32, 40), EMPTY), U.subarray(0, 32))) {
        return aesDecryptRaw(await hash(pw, U.subarray(40, 48), EMPTY), ZERO_IV, enc.UE);
      }
      const O = enc.O.subarray(0, 48);
      if (equal(await hash(pw, O.subarray(32, 40), U), O.subarray(0, 32))) {
        return aesDecryptRaw(await hash(pw, O.subarray(40, 48), U), ZERO_IV, enc.OE);
      }
      return null;
    }
    // Contraseñas antiguas: se usan los bytes Latin-1.
    const legacy = padPassword(latin1(password));
    let key = legacyKey(legacy, enc);
    if (legacyUserOk(key, enc)) return key;
    key = legacyKey(legacyUserFromOwner(legacy, enc), enc);
    return legacyUserOk(key, enc) ? key : null;
  }

  // ---------- Lectura del diccionario de cifrado ----------

  const bytesOf = (obj) => (obj instanceof PDFString || obj instanceof PDFHexString ? obj.asBytes() : EMPTY);

  function readEncrypt(pdf) {
    const ctx = pdf.context;
    const encRef = ctx.trailerInfo.Encrypt;
    const dict = encRef && ctx.lookup(encRef);
    if (!(dict instanceof PDFDict)) return null;
    const num = (k, d) => {
      const v = dict.lookup(PDFName.of(k));
      return v instanceof PDFNumber ? v.asNumber() : d;
    };
    const filter = dict.lookup(PDFName.of("Filter"));
    if (filter !== PDFName.of("Standard")) throw userMessage("Este PDF usa un tipo de protección que no se puede quitar aquí (con certificado).");
    const V = num("V", 0);
    const R = num("R", 2);
    const ids = ctx.lookup(ctx.trailerInfo.ID);
    const em = dict.lookup(PDFName.of("EncryptMetadata"));
    // Método de cada tipo de dato: "rc4", "aes" (128), "aes256" o null (sin cifrar).
    let stm = "rc4";
    let str = "rc4";
    let n = R === 2 ? 5 : num("Length", 40) / 8;
    if (V >= 4) {
      const cf = dict.lookup(PDFName.of("CF"));
      const method = (nameKey) => {
        const name = dict.lookup(PDFName.of(nameKey));
        if (!name || name === PDFName.of("Identity")) return null;
        const f = cf instanceof PDFDict ? cf.lookup(name) : null;
        const cfm = f instanceof PDFDict ? f.lookup(PDFName.of("CFM")) : null;
        if (cfm === PDFName.of("AESV2")) return "aes";
        if (cfm === PDFName.of("AESV3")) return "aes256";
        if (cfm === PDFName.of("V2")) return "rc4";
        return null;
      };
      stm = method("StmF");
      str = method("StrF");
      if (V === 4) n = Math.max(5, Math.min(16, num("Length", 128) / 8 || 16));
    }
    return {
      ref: encRef,
      V, R, n, stm, str,
      P: num("P", 0),
      O: bytesOf(dict.lookup(PDFName.of("O"))),
      U: bytesOf(dict.lookup(PDFName.of("U"))),
      OE: bytesOf(dict.lookup(PDFName.of("OE"))),
      UE: bytesOf(dict.lookup(PDFName.of("UE"))),
      id0: ids instanceof PDFArray ? bytesOf(ids.lookup(0)) : EMPTY,
      encryptMetadata: !(em instanceof PDFBool) || em.asBoolean(),
    };
  }

  function objectKey(enc, key, ref, aes) {
    if (enc.R >= 5) return key;
    const id = Uint8Array.of(
      ref.objectNumber & 255, (ref.objectNumber >> 8) & 255, (ref.objectNumber >> 16) & 255,
      ref.generationNumber & 255, (ref.generationNumber >> 8) & 255);
    return md5(concat(key, id, aes ? latin1("sAlT") : EMPTY)).subarray(0, Math.min(enc.n + 5, 16));
  }

  async function decryptBytes(method, objKey, data) {
    if (!method) return data;
    if (method === "rc4") return rc4(objKey, data);
    if (data.length < 32 || data.length % 16) return EMPTY;
    try {
      return await aesDecrypt(objKey, data.subarray(0, 16), data.subarray(16));
    } catch {
      return EMPTY;
    }
  }

  // ---------- Carga con pdf-lib ----------
  // Los "object streams" (grupos de objetos comprimidos) vienen cifrados y pdf-lib los
  // interpreta al cargar, así que mientras se carga se descifran antes de leerlos.

  let objStreamHook = null;
  let lastRef = null;
  let assignHook = null;

  const origHeader = PDFParser.prototype.parseIndirectObjectHeader;
  PDFParser.prototype.parseIndirectObjectHeader = function () {
    lastRef = origHeader.call(this);
    return lastRef;
  };
  const origForStream = PDFObjectStreamParser.forStream;
  PDFObjectStreamParser.forStream = function (raw, wait) {
    if (!objStreamHook) return origForStream.call(this, raw, wait);
    const hook = objStreamHook;
    const ref = lastRef;
    return { parseIntoContext: () => hook(raw, ref, () => origForStream.call(PDFObjectStreamParser, raw, wait).parseIntoContext()) };
  };
  const origAssign = PDFContext.prototype.assign;
  PDFContext.prototype.assign = function (ref, obj) {
    if (assignHook) assignHook(ref);
    return origAssign.call(this, ref, obj);
  };

  async function loadWithHook(bytes, hook) {
    objStreamHook = hook;
    try {
      return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    } finally {
      objStreamHook = null;
      assignHook = null;
    }
  }

  // Busca "/Encrypt" en los bytes (rápido, para no analizar cada PDF que se agrega).
  function mentionsEncrypt(bytes) {
    const pat = latin1("/Encrypt");
    outer: for (let i = bytes.indexOf(47); i >= 0 && i <= bytes.length - pat.length; i = bytes.indexOf(47, i + 1)) {
      for (let j = 1; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer;
      return true;
    }
    return false;
  }

  function userMessage(msg) {
    return Object.assign(new Error(msg), { userMessage: msg });
  }

  // Devuelve el PDF sin contraseña, o null si la contraseña no es correcta.
  async function decrypt(bytes, password) {
    const probe = await loadWithHook(bytes, async () => {});
    const enc = readEncrypt(probe);
    if (!enc) return bytes;
    const key = await fileKey(enc, password);
    if (!key) return null;

    const fromObjStreams = new Set();
    const pdf = await loadWithHook(bytes, async (raw, ref, parse) => {
      raw.contents = await decryptBytes(enc.stm, objectKey(enc, key, ref, enc.stm === "aes"), raw.contents);
      assignHook = (r) => fromObjStreams.add(r);
      try {
        await parse();
      } finally {
        assignHook = null;
      }
    });

    const ctx = pdf.context;
    const encRefTag = enc.ref instanceof PDFRef ? enc.ref.tag : null;
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (ref.tag === encRefTag) continue;
      // Los objetos que venían dentro de un "object stream" ya quedaron descifrados con él.
      const strings = fromObjStreams.has(ref) ? null : enc.str;
      const sKey = strings && objectKey(enc, key, ref, strings === "aes");
      const fixed = await walk(obj, async (s) => PDFHexString.of(toHex(await decryptBytes(strings, sKey, s))), !!strings);
      if (fixed !== obj) ctx.assign(ref, fixed);
      if (obj instanceof PDFRawStream) {
        const type = obj.dict.lookup(PDFName.of("Type"));
        if (type === PDFName.of("XRef")) continue;
        if (type === PDFName.of("Metadata") && !enc.encryptMetadata) continue;
        // Un filtro /Crypt propio (por ejemplo /Identity) indica que el flujo no está cifrado.
        const filters = obj.dict.lookup(PDFName.of("Filter"));
        const crypt = filters === PDFName.of("Crypt") ||
          (filters instanceof PDFArray && filters.asArray().includes(PDFName.of("Crypt")));
        if (crypt) continue;
        obj.contents = await decryptBytes(enc.stm, objectKey(enc, key, ref, enc.stm === "aes"), obj.contents);
      }
    }
    ctx.delete(enc.ref);
    ctx.trailerInfo.Encrypt = undefined;
    return pdf.save();
  }

  // Recorre un objeto y reemplaza sus textos (strings) con fn; devuelve el objeto (igual o nuevo).
  async function walk(obj, fn, active) {
    if (!active) return obj;
    if (obj instanceof PDFString || obj instanceof PDFHexString) return fn(obj.asBytes());
    if (obj instanceof PDFStream) {
      await walk(obj.dict, fn, active);
      return obj;
    }
    if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        const nv = await walk(v, fn, active);
        if (nv !== v) obj.set(k, nv);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.get(i);
        const nv = await walk(v, fn, active);
        if (nv !== v) obj.set(i, nv);
      }
    }
    return obj;
  }

  // Cifra el PDF con AES-256 (revisión 6). Con la contraseña se puede abrir, imprimir y copiar.
  async function encrypt(bytes, password) {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const ctx = pdf.context;
    const pw = new TextEncoder().encode(password).subarray(0, 127);
    const key = rand(32);
    const uSalts = [rand(8), rand(8)];
    const U = concat(await hash6(pw, uSalts[0], EMPTY), ...uSalts);
    const UE = await aesEncryptRaw(await hash6(pw, uSalts[1], EMPTY), ZERO_IV, key);
    const oSalts = [rand(8), rand(8)];
    const O = concat(await hash6(pw, oSalts[0], U), ...oSalts);
    const OE = await aesEncryptRaw(await hash6(pw, oSalts[1], U), ZERO_IV, key);
    const P = -4; // todos los permisos
    const perms = new Uint8Array(16);
    new DataView(perms.buffer).setInt32(0, P, true);
    perms.set([255, 255, 255, 255], 4);
    perms.set(latin1("Tadb"), 8);
    perms.set(rand(4), 12);
    const Perms = await aesEncryptRaw(key, ZERO_IV, perms);

    const seal = async (data) => {
      const iv = rand(16);
      return concat(iv, await aesEncrypt(key, iv, data));
    };
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      const fixed = await walk(obj, async (s) => PDFHexString.of(toHex(await seal(s))), true);
      if (fixed !== obj) ctx.assign(ref, fixed);
      if (obj instanceof PDFStream) {
        const raw = obj instanceof PDFRawStream ? obj.contents : obj.getContents();
        ctx.assign(ref, PDFRawStream.of(obj.dict, await seal(raw)));
      }
    }
    const hex = (b) => PDFHexString.of(toHex(b));
    const encDict = ctx.obj({
      Filter: "Standard", V: 5, R: 6, Length: 256, P,
      CF: { StdCF: { AuthEvent: "DocOpen", CFM: "AESV3", Length: 32 } },
      StmF: "StdCF", StrF: "StdCF", EncryptMetadata: true,
    });
    encDict.set(PDFName.of("O"), hex(O));
    encDict.set(PDFName.of("U"), hex(U));
    encDict.set(PDFName.of("OE"), hex(OE));
    encDict.set(PDFName.of("UE"), hex(UE));
    encDict.set(PDFName.of("Perms"), hex(Perms));
    ctx.trailerInfo.Encrypt = ctx.register(encDict);
    const id = toHex(rand(16));
    ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
    // Sin "object streams": así cada objeto queda cifrado por separado, como pide el estándar.
    return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  }

  // Al agregar un PDF a la lista: si tiene contraseña se pide y se quita. Los PDF que se abren
  // sin contraseña pero vienen cifrados (con restricciones) también se descifran, para que pdf-lib
  // pueda unirlos y editarlos.
  async function unlockForApp(bytes, name) {
    if (!mentionsEncrypt(bytes)) return bytes;
    let plain = await decrypt(bytes, "");
    let message = `"${name}" tiene contraseña. Escríbela para abrirlo:`;
    while (!plain) {
      const pw = prompt(message);
      if (pw === null) throw userMessage(`No se abrió "${name}" porque no se escribió su contraseña.`);
      plain = await decrypt(bytes, pw);
      message = `Contraseña incorrecta. Vuelve a escribir la contraseña de "${name}":`;
    }
    return plain;
  }

  window.PdfSeguridad = { encrypt, decrypt, unlockForApp, md5 };
})();
