# IMPRESION-VARIAS

App web para juntar varios archivos (PDF e imágenes), quitar las hojas que no quieras e imprimir todo de una sola vez.

## Uso

1. Ábrela en https://paucoxd.github.io/IMPRESION-VARIAS/ (o abre `index.html` directamente en el navegador).
2. Arrastra tus archivos o haz clic en la zona para elegirlos. Admite PDF, JPG, PNG, WEBP, GIF, etc.
3. Debajo de cada hoja tienes:
   - **↺ / ↻** para girarla (o *↻ Girar todas* para todo el archivo).
   - **✎** para abrir el **editor** (también al hacer clic en la miniatura).
   - **✕** para eliminarla (otro clic la restaura). También puedes escribir un rango en "Eliminar hojas" (ej. `2, 4-6`).
4. En el **editor** puedes:
   - **Editar texto**: se marcan en azul los textos que ya trae el PDF; clic en uno para cambiarlo (si lo dejas vacío, se borra). El texto original se quita de verdad del PDF, no solo se tapa.
     Si la hoja es una imagen, un escaneo o tiene las letras dibujadas, pulsa **Digitalizar** para reconocer las letras (en tu navegador, sin conexión) y poder cambiarlas; en ese caso el texto viejo se cubre con el color del fondo.
   - **Texto**: clic donde quieras escribir y Enter para terminar (Mayús+Enter para otra línea). Clic sobre un texto para cambiarlo.
   - **Dibujar** a mano alzada, **Resaltar** (arrastrando) y **Tapar** con blanco (para ocultar algo).
   - **Imagen**: insertar una imagen o firma; luego muévela con **Mover**.
   - **Mover** y seleccionar elementos; *Borrar elemento* (o Supr) y *Deshacer* (Ctrl+Z). Color y tamaño se aplican al elemento seleccionado.
   - **Zoom** con − / + (clic en el porcentaje para ajustar la hoja a la pantalla), Ctrl + rueda del ratón o pellizcando en el móvil.
   - Pulsa **Guardar** para aplicar los cambios a la hoja.
5. Ordena los archivos con ↑ / ↓ y quita los que sobren con *Quitar*.
6. Pulsa **Imprimir todo** para mandar todo a la impresora en un solo trabajo, o **Descargar PDF** para guardar el PDF unido.

Todo se procesa en tu navegador: los archivos no se suben a ningún servidor y funciona sin conexión.

Las imágenes se colocan en una hoja A4 (vertical u horizontal según la imagen). Los PDF protegidos con contraseña no son compatibles.

## Librerías

Incluidas en `vendor/`:
- [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 (Apache-2.0) — miniaturas, editor y detección del texto.
- [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1 (MIT) — unir PDFs, eliminar, girar y aplicar las ediciones.
- [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 y tesseract.js-core 5.1.1 (Apache-2.0), con el idioma español de [tessdata](https://github.com/tesseract-ocr/tessdata_best) (Apache-2.0) — Digitalizar. Se carga solo al usarlo.
