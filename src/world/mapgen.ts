import { Rng, fbm, hash2 } from '../core/rng';
import { Heap } from './path';
import { World, Ter, BL_TERRAIN } from './world';

export interface MapTemplate {
  id: string;
  name: string;
  desc: string;
  size: number;
  /** Mapa fixo: a mesma semente gera sempre o mesmo terreno. */
  seed: number;
  starts: [number, number][];
  expansions: [number, number][];
  crystals: [number, number][];
  boss?: [number, number];
  river?: 'vertical' | 'diagonal';
  lakeBias?: number;
  mountainBias?: number;
}

export const MAPS: MapTemplate[] = [
  {
    id: 'vale', name: 'Vale de Aldaris', size: 160, seed: 417321,
    desc: 'Quatro reinos ao redor de um lago central onde repousa o Grande Cristal. Muitas expansões, florestas densas e planaltos.',
    starts: [[0.14, 0.14], [0.86, 0.86], [0.86, 0.14], [0.14, 0.86]],
    expansions: [[0.5, 0.12], [0.12, 0.5], [0.88, 0.5], [0.5, 0.88], [0.31, 0.3], [0.69, 0.7], [0.69, 0.3], [0.31, 0.7]],
    crystals: [[0.5, 0.42], [0.42, 0.56], [0.58, 0.56], [0.22, 0.22], [0.78, 0.78], [0.78, 0.22], [0.22, 0.78]],
    boss: [0.5, 0.5], lakeBias: 0.02,
  },
  {
    id: 'estreito', name: 'Estreito das Brumas', size: 144, seed: 280913,
    desc: 'Um rio largo divide o continente. Pontes e vaus são passagens estratégicas disputadas.',
    starts: [[0.13, 0.18], [0.87, 0.82], [0.87, 0.18], [0.13, 0.82]],
    expansions: [[0.3, 0.5], [0.7, 0.5], [0.24, 0.32], [0.76, 0.68], [0.76, 0.32], [0.24, 0.68], [0.5, 0.12], [0.5, 0.88]],
    crystals: [[0.5, 0.36], [0.5, 0.64], [0.32, 0.18], [0.68, 0.82]],
    river: 'vertical', boss: [0.5, 0.5], lakeBias: -0.03,
  },
  {
    id: 'coroa', name: 'Coroa Gelada', size: 112, seed: 731554,
    desc: 'Mapa compacto para duelos: planaltos, passagens estreitas e partidas rápidas.',
    starts: [[0.18, 0.82], [0.82, 0.18]],
    expansions: [[0.2, 0.42], [0.8, 0.58], [0.5, 0.78], [0.5, 0.22]],
    crystals: [[0.42, 0.5], [0.58, 0.5]],
    mountainBias: 0.04,
  },
];

export interface CampDef { x: number; y: number; level: number; units: string[] }
export interface Decor { x: number; y: number; kind: 'pillar' | 'arch' | 'statue' | 'stones' | 'bones' | 'crystalshard' }
export interface MapGenResult {
  world: World;
  starts: { x: number; y: number }[];
  mines: { x: number; y: number; amount: number }[];
  crystals: { x: number; y: number; amount: number }[];
  camps: CampDef[];
  neutrals: { type: string; x: number; y: number }[];
  chests: { x: number; y: number; level: number }[];
  decor: Decor[];
}

const BIOME_BASE = [Ter.Grass, Ter.Ash, Ter.Moss, Ter.Snow];
const BIOME_ALT = [Ter.Dirt, Ter.Dirt, Ter.Grass, Ter.Dirt];

