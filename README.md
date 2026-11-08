# MultiTracker

Tracker para The Binding of Isaac: Repentance+ que reúne en una sola vista los objetos de la partida actual y el progreso hacia Dead God. Se usa en su propia ventana y puede capturarse en OBS.

Solo lee archivos del juego: no modifica tus partidas ni necesita mods.

*An item and Dead God progress tracker for Repentance+. A single portable Windows executable: no installation and no local server. Available in English, Spanish, French, Portuguese and Russian (English by default). Extract the game's resources once, open `MultiTracker.exe`, and capture its window in OBS.*

## Requisitos

- Windows de 64 bits
- The Binding of Isaac: Repentance+ en Steam

## Instalación

1. Descarga `MultiTracker.exe` de la [última versión](https://github.com/maflatv/MultiTracker/releases/latest) y ponlo en su propia carpeta. Tus ajustes se guardarán ahí. Hay también un `.zip` con el mismo `.exe` y las licencias.
2. Ejecuta una vez `tools\ResourceExtractor\ResourceExtractor.exe`, en la carpeta del juego en Steam. MultiTracker toma de ahí los iconos, los nombres y sus traducciones, porque no incluye ningún archivo del juego.
3. Abre `MultiTracker.exe`. Es portable: no se instala ni abre ningún servidor.
4. Elige tu guardado y tu idioma en el panel.

El ejecutable no tiene firma digital, así que Windows puede mostrar un aviso. Para continuar, pulsa **Más información** y luego **Ejecutar de todas formas**.

## Uso

- **Configurar:** el panel permite elegir el guardado, el idioma, qué se muestra y la apariencia. Los cambios se aplican al momento y se conservan al cerrar el programa.
- **Ventana del tracker:** el botón **Abrir en ventana** abre el tracker en una ventana de 900×121. MultiTracker recuerda dónde dejaste cada ventana.
- **OBS:** añade la ventana «MultiTracker · Tracker» con una **Captura de ventana**. Si prefieres una fuente de navegador, activa en el panel **Permitir la vista como fuente de navegador en OBS** y usa http://localhost:7374/overlay.html. Esa opción es la única que abre un puerto, y solo en tu PC.

## Idiomas

El idioma por defecto es el inglés. En el panel puedes elegir entre English, Español, Français, Português y Русский.

- **Interfaz y descripciones de los objetos:** traducidas en MultiTracker (`app/i18n.js` y `data/descriptions/`).
- **Nombres de objetos, personajes y transformaciones:** salen de las traducciones oficiales del juego. El juego no está en portugués, así que en ese idioma se muestran en inglés.

## Desde el código fuente

Requiere [Node.js](https://nodejs.org) 24. Las herramientas de compilación (Electron y electron-builder) se instalan solas en `.build/`, fuera del repositorio.

- **Aplicación de escritorio:** `node build/run-desktop.js`.
- **Sin Electron:** `iniciar.bat` sirve el panel en http://localhost:7374 con Node, y `ventana.bat` abre el tracker en una ventana de Microsoft Edge.
- **Generar el ejecutable:** `node build/build-exe.js 1.1.1` crea `MultiTracker.exe` y el `.zip` en `dist/`. Solo incluye archivos que Git publicaría: lo ignorado nunca llega al `.exe`.

## Qué muestra

- **Objetos de la partida:** separados por piso con códigos como `B1`, `C2`, `Do1`, `BXL` o `CATH`. Los tomados bajo la maldición del ciego llevan una marca.
- **Solo lo que el personaje posee:** los rerolls (D4, D100, sala de dados...) y Genesis quitan lo perdido.
- **Jacob y Esaú:** cada objeto indica quién lo lleva.
- **Objeto recién tomado:** se destaca con una animación durante unos segundos.
- **Progreso hacia Dead God:** logros, colección, marcas, retos y racha actual. En un guardado al 100% solo se muestra la racha.
- **Logros como iconos:** los contadores y los logros vigilados se muestran con los iconos de sus logros de Steam, con una ✓ en los conseguidos. MultiTracker sabe qué icono corresponde a cada logro por el esquema que Steam guarda en tu PC (`appcache/stats`), descarga cada imagen una vez de la CDN de Steam y la guarda en `userdata/cache/achievements/`. Sin conexión, o eligiendo **Texto y barras** en el panel, se muestran con texto.

Si el guardado elegido no se encuentra, MultiTracker muestra un error en lugar de cambiar a otro.

## Si no encuentra el juego

MultiTracker busca sola las carpetas, incluidas otras bibliotecas de Steam. Si no las encuentra, copia `multitracker.config.example.json` como `multitracker.config.json` y deja solo las rutas que necesites corregir:

| Clave | Carpeta |
| --- | --- |
| `resourcesDir` | Recursos extraídos del juego, con `items.xml` dentro |
| `gameDir` | La que contiene `log.txt`, en `Documents/My Games/Binding of Isaac Repentance+` |
| `steamUserdata` | `userdata` de Steam, donde están los guardados |

El archivo debe estar junto a `MultiTracker.exe`. Tus ajustes se guardan en `userdata/`, también junto a él: `config.json` (guardado, idioma, opciones y apariencia) y `windows.json` (posición de las ventanas).

## Fuente Upheaval (opcional)

El tracker está pensado para la fuente pixel Upheaval TT (BRK), que no se incluye porque no pudimos confirmar si su licencia permite redistribuirla. Sin ella, se usa la fuente del sistema.

Para usarla, consíguela por tu cuenta y guárdala como `app/upheaval.ttf`, en la carpeta de `MultiTracker.exe`.

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

## Apoya el proyecto

MultiTracker es gratuito. Si te resulta útil y quieres apoyar a Mafla, puedes hacerlo en [Ko-fi](https://ko-fi.com/maflatv).
