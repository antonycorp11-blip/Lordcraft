import type { World } from '../world/world';

// Névoa de guerra por jogador: 0 desconhecido, 1 explorado, 2 visível.
// Terreno elevado bloqueia visão de quem está embaixo (exceto voadores).

const circleCache = new Map<number, Int16Array>();
function circle(r: number): Int16Array {
  const key = Math.round(r * 2);
  let c = circleCache.get(key);
  if (c) return c;
  const rr = key / 2;
  const pts: number[] = [];
  const R = Math.ceil(rr);
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= rr * rr + 0.5) pts.push(x, y);
  c = new Int16Array(pts);
  circleCache.set(key, c);
  return c;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface Viewer { x: number; y: number; sight: number; air: boolean }

export class Fog {
  w: number;
  h: number;
  vis: Uint8Array;   // visível agora
  seen: Uint8Array;  // já explorado
  version = 0;       // só muda quando algum tile muda de fato (o desenho depende disso)
  revealAll = false;
  private prevVis: Uint8Array;
  private allShown = false;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.vis = new Uint8Array(w * h);
    this.seen = new Uint8Array(w * h);
    this.prevVis = new Uint8Array(w * h);
  }

  compute(world: World, viewers: Viewer[], extra: { x: number; y: number; r: number }[] = []) {
    const W = this.w, H = this.h;
    const vis = this.vis, seen = this.seen, elev = world.elev;
    if (this.revealAll) {
      if (!this.allShown) { vis.fill(1); seen.fill(1); this.allShown = true; this.version++; }
      return;
    }
    this.allShown = false;
    this.prevVis.set(vis);
    vis.fill(0);
    let fresh = 0;
    const stamped = new Set<number>();
    for (const v of viewers) {
      const cx = Math.floor(v.x), cy = Math.floor(v.y);
      const key = (cx + cy * W) * 64 + Math.round(v.sight * 2) + (v.air ? 32 : 0);
      if (stamped.has(key)) continue;
      stamped.add(key);
      const c = circle(v.sight);
      const he = cx >= 0 && cy >= 0 && cx < W && cy < H ? elev[cx + cy * W] : 0;
      for (let k = 0; k < c.length; k += 2) {
        const x = cx + c[k], y = cy + c[k + 1];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = x + y * W;
        if (!v.air && elev[i] > he) {
          // vê apenas a borda imediata do planalto
          if (Math.abs(c[k]) > 1 || Math.abs(c[k + 1]) > 1) continue;
        }
        vis[i] = 1;
        if (!seen[i]) { seen[i] = 1; fresh++; }
      }
    }
    for (const r of extra) {
      const c = circle(r.r);
      const cx = Math.floor(r.x), cy = Math.floor(r.y);
      for (let k = 0; k < c.length; k += 2) {
        const x = cx + c[k], y = cy + c[k + 1];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        vis[x + y * W] = 1;
        if (!seen[x + y * W]) { seen[x + y * W] = 1; fresh++; }
      }
    }
    if (fresh > 0 || !sameBytes(vis, this.prevVis)) this.version++;
  }

  visible(x: number, y: number): boolean {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return false;
    return this.vis[ix + iy * this.w] === 1;
  }
  explored(x: number, y: number): boolean {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return false;
    return this.seen[ix + iy * this.w] === 1;
  }
  /** Algum tile do retângulo visível (para edifícios). */
  rectVisible(x0: number, y0: number, s: number): boolean {
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if (this.visible(x, y)) return true;
    return false;
  }
  rectExplored(x0: number, y0: number, s: number): boolean {
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) if (this.explored(x, y)) return true;
    return false;
  }
}
