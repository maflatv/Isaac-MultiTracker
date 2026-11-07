# MultiTracker

Tracker para The Binding of Isaac: Repentance+ que reúne en una sola vista los objetos de la partida actual y el progreso hacia Dead God. Se puede usar en una ventana aparte o como fuente de navegador en OBS.

Solo lee archivos del juego: no modifica tus partidas ni necesita mods.

*An item and Dead God progress tracker for Repentance+. Windows and Node.js only; the interface is in Spanish. Extract the game's resources, run `iniciar.bat`, and add `http://localhost:7374/overlay.html` to OBS as a browser source.*

## Requisitos

- Windows
- [Node.js](https://nodejs.org) (no hay que instalar dependencias)
- The Binding of Isaac: Repentance+ en Steam

## Instalación

1. Descarga o clona este repositorio.
2. Ejecuta una vez `tools\ResourceExtractor\ResourceExtractor.exe`, en la carpeta del juego en Steam. MultiTracker toma de ahí los iconos y los nombres, porque este repositorio no incluye ningún archivo del juego.
3. Ejecuta `iniciar.bat`. Se abrirá el panel en http://localhost:7374.
4. Elige tu guardado en el panel.

## Uso

- **Configurar:** el panel permite elegir el guardado, qué se muestra y la apariencia. Los cambios se aplican al momento.
- **Ventana aparte:** `ventana.bat` abre el tracker en una ventana de 900×121 con Microsoft Edge.
- **OBS:** añade una fuente de navegador con la URL http://localhost:7374/overlay.html. `iniciar.bat` debe seguir abierto.

## Qué muestra

- **Objetos de la partida:** separados por piso con códigos como `B1`, `C2`, `Do1`, `BXL` o `CATH`. Los tomados bajo la maldición del ciego llevan una marca.
- **Solo lo que el personaje posee:** los rerolls (D4, D100, sala de dados...) y Genesis quitan lo perdido.
- **Jacob y Esaú:** cada objeto indica quién lo lleva.
- **Objeto recién tomado:** se destaca con una animación durante unos segundos.
- **Progreso hacia Dead God:** logros, colección, marcas, retos y racha actual. En un guardado al 100% solo se muestra la racha.

Si el guardado elegido no se encuentra, MultiTracker muestra un error en lugar de cambiar a otro.

## Si no encuentra el juego

MultiTracker busca sola las carpetas, incluidas otras bibliotecas de Steam. Si no las encuentra, copia `multitracker.config.example.json` como `multitracker.config.json` y deja solo las rutas que necesites corregir:

| Clave | Carpeta |
| --- | --- |
| `resourcesDir` | Recursos extraídos del juego, con `items.xml` dentro |
| `gameDir` | La que contiene `log.txt`, en `Documents/My Games/Binding of Isaac Repentance+` |
| `steamUserdata` | `userdata` de Steam, donde están los guardados |

Tus ajustes se guardan en `userdata/` y no se suben a Git.

## Fuente Upheaval (opcional)

El tracker está pensado para la fuente pixel Upheaval TT (BRK), que no se incluye porque no pudimos confirmar si su licencia permite redistribuirla. Sin ella, se usa la fuente del sistema.

Para usarla, consíguela por tu cuenta y guárdala como `app/upheaval.ttf`.

## Créditos

- Las descripciones de `data/items.json` proceden de [Rebirth Item Tracker](https://github.com/Hyphen-ated/RebirthItemTracker), de Brett824 y Hyphen-ated. Su licencia está en `data/LICENSE-RebirthItemTracker.txt`.
- The Binding of Isaac es propiedad de sus creadores. Este proyecto no está afiliado a ellos.
