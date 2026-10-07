import { hash2, valueNoise } from '../core/rng';
import { atWar, isAbove } from '../realm/core';
import type { House, Realm } from '../realm/types';

// Mapa político do reino: um continente desenhado em canvas com as províncias como
// territórios de verdade, coloridos pelo reino a que pertencem (o jogador e seus vassalos
// com a cor dele). Por cima, cada província tem um "countryball" com o brasão da casa e
// olhos que olham para você — a expressão mostra a relação (guerra, aliança, vassalo).

export const MAP_W = 640, MAP_H = 474; // mesma proporção do quadro (1,35)
const PARCH = [232, 220, 181];

/** Bloco no mapa: o jogador e todos abaixo dele formam um só; cada outra casa é o seu. */
export function topOf(r: Realm, id: string): string {
  return id === r.player || isAbove(r, r.player, id) ? r.player : id;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1).padEnd(6, '0'), 16);
  return hex.length === 4
    ? [parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), parseInt(hex[3] + hex[3], 16)]
    : [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

/** Cor do reino no mapa (o jogador sempre em dourado/azul vivo, para se achar de cara). */
/** Cor de cada casa no mapa: bem distintas entre si; o dourado é só do jogador. */
const MAP_COLORS: Record<string, string> = {
  valcrest: '#7a5aa8', morvane: '#4f78a8', thorne: '#b24a3c', velsa: '#3e9a8e', draven: '#4f8a4a', ostrel: '#c07a3a', brannoc: '#a8508e',
};

export function realmColor(r: Realm, top: string): [number, number, number] {
  if (top === r.player) return [222, 178, 60];
  if (MAP_COLORS[top]) return rgb(MAP_COLORS[top]);
  const c = rgb(r.houses[top].crest.c1);
  const lum = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;
  // cores muito escuras ou claras ficam legíveis sobre o pergaminho
  return mix(c, PARCH, lum < 0.25 ? 0.35 : lum > 0.8 ? 0.15 : 0.25) as [number, number, number];
}

let cache: { sig: string; url: string; region: Uint8Array; ids: string[] } | null = null;

function signature(r: Realm): string {
  return Object.values(r.provinces).map((p) => `${p.id}:${p.owner}:${topOf(r, p.owner)}`).join('|') + r.houses[r.player].crest.c1;
}

/** Província em (x, y) — porcentagens do quadro. */
export function provinceAt(r: Realm, xPct: number, yPct: number): string | null {
  if (!cache) return null;
  const x = Math.floor((xPct / 100) * MAP_W), y = Math.floor((yPct / 100) * MAP_H);
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return null;
  const k = cache.region[x + y * MAP_W];
  return k ? cache.ids[k - 1] : null;
}

/** Imagem do mapa (data URL), refeita só quando donos ou suseranos mudam. */
export function realmMapImage(r: Realm): string {
  const sig = signature(r);
  if (cache?.sig === sig) return cache.url;
  const cv = document.createElement('canvas');
  cv.width = MAP_W; cv.height = MAP_H;
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  const provs = Object.values(r.provinces);
  const ids = provs.map((p) => p.id);
  const img = ctx.createImageData(MAP_W, MAP_H);
  const px = img.data;
  const region = new Uint8Array(MAP_W * MAP_H);
  const seed = 7;
  // 1) terra x mar e território de cada província (Voronoi com bordas orgânicas)
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const u = x / MAP_W, v = y / MAP_H;
    const du = (u - 0.5) * 1.35, dv = v - 0.52;
    const d = Math.hypot(du, dv);
    const n = valueNoise(u * 5, v * 5, seed) - 0.5;
    let land = d < 0.5 + n * 0.22;
    let best = 0, bd = Infinity;
    const wu = u * 100 + (valueNoise(u * 9, v * 9, seed + 3) - 0.5) * 9;
    const wv = v * 100 + (valueNoise(u * 9 + 40, v * 9, seed + 4) - 0.5) * 9;
    for (let k = 0; k < provs.length; k++) {
      const p = provs[k];
      const dd = Math.hypot((wu - p.x) * 1.35, wv - p.y);
      if (dd < bd) { bd = dd; best = k; }
      if (dd < 9) land = true; // a capital nunca fica no mar
    }
    if (bd > 30) land = false;
    region[x + y * MAP_W] = land ? best + 1 : 0;
  }
  const colorOf = provs.map((p) => {
    const top = topOf(r, p.owner);
    const base = realmColor(r, top);
    // seus vassalos: dourado mais claro que a sua sede
    return top === p.owner ? base : mix(base, PARCH, 0.32);
  });
  const isTopBorder = (a: number, b: number) => topOf(r, provs[a - 1].owner) !== topOf(r, provs[b - 1].owner);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = x + y * MAP_W, o = i * 4;
    const k = region[i];
    const grain = (hash2(x, y, 11) - 0.5) * 14;
    if (!k) {
      // mar: azul com ondas suaves e sombra da costa
      let near = 0;
      for (const [dx, dy] of [[0, -3], [3, 0], [0, 3], [-3, 0], [0, -7], [7, 0], [0, 7], [-7, 0]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < MAP_W && yy < MAP_H && region[xx + yy * MAP_W]) near++;
      }
      const wave = Math.sin((x * 0.09 + y * 0.05) + valueNoise(x / 40, y / 40, 9) * 6) > 0.92 ? 18 : 0;
      const c = mix([38, 78, 98], [70, 122, 138], valueNoise(x / 90, y / 90, 5));
      px[o] = c[0] + near * 6 + wave + grain * 0.4; px[o + 1] = c[1] + near * 7 + wave + grain * 0.4; px[o + 2] = c[2] + near * 6 + wave + grain * 0.4; px[o + 3] = 255;
      continue;
    }
    let c = colorOf[k - 1];
    // fronteiras: fina entre províncias, grossa entre reinos; costa escura
    let edge = 0;
    for (const [dx, dy, w] of [[1, 0, 1], [0, 1, 1], [-1, 0, 1], [0, -1, 1], [2, 0, 2], [0, 2, 2], [-2, 0, 2], [0, -2, 2]] as const) {
      const xx = x + dx, yy = y + dy;
      const j = xx >= 0 && yy >= 0 && xx < MAP_W && yy < MAP_H ? region[xx + yy * MAP_W] : 0;
      if (j === k) continue;
      if (!j) edge = Math.max(edge, w === 1 ? 3 : 2);
      else if (isTopBorder(k, j)) edge = Math.max(edge, w === 1 ? 4 : 3);
      else if (w === 1) edge = Math.max(edge, 1);
    }
    if (edge === 4) c = mix(c, [40, 30, 20], 0.75);
    else if (edge === 3) c = mix(c, [40, 30, 20], 0.55);
    else if (edge === 2) c = mix(c, [255, 245, 220], 0.35);
    else if (edge === 1) c = mix(c, [60, 45, 30], 0.45);
    const shade = (valueNoise(x / 26, y / 26, 21) - 0.5) * 26;
    px[o] = c[0] + grain + shade; px[o + 1] = c[1] + grain + shade; px[o + 2] = c[2] + grain + shade * 0.8; px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 2) relevo e paisagem desenhados por cima: florestas, montanhas, trigais
  const sx = MAP_W / 100, sy = MAP_H / 100;
  provs.forEach((p, k) => {
    const rnd = (n: number) => hash2(k * 31 + n, n * 7, 3);
    const draw = (n: number, fn: (x: number, y: number) => void) => {
      for (let i = 0; i < n; i++) {
        const a = rnd(i) * Math.PI * 2, d = 6 + rnd(i + 50) * 11;
        const x = (p.x + Math.cos(a) * d / 1.35) * sx, y = (p.y + Math.sin(a) * d) * sy;
        if (region[Math.floor(x) + Math.floor(y) * MAP_W] === k + 1) fn(x, y);
      }
    };
    if (p.prod.wood > 1.1) draw(Math.round(p.prod.wood * 9), (x, y) => {
      ctx.fillStyle = 'rgba(30,60,35,0.75)';
      ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 4, y + 2); ctx.lineTo(x - 4, y + 2); ctx.fill();
      ctx.fillStyle = 'rgba(60,40,25,0.7)'; ctx.fillRect(x - 0.6, y + 2, 1.2, 2.5);
    });
    if (p.prod.aether > 1 || p.id === 'brasa' || p.id === 'morvane') draw(p.prod.aether > 1.5 ? 9 : 6, (x, y) => {
      ctx.fillStyle = 'rgba(90,82,74,0.85)';
      ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 7, y + 3); ctx.lineTo(x - 7, y + 3); ctx.fill();
      ctx.fillStyle = p.prod.aether > 1.5 ? 'rgba(140,220,235,0.9)' : 'rgba(240,240,240,0.9)';
      ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 2.5, y - 4.5); ctx.lineTo(x - 2.5, y - 4.5); ctx.fill();
    });
    if (p.prod.food > 1.4) draw(10, (x, y) => {
      ctx.strokeStyle = 'rgba(200,160,60,0.8)'; ctx.lineWidth = 1.2;
      for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.moveTo(x + j * 2.5, y + 3); ctx.lineTo(x + j * 2.5 + 1, y - 3); ctx.stroke(); }
    });
  });
  // 3) estradas pontilhadas
  ctx.setLineDash([4, 4]);
  for (const rd of r.roads) {
    const a = r.provinces[rd.a], b = r.provinces[rd.b];
    ctx.strokeStyle = rd.danger >= 0.09 ? 'rgba(150,40,30,0.7)' : 'rgba(70,50,30,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x * sx, a.y * sy); ctx.lineTo(b.x * sx, b.y * sy); ctx.stroke();
  }
  ctx.setLineDash([]);
  // 4) moldura de pergaminho
  const g = ctx.createRadialGradient(MAP_W / 2, MAP_H / 2, MAP_H * 0.35, MAP_W / 2, MAP_H / 2, MAP_W * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,8,4,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, MAP_W, MAP_H);
  const url = cv.toDataURL('image/jpeg', 0.86);
  cache = { sig, url, region, ids };
  return url;
}

/** Expressão do countryball conforme a relação da casa com o jogador. */
export function ballMood(r: Realm, h: House): 'me' | 'war' | 'ally' | 'vassal' | 'lord' | 'calm' {
  if (h.id === r.player) return 'me';
  if (atWar(r, h.id, r.player)) return 'war';
  if (h.liege === r.player) return 'vassal';
  if (isAbove(r, h.id, r.player)) return 'lord';
  if (h.rel[r.player] === 'ally') return 'ally';
  return 'calm';
}
