import type { Game } from '../sim/game';
import { Ter } from '../world/world';
import type { Camera } from './camera';
import { TILE } from './camera';

// Minimapa vetorial (SVG): terreno estático + camada dinâmica de unidades,
// edifícios, névoa, câmera e alertas. Unidades agregadas por células 2x2.

const TER_COL: Record<number, string> = {
  [Ter.Grass]: '#557d36', [Ter.Dirt]: '#7b6542', [Ter.Sand]: '#c2ad78', [Ter.Snow]: '#d9e1ea', [Ter.Ash]: '#5b4943',
  [Ter.Water]: '#24527c', [Ter.Shallow]: '#3f7d9f', [Ter.Rock]: '#6a6762', [Ter.Road]: '#9b8a62', [Ter.Moss]: '#3e6b4b', [Ter.Bridge]: '#8a6a44',
};
const TREE_COL = ['#2c5622', '#2c4b3d', '#4a3a30', '#21504a'];

export class Minimap {
  el: HTMLElement;
  bg: HTMLElement;
  svg: SVGSVGElement;
  private gFog: SVGPathElement;
  private gUnexp: SVGPathElement;
  private gDyn: SVGGElement;
  private camRect: SVGRectElement;
  private lastTreeVer = -1;
  private lastBg = 0;

