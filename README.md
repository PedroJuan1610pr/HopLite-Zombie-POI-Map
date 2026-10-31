# HopLite Zombie Map (Live + Multijugador)

Mapa web con:
- Posición en tiempo real vía mod **PlayerCoordsAPI** (localhost)
- Multijugador: varios jugadores, cada uno en su casa, misma sala

## Tiempo real (solo tú)

1. Instala [PlayerCoordsAPI](https://modrinth.com/project/ZTxdoq6g) para tu versión Fabric.
2. Abre este mapa **en local** (no desde GitHub Pages).
3. Activa **Tiempo real**.

## Multijugador (varios en casa)

1. Alguien arranca el relay: carpeta `relay/` → `node server.js` (o despliegue en Render).
2. Todos ponen la misma **URL del relay** y el mismo **código de sala**.
3. Cada uno activa **Tiempo real** + **Compartir ON**.

Ver `relay/README.md` para desplegar el servidor.
