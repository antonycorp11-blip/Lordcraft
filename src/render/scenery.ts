import { hash2 } from '../core/rng';
import type { Decor } from '../world/mapgen';
import { World, Ter } from '../world/world';
import { TILE } from './camera';
import oakUrl from '../assets/sprites/t_oak.webp';
import pineUrl from '../assets/sprites/t_pine.webp';
import mapleUrl from '../assets/sprites/t_maple.webp';
import frostUrl from '../assets/sprites/t_frost.webp';
import propsUrl from '../assets/sprites/d_props.webp';
import worldPropsUrl from '../assets/world-props.webp';

// Cenário fixo (árvores, pedras, penhascos, enfeites, capim) desenhado no mesmo canvas do
// chão de cada bloco. Antes eram centenas de elementos HTML por bloco, e montar/mostrar
// blocos novos ao arrastar a câmera travava o celular. Cada bloco desenha também o que
// transborda dos vizinhos na sua margem, então as bordas entre blocos ficam idênticas.

const TREE_WOOD = 50;
const TREE_FRAMES = 20;
const FRAME_STILL = 12, FRAME_D1 = 13, FRAME_D2 = 14;

const URLS: Record<string, string> = { t0: oakUrl, t1: pineUrl, t2: mapleUrl, t3: frostUrl, props: propsUrl, world: worldPropsUrl };
const imgs: Record<string, HTMLImageElement> = {};
let loaded = 0;
let started = false;
const waiting: (() => void)[] = [];

export function sceneryReady(fn: () => void): boolean {
  if (!started) {
    started = true;
    for (const [k, u] of Object.entries(URLS)) {
      const im = new Image();
      im.decoding = 'async';
      im.onload = im.onerror = () => { loaded++; if (loaded === Object.keys(URLS).length) for (const f of waiting.splice(0)) f(); };
      im.src = u;
      imgs[k] = im;
    }
  }
  if (loaded === Object.keys(URLS).length) { fn(); return true; }
  waiting.push(fn);
  return false;
}

function cell(im: HTMLImageElement, cols: number, rows: number, c: number, r: number): [number, number, number, number] {
  const w = im.naturalWidth / cols, h = im.naturalHeight / rows;
  return [c * w, r * h, w, h];
}

/** Caixa (px do mundo) ocupada pela arte de uma árvore no tile i. */
export function treeBox(w: World, i: number, seed: number): { x: number; y: number; w: number; h: number } {
  const x = i % w.w, y = Math.floor(i / w.w);
  const ox = Math.round((hash2(x, y, seed + 9) - 0.5) * 8), oy = Math.round((hash2(y, x, seed + 9) - 0.5) * 6);
  return { x: x * TILE + ox - 22, y: y * TILE + oy - 42, w: 78, h: 78 };
}

interface Item { z: number; draw: (ctx: CanvasRenderingContext2D) => void }

/**
 * Desenha o cenário que cai dentro do retângulo (px do mundo) [ax, ay, ax+aw, ay+ah].
 * O contexto já deve estar transformado para coordenadas do mundo.
 */
