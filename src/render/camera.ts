export const TILE = 32;

/** Câmera 2D: posição (px do mundo no canto superior esquerdo) e zoom. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  vw = 800;
  vh = 600;
  minZoom = 0.5; // abaixo disso o mapa precisaria de uma versão simplificada, que destoava da arte
  maxZoom = 1.7;
  worldW: number;
  worldH: number;
  constructor(worldTilesW: number, worldTilesH: number) {
    this.worldW = worldTilesW * TILE;
    this.worldH = worldTilesH * TILE;
  }
  resize(w: number, h: number) {
    this.vw = w;
    this.vh = h;
    this.clamp();
  }
  clamp() {
    const vwW = this.vw / this.zoom, vhW = this.vh / this.zoom;
    const mx = Math.max(0, this.worldW - vwW), my = Math.max(0, this.worldH - vhW);
    if (vwW > this.worldW) this.x = (this.worldW - vwW) / 2; else this.x = Math.max(0, Math.min(mx, this.x));
    if (vhW > this.worldH) this.y = (this.worldH - vhW) / 2; else this.y = Math.max(-40, Math.min(my + 60, this.y));
  }
  /** Centraliza em coordenadas de tile. */
  centerOn(tx: number, ty: number) {
    this.x = tx * TILE - this.vw / this.zoom / 2;
    this.y = ty * TILE - this.vh / this.zoom / 2;
    this.clamp();
  }
  center(): [number, number] {
    return [(this.x + this.vw / this.zoom / 2) / TILE, (this.y + this.vh / this.zoom / 2) / TILE];
  }
  /** Tela (px relativos ao viewport) -> tiles. */
  toWorld(sx: number, sy: number): [number, number] {
    return [(this.x + sx / this.zoom) / TILE, (this.y + sy / this.zoom) / TILE];
  }
  toScreen(tx: number, ty: number): [number, number] {
    return [(tx * TILE - this.x) * this.zoom, (ty * TILE - this.y) * this.zoom];
  }
  zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.x = wx * TILE - sx / this.zoom;
    this.y = wy * TILE - sy / this.zoom;
    this.clamp();
  }
  pan(dxScreen: number, dyScreen: number) {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clamp();
  }
  /** Retângulo visível em tiles. */
  viewRect(margin = 0): [number, number, number, number] {
    return [
      this.x / TILE - margin, this.y / TILE - margin,
      (this.x + this.vw / this.zoom) / TILE + margin, (this.y + this.vh / this.zoom) / TILE + margin,
    ];
  }
}
