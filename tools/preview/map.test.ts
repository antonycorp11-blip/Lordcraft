// @vitest-environment happy-dom
// Prévia do mapa com o MESMO código de desenho do jogo (chão + cenário), sem navegador.
// Uso: PREVIEW=1 PREVIEW_OUT=arquivo.jpg PREVIEW_RECT="x,y,w,h" PREVIEW_SCALE=0.3 npx vitest run tools/preview/map.test.ts
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createCanvas, Image as NImage } from '@napi-rs/canvas';
import { createCampaign } from '../../src/sim/setup';
import { TerrainView } from '../../src/render/terrain';
import { TILE } from '../../src/render/camera';

const ROOT = resolve(__dirname, '../..');
const napiOf = (src: any) => src?._napi ?? src?._nimg ?? src;
(globalThis as any).Image = class {
  onload: (() => void) | null = null; onerror: (() => void) | null = null; decoding = ''; _nimg: any; naturalWidth = 0; naturalHeight = 0;
  set src(u: string) {
    const img = new NImage();
    // como no navegador: onload só depois de decodificar
    img.onload = () => { this.naturalWidth = img.width; this.naturalHeight = img.height; this.onload?.(); };
    img.onerror = () => this.onerror?.();
    this._nimg = img;
    img.src = readFileSync(resolve(ROOT, u.replace(/^\//, '').replace(/\?.*$/, '')));
  }
};
(HTMLCanvasElement.prototype as any).getContext = function () {
  const w = Math.max(1, this.width), h = Math.max(1, this.height);
  if (!this._napi || this._napi.width !== w || this._napi.height !== h) this._napi = createCanvas(w, h);
  const ctx = this._napi.getContext('2d');
  return new Proxy(ctx, {
    get(t, k) {
      if (k === 'drawImage') return (src: any, ...a: number[]) => (t as any).drawImage(napiOf(src), ...a);
      const v = (t as any)[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) { (t as any)[k] = v; return true; },
  });
};

it("prévia do mapa", async () => {
  const { game: g } = createCampaign({ lordName: 'A', houseName: 'B', crest: { c1: '#123', c2: '#eee', pattern: 'fess', charge: '✦' }, female: false, seed: 3, faction: 'valmir' });
  const [rx, ry, rw, rh] = (process.env.PREVIEW_RECT ?? '0,0,60,40').split(',').map(Number);
  const ground = document.createElement('div'), objs = document.createElement('div');
  const tv = new TerrainView(g.world, ground, objs, g.decor, g.seed);
  // carrega imagens e pinta os blocos da região em escala 1
  for (let k = 0; k < 6; k++) { tv.update(rx, ry, rx + rw, ry + rh, false, 1); await new Promise((r) => setTimeout(r, 20)); }
  for (let k = 0; k < 400; k++) tv.update(rx, ry, rx + rw, ry + rh, false, 1);
  if (process.env.PREVIEW_REPAINT) { for (const c of (tv as any).chunks) c.painted = 0; for (let k = 0; k < 120; k++) tv.update(rx, ry, rx + rw, ry + rh, false, 1); }
  if (process.env.PREVIEW_DEBUG) console.log((tv as any).chunks.filter((c: any) => c.built).map((c: any) => `${c.cx},${c.cy} p=${c.painted} napi=${!!c.gcv?._napi}`).join(' | '), 'sceneryOk', (tv as any).sceneryOk);
  const out = createCanvas(rw * TILE, rh * TILE);
  const o = out.getContext('2d');
  o.fillStyle = '#607247'; o.fillRect(0, 0, out.width, out.height);
  for (const c of (tv as any).chunks) {
    if (!c.gcv?._napi || !c.painted) continue;
    o.drawImage(c.gcv._napi, c.cx * 512 - 56 - rx * TILE, c.cy * 512 - 56 - ry * TILE, 624, 624);
  }
  // sede e minas por cima, só para referência
  o.fillStyle = 'rgba(40,80,200,0.85)';
  for (const b of g.buildings) o.fillRect((b.tx - rx) * TILE, (b.ty - ry) * TILE, b.size * TILE, b.size * TILE);
  o.fillStyle = 'rgba(220,220,230,0.9)';
  for (const r of g.resources) o.fillRect((r.tx - rx) * TILE, (r.ty - ry) * TILE, r.size * TILE, r.size * TILE);
  const sc = Number(process.env.PREVIEW_SCALE ?? 1);
  let fin = out;
  if (sc !== 1) { fin = createCanvas(Math.round(out.width * sc), Math.round(out.height * sc)); fin.getContext('2d').drawImage(out, 0, 0, fin.width, fin.height); }
  writeFileSync(process.env.PREVIEW_OUT ?? 'preview.png', await fin.encode('jpeg', 80));
}, 120000);