export function paintScenery(ctx: CanvasRenderingContext2D, w: World, seed: number, decor: Decor[], stumps: Set<number>,
  ax: number, ay: number, aw: number, ah: number) {
  const items: Item[] = [];
  const S = seed;
  const tx0 = Math.max(0, Math.floor(ax / TILE) - 3), ty0 = Math.max(0, Math.floor(ay / TILE) - 2);
  const tx1 = Math.min(w.w - 1, Math.ceil((ax + aw) / TILE) + 2), ty1 = Math.min(w.h - 1, Math.ceil((ay + ah) / TILE) + 3);
  const world = imgs.world, props = imgs.props;
  // detalhes rasteiros: desenhados antes de tudo
  ctx.save();
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      const i = w.idx(x, y);
      const t = w.ter[i];
      const lx = x * TILE, ly = y * TILE;
      const h = hash2(x * 3, y * 5, S + 1);
      if (t === Ter.Bridge) {
        ctx.fillStyle = '#7d6c49';
        ctx.fillRect(lx, ly, 33, 33);
        ctx.fillStyle = '#5c5139';
        for (let k = 0; k < 33; k += 8) ctx.fillRect(lx, ly + k + 5, 33, 2);
      } else if (t === Ter.Water && h < 0.16) {
        ctx.strokeStyle = 'rgba(162,219,216,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(lx + (h * 60) % 16 + 12, ly + 12, 12, 3, 0, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else if (t === Ter.Road) {
        ctx.drawImage(roadDisc(), lx + 16 - 26 + (h - 0.5) * 4, ly + 16 - 26 + (hash2(y, x, S + 2) - 0.5) * 4);
        if (h < 0.18) pebble(ctx, lx + (h * 90) % 20, ly + (h * 55) % 20, 5, 4);
      } else if (w.block[i] === 0 && !w.tree[i]) {
        if (h < 0.03 && (t === Ter.Grass || t === Ter.Moss || t === Ter.Dirt)) {
          const list = t === Ter.Dirt ? [0, 1, 5, 12] : [2, 3, 4, 2, 3, 0, 1, 5];
          const k = list[Math.floor(hash2(x * 7, y * 11, S + 3) * list.length)];
          const px = lx + (h * 500) % 10 - 4, py = ly - 12;
          items.push({ z: (y + 1) * TILE, draw: (c) => { const [sx, sy, sw, sh] = cell(props, 4, 4, k % 4, Math.floor(k / 4)); c.drawImage(props, sx, sy, sw, sh, px, py, 40, 40); } });
        } else if (h < 0.09 && (t === Ter.Grass || t === Ter.Moss)) {
          tuft(ctx, lx + (h * 300) % 22, ly + (h * 170) % 22, t === Ter.Moss ? '#9bb582' : '#a6b568', h < 0.03);
        } else if (h < 0.05 && t === Ter.Snow) tuft(ctx, lx + 8, ly + 10, '#eef1e2', false);
        else if (h < 0.06 && t === Ter.Ash) { ctx.fillStyle = '#d69552'; ctx.fillRect(lx + 10, ly + 12, 3, 3); }
        else if (h > 0.985) pebble(ctx, lx + 6, ly + 10, 10, 8);
      }
      // penhascos
      if (w.cliff[i]) {
        const north = y > 0 && w.elev[w.idx(x, y - 1)] === 0;
        items.push({ z: (y + 1) * TILE - 1, draw: (c) => {
          const [sx, sy, sw, sh] = cell(world, 4, 3, 3, 1);
          c.save();
          if (north) c.globalAlpha = 0.7;
          shadow(c, lx + 26, ly + 44, 20, 6);
          c.drawImage(world, sx, sy, sw, sh, lx, ly, 42, 45);
          c.restore();
        } });
      }
      // montanha: um rochedo por célula 2x2, de tamanho e posição variados (maciço, não grade)
      if (t === Ter.Rock && (x & 1) === 0 && (y & 1) === 0) {
        let n = 0;
        for (let k = 0; k < 4; k++) { const xx = x + (k & 1), yy = y + (k >> 1); if (xx < w.w && yy < w.h && w.ter[w.idx(xx, yy)] === Ter.Rock) n++; }
        const sc = (n === 4 ? 1.55 : 1.15) + hash2(x, y, S + 21) * 0.45;
        const rot = (hash2(y, x, S + 22) - 0.5) * 30;
        const flip = hash2(x, y, S + 23) < 0.5 ? -1 : 1;
        const jx = (hash2(x, y, S + 24) - 0.5) * 18, jy = (hash2(y, x, S + 25) - 0.5) * 14;
        items.push({ z: (y + 2) * TILE, draw: (c) => {
          const [sx, sy, sw, sh] = cell(world, 4, 3, 2, 1);
          c.save();
          shadow(c, lx + 32 + jx + 6, ly + 44 + jy, 26 * sc, 8 * sc);
          c.translate(lx + 32 + jx, ly + 22 + jy);
          c.rotate((rot * Math.PI) / 180);
          c.scale(sc * flip, sc);
          c.drawImage(world, sx, sy, sw, sh, -27.5, -27.5, 55, 55);
          c.restore();
        } });
      }
      // árvores e tocos
      if (w.tree[i] || stumps.has(i)) {
        const b = treeBox(w, i, S);
        const oy = b.y + 42 - ly;
        if (stumps.has(i) && !w.tree[i]) {
          items.push({ z: (y + 1) * TILE + oy - 1, draw: (c) => { const [sx, sy, sw, sh] = cell(world, 4, 3, 3, 2); c.drawImage(world, sx, sy, sw, sh, b.x + 16, b.y + 32, 48, 48); } });
        } else {
          const k = w.treeKind[i];
          const f = w.tree[i] / TREE_WOOD;
          const frame = f < 0.34 ? FRAME_D2 : f < 0.67 ? FRAME_D1 : FRAME_STILL;
          const im = imgs['t' + (k & 3)];
          items.push({ z: (y + 1) * TILE + oy, draw: (c) => { const [sx, sy, sw, sh] = cell(im, TREE_FRAMES, 1, frame, 0); c.drawImage(im, sx, sy, sw, sh, b.x, b.y, b.w, b.h); } });
        }
      }
    }
  ctx.restore();
  // ruínas e enfeites do mapa
  for (const d of decor) {
    if (d.x < tx0 || d.x > tx1 || d.y < ty0 || d.y > ty1) continue;
    const pos: Record<string, [number, number]> = { pillar: [3, 1], statue: [3, 1], arch: [0, 2], stones: [1, 0], bones: [1, 2], crystalshard: [2, 2] };
    const [cc, rr] = pos[d.kind] ?? [1, 0];
    items.push({ z: (d.y + 1) * TILE, draw: (c) => { const [sx, sy, sw, sh] = cell(props, 4, 4, cc, rr); c.globalAlpha = 0.9; c.drawImage(props, sx, sy, sw, sh, d.x * TILE, d.y * TILE - 8, 48, 48); c.globalAlpha = 1; } });
  }
  items.sort((a, b) => a.z - b.z);
  for (const it of items) it.draw(ctx);
}