  constructor(private g: Game, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.bg = document.createElement('div');
    this.bg.className = 'mm-bg';
    this.el.appendChild(this.bg);
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
    this.svg.setAttribute('viewBox', `0 0 ${g.world.w} ${g.world.h}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.innerHTML = `<g class="dyn"></g><path class="mm-dim"/><path class="mm-unexp"/><rect class="mm-cam"/>`;
    this.el.appendChild(this.svg);
    this.gDyn = this.svg.querySelector('.dyn')!;
    this.gFog = this.svg.querySelector('.mm-dim')!;
    this.gUnexp = this.svg.querySelector('.mm-unexp')!;
    this.camRect = this.svg.querySelector('.mm-cam')!;
    parent.appendChild(this.el);
    this.renderTerrain();
  }

  renderTerrain() {
    const w = this.g.world;
    const paths = new Map<string, string>();
    const add = (c: string, s: string) => paths.set(c, (paths.get(c) ?? '') + s);
    for (let y = 0; y < w.h; y++) {
      let run = 0, col = '';
      for (let x = 0; x <= w.w; x++) {
        let c = '';
        if (x < w.w) {
          const i = w.idx(x, y);
          c = w.tree[i] ? TREE_COL[w.treeKind[i]] : w.cliff[i] ? '#4e4a44' : TER_COL[w.ter[i]] ?? '#555';
          if (!w.tree[i] && w.elev[i] && !w.cliff[i]) c = shade(c);
        }
        if (c !== col) {
          if (col) add(col, `M${run} ${y}h${x - run}v1h${run - x}z`);
          col = c; run = x;
        }
      }
    }
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.w} ${w.h}" shape-rendering="crispEdges" preserveAspectRatio="none">`;
    for (const [c, d] of paths) svg += `<path fill="${c}" d="${d}"/>`;
    svg += '</svg>';
    this.bg.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
    this.lastTreeVer = w.treeVersion;
    this.lastBg = performance.now();
  }

  update(pid: number, cam: Camera, now: number) {
    const g = this.g;
    if (g.world.treeVersion !== this.lastTreeVer && now - this.lastBg > 20000) this.renderTerrain();
    const fog = g.fogs[pid];
    // névoa em células 2x2
    let dDim = '', dUn = '';
    const W = g.world.w, H = g.world.h;
    for (let y = 0; y < H; y += 2) {
      let ru = -1, rd = -1;
      for (let x = 0; x <= W; x += 2) {
        const inR = x < W;
        const seen = inR && fog.seen[x + y * W];
        const vis = inR && fog.vis[x + y * W];
        const un = inR && !seen, dim = inR && seen && !vis;
        if (un && ru < 0) ru = x;
        if (!un && ru >= 0) { dUn += `M${ru} ${y}h${x - ru}v2h${ru - x}z`; ru = -1; }
        if (dim && rd < 0) rd = x;
        if (!dim && rd >= 0) { dDim += `M${rd} ${y}h${x - rd}v2h${rd - x}z`; rd = -1; }
      }
    }
    this.gFog.setAttribute('d', dDim);
    this.gUnexp.setAttribute('d', dUn);

    // unidades e edifícios
    const byColor = new Map<string, Set<number>>();
    const bPaths = new Map<string, string>();
    for (const u of g.units) {
      if (!u.alive || u.inside) continue;
      if (!g.sharesVision(pid, u.owner) && !fog.visible(u.x, u.y)) continue;
      const col = u.owner === pid ? '#3cff6a' : g.players[u.owner]?.color ?? (u.owner === 8 ? '#e8d8a8' : '#ccc');
      if (!byColor.has(col)) byColor.set(col, new Set());
      byColor.get(col)!.add((Math.floor(u.x / 2) << 10) | Math.floor(u.y / 2));
    }
    for (const b of g.buildings) {
      if (!b.alive) continue;
      if (!g.sharesVision(pid, b.owner) && !fog.rectVisible(b.tx, b.ty, b.size)) continue;
      const col = b.owner === pid ? '#3cff6a' : g.players[b.owner]?.color ?? '#c9b48a';
      bPaths.set(col, (bPaths.get(col) ?? '') + `M${b.tx} ${b.ty}h${b.size}v${b.size}h${-b.size}z`);
    }
    const gm = g.ghosts.get(pid);
    if (gm) for (const gh of gm.values()) {
      const col = g.players[gh.owner]?.color ?? '#aaa';
      bPaths.set(col, (bPaths.get(col) ?? '') + `M${gh.tx} ${gh.ty}h${gh.size}v${gh.size}h${-gh.size}z`);
    }
    let html = '';
    for (const r of g.resources) {
      if (!r.alive || !fog.rectExplored(r.tx, r.ty, r.size)) continue;
      html += `<rect class="${r.kind === 'mine' ? 'mm-mine' : 'mm-cry'}" x="${r.tx - 0.5}" y="${r.ty - 0.5}" width="${r.size + 1}" height="${r.size + 1}"/>`;
    }
    for (const c of g.camps) {
      if (c.cleared || !fog.explored(c.x, c.y)) continue;
      html += `<circle class="mm-camp l${c.level}" cx="${c.x}" cy="${c.y}" r="1.6"/>`;
    }
    for (const [col, d] of bPaths) html += `<path class="mm-b" fill="${col}" d="${d}"/>`;
    for (const [col, set] of byColor) {
      let d = '';
      for (const k of set) { const x = (k >> 10) * 2, y = (k & 1023) * 2; d += `M${x} ${y}h1.8v1.8h-1.8z`; }
      html += `<path fill="${col}" d="${d}"/>`;
    }
    for (const a of g.alerts) {
      if (a.owner !== pid || g.time - a.t > 4) continue;
      html += `<circle class="mm-ping ${a.kind}" cx="${a.x}" cy="${a.y}" r="4"/>`;
    }
    this.gDyn.innerHTML = html;
    const [x0, y0, x1, y1] = cam.viewRect(0);
    this.camRect.setAttribute('x', String(x0));
    this.camRect.setAttribute('y', String(y0));
    this.camRect.setAttribute('width', String(x1 - x0));
    this.camRect.setAttribute('height', String(y1 - y0));
  }

  /** Converte coordenadas do clique em tiles. */
  toTile(clientX: number, clientY: number): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * this.g.world.w, ((clientY - r.top) / r.height) * this.g.world.h];
  }
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 16), gg = Math.min(255, ((n >> 8) & 255) + 16), b = Math.min(255, (n & 255) + 12);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`;
}

void TILE;
