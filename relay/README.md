# HopLite Map Relay

Servidor mínimo para que varios jugadores vean sus posiciones en el mapa, cada uno desde su casa.

## Arranque local

```bash
cd relay
node server.js
```

Queda en `http://localhost:8787`.

Para que tus amigos entren desde fuera de tu red:

1. **Opción fácil:** despliega gratis en [Render](https://render.com) (Web Service, runtime Node, start command `node server.js`).
2. **Opción rápida en casa:** [ngrok](https://ngrok.com) → `ngrok http 8787` y comparte la URL https.

## En el mapa

1. Activa **Tiempo real** (mod PlayerCoordsAPI).
2. Pon tu **nombre**, el mismo **código de sala** (ej. `hoplite`) y la **URL del relay**.
3. Pulsa **Compartir ON**.

Todos con la misma sala y URL se verán en el mapa.

## API

- `GET /room/:sala` → lista de jugadores
- `PUT /room/:sala/player` → publicar posición (JSON)
- `DELETE /room/:sala/player/:id` → salir
- `GET /health`
