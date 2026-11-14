# Servicio para compartir partidas

Es lo que usa la pestaña **Multijugador** de MultiTracker para «Dejar que otros vean mi partida» y «Ver la partida de otra
persona». Corre en Cloudflare Workers, con un Durable Object por código. Los usuarios no tienen que configurar nada: solo
comparten un código de 7 letras.

Publicado en `https://multitracker-relay.maflatv.workers.dev` (cuenta de Cloudflare de MaflaTV). Para
publicar un cambio de `worker.js`: `npx wrangler deploy` en esta carpeta.

## Publicarlo en otra cuenta

1. Crea una cuenta gratuita en <https://dash.cloudflare.com/sign-up>.
2. En esta carpeta (`multitracker/relay`):
   ```
   npx wrangler login
   npx wrangler deploy
   ```
   `login` abre el navegador para autorizar Wrangler en tu cuenta. `deploy` publica el servicio y muestra su dirección,
   del tipo `https://multitracker-relay.<tu-subdominio>.workers.dev`.
3. Pon esa dirección en `DEFAULT_RELAY` de `lib/remote.js` y publica una versión nueva de MultiTracker.

Para probar con otra dirección sin tocar el código: variable de entorno `MULTITRACKER_RELAY`.

## Cómo funciona

| Ruta | Qué hace |
|---|---|
| `POST /v1/rooms` | Crea un código y su clave. La clave solo la guarda quien comparte (en su `config.json`). |
| `PUT /v1/rooms/<código>` | Sube la partida (con la clave). Como mucho una vez por segundo. |
| `GET /v1/rooms/<código>` | La última partida. 404 si el código no existe; 204 si aún no ha subido nada. |
| `GET /v1/rooms/<código>/ws` | WebSocket: la última partida al conectar y cada una nueva al llegar. |
| `DELETE /v1/rooms/<código>` | Borra el código (con la clave), al pulsar «Código nuevo». |

- Un código sin partidas nuevas durante 14 días se borra solo.
- Quien comparte sube enseguida los cambios de objetos, pisos y jugadores; el tiempo y el progreso, como mucho cada
  30 s. Quien mira recibe cada cambio por WebSocket y, si su red no lo permite, pregunta cada 3 s.
- Se sube lo mismo que guarda el log (seed, pisos, objetos, personajes, tiempo), el progreso del guardado y, en
  partidas online, los nombres de Steam, sin sus ids.

## Límites del plan gratuito

Cloudflare cobra por peticiones. Cada cambio de quien comparte es una; los WebSocket de quien mira hibernan mientras no
llega nada y casi no cuentan. Si algún día se quedara corto, el plan de pago de Workers empieza en 5 USD al mes.
