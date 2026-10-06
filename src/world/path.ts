import type { World } from './world';

// Navegação: A* com cache para ordens individuais e campos de fluxo
// compartilhados para exércitos grandes.

const SQ2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DC = [1, 1, 1, 1, SQ2, SQ2, SQ2, SQ2];

export interface Pt { x: number; y: number }

export class Heap {
  idx: Int32Array;
  val: Float32Array;
  size = 0;
  constructor(cap: number) {
    this.idx = new Int32Array(cap);
    this.val = new Float32Array(cap);
  }
  clear() { this.size = 0; }
  push(i: number, v: number) {
    if (this.size >= this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2); ni.set(this.idx); this.idx = ni;
      const nv = new Float32Array(this.val.length * 2); nv.set(this.val); this.val = nv;
    }
    let p = this.size++;
    const I = this.idx, V = this.val;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (V[q] <= v) break;
      I[p] = I[q]; V[p] = V[q]; p = q;
    }
    I[p] = i; V[p] = v;
  }
  pop(): number {
    const I = this.idx, V = this.val;
    const top = I[0];
    const n = --this.size;
    if (n > 0) {
      const li = I[n], lv = V[n];
      let p = 0;
      for (;;) {
        let c = p * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && V[c + 1] < V[c]) c++;
        if (V[c] >= lv) break;
        I[p] = I[c]; V[p] = V[c]; p = c;
      }
      I[p] = li; V[p] = lv;
    }
    return top;
  }
  topVal() { return this.val[0]; }
}

export class FlowField {
  dist: Float32Array;
  constructor(public gx: number, public gy: number, public version: number, n: number, public last = 0) {
    this.dist = new Float32Array(n);
  }
}

export class Pathfinder {
  world: World;
  private g: Float32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private parent: Int32Array;
  private heap: Heap;
  private gen = 1;
  private cache = new Map<string, { v: number; pts: Pt[] }>();
  private fields = new Map<number, FlowField>();
  fieldBudget = 2;
  stats = { astar: 0, astarNodes: 0, cacheHits: 0, fields: 0, fieldHits: 0 };

  constructor(world: World) {
    this.world = world;
    const n = world.w * world.h;
    this.g = new Float32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.parent = new Int32Array(n);
    this.heap = new Heap(4096);
  }

  private canStep(x: number, y: number, d: number): boolean {
    const w = this.world;
    const nx = x + DX[d], ny = y + DY[d];
    if (!w.free(nx, ny)) return false;
    if (d >= 4 && (!w.free(x + DX[d], y) || !w.free(x, y + DY[d]))) return false;
    return true;
  }

