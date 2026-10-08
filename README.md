# IMPRESION-VARIAS

App web para juntar varios archivos (PDF e imágenes), quitar las hojas que no quieras e imprimir todo de una sola vez.

## Uso

1. Abre `index.html` en el navegador (doble clic, o publícalo en GitHub Pages / cualquier hosting estático).
2. Arrastra tus archivos o haz clic en la zona para elegirlos. Admite PDF, JPG, PNG, WEBP, GIF, etc.
3. Para **eliminar hojas**:
   - haz clic en la miniatura de la hoja (otro clic la restaura), o
   - escribe un rango en "Eliminar hojas" (ej. `2, 4-6`) y pulsa *Eliminar*.
4. Ordena los archivos con ↑ / ↓ y quita los que sobren con *Quitar*.
5. Pulsa **Imprimir todo** para mandar todo a la impresora en un solo trabajo, o **Descargar PDF** para guardar el PDF unido.

Todo se procesa en tu navegador: los archivos no se suben a ningún servidor y funciona sin conexión.

Las imágenes se colocan en una hoja A4 (vertical u horizontal según la imagen). Los PDF protegidos con contraseña no son compatibles.

## Librerías

Incluidas en `vendor/`:
- [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 (Apache-2.0) — miniaturas.
- [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 (MIT) — unir PDFs y eliminar hojas.
