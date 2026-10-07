import { Rng } from '../core/rng';
import { DAY_SECS, DAYS_PER_SEASON, SEASON_NAMES, SEASON_SECS, START_YEAR } from './data';
import type { ChronicleEntry, House, Person, Realm } from './types';

// Utilidades compartilhadas pela camada do feudo.

export function rng(r: Realm): Rng {
  const x = new Rng(1);
  x.s = r.rngS;
  return x;
}
/** Sorteio que avança o estado salvo do reino. */
export function roll(r: Realm): number {
  const x = rng(r);
  const v = x.next();
  r.rngS = x.s;
  return v;
}
export function chance(r: Realm, p: number): boolean { return roll(r) < p; }
export function pick<T>(r: Realm, arr: T[]): T { return arr[Math.floor(roll(r) * arr.length) % arr.length]; }
export function nid(r: Realm): number { return r.nextId++; }

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function year(r: Realm): number { return START_YEAR + r.time / (SEASON_SECS * 4); }
export function seasonOf(r: Realm): number { return Math.floor(r.time / SEASON_SECS) % 4; }
export function dayOf(r: Realm): number { return Math.floor((r.time % SEASON_SECS) / DAY_SECS) + 1; }
export function dateText(r: Realm, t = r.time): string {
  const y = Math.floor(START_YEAR + t / (SEASON_SECS * 4));
  const s = Math.floor(t / SEASON_SECS) % 4;
  const d = Math.floor((t % SEASON_SECS) / DAY_SECS) + 1;
  return `${d} de ${SEASON_NAMES[s]}, ano ${y}`;
}
export function daysToSecs(days: number): number { return days * DAY_SECS; }
export function secsToDays(s: number): number { return Math.max(0, Math.ceil(s / DAY_SECS)); }
export { DAYS_PER_SEASON };

export function player(r: Realm): House { return r.houses[r.player]; }
export function age(r: Realm, p: Person): number { return Math.floor((p.diedAt ?? year(r)) - p.born); }
export function lordOf(r: Realm, h: House): Person { return r.persons[h.lord]; }
export function houseName(r: Realm, id: string): string { return r.houses[id] ? `Casa ${r.houses[id].name}` : id; }

export function log(r: Realm, text: string, kind: ChronicleEntry['kind'] = 'info') {
  r.chronicle.push({ t: r.time, year: Math.floor(year(r)), season: seasonOf(r), text, kind });
  if (r.chronicle.length > 160) r.chronicle.splice(0, r.chronicle.length - 160);
}

/** Muda a opinião de uma casa sobre o jogador e guarda a lembrança do motivo. */
export function remember(r: Realm, house: string, text: string, trust: number, fear = 0, legit = 0) {
  const h = r.houses[house];
  if (!h || house === r.player) return;
  const chan = r.council.chanceler && trust > 0 ? 1.25 : 1;
  const mul = h.personality === 'honrado' && trust < 0 ? 1.5 : 1;
  h.op.trust = clamp(h.op.trust + trust * chan * mul, -100, 100);
  h.op.fear = clamp(h.op.fear + fear, 0, 100);
  h.op.legit = clamp(h.op.legit + legit, 0, 100);
  r.memories.push({ house, t: r.time, text, trust, fear, legit });
  if (r.memories.length > 240) r.memories.splice(0, r.memories.length - 240);
}

/** Lembrança que se espalha por todas as casas (com peso menor para quem não foi o alvo). */
export function rumor(r: Realm, text: string, trust: number, fear = 0, legit = 0, except = '') {
  for (const h of Object.values(r.houses)) {
    if (!h.alive || h.id === r.player || h.id === except) continue;
    remember(r, h.id, text, trust, fear, legit);
  }
}

// ----------------------------------------------------------------------
// Hierarquia feudal
// ----------------------------------------------------------------------
export function vassalsOf(r: Realm, id: string): House[] {
  return Object.values(r.houses).filter((h) => h.alive && h.liege === id);
}
/** Todas as casas abaixo de `id` na hierarquia (vassalos e vassalos de vassalos). */
export function realmOf(r: Realm, id: string): House[] {
  const out: House[] = [];
  const walk = (x: string) => { for (const v of vassalsOf(r, x)) { out.push(v); walk(v.id); } };
  walk(id);
  return out;
}
/** Províncias sob a bandeira do jogador: a própria e as de seus vassalos. */
export function provincesUnder(r: Realm, id: string): number {
  return 1 + realmOf(r, id).length;
}
export function isAbove(r: Realm, a: string, b: string): boolean {
  let x = r.houses[b]?.liege;
  for (let i = 0; i < 10 && x; i++) { if (x === a) return true; x = r.houses[x]?.liege; }
  return false;
}

export function atWar(r: Realm, a: string, b: string): boolean { return r.houses[a]?.rel[b] === 'war'; }
export function allied(r: Realm, a: string, b: string): boolean { return r.houses[a]?.rel[b] === 'ally'; }
export function setRel(r: Realm, a: string, b: string, rel: 'war' | 'ally' | null) {
  const ha = r.houses[a], hb = r.houses[b];
  if (!ha || !hb) return;
  if (rel) { ha.rel[b] = rel; hb.rel[a] = rel; } else { delete ha.rel[b]; delete hb.rel[a]; }
  if (rel === 'war') { ha.warSince = hb.warSince = r.time; }
}

/** Legitimidade média que as casas atribuem ao jogador. */
export function avgLegit(r: Realm): number {
  const hs = Object.values(r.houses).filter((h) => h.alive && h.id !== r.player);
  return hs.length ? hs.reduce((s, h) => s + h.op.legit, 0) / hs.length : 0;
}

// ----------------------------------------------------------------------
// Estradas
// ----------------------------------------------------------------------
export function neighbors(r: Realm, p: string): { id: string; days: number; danger: number }[] {
  return r.roads.filter((x) => x.a === p || x.b === p).map((x) => ({ id: x.a === p ? x.b : x.a, days: x.days, danger: x.danger }));
}
export function road(r: Realm, a: string, b: string) {
  return r.roads.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
}
/** Menor caminho em dias (Dijkstra simples, oito províncias). */
export function route(r: Realm, from: string, to: string): { path: string[]; days: number } {
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const open = new Set(Object.keys(r.provinces));
  while (open.size) {
    let u = '', best = Infinity;
    for (const k of open) if ((dist[k] ?? Infinity) < best) { best = dist[k]; u = k; }
    if (!u) break;
    open.delete(u);
    if (u === to) break;
    for (const n of neighbors(r, u)) {
      const d = best + n.days;
      if (d < (dist[n.id] ?? Infinity)) { dist[n.id] = d; prev[n.id] = u; }
    }
  }
  if (dist[to] === undefined) return { path: [from], days: 0 };
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return { path, days: dist[to] };
}
export function provinceOfHouse(r: Realm, house: string): string { return r.houses[house].province; }
export function travelDays(r: Realm, a: string, b: string): number { return route(r, a, b).days; }
