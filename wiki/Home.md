# Downtime wiki

App docs that sit next to the globes. Hardware we do not have yet still belongs here so the next box is a known path.

## Pages

- [ADS-B IM feeder](ADS-B-IM-Feeder.md) — local 1090 MHz receiver using [adsb.im/howto](https://adsb.im/howto). Not built yet. The Cesium **AIR** layer uses [adsb.lol](https://adsb.lol) until a feeder exists.

## Live globes

- Canvas HUD: `http://127.0.0.1:4173/`
- Cesium: `http://127.0.0.1:4173/cesium.html`

```bash
cd visualizer
node server.mjs
```