  /**
   * A* até um retângulo-objetivo (inclusive). Retorna pontos suavizados (centros de tiles),
   * ou caminho até o ponto mais próximo alcançável se o objetivo for inacessível.
   */
  find(sx: number, sy: number, gx0: number, gy0: number, gx1: number, gy1: number, maxNodes = 7000): Pt[] {
    const w = this.world;
    const W = w.w;
    let stx = Math.floor(sx), sty = Math.floor(sy);
    if (!w.free(stx, sty)) {
      const nf = w.nearestFree(sx, sy, 3);
      if (nf) { stx = nf[0]; sty = nf[1]; }
    }
    const key = `${stx + sty * W}:${gx0},${gy0},${gx1},${gy1}`;
    const c = this.cache.get(key);
    if (c && c.v === w.version) {
      this.stats.cacheHits++;
      this.cache.delete(key);
      this.cache.set(key, c);
      return c.pts.slice();
    }
    this.stats.astar++;
    const gen = ++this.gen;
    const G = this.g, S = this.stamp, CL = this.closed, P = this.parent;
    const heap = this.heap;
    heap.clear();
    const h = (x: number, y: number) => {
      const dx = Math.max(gx0 - x, 0, x - gx1), dy = Math.max(gy0 - y, 0, y - gy1);
      return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy);
    };
    const s = stx + sty * W;
    G[s] = 0; S[s] = gen; P[s] = -1;
    heap.push(s, h(stx, sty));
    let best = s, bestH = h(stx, sty), found = -1, nodes = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (CL[cur] === gen) continue;
      CL[cur] = gen;
      const cx = cur % W, cy = (cur - cx) / W;
      if (cx >= gx0 && cx <= gx1 && cy >= gy0 && cy <= gy1) { found = cur; break; }
      const hc = h(cx, cy);
      if (hc < bestH) { bestH = hc; best = cur; }
      if (++nodes > maxNodes) break;
      const gc = G[cur];
      for (let d = 0; d < 8; d++) {
        if (!this.canStep(cx, cy, d)) {
          // permitir entrar no objetivo mesmo se bloqueado? não: objetivos bloqueados usam anel
          continue;
        }
        const nx = cx + DX[d], ny = cy + DY[d];
        const ni = nx + ny * W;
        if (CL[ni] === gen) continue;
        const ng = gc + DC[d];
        if (S[ni] !== gen || ng < G[ni]) {
          S[ni] = gen; G[ni] = ng; P[ni] = cur;
          heap.push(ni, ng + h(nx, ny) * 1.001);
        }
      }
    }
    this.stats.astarNodes += nodes;
    const end = found >= 0 ? found : best;
    const raw: number[] = [];
    for (let i = end; i !== -1 && raw.length < 4000; i = P[i]) raw.push(i);
    raw.reverse();
    const pts = this.smooth(raw, sx, sy);
    this.cache.set(key, { v: w.version, pts });
    if (this.cache.size > 900) this.cache.delete(this.cache.keys().next().value!);
    return pts.slice();
  }

  private smooth(raw: number[], sx: number, sy: number): Pt[] {
    const W = this.world.w;
    const pts: Pt[] = raw.map((i) => ({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 }));
    if (pts.length <= 1) return pts.slice(1);
    const out: Pt[] = [];
    let ax = pts[0].x, ay = pts[0].y;
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 24);
      for (; j > i + 1; j--) if (this.world.lineFree(ax, ay, pts[j].x, pts[j].y, 0.32)) break;
      out.push(pts[j]);
      ax = pts[j].x; ay = pts[j].y;
      i = j;
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Campos de fluxo (Dijkstra a partir do objetivo) — compartilhados
  // ------------------------------------------------------------------
  resetBudget() { this.fieldBudget = 2; }

  getField(gx: number, gy: number, now: number): FlowField | null {
    const w = this.world;
    gx = Math.max(0, Math.min(w.w - 1, Math.floor(gx)));
    gy = Math.max(0, Math.min(w.h - 1, Math.floor(gy)));
    const key = gx + gy * w.w;
    const f = this.fields.get(key);
    if (f && f.version === w.version) {
      f.last = now;
      this.stats.fieldHits++;
      return f;
    }
    if (this.fieldBudget <= 0) return f ?? null; // usa versão antiga até haver orçamento
    this.fieldBudget--;
    const nf = this.computeField(gx, gy);
    nf.last = now;
    this.fields.set(key, nf);
    if (this.fields.size > 48) {
      let oldK = -1, oldT = Infinity;
      for (const [k, v] of this.fields) if (v.last < oldT) { oldT = v.last; oldK = k; }
      this.fields.delete(oldK);
    }
    return nf;
  }

  private computeField(gx: number, gy: number): FlowField {
    this.stats.fields++;
    const w = this.world, W = w.w;
    const ff = new FlowField(gx, gy, w.version, w.w * w.h);
    const D = ff.dist;
    D.fill(Infinity);
    const heap = this.heap;
    heap.clear();
    // objetivo bloqueado: semeia com células livres vizinhas
    if (w.free(gx, gy)) {
      D[gx + gy * W] = 0;
      heap.push(gx + gy * W, 0);
    } else {
      for (let r = 1; r < 8 && heap.size === 0; r++)
        for (let y = gy - r; y <= gy + r; y++)
          for (let x = gx - r; x <= gx + r; x++)
            if (w.free(x, y)) {
              const i = x + y * W;
              const d = Math.hypot(x - gx, y - gy);
              D[i] = d;
              heap.push(i, d);
            }
    }
    while (heap.size > 0) {
      const v = heap.topVal();
      const cur = heap.pop();
      if (v > D[cur]) continue;
      const cx = cur % W, cy = (cur - cx) / W;
      for (let d = 0; d < 8; d++) {
        if (!this.canStep(cx, cy, d)) continue;
        const ni = cx + DX[d] + (cy + DY[d]) * W;
        const nd = v + DC[d];
        if (nd < D[ni]) {
          D[ni] = nd;
          heap.push(ni, nd);
        }
      }
    }
    return ff;
  }

  /**
   * Direção de fluxo a partir de (x,y): olha alguns passos à frente e
   * escolhe o ponto mais distante com linha livre (movimento suave).
   */
  flowTarget(f: FlowField, x: number, y: number): Pt | null {
    const w = this.world, W = w.w, D = f.dist;
    let cx = Math.floor(x), cy = Math.floor(y);
    if (!w.inside(cx, cy)) return null;
    if (!isFinite(D[cx + cy * W])) {
      const nf = w.nearestFree(x, y, 2);
      if (!nf || !isFinite(D[nf[0] + nf[1] * W])) return null;
      return { x: nf[0] + 0.5, y: nf[1] + 0.5 };
    }
    let best: Pt | null = null;
    for (let step = 0; step < 4; step++) {
      let bd = D[cx + cy * W], bx = -1, by = -1;
      if (bd === 0) break;
      for (let d = 0; d < 8; d++) {
        if (!this.canStep(cx, cy, d)) continue;
        const nx = cx + DX[d], ny = cy + DY[d];
        const v = D[nx + ny * W];
        if (v < bd) { bd = v; bx = nx; by = ny; }
      }
      if (bx < 0) break;
      const p = { x: bx + 0.5, y: by + 0.5 };
      if (step > 0 && !w.lineFree(x, y, p.x, p.y, 0.3)) break;
      best = p;
      cx = bx; cy = by;
    }
    return best;
  }

  fieldDist(f: FlowField, x: number, y: number): number {
    const w = this.world;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!w.inside(cx, cy)) return Infinity;
    return f.dist[cx + cy * w.w];
  }

  get fieldCount() { return this.fields.size; }
  get cacheSize() { return this.cache.size; }
  clear() { this.cache.clear(); this.fields.clear(); }
}