let disc: HTMLCanvasElement | null = null;
/** Mancha de terra batida com borda suave: lado a lado, viram um caminho contínuo. */
function roadDisc(): HTMLCanvasElement {
  if (disc) return disc;
  disc = document.createElement('canvas');
  disc.width = disc.height = 52;
  const c = disc.getContext('2d');
  if (!c) return disc;
  const g = c.createRadialGradient(26, 26, 4, 26, 26, 26);
  g.addColorStop(0, 'rgba(150,128,86,0.95)');
  g.addColorStop(0.55, 'rgba(140,118,78,0.85)');
  g.addColorStop(1, 'rgba(120,100,64,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 52, 52);
  return disc;
}

/** Sombra barata (elipse translúcida): a sombra borrada do canvas é lenta no celular. */
function shadow(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  c.fillStyle = 'rgba(14,34,28,0.32)';
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

function pebble(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = 'rgba(87,91,65,0.35)';
  ctx.beginPath(); ctx.ellipse(x + w / 2 + 1, y + h / 2 + 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#a6a38a';
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
}

function tuft(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, flower: boolean) {
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + 3.2, y + 5.1); ctx.lineTo(x + 4.4, y); ctx.lineTo(x + 5.7, y + 5.1); ctx.lineTo(x + 9, y + 1.2);
  ctx.lineTo(x + 8.1, y + 8); ctx.lineTo(x + 0.9, y + 8); ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  if (flower) { ctx.fillStyle = '#dccc91'; ctx.fillRect(x, y, 3, 3); ctx.fillRect(x + 5, y + 2, 3, 3); }
}