export function generateMap(tpl: MapTemplate, seed: number, startBiomes: number[]): MapGenResult {
  const rng = new Rng(seed);
  const N = tpl.size;
  const w = new World(N, N);
  const idx = (x: number, y: number) => y * N + x;
  const starts = tpl.starts.map(([x, y]) => ({ x: Math.round(x * N), y: Math.round(y * N) }));
  const exps = tpl.expansions.map(([x, y]) => ({ x: Math.round(x * N), y: Math.round(y * N) }));
  const crys = tpl.crystals.map(([x, y]) => ({ x: Math.round(x * N), y: Math.round(y * N) }));
  const cx = N / 2, cy = N / 2;

  // -------- 1. Elevação, umidade, biomas --------
  const E = new Float32Array(N * N);
  const M = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      let e = fbm(x / 26, y / 26, seed, 4);
      const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
      if (edge < 6) e += (6 - edge) * 0.07; // bordas montanhosas
      e += (tpl.mountainBias ?? 0);
      E[i] = e;
      M[i] = fbm(x / 17 + 40, y / 17 + 40, seed + 7, 4);
      // bioma: start mais próximo com jitter de ruído
      let bd = Infinity, bb = 0;
      const jx = (fbm(x / 14, y / 14, seed + 33) - 0.5) * 22;
      const jy = (fbm(x / 14 + 9, y / 14, seed + 34) - 0.5) * 22;
      for (let s = 0; s < starts.length; s++) {
        const d = Math.hypot(x + jx - starts[s].x, y + jy - starts[s].y);
        if (d < bd) { bd = d; bb = startBiomes[s] ?? s % 4; }
      }
      w.biome[i] = bb;
      const dc = Math.hypot(x + jx - cx, y + jy - cy);
      const centerWild = dc < N * 0.14;
      const base = centerWild ? Ter.Grass : BIOME_BASE[bb];
      const alt = centerWild ? Ter.Dirt : BIOME_ALT[bb];
      w.ter[i] = M[i] < 0.38 ? alt : base;
    }

  // -------- 2. Água, montanhas, planaltos --------
  const lake = 0.27 + (tpl.lakeBias ?? 0);
  for (let i = 0; i < N * N; i++) {
    const e = E[i];
    if (e < lake) w.ter[i] = Ter.Water;
    else if (e < lake + 0.035) w.ter[i] = Ter.Shallow;
    else if (e < lake + 0.06) w.ter[i] = Ter.Sand;
    else if (e > 0.74) w.ter[i] = Ter.Rock;
    else if (e > 0.6) w.elev[i] = 1;
  }

  // Rio
  if (tpl.river) {
    for (let y = 0; y < N; y++) {
      const t = y / N;
      const mid = N / 2 + Math.sin(t * Math.PI * 2.2 + seed % 7) * N * 0.05 + (fbm(0, y / 12, seed + 77) - 0.5) * 8;
      const width = 3.2 + fbm(3, y / 9, seed + 78) * 2.5;
      for (let x = Math.floor(mid - width - 2); x <= mid + width + 2; x++) {
        if (x < 0 || x >= N) continue;
        const i = idx(x, y);
        const d = Math.abs(x - mid);
        if (d < width) w.ter[i] = Ter.Water;
        else if (d < width + 1) w.ter[i] = Ter.Shallow;
        else if (w.ter[i] !== Ter.Water) w.ter[i] = Ter.Sand;
        w.elev[i] = 0;
      }
    }
    // vaus
    for (const fy of [0.2, 0.5, 0.8]) {
      const yy = Math.round(fy * N);
      for (let y = yy - 2; y <= yy + 2; y++)
        for (let x = 0; x < N; x++) if (w.ter[idx(x, y)] === Ter.Water && Math.abs(x - N / 2) < N * 0.15) w.ter[idx(x, y)] = Ter.Shallow;
    }
  }

  // -------- 3. Áreas limpas (bases, expansões) --------
  const clearArea = (px: number, py: number, r: number, flatten = true) => {
    for (let y = Math.floor(py - r); y <= py + r; y++)
      for (let x = Math.floor(px - r); x <= px + r; x++) {
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
        const d = Math.hypot(x - px, y - py);
        if (d > r) continue;
        const i = idx(x, y);
        const b = w.biome[i];
        if (w.ter[i] === Ter.Water || w.ter[i] === Ter.Rock || w.ter[i] === Ter.Shallow || w.ter[i] === Ter.Sand)
          w.ter[i] = M[i] < 0.38 ? BIOME_ALT[b] : BIOME_BASE[b];
        if (flatten) w.elev[i] = 0;
      }
  };
  starts.forEach((s) => clearArea(s.x, s.y, 17)); // área inicial ampla para construir
  exps.forEach((e) => clearArea(e.x, e.y, 9));
  crys.forEach((c) => clearArea(c.x, c.y, 4, false));
  if (tpl.boss) clearArea(tpl.boss[0] * N, tpl.boss[1] * N, 6);

  // -------- 4. Penhascos --------
  const computeCliffs = () => {
    w.cliff.fill(0);
    for (let y = 1; y < N - 1; y++)
      for (let x = 1; x < N - 1; x++) {
        const i = idx(x, y);
        if (w.elev[i] !== 1) continue;
        if (w.elev[i - 1] === 0 || w.elev[i + 1] === 0 || w.elev[i - N] === 0 || w.elev[i + N] === 0) w.cliff[i] = 1;
      }
  };
  computeCliffs();
  // rampas aleatórias
  for (let y = 2; y < N - 2; y++)
    for (let x = 2; x < N - 2; x++) {
      const i = idx(x, y);
      if (w.cliff[i] && hash2(x, y, seed + 5) < 0.018) {
        for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) w.cliff[idx(xx, yy)] = 0;
      }
    }

  // -------- 5. Recursos (posições) --------
  const mines: MapGenResult['mines'] = [];
  const crystals: MapGenResult['crystals'] = [];
  const mineFor = (px: number, py: number, amount: number, awayX: number, awayY: number) => {
    // mina a ~9 tiles do centro (sede 5x5 + espaço para os trabalhadores), na direção "away"
    const len = Math.hypot(awayX, awayY) || 1;
    const mx = Math.round(px + (awayX / len) * 9 - 1.5);
    const my = Math.round(py + (awayY / len) * 9 - 1.5);
    mines.push({ x: mx, y: my, amount });
  };
  starts.forEach((s) => mineFor(s.x, s.y, 13500, s.x < cx ? -1 : 1, s.y < cy ? -0.6 : 0.6));
  exps.forEach((e, k) => mineFor(e.x, e.y, 9000 + (k % 3) * 2500, e.x - cx || 1, e.y - cy || 1));
  crys.forEach((c, k) => crystals.push({ x: c.x - 1, y: c.y - 1, amount: k < 3 ? 3000 : 2000 }));

  // -------- 6. Estradas --------
  const roadCost = (i: number) => {
    const t = w.ter[i];
    if (t === Ter.Water) return 14;
    if (t === Ter.Rock) return 22;
    if (w.cliff[i]) return 12;
    return 1 + (w.elev[i] ? 0.5 : 0);
  };
  const carve = (ax: number, ay: number, bx: number, by: number, width = 1) => {
    const path = costPath(N, roadCost, idx(ax, ay), idx(bx, by));
    for (const p of path) {
      const px = p % N, py = (p - px) / N;
      for (let oy = 0; oy <= width; oy++)
        for (let ox = 0; ox <= width; ox++) {
          const x = px + ox, y = py + oy;
          if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
          const i = idx(x, y);
          if (w.ter[i] === Ter.Water || w.ter[i] === Ter.Shallow) w.ter[i] = Ter.Bridge;
          else w.ter[i] = Ter.Road;
          w.cliff[i] = 0;
        }
    }
  };
  const center = tpl.boss ? { x: Math.round(tpl.boss[0] * N), y: Math.round(tpl.boss[1] * N) } : { x: cx, y: cy };
  starts.forEach((s) => carve(s.x, s.y, center.x, center.y + 7));
  for (let a = 0; a < starts.length; a++) {
    // estrada para as 2 expansões mais próximas
    const sorted = exps.map((e, k) => ({ k, d: Math.hypot(e.x - starts[a].x, e.y - starts[a].y) })).sort((p, q) => p.d - q.d);
    sorted.slice(0, 2).forEach(({ k }) => carve(starts[a].x, starts[a].y, exps[k].x, exps[k].y, 0));
  }

  // -------- 7. Florestas --------
  const reserved = new Uint8Array(N * N);
  const reserve = (px: number, py: number, r: number) => {
    for (let y = Math.floor(py - r); y <= py + r; y++)
      for (let x = Math.floor(px - r); x <= px + r; x++)
        if (x >= 0 && y >= 0 && x < N && y < N && Math.hypot(x - px, y - py) <= r) reserved[idx(x, y)] = 1;
  };
  starts.forEach((s) => reserve(s.x, s.y, 13));
  exps.forEach((e) => reserve(e.x, e.y, 6.5));
  mines.forEach((m) => reserve(m.x + 1.5, m.y + 1.5, 3.5));
  crystals.forEach((c) => reserve(c.x + 1, c.y + 1, 3.5));
  if (tpl.boss) reserve(tpl.boss[0] * N, tpl.boss[1] * N, 6);

  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      const i = idx(x, y);
      const t = w.ter[i];
      if (reserved[i] || w.cliff[i] || t === Ter.Water || t === Ter.Shallow || t === Ter.Rock || t === Ter.Road || t === Ter.Bridge || t === Ter.Sand) continue;
      const b = w.biome[i];
      const thr = b === 2 ? 0.5 : b === 1 ? 0.62 : 0.56;
      const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
      let m = M[i] + (edge < 8 ? (8 - edge) * 0.05 : 0);
      // cinturão de floresta ao redor das bases (proteção natural)
      for (const s of starts) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d > 13 && d < 18) m += 0.1;
      }
      if (m > thr && hash2(x, y, seed + 11) < 0.93) {
        const kind = b === 3 ? 1 : b === 1 ? 2 : b === 2 ? 3 : (hash2(x, y, seed + 12) < 0.3 ? 1 : 0);
        w.setTree(i, 50, kind);
      }
    }

  // -------- 8. Bloqueios do terreno --------
  for (let i = 0; i < N * N; i++) {
    const t = w.ter[i];
    if (t === Ter.Water || t === Ter.Rock || w.cliff[i]) {
      w.block[i] |= BL_TERRAIN;
      if (w.tree[i]) { w.tree[i] = 0; w.block[i] &= ~2; }
    }
  }
  // borda do mapa
  for (let k = 0; k < N; k++) {
    for (const i of [idx(k, 0), idx(k, N - 1), idx(0, k), idx(N - 1, k)]) {
      w.block[i] |= BL_TERRAIN;
      if (w.ter[i] !== Ter.Water) w.ter[i] = Ter.Rock;
    }
  }
  // garante que posições de minas/cristais estejam livres de bloqueio do terreno
  const unblockRect = (x0: number, y0: number, s: number, pad: number) => {
    for (let y = y0 - pad; y < y0 + s + pad; y++)
      for (let x = x0 - pad; x < x0 + s + pad; x++) {
        if (x < 1 || y < 1 || x >= N - 1 || y >= N - 1) continue;
        const i = idx(x, y);
        w.block[i] = 0; w.cliff[i] = 0; w.tree[i] = 0;
        if (w.ter[i] === Ter.Water || w.ter[i] === Ter.Rock) w.ter[i] = Ter.Dirt;
      }
  };
  mines.forEach((m) => unblockRect(m.x, m.y, 3, 1));
  crystals.forEach((c) => unblockRect(c.x, c.y, 2, 1));
  starts.forEach((s) => unblockRect(s.x - 2, s.y - 2, 4, 3));

  // -------- 9. Conectividade --------
  const reach = flood(w, starts[0].x, starts[0].y);
  const targets = [...starts, ...exps, ...mines.map((m) => ({ x: m.x + 1, y: m.y + 4 })), ...crystals.map((c) => ({ x: c.x, y: c.y + 3 }))];
  for (const t of targets) {
    const tx = Math.max(1, Math.min(N - 2, t.x)), ty = Math.max(1, Math.min(N - 2, t.y));
    if (!reach[idx(tx, ty)]) {
      carve(starts[0].x, starts[0].y, tx, ty, 1);
      for (let y = 1; y < N - 1; y++)
        for (let x = 1; x < N - 1; x++) {
          const i = idx(x, y);
          const t2 = w.ter[i];
          if (t2 === Ter.Road || t2 === Ter.Bridge) { w.block[i] &= ~(BL_TERRAIN | 2); w.tree[i] = 0; }
        }
      const r2 = flood(w, starts[0].x, starts[0].y);
      reach.set(r2);
    }
  }
  // estradas nunca bloqueadas
  for (let i = 0; i < N * N; i++) {
    if (w.ter[i] === Ter.Road || w.ter[i] === Ter.Bridge) { w.block[i] &= ~(BL_TERRAIN | 2); w.tree[i] = 0; w.cliff[i] = 0; }
  }

  // -------- 10. Acampamentos neutros, ruínas, baús --------
  const camps: CampDef[] = [];
  const neutrals: MapGenResult['neutrals'] = [];
  const chests: MapGenResult['chests'] = [];
  const decor: Decor[] = [];
  const L1 = [['c_lobo', 'c_lobo'], ['c_saqueador', 'c_batedor'], ['c_aranha', 'c_lobo']];
  const L2 = [['c_lobo_alfa', 'c_lobo', 'c_lobo'], ['c_saqueador', 'c_saqueador', 'c_batedor', 'c_batedor'], ['c_ogro', 'c_aranha'], ['c_aranha', 'c_aranha', 'c_aranha']];
  const L3 = [['c_ogro', 'c_ogro', 'c_batedor', 'c_saqueador'], ['c_golem', 'c_aranha', 'c_aranha'], ['c_golem', 'c_ogro']];
  const freeNear = (x: number, y: number) => w.nearestFree(x, y, 6) ?? [x, y];

  exps.forEach((e, k) => {
    // guarda posicionada entre a mina e o centro da expansão
    const m = mines[starts.length + k];
    const gx = (m.x + 1.5 + e.x) / 2, gy = (m.y + 1.5 + e.y) / 2;
    const [fx, fy] = freeNear(gx, gy);
    camps.push({ x: fx + 0.5, y: fy + 0.5, level: k < 4 ? 2 : 2, units: rng.pick(L2) });
  });
  crystals.forEach((c, k) => {
    if (tpl.boss && k < 3) return;
    const [fx, fy] = freeNear(c.x + 1, c.y + 4);
    camps.push({ x: fx + 0.5, y: fy + 0.5, level: 3, units: rng.pick(L3) });
  });
  if (tpl.boss) {
    const [fx, fy] = freeNear(tpl.boss[0] * N, tpl.boss[1] * N + 2);
    camps.push({ x: fx + 0.5, y: fy + 0.5, level: 4, units: ['c_dragao', 'c_golem', 'c_golem'] });
  }
  // acampamentos fáceis entre as bases e o centro
  starts.forEach((s) => {
    const px = s.x + (center.x - s.x) * 0.33, py = s.y + (center.y - s.y) * 0.33;
    const [fx, fy] = freeNear(px + rng.range(-4, 4), py + rng.range(-4, 4));
    camps.push({ x: fx + 0.5, y: fy + 0.5, level: 1, units: rng.pick(L1) });
  });

  // edifícios neutros
  const placeNeutral = (type: string, px: number, py: number, size: number) => {
    for (let r = 0; r < 14; r++) {
      for (let a = 0; a < 12; a++) {
        const x = Math.round(px + Math.cos(a) * r), y = Math.round(py + Math.sin(a) * r);
        let ok = true;
        for (let yy = y - 1; yy < y + size + 1 && ok; yy++)
          for (let xx = x - 1; xx < x + size + 1 && ok; xx++) if (!w.free(xx, yy)) ok = false;
        if (ok) { neutrals.push({ type, x, y }); return; }
      }
    }
  };
  placeNeutral('n_mercado', center.x - 14, center.y - 12, 3);
  placeNeutral('n_mercenarios', center.x + 13, center.y + 12, 3);
  placeNeutral('n_fonte', center.x + 12, center.y - 13, 2);
  if (starts.length > 2) placeNeutral('n_fonte', center.x - 12, center.y + 13, 2);

  // ruínas com baús entre bases adjacentes
  const ruinSpots = exps.slice(0, 4).map((e) => ({ x: (e.x + center.x) / 2, y: (e.y + center.y) / 2 }));
  ruinSpots.forEach((r) => {
    const [fx, fy] = freeNear(r.x, r.y);
    chests.push({ x: fx + 0.5, y: fy + 0.5, level: 2 });
    const kinds: Decor['kind'][] = ['pillar', 'arch', 'statue', 'stones', 'pillar'];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rng.next();
      const dx = Math.round(fx + Math.cos(a) * 3), dy = Math.round(fy + Math.sin(a) * 3);
      if (w.free(dx, dy) && Math.hypot(dx - fx, dy - fy) > 2) {
        decor.push({ x: dx, y: dy, kind: kinds[k % kinds.length] });
        w.block[idx(dx, dy)] |= BL_TERRAIN;
      }
    }
  });
  // ossadas e fragmentos decorativos (não bloqueiam)
  for (let k = 0; k < N * 0.8; k++) {
    const x = rng.int(4, N - 5), y = rng.int(4, N - 5);
    if (w.free(x, y) && !reserved[idx(x, y)]) decor.push({ x, y, kind: w.biome[idx(x, y)] === 1 ? 'bones' : 'stones' });
  }

  w.version++;
  return { world: w, starts, mines, crystals, camps, neutrals, chests, decor };
}

