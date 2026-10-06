import atlasUrl from '../assets/terrain-atlas-v2.webp';

// Pinta o chão de um bloco num único canvas, com as mesmas manchas orgânicas que antes
// eram ~70 elementos HTML (com máscara, rotação e filtro) por bloco. Cada tipo de terreno
// vira um "carimbo" pré-recortado do atlas, com borda suave; o bloco só carimba.

export interface GroundBlob { ter: string; v: number; x: number; y: number; rot: number; hi: boolean }

/** Margem em px além do bloco: as manchas da borda transbordam para o vizinho. */
export const PAD = 56;

const STAMP_W = 98, STAMP_H = 92;
const ATLAS_CELL: Record<string, [number, number]> = {
  grass: [0, 0], dirt: [1, 0], moss: [2, 0], ash: [3, 0],
  snow: [0, 1], water: [1, 1], shallow: [2, 1], sand: [3, 1],
  road: [0, 2], rock: [1, 2], bridge: [2, 2],
};
const BASE_COLOR: Record<string, string> = {
  grass: '#647948', dirt: '#83764d', moss: '#476c55', ash: '#746157', snow: '#becac6', water: '#305b69',
  shallow: '#528887', sand: '#b4ab7d', road: '#9b8b5e', rock: '#70736c', bridge: '#305b69',
};
const BRIGHTNESS = [1, 0.94, 1.05, 0.98];

let atlas: HTMLImageElement | null = null;
let ready = false;
const waiting: (() => void)[] = [];
const stamps = new Map<string, HTMLCanvasElement>();

function loadAtlas() {
  if (atlas) return;
  atlas = new Image();
  atlas.decoding = 'async';
  atlas.onload = () => { ready = true; for (const fn of waiting.splice(0)) fn(); };
  atlas.src = atlasUrl;
}

/** Executa agora se o atlas já carregou, ou assim que carregar. */
export function whenGroundReady(fn: () => void): boolean {
  loadAtlas();
  if (ready) { fn(); return true; }
  waiting.push(fn);
  return false;
}

/** Máscara elíptica igual à do CSS antigo (opaco até 52%, 80% em 67%, some em 81%). */
function softEdge(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.setTransform(1, 0, 0, h / w, w / 2, h / 2);
  const r = (w / 2) * Math.SQRT2;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, '#000');
  g.addColorStop(0.52, '#000');
  g.addColorStop(0.67, 'rgba(0,0,0,.8)');
  g.addColorStop(0.81, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, w / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function stamp(ter: string, v: number, hi: boolean, scale: number): HTMLCanvasElement {
  const key = `${hi ? 'hi' : ter}:${v}:${scale}`;
  let cv = stamps.get(key);
  if (cv) return cv;
  const w = Math.ceil(STAMP_W * scale), h = Math.ceil(STAMP_H * scale);
  cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  if (hi) {
    // brilho de planalto (antes: radial-gradient(ellipse,#d1dca638,transparent 70%))
    ctx.setTransform(1, 0, 0, h / w, w / 2, h / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, (w / 2) * Math.SQRT2);
    g.addColorStop(0, 'rgba(209,220,166,.22)');
    g.addColorStop(0.7, 'rgba(209,220,166,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -w / 2, w, w);
  } else {
    const [c, r] = ATLAS_CELL[ter] ?? ATLAS_CELL.grass;
    ctx.fillStyle = BASE_COLOR[ter] ?? BASE_COLOR.grass;
    ctx.fillRect(0, 0, w, h);
    const cw = atlas!.naturalWidth / 4, chh = atlas!.naturalHeight / 3;
    ctx.drawImage(atlas!, c * cw, r * chh, cw, chh, 0, 0, w, h);
    const b = BRIGHTNESS[v] ?? 1;
    if (b !== 1) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = b < 1 ? `rgba(0,0,0,${1 - b})` : `rgba(255,255,255,${(b - 1) * 1.4})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    softEdge(ctx, w, h);
  }
  stamps.set(key, cv);
  return cv;
}

/** Pinta as manchas (já em ordem de desenho) no canvas do bloco. */
export function paintGround(canvas: HTMLCanvasElement, blobs: GroundBlob[], sizePx: number, scale: number) {
  const full = Math.ceil((sizePx + PAD * 2) * scale);
  if (canvas.width !== full) { canvas.width = full; canvas.height = full; }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, full, full);
  for (const b of blobs) {
    const st = stamp(b.ter, b.v, b.hi, scale);
    ctx.setTransform(1, 0, 0, 1, (b.x + PAD) * scale, (b.y + PAD) * scale);
    if (b.rot) ctx.rotate((b.rot * Math.PI) / 180);
    ctx.drawImage(st, -st.width / 2, -st.height / 2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Libera a memória do canvas (será repintado se voltar à tela). */
export function releaseGround(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}
