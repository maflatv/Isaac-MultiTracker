# MultiTracker

## Apoya el proyecto

MultiTracker es gratuito. Si te resulta útil y quieres apoyar a Mafla, puedes hacerlo en [Ko-fi](https://ko-fi.com/maflatv).

## Qué es

Tracker para The Binding of Isaac: Repentance+ que reúne en una sola vista los objetos de la partida actual y el progreso hacia Dead God. Se usa en su propia ventana y puede capturarse en OBS.

Solo lee archivos del juego: no modifica tus partidas ni necesita mods.

*An item and Dead God progress tracker for Repentance+. Install it and it updates itself, or use the single portable executable; no local server. Available in English, Spanish, French, Portuguese and Russian (English by default). Run `MultiTracker-Setup-<version>.exe` (or the portable `MultiTracker.exe`) and capture its window in OBS.*

## Requisitos

- Windows de 64 bits
- The Binding of Isaac: Repentance+ en Steam

## Instalación

En la [última versión](https://github.com/maflatv/Isaac-MultiTracker/releases/latest) hay dos formas de usarlo:

- **Instalador (recomendado):** `MultiTracker-Setup-<versión>.exe`. Se instala solo para tu usuario, sin permisos de administrador, con accesos directos en el escritorio y en el menú Inicio. Arranca más rápido que el portable y **se actualiza solo**: al abrirlo busca si hay una versión nueva y, si la hay, te lo avisa en el panel. Solo descarga si lo pides, y únicamente lo que ha cambiado (normalmente un par de MB, no el instalador entero). Lo descargado se instala al pulsar **Reiniciar y actualizar** o al cerrar MultiTracker. También puedes buscar a mano en **Acerca de → Buscar actualizaciones**.
- **Portable:** `MultiTracker.exe`, un solo archivo que no se instala. Ponlo en su propia carpeta: tus ajustes se guardarán ahí. No se actualiza solo; para cambiar de versión, descarga el nuevo y sustituye el `.exe`. Hay también un `.zip` con el mismo `.exe` y las licencias.

Después, elige tu guardado y tu idioma en el panel.

**Del portable al instalador:** la primera vez que abres la versión instalada te pregunta si quieres traer tus ajustes. Elige la carpeta donde tenías `MultiTracker.exe` y se copian tu configuración, perfiles, temas, tiempo de juego e imagen de fondo. El portable no se toca.

MultiTracker trae incluidos los iconos de objetos y trinkets, los nombres y sus traducciones (unos 5 MB, en `data/resources/`), así que se abre al momento y no necesita extraer nada del juego. Esos archivos son del juego y pertenecen a Edmund McMillen y Nicalis: no forman parte de la licencia MIT de MultiTracker.

El ejecutable no tiene firma digital, así que Windows puede mostrar un aviso. Para continuar, pulsa **Más información** y luego **Ejecutar de todas formas**.

## Uso

- **Configurar:** el panel permite elegir el guardado, el idioma, qué se muestra y la apariencia. Los cambios se aplican al momento y se conservan al cerrar el programa. La vista previa cambia mientras arrastras un control, y los ajustes que no tienen efecto con la configuración actual se ven atenuados. Cada sección tiene un botón **Restablecer**, y aplicar un tema o restablecer se puede deshacer. Los contadores y los logros vigilados tienen buscador.
- **Perfiles:** crea perfiles con ajustes distintos (por ejemplo, uno para la ventana y otro para OBS). En **Perfiles** eliges el que editas y el que usa la ventana del tracker; junto al enlace para OBS, el que usa la fuente de navegador (el enlace lleva `?profile=`). El guardado, el idioma, el tamaño de la ventana y la imagen de fondo son comunes a todos.
- **Temas propios, exportar e importar:** guarda tu apariencia como tema con un nombre, y exporta o importa los ajustes en un archivo `.json` para hacer copias o compartir tu estilo. La exportación nunca incluye el guardado, rutas ni la imagen de fondo.
- **Ventana del tracker:** el botón **Abrir en ventana** abre el tracker en su propia ventana, de 900×121 por defecto. Puedes estirarla o escribir el ancho y el alto en **Distribución**; el tamaño y la posición se recuerdan.
- **OBS:** añade la ventana «MultiTracker · Tracker» con una **Captura de ventana**. Si prefieres una fuente de navegador, activa en el panel **Permitir la vista como fuente de navegador en OBS** y usa http://localhost:7374/overlay.html. Esa opción es la única que abre un puerto, y solo en tu PC.

## Idiomas

El idioma por defecto es el inglés. En el panel puedes elegir entre English, Español, Français, Português y Русский.

- **Interfaz y descripciones de los objetos:** traducidas en MultiTracker (`app/i18n.js` y `data/descriptions/`).
- **Nombres de objetos, personajes y transformaciones:** salen de las traducciones oficiales del juego. El juego no está en portugués, así que en ese idioma se muestran en inglés.

## Desde el código fuente

Requiere [Node.js](https://nodejs.org) 24. Las herramientas de compilación (Electron y electron-builder) se instalan solas en `.build/`, fuera del repositorio.

- **Aplicación de escritorio:** `node build/run-desktop.js`.
- **Sin Electron:** `iniciar.bat` sirve el panel en http://localhost:7374 con Node, y `ventana.bat` abre el tracker en una ventana de Microsoft Edge.
- **Pruebas:** `node --test "test/*.test.js"` comprueba el lector del log (recoger, quitar, rerolls, Genesis, Alma de Esaú, Strawman, Tainted Lazarus, maldición del ciego, reinicio del log y partidas continuadas) y el del guardado. No necesitan nada instalado aparte de Node.
- **Actualizar los recursos del juego:** `node build/update-resources.js` vuelve a generar `data/resources/` desde el juego instalado (tarda 2-3 minutos y usa 1,2 GB temporales). Hace falta cuando una actualización del juego añade objetos, trinkets o logros.
- **Generar una versión:** `node build/build-exe.js 1.9.0` crea en `dist/` los cinco archivos de una release: `MultiTracker-Setup-1.9.0.exe` (instalador), `MultiTracker-Setup-1.9.0.exe.blockmap` (para descargar solo lo que cambia), `latest.yml` (lo que lee la versión instalada para saber cuál es la última), `MultiTracker.exe` (portable) y el `.zip`. Solo incluye archivos que Git publicaría: lo ignorado nunca llega al programa.
- **Publicar una versión:** escribe las notas en `build/notas/1.9.0.md` (primero en inglés y después en una sección `# Español`), sube el commit y la etiqueta (`git push origin main v1.9.0`) y ejecuta `node build/publish-release.js 1.9.0`. Crea la release `v1.9.0` en GitHub con los cinco archivos de `dist/`, la publica como última versión y comprueba que su `latest.yml` es el que verán las versiones instaladas. Usa `GH_TOKEN` si está definida o, si no, la misma credencial con la que Git sube a GitHub; no la guarda ni la muestra. No toca una release ya publicada.

## Qué muestra

- **Objetos de la partida:** separados por piso con códigos como `B1`, `C2`, `Do1`, `BXL` o `CATH`. Los pisos con la maldición del ciego llevan su separador en otro color y un «?» tras el código. En **Iconos → Maldición del ciego** puedes marcar también cada objeto o no marcar nada. Si el Black Candle o Genesis quitan la maldición a mitad de piso, lo tomado después se muestra como un tramo normal del mismo piso. La runa Dagaz también la quita, pero el juego no registra en `log.txt` qué carta se usa, así que en ese caso el piso sigue marcado.
- **Solo lo que el personaje posee:** los rerolls (D4, D100, sala de dados...) y Genesis quitan lo perdido.
- **Jacob y Esaú, y Tainted Lazarus:** cada objeto indica quién lo lleva con la cabeza del personaje (o una letra si faltan los recursos del juego). En **Iconos** puedes ponerla sobre un círculo de su color. Con Tainted Lazarus se sigue cada cambio de forma, al limpiar una sala o con Flip, también al continuar la partida, y un reroll solo cambia los objetos de la forma activa. Flip es común a las dos formas: se muestra una vez y sin cabeza.
- **Si los objetos no caben:** por defecto la estantería **pasa páginas** como un carrusel. Los iconos se achican hasta el tamaño mínimo que elijas y, desde ahí, los objetos se reparten en páginas que rotan solas. Empieza por la página de los más recientes y, al coger un objeto, salta a la suya. En **Iconos** eliges los segundos por página (los mismos que usa la columna lateral), el efecto (deslizar de izquierda a derecha o al revés, fundido o ninguno), cuánto dura la animación y si se ve el indicador de página. Un piso partido entre dos páginas repite su código.
- **O la lista completa en la misma ventana:** con **Encoger y superponer**, los iconos se superponen un poco. En partidas muy largas también se ocultan los códigos de piso, aunque se mantienen sus líneas, y se usan iconos más pequeños. Al pasar el puntero, el icono se ve entero.
- **Objeto recién tomado:** se destaca durante unos segundos, con el estilo que elijas: pantalla completa, aviso en una esquina, vuelo hasta su sitio en la lista, foco sobre él, marquesina o solo un pulso en su icono.
- **Descripción al pasar el puntero:** en la ventana del tracker, el objeto bajo el puntero se marca y su nombre, descripción y piso aparecen en una franja. En el panel puedes elegir qué objeto se marca: el que está bajo el puntero, el último tomado o ninguno.
- **Cualquier fuente instalada:** el campo **Fuente** del panel sugiere las fuentes instaladas en tu PC.
- **Personaje, seed y racha resaltados:** llevan un contorno negro alrededor de cada letra, como el texto del juego. En **Texto** puedes cambiarlo por un brillo o quitarlo, y elegir su color y su grosor.
- **Imagen de fondo:** en **Fondo** puedes elegir una imagen PNG, JPG, GIF o WebP de hasta 10 MB y ajustar su opacidad, su tamaño (llenar, ajustar, estirar, mosaico o escala propia) y su posición. MultiTracker guarda una copia en `userdata/`.
- **Progreso hacia Dead God:** logros, colección, marcas, retos y racha actual. En un guardado al 100% solo se muestra la racha.
- **Tiempo de juego por archivo:** MultiTracker suma el tiempo de cada partida al guardado en el que se juega y lo muestra en el panel, junto a cada archivo. En la vista puedes activar **Tiempo en este archivo** y **Tiempo de la partida**. El juego no guarda este dato: se cuenta con el contador de frames que escribe en `log.txt`, así que no incluye menús ni pausas, y solo se registra desde que usas MultiTracker. Ábrelo en cada sesión de juego: no hace falta que esté abierto todo el rato, pero sí antes de volver a abrir el juego, que vacía el log al arrancar. Continuar una partida suma también lo jugado antes en ella.
- **Logros como iconos:** los contadores y los logros vigilados se muestran con los iconos de sus logros de Steam, con una ✓ en los conseguidos. MultiTracker sabe qué icono corresponde a cada logro por el esquema que Steam guarda en tu PC (`appcache/stats`), descarga cada imagen una vez de la CDN de Steam y la guarda en `userdata/cache/achievements/`. Sin conexión, o eligiendo **Texto y barras** en el panel, se muestran con texto. Con **Ambos** se alternan iconos y texto con un fundido; eliges cuántos segundos dura cada uno y cuánto tarda el fundido.

Si el guardado elegido no se encuentra, MultiTracker muestra un error en lugar de cambiar a otro.

## Si no encuentra el juego

MultiTracker busca sola las carpetas, incluidas otras bibliotecas de Steam. Si no las encuentra, copia `multitracker.config.example.json` como `multitracker.config.json` y deja solo las rutas que necesites corregir:

| Clave | Carpeta |
| --- | --- |
| `resourcesDir` | Opcional. Recursos extraídos del juego, con `items.xml` dentro, para usarlos en lugar de los incluidos (por ejemplo, si una actualización del juego añade objetos antes de que salga una versión nueva de MultiTracker) |
| `gameDir` | La que contiene `log.txt`, en `Documents/My Games/Binding of Isaac Repentance+` |
| `steamUserdata` | `userdata` de Steam, donde están los guardados |

El archivo debe estar en la carpeta de tus ajustes: junto a `MultiTracker.exe` en el portable, o en `%APPDATA%\MultiTracker` en la versión instalada. Tus ajustes se guardan en `userdata/` dentro de esa carpeta (desinstalar no los borra): `config.json` (guardado, idioma, opciones, apariencia, perfiles y temas propios), `windows.json` (posición de las ventanas), `playtime.json` (tiempo de juego de cada archivo) y, si eliges una, `background.*` (la imagen de fondo). Si mueves el `MultiTracker.exe` portable, lleva `userdata/` con él: el tiempo registrado no se puede volver a calcular.

## Fuente Upheaval (opcional)

El tracker está pensado para la fuente pixel Upheaval TT (BRK), que no se incluye porque no pudimos confirmar si su licencia permite redistribuirla. Sin ella, se usa la fuente del sistema.

Para usarla, consíguela por tu cuenta e instálala en Windows; después elige **Upheaval TT (BRK)** en el campo **Fuente** del panel. También puedes guardarla como `app/upheaval.ttf`, en la carpeta de `MultiTracker.exe`, y elegir **Upheaval**.

## Créditos

También puedes verlos en el panel, con el botón **Acerca de**.

| Componente | Autoría | Aportación |
| --- | --- | --- |
| MultiTracker | **Mafla** | Creador del proyecto |
| [Rebirth Item Tracker](https://github.com/Hyphen-ated/RebirthItemTracker) | Brett824 y Hyphen-ated | Descripciones de los objetos (`data/items.json`, en inglés) y códigos de los pisos. Licencia BSD de 2 cláusulas, en `data/LICENSE-RebirthItemTracker.txt` |
| Isaac Deadgod Tracker | veryhighlibido | Inspiración para el seguimiento del progreso hacia Dead God |
| [Fuente Upheaval](https://www.dafont.com/aenigma.d188) | Brian Kent (Ænigma Fonts) | Fuente opcional; no se incluye |
| [Electron](https://www.electronjs.org) | OpenJS Foundation y colaboradores (incluye Chromium y Node.js) | Motor incluido en el ejecutable. Sus licencias acompañan a cada versión publicada |
| The Binding of Isaac: Repentance+ | Edmund McMillen y Nicalis | Iconos, nombres y sus traducciones, leídos de tu propia copia del juego |

Proyecto de fans, sin afiliación con los creadores del juego.

## Licencia

El código de MultiTracker se publica bajo la [licencia MIT](LICENSE). `data/items.json` y sus traducciones en `data/descriptions/` conservan la licencia de Rebirth Item Tracker, en `data/LICENSE-RebirthItemTracker.txt`.