function flood(w: World, sx: number, sy: number): Uint8Array {
  const N = w.w;
  const seen = new Uint8Array(w.w * w.h);
  const st = [sy * N + sx];
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!;
    const x = c % N, y = (c - x) / N;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= w.h) continue;
      const ni = ny * N + nx;
      if (seen[ni] || !w.freeI(ni)) continue;
      seen[ni] = 1;
      st.push(ni);
    }
  }
  return seen;
}

function costPath(N: number, cost: (i: number) => number, s: number, g: number): number[] {
  const D = new Float32Array(N * N).fill(Infinity);
  const P = new Int32Array(N * N).fill(-1);
  const h = new Heap(4096);
  D[s] = 0;
  h.push(s, 0);
  const gx = g % N, gy = Math.floor(g / N);
  while (h.size) {
    const v = h.topVal();
    const c = h.pop();
    if (c === g) break;
    if (v > D[c] + Math.abs((c % N) - gx) + Math.abs(Math.floor(c / N) - gy) + 0.001) continue;
    const x = c % N, y = (c - x) / N;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
      const ni = ny * N + nx;
      // ruído leve deixa a estrada sinuosa
      const nd = D[c] + cost(ni) + hash2(nx, ny, 99) * 0.6;
      if (nd < D[ni]) {
        D[ni] = nd;
        P[ni] = c;
        h.push(ni, nd + Math.abs(nx - gx) + Math.abs(ny - gy));
      }
    }
  }
  const out: number[] = [];
  for (let i = g; i !== -1; i = P[i]) out.push(i);
  return out.reverse();
}
