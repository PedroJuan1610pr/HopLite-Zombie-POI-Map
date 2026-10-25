# Minecraft Coordinate Mapper

Herramienta web (HTML + CSS + JS, sin servidor ni dependencias) para convertir un punto de la imagen de un mapa en coordenadas X/Z de Minecraft.

## Publicar en GitHub Pages
1. **Crear repositorio:** en github.com pulsa *New repository*, ponle un nombre (p. ej. `mapa-minecraft`) y déjalo público.
2. **Subir archivos:** *Add file → Upload files* y arrastra **el contenido** de la carpeta (`index.html`, `css`, `js`, `images`, `README.md` y `.nojekyll`). Pulsa *Commit changes*.
3. **Cambiar el mapa:** sustituye `images/mapa.png` por tu imagen (mismo nombre). También puedes cargar otra imagen desde la web (solo temporal).
4. **Activar Pages:** *Settings → Pages → Source: Deploy from a branch → Branch: main / (root) → Save*.
5. **Abrir:** tras 1–2 minutos estará en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

> Si abres `index.html` con doble clic, el mapa predeterminado puede cargar igualmente; el botón de copiar requiere HTTPS (GitHub Pages lo cumple) o usa un método alternativo.

## Cómo funciona la transformación
- Las coordenadas se calculan **siempre sobre el píxel original** de la imagen:
  `X = Xmín + px/(W-1)·(Xmáx-Xmín)`, `Z = Zmín + py/(H-1)·(Zmáx-Zmín)`, redondeado.
- Para dibujar: `pantalla = desplazamiento + zoom · (inversión ? tamaño - c : c)`. La inversa convierte un clic en píxel original.
- Zoom, arrastre e inversión solo cambian el dibujo; los marcadores guardan el píxel original, así que siguen siendo correctos.

## Puntos de interés (carpetas por nombre y tier)
1. **Crear la lista (modo editor):** abre la web con `?editor=1` al final (p. ej. `.../mapa-minecraft/?editor=1`). Haz clic en el mapa, escribe *Nombre* y *Tier*, y pulsa «Guardar punto». Nombre y tier se mantienen para añadir varios seguidos. Los datos se guardan en tu navegador.
2. **Agrupar:** la lista se organiza en carpetas «Nombre › Tier» o «Tier › Nombre»; puedes ocultar o eliminar carpetas enteras y filtrar con el buscador.
3. **Dejarlos fijos:** pulsa «Exportar pois.json» y sustituye el archivo `data/pois.json` del repositorio con el descargado.
4. **Web pública:** sin `?editor=1` la página es de solo lectura (sin botones de crear, borrar, importar ni exportar) y carga siempre `data/pois.json`.

## Guardar los puntos en tu carpeta local
En modo editor (`?editor=1`), con Chrome o Edge, el panel «Guardar en carpeta local» escribe `data/pois.json` directamente en la carpeta del proyecto de tu ordenador. Elige la carpeta una vez (la que contiene `index.html`); después cada cambio se guarda solo. Luego haces `git add`, `commit` y `push` como siempre. Al reabrir la página, pulsa «Guardar ahora» una vez para reactivar el permiso.
