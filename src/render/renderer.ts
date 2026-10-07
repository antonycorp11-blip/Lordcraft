import { BUILDINGS, UNITS } from '../data/factions';
import type { Entity } from '../sim/entity';
import type { Game, FxEvent } from '../sim/game';
import type { Projectile } from '../sim/combat';
import { Camera, TILE } from './camera';
import { TerrainView } from './terrain';
import { buildingClass, buildingHTML, resourceHTML, unitClass, unitHTML, unitScale } from './views';
import { applySheetStyle, spriteFrame, spriteSheetFor, spriteState, type SpriteDir, type WorkKind } from './sprite-anim';
import { Weather } from './weather';
import { applyAtlasStyle, atlasPosition, buildingAtlas, buildingFrame, resourceAtlas, resourceFrame } from './atlas';

// Renderizador DOM/CSS. Lê o estado da simulação; nunca o modifica.

interface View {
  el: HTMLElement;
  type: string;
  tx: string;
  z: number;
  cls: string;
  hp: number;
  mp: number;
  prog: number;
  atkPar: number;
  lastAnimT: number;
  hpB?: HTMLElement;
  mpB?: HTMLElement;
  progB?: HTMLElement;
  lvl?: HTMLElement;
  lvlN?: number;
  light?: HTMLElement;
  spr?: HTMLElement;     // quadro da folha de animação (sprite-anim)
  sprPos?: string;
  sprMode?: string;
  atl?: HTMLElement;      // quadro da folha de construção/recurso
  atlPos?: string;
  sprDir?: SpriteDir;     // última direção de movimento (para ficar parado na mesma pose)
  lx?: number; ly?: number; // última posição desenhada (px)
  stride?: number;          // distância andada: avança o ciclo de caminhada
  svx?: number; svy?: number; // movimento suavizado (direção sem tremer)
  seen: number;
}

interface FxView { el: HTMLElement; k: string; until: number }

export interface Placement { type: string; tx: number; ty: number; cells: boolean[]; ok: boolean }

const FX_DUR: Record<string, number> = {
  slash: 0.32, hit: 0.35, spark: 0.4, blood: 0.5, death: 0.9, explode: 0.6, bigexplode: 0.85, heal: 0.9, spell: 0.6,
  levelup: 1.4, build: 0.9, collapse: 1.6, smoke: 1.4, stomp: 0.8, moon: 0.9, star: 0.7, summon: 0.8, text: 1.3, order: 0.6,
  aorder: 0.6, chop: 0.35, deposit: 0.6, root: 1.0, buff: 0.8,
};

export interface Quality {
  fx: number;          // multiplicador de orçamento de efeitos
  fogBlur: boolean;
  water: boolean;
  shadows: boolean;
  lodUnits: number;    // unidades visíveis antes de simplificar
}
export const QUALITY: Record<string, Quality> = {
  baixa: { fx: 0.35, fogBlur: false, water: false, shadows: false, lodUnits: 160 },
  media: { fx: 0.7, fogBlur: true, water: true, shadows: true, lodUnits: 320 },
  alta: { fx: 1, fogBlur: true, water: true, shadows: true, lodUnits: 520 },
};

export class Renderer {
  g: Game;
  cam: Camera;
  pid: number;
  root: HTMLElement;
  world: HTMLElement;
  ground: HTMLElement;
  decals: HTMLElement;
  objs: HTMLElement;
  nightEl: HTMLElement;
  lights: HTMLElement;
  fogCanvas: HTMLCanvasElement;
  private fogCtx: CanvasRenderingContext2D;
  private fogImg: ImageData;
  overlay: HTMLElement;
  terrain: TerrainView;
  weather: Weather;
  views = new Map<number, View>();
  ghostViews = new Map<number, View>();
  pools = new Map<string, View[]>();
  projViews = new Map<number, HTMLElement>();
  projPool = new Map<string, HTMLElement[]>();
  fxViews: FxView[] = [];
  fxPool = new Map<string, HTMLElement[]>();
  selected = new Set<number>();
  hover = 0;
  placement: Placement | null = null;
  placeEl: HTMLElement;
  placeGhost: HTMLElement | null = null;
  placeGhostType = '';
  rallyEl: HTMLElement;
  rallyLine: HTMLElement;
  quality: Quality = QUALITY.alta;
  showAllHp = false;
  frame = 0;
  private fogVer = -1;
  private lastFar = false;
  private lod = 0;
  private lastDark = -1;
  private now = 0;
  stats = { units: 0, buildings: 0, nodes: 0, fx: 0, proj: 0, renderMs: 0, chunks: 0, lod: 0 };

  constructor(g: Game, root: HTMLElement, pid: number) {
    this.g = g;
    this.pid = pid;
    this.root = root;
    this.cam = new Camera(g.world.w, g.world.h);
    root.innerHTML = '';
    const mk = (cls: string, parent: HTMLElement, tag = 'div') => {
      const el = document.createElement(tag);
      el.className = cls;
      parent.appendChild(el);
      return el;
    };
    this.world = mk('world', root);
    this.world.style.width = g.world.w * TILE + 'px';
    this.world.style.height = g.world.h * TILE + 'px';
    this.ground = mk('layer ground', this.world);
    mk('layer gtex', this.world);
    this.decals = mk('layer decals', this.world);
    this.objs = mk('layer objs', this.world);
    this.nightEl = mk('layer night', this.world);
    this.lights = mk('layer lights', this.world);
    // Névoa: 1 pixel por tile, ampliado pela GPU. A ampliação suave já gera bordas
    // macias, sem filtro de desfoque; só é redesenhada quando a névoa muda.
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.className = 'layer fog';
    this.fogCanvas.width = g.world.w;
    this.fogCanvas.height = g.world.h;
    this.fogCanvas.style.width = g.world.w * TILE + 'px';
    this.fogCanvas.style.height = g.world.h * TILE + 'px';
    this.world.appendChild(this.fogCanvas);
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(g.world.w, g.world.h);
    this.overlay = mk('layer over', this.world);
    this.placeEl = mk('place', this.overlay);
    this.rallyEl = mk('rally', this.overlay);
    this.rallyLine = mk('rallyline', this.overlay);
    this.terrain = new TerrainView(g.world, this.ground, this.objs, g.decor, g.seed);
    this.weather = new Weather(root, g.seed);
  }

  setQuality(q: string) {
    this.quality = QUALITY[q] ?? QUALITY.alta;
    this.root.classList.toggle('q-low', q === 'baixa');
    this.root.classList.toggle('q-high', q === 'alta');
    this.root.classList.toggle('q-noshadow', !this.quality.shadows);
    this.root.classList.toggle('q-nowater', !this.quality.water);
    this.weather.maxDrops = q === 'baixa' ? 180 : q === 'media' ? 380 : 650;
  }

  // ------------------------------------------------------------------
  render(alpha: number, now: number) {
    const t0 = performance.now();
    this.now = now;
    this.frame++;
    const g = this.g, cam = this.cam;
    this.world.style.transform = `translate3d(${(-cam.x * cam.zoom).toFixed(1)}px,${(-cam.y * cam.zoom).toFixed(1)}px,0) scale(${cam.zoom})`;
    const [x0, y0, x1, y1] = cam.viewRect(2);
    const far = cam.zoom < 0.5;
    if (far !== this.lastFar) { this.root.classList.toggle('far', far); this.lastFar = far; }
    this.terrain.update(x0, y0, x1, y1, far, cam.zoom);
    while (g.world.changedTrees.length) this.terrain.onTreeRemoved(g.world.changedTrees.pop()!);
    while (g.world.damagedTrees.length) this.terrain.onTreeDamaged(g.world.damagedTrees.pop()!);

    // escuridão
    const dark = g.darkness();
    if (Math.abs(dark - this.lastDark) > 0.01) {
      this.lastDark = dark;
      this.nightEl.style.opacity = (dark * 0.62).toFixed(3);
      this.lights.style.opacity = dark.toFixed(3);
      this.root.classList.toggle('night', dark > 0.45);
    }

    const fog = g.fogs[this.pid];
    this.updateFog();

    // ---- unidades ----
    const vis: Entity[] = [];
    g.spatial.queryRect(x0, y0 - 1, x1, y1 + 2, vis);
    // inclui unidades mortas em animação (fora do hash)
    for (const u of g.units) if (!u.alive && u.dying > 0 && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1 + 2) vis.push(u);
    let nUnits = 0;
    for (const u of vis) if (u.alive) nUnits++;
    const lod = nUnits > this.quality.lodUnits * 1.8 || cam.zoom < 0.45 ? 2 : nUnits > this.quality.lodUnits || cam.zoom < 0.62 ? 1 : 0;
    if (lod !== this.lod) {
      this.root.classList.toggle('lod1', lod >= 1);
      this.root.classList.toggle('lod2', lod >= 2);
      this.lod = lod;
    }
    const f = this.frame;
    let shown = 0;
    for (const u of vis) {
      if (u.inside || u.removed) continue;
      if (!g.sharesVision(this.pid, u.owner) && !fog.visible(u.x, u.y)) continue;
      this.drawUnit(u, alpha, f);
      shown++;
    }
    // ---- edifícios ----
    let nb = 0;
    for (const b of g.buildings) {
      if (b.tx + b.size < x0 || b.tx > x1 || b.ty + b.size < y0 || b.ty > y1 + 3) continue;
      if (!g.sharesVision(this.pid, b.owner) && !fog.rectVisible(b.tx, b.ty, b.size)) continue;
      this.drawBuilding(b, f);
      nb++;
    }
    // fantasmas (memória de edifícios inimigos sob névoa)
    const gm = g.ghosts.get(this.pid);
    if (gm) {
      for (const [id, gh] of gm) {
        if (gh.tx + gh.size < x0 || gh.tx > x1 || gh.ty + gh.size < y0 || gh.ty > y1 + 3) continue;
        const real = g.ents.get(id);
        if (real && real.alive && fog.rectVisible(gh.tx, gh.ty, gh.size)) continue;
        this.drawGhost(id, gh, f);
      }
    }
    for (const r of g.resources) {
      if (!r.alive || r.tx + r.size < x0 || r.tx > x1 || r.ty + r.size < y0 || r.ty > y1 + 3) continue;
      if (!fog.rectExplored(r.tx, r.ty, r.size)) continue;
      this.drawResource(r, f);
    }
    for (const p of g.pickups) {
      if (!p.alive || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      if (!fog.visible(p.x, p.y)) continue;
      this.drawPickup(p, f);
    }
    // libera vistas não usadas
    for (const [id, v] of this.views) if (v.seen !== f) { this.release(v); this.views.delete(id); }
    for (const [id, v] of this.ghostViews) if (v.seen !== f) { this.release(v); this.ghostViews.delete(id); }

    this.drawProjectiles(alpha, x0, y0, x1, y1);
    this.drawFx(x0, y0, x1, y1);
    this.drawPlacement();
    this.drawRally();
    this.weather.update(now);

    this.stats.units = shown;
    this.stats.buildings = nb;
    this.stats.lod = lod;
    this.stats.fx = this.fxViews.length;
    this.stats.proj = this.projViews.size;
    this.stats.chunks = this.terrain.builtCount;
    if (f % 30 === 0) this.stats.nodes = this.root.getElementsByTagName('*').length;
    this.stats.renderMs = this.stats.renderMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  // ------------------------------------------------------------------
  private acquire(key: string, make: () => HTMLElement): View {
    const pool = this.pools.get(key);
    const v = pool?.pop();
    if (v) { v.el.style.display = ''; return v; }
    const el = make();
    this.objs.appendChild(el);
    return { el, type: key, tx: '', z: -1, cls: '', hp: -1, mp: -1, prog: -1, atkPar: 0, lastAnimT: 0, seen: 0 };
  }
  private release(v: View) {
    v.el.style.display = 'none';
    if (v.light) v.light.style.display = 'none';
    let pool = this.pools.get(v.type);
    if (!pool) { pool = []; this.pools.set(v.type, pool); }
    if (pool.length < 400) pool.push(v);
    else { v.el.remove(); v.light?.remove(); }
  }

  private relColor(owner: number): string {
    if (owner === this.pid) return 'own';
    if (owner >= 8) return 'neu';
    return this.g.isAlly(this.pid, owner) ? 'ally' : this.g.isEnemy(this.pid, owner) ? 'foe' : 'neu';
  }

  private drawUnit(u: Entity, alpha: number, f: number) {
    let v = this.views.get(u.id);
    if (!v || v.type !== 'u:' + u.type) {
      if (v) this.release(v);
      v = this.acquire('u:' + u.type, () => {
        const el = document.createElement('div');
        el.innerHTML = unitHTML(u.type);
        const s = unitScale(u.type);
        if (s !== 1) (el.querySelector('.fig') as HTMLElement).style.setProperty('--s', String(s));
        if (s !== 1) el.style.setProperty('--unit-scale', String(s));
        return el;
      });
      v.hpB = v.el.querySelector('.hp b') as HTMLElement;
      v.mpB = v.el.querySelector('.mp b') as HTMLElement;
      v.lvl = v.el.querySelector('.lvl') as HTMLElement;
      v.spr = (v.el.querySelector('.sprite-anim') as HTMLElement) ?? undefined;
      const sheet = spriteSheetFor(u.type);
      if (v.spr && sheet) applySheetStyle(v.spr, sheet, unitScale(u.type));
      v.sprPos = ''; v.sprMode = ''; v.sprDir = undefined; v.lx = v.ly = undefined; v.stride = 0; v.svx = v.svy = 0;
      v.cls = ''; v.tx = ''; v.hp = -1; v.mp = -1; v.lvlN = -1;
      this.views.set(u.id, v);
    }
    v.seen = f;
    const p = this.g.players[u.owner];
    const color = p ? p.color : u.owner === 8 ? '#8a7a66' : '#bbb';
    if (v.el.dataset.c !== color) { v.el.style.setProperty('--tc', color); v.el.dataset.c = color; }
    const rx = (u.px + (u.x - u.px) * alpha) * TILE, ry = (u.py + (u.y - u.py) * alpha) * TILE;
    const tx = `translate3d(${rx.toFixed(1)}px,${ry.toFixed(1)}px,0)`;
    if (tx !== v.tx) { v.el.style.transform = tx; v.tx = tx; }
    const z = Math.floor(ry) + (u.air ? 200000 : 0) + (u.alive ? 0 : -16);
    if (z !== v.z) { v.el.style.zIndex = String(z); v.z = z; }
    // animação de ataque reinicia a cada golpe alternando classes
    if (u.anim === 'attack' && u.animT < v.lastAnimT) v.atkPar ^= 1;
    v.lastAnimT = u.animT;
    let st = 's-idle';
    if (!u.alive) st = 's-die';
    else if (u.anim === 'walk') st = 's-walk';
    else if (u.anim === 'attack') st = v.atkPar ? 's-atk2' : 's-atk1';
    else if (u.anim === 'work') st = 's-work';
    else if (u.anim === 'cast') st = 's-cast';
    let cls = `${unitClass(u.type)} ${st} r-${this.relColor(u.owner)}`;
    if (v.spr) {
      const sheet = spriteSheetFor(u.type)!;
      // distância andada na tela: o ciclo de caminhada acompanha o chão
      const dxp = rx - (v.lx ?? rx), dyp = ry - (v.ly ?? ry);
      v.lx = rx; v.ly = ry;
      const step = Math.hypot(dxp, dyp);
      if (step < 24) v.stride = (v.stride ?? 0) + step; // ignora saltos (teleporte, reaparecer)
      // direção pelo movimento suavizado, com folga para não piscar na diagonal
      v.svx = (v.svx ?? 0) * 0.8 + dxp * 0.2;
      v.svy = (v.svy ?? 0) * 0.8 + dyp * 0.2;
      const ax = Math.abs(v.svx), ay = Math.abs(v.svy);
      if (ax + ay > 0.08) {
        const wasH = v.sprDir === 'e' || v.sprDir === 'w';
        const horiz = wasH ? ax * 1.35 > ay : ax > ay * 1.35;
        v.sprDir = horiz ? (v.svx > 0 ? 'e' : 'w') : (v.svy > 0 ? 's' : 'n');
      }
      const o = u.order;
      const work: WorkKind = o?.t === 'build' || o?.t === 'repair' ? 'build'
        : o?.t === 'gather' && o.tile !== undefined ? 'chop' : 'mine';
      const fr = spriteFrame(sheet, {
        state: spriteState(u), t: u.animT, dir: v.sprDir ?? 's', facingLeft: u.facing < 0, work,
        carrying: (u.carry === 'silver' || u.carry === 'aether') && u.carryAmt > 0,
        dist: v.stride ?? 0,
      }, unitScale(u.type));
      if (fr.mode !== 'anim') cls += fr.mode === 'legacy' ? ' sa-legacy' : ' sa-still';
      if (fr.flip) cls += ' sa-flip';
      if (fr.carry) cls += ' sa-carry';
      const pos = `${-fr.x}px ${-fr.y}px`;
      if (pos !== v.sprPos) { v.spr.style.backgroundPosition = pos; v.sprPos = pos; }
    }
    if (u.facing < 0) cls += ' fl';
    if (u.faceUp) cls += ' up';
    if (this.selected.has(u.id)) cls += ' sel';
    if (this.hover === u.id) cls += ' hov';
    if (u.alive && (u.hp < u.maxHp - 0.5 || this.showAllHp)) cls += ' dmg';
    if (u.carry) cls += ' cr-' + u.carry;
    if (u.buffs.length) {
      for (const b of u.buffs) {
        if (b.stun) cls += ' stun';
        else if (b.root) cls += ' rooted';
        else if (b.id === 'bloodfury' || b.id === 'avante') cls += ' fury';
        else if (b.id === 'avatar') cls += ' avatar';
        else if (b.id === 'slow' || b.id === 'dust') cls += ' slowed';
      }
    }
    if (u.timedLife > 0) cls += ' summoned';
    if (cls !== v.cls) { v.el.className = cls; v.cls = cls; }
    const hp = Math.round((u.hp / u.maxHp) * 50) / 50;
    if (hp !== v.hp) { v.hpB!.style.transform = `scaleX(${hp})`; v.hp = hp; v.hpB!.className = hp < 0.35 ? 'lo' : hp < 0.65 ? 'mid' : ''; }
    if (u.maxMana > 0) {
      const mp = Math.round((u.mana / u.maxMana) * 25) / 25;
      if (mp !== v.mp) { v.mpB!.style.transform = `scaleX(${mp})`; v.mp = mp; }
    }
    if (u.isHero && v.lvlN !== u.level) { v.lvl!.textContent = String(u.level); v.lvlN = u.level; }
  }

  private drawBuilding(b: Entity, f: number) {
    let v = this.views.get(b.id);
    if (!v || v.type !== 'b:' + b.type) {
      if (v) this.release(v);
      v = this.acquire('b:' + b.type, () => {
        const el = document.createElement('div');
        el.innerHTML = buildingHTML(b.type);
        return el;
      });
      v.hpB = v.el.querySelector('.hp b') as HTMLElement;
      v.progB = v.el.querySelector('.prog b') as HTMLElement;
      v.cls = ''; v.tx = ''; v.hp = -1; v.prog = -2; v.atlPos = '';
      const ba = buildingAtlas(b.type);
      if (ba && !v.atl) {
        v.atl = document.createElement('i');
        v.atl.className = 'atl';
        v.el.prepend(v.atl);
        applyAtlasStyle(v.atl, ba, b.size, TILE);
      }
      if (!v.light) {
        v.light = document.createElement('i');
        v.light.className = `lt a-${BUILDINGS[b.type].arch} s${b.size}`;
        this.lights.appendChild(v.light);
      }
      this.views.set(b.id, v);
    }
    v.seen = f;
    const p = this.g.players[b.owner];
    const color = p ? p.color : '#c9b48a';
    if (v.el.dataset.c !== color) { v.el.style.setProperty('--tc', color); v.el.dataset.c = color; }
    const tx = `translate3d(${b.tx * TILE}px,${b.ty * TILE}px,0)`;
    if (tx !== v.tx) {
      v.el.style.transform = tx; v.tx = tx;
      v.el.style.zIndex = String((b.ty + b.size) * TILE - 2);
      v.light!.style.transform = `translate3d(${b.cx * TILE}px,${b.cy * TILE}px,0)`;
    }
    v.light!.style.display = b.alive && b.built ? '' : 'none';
    let cls = `${buildingClass(b.type)} r-${this.relColor(b.owner)}`;
    if (!b.alive) cls += ' dead';
    else if (!b.built) cls += b.progress < 0.33 ? ' c0' : b.progress < 0.75 ? ' c1' : ' c2';
    const hr = b.hp / b.maxHp;
    if (b.alive && b.built) { if (hr < 0.3) cls += ' d2'; else if (hr < 0.6) cls += ' d1'; }
    if (this.selected.has(b.id)) cls += ' sel';
    if (this.hover === b.id) cls += ' hov';
    if (b.bqueue.length) cls += ' busy';
    if (b.upgrading) cls += ' upg';
    if (b.alive && (hr < 0.999 || this.showAllHp)) cls += ' dmg';
    const ba = v.atl ? buildingAtlas(b.type) : undefined;
    if (ba) {
      cls += ' atl-on';
      const pos = atlasPosition(ba, buildingFrame({ alive: b.alive, built: b.built, progress: b.progress, hpRatio: hr, night: this.lastDark > 0.45, id: b.id }, this.now));
      if (pos !== v.atlPos) { v.atl!.style.backgroundPosition = pos; v.atlPos = pos; }
    }
    if (cls !== v.cls) { v.el.className = cls; v.cls = cls; }
    const hp = Math.round(hr * 50) / 50;
    if (hp !== v.hp) { v.hpB!.style.transform = `scaleX(${hp})`; v.hp = hp; v.hpB!.className = hp < 0.35 ? 'lo' : hp < 0.65 ? 'mid' : ''; }
    let prog = -1;
    if (!b.built) prog = b.progress;
    else if (b.bqueue.length && (b.owner === this.pid || this.selected.has(b.id))) prog = b.bqueue[0].t / b.bqueue[0].total;
    prog = Math.round(prog * 60) / 60;
    if (prog !== v.prog) {
      v.prog = prog;
      v.progB!.parentElement!.style.display = prog >= 0 ? '' : 'none';
      if (prog >= 0) v.progB!.style.transform = `scaleX(${prog})`;
    }
  }

  private drawGhost(id: number, gh: { type: string; tx: number; ty: number; size: number; owner: number }, f: number) {
    let v = this.ghostViews.get(id);
    if (!v) {
      v = this.acquire('b:' + gh.type, () => {
        const el = document.createElement('div');
        el.innerHTML = buildingHTML(gh.type);
        return el;
      });
      v.cls = ''; v.tx = '';
      this.ghostViews.set(id, v);
      if (v.light) v.light.style.display = 'none';
    }
    v.seen = f;
    const color = this.g.players[gh.owner]?.color ?? '#aaa';
    v.el.style.setProperty('--tc', color);
    v.el.dataset.c = color;
    const tx = `translate3d(${gh.tx * TILE}px,${gh.ty * TILE}px,0)`;
    if (tx !== v.tx) { v.el.style.transform = tx; v.tx = tx; v.el.style.zIndex = String((gh.ty + gh.size) * TILE - 2); }
    const cls = `${buildingClass(gh.type)} ghost r-foe`;
    if (cls !== v.cls) { v.el.className = cls; v.cls = cls; }
  }

  private drawResource(r: Entity, f: number) {
    let v = this.views.get(r.id);
    if (!v) {
      v = this.acquire('r:' + r.kind, () => {
        const el = document.createElement('div');
        el.innerHTML = resourceHTML(r.kind as 'mine' | 'crystal');
        return el;
      });
      v.cls = ''; v.tx = ''; v.atlPos = '';
      const ra = resourceAtlas(r.kind);
      if (ra && !v.atl) {
        v.atl = document.createElement('i');
        v.atl.className = 'atl';
        v.el.prepend(v.atl);
        applyAtlasStyle(v.atl, ra, r.size, TILE);
      }
      this.views.set(r.id, v);
    }
    v.seen = f;
    const tx = `translate3d(${r.tx * TILE}px,${r.ty * TILE}px,0)`;
    if (tx !== v.tx) { v.el.style.transform = tx; v.tx = tx; v.el.style.zIndex = String((r.ty + r.size) * TILE - 4); }
    const lvl = r.amount > 8000 ? 3 : r.amount > 3000 ? 2 : 1;
    let cls = `res ${r.kind} l${lvl}${r.workers ? ' busy' : ''}${r.extractor ? ' ext' : ''}`;
    if (v.atl) {
      cls += ' atl-on';
      const pos = atlasPosition(resourceAtlas(r.kind)!, resourceFrame(r.kind, r.amount, this.now, r.id));
      if (pos !== v.atlPos) { v.atl.style.backgroundPosition = pos; v.atlPos = pos; }
    }
    if (this.selected.has(r.id)) cls += ' sel';
    if (this.hover === r.id) cls += ' hov';
    if (cls !== v.cls) { v.el.className = cls; v.cls = cls; }
  }

  private drawPickup(p: Entity, f: number) {
    let v = this.views.get(p.id);
    const key = p.kind === 'chest' ? 'p:chest' : 'p:item';
    if (!v) {
      v = this.acquire(key, () => {
        const el = document.createElement('div');
        el.innerHTML = '<i class="sh"></i><i class="ic"></i><i class="ring"></i>';
        return el;
      });
      v.cls = ''; v.tx = '';
      this.views.set(p.id, v);
    }
    v.seen = f;
    const tx = `translate3d(${p.x * TILE}px,${p.y * TILE}px,0)`;
    if (tx !== v.tx) { v.el.style.transform = tx; v.tx = tx; v.el.style.zIndex = String(Math.floor(p.y * TILE)); }
    const cls = `pk ${p.kind} it-${p.itemId}${this.hover === p.id ? ' hov' : ''}${this.selected.has(p.id) ? ' sel' : ''}`;
    if (cls !== v.cls) { v.el.className = cls; v.cls = cls; }
  }

  // ------------------------------------------------------------------
  private drawProjectiles(alpha: number, x0: number, y0: number, x1: number, y1: number) {
    const seen = new Set<number>();
    for (const p of this.g.projectiles) {
      if (p.x < x0 || p.x > x1 || p.y < y0 - 3 || p.y > y1) continue;
      const fog = this.g.fogs[this.pid];
      if (!fog.visible(p.x, p.y + 0.5) && p.owner !== this.pid) continue;
      seen.add(p.id);
      let el = this.projViews.get(p.id);
      if (!el) {
        el = this.projPool.get(p.style)?.pop();
        if (!el) { el = document.createElement('i'); el.className = `pj pj-${p.style}`; this.objs.appendChild(el); }
        el.style.display = '';
        this.projViews.set(p.id, el);
      }
      const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha;
      const k = Math.min(1, p.t / p.dur);
      const arcY = -p.arc * 4 * k * (1 - k);
      const dk = 1 - 2 * k;
      const dx = p.tx - p.sx, dy = p.ty - p.sy + (-p.arc * 4 * dk);
      const ang = Math.atan2(dy, dx) * 57.2958;
      el.style.transform = `translate3d(${(x * TILE).toFixed(1)}px,${((y + arcY) * TILE).toFixed(1)}px,0) rotate(${ang.toFixed(0)}deg)`;
      el.style.zIndex = String(Math.floor((y + 0.6) * TILE) + 150000);
    }
    for (const [id, el] of this.projViews) {
      if (seen.has(id)) continue;
      el.style.display = 'none';
      const style = el.className.slice(6);
      if (!this.projPool.has(style)) this.projPool.set(style, []);
      this.projPool.get(style)!.push(el);
      this.projViews.delete(id);
    }
  }

  private drawFx(x0: number, y0: number, x1: number, y1: number) {
    const g = this.g;
    const now = this.now;
    const fog = g.fogs[this.pid];
    const budget = Math.floor(220 * this.quality.fx);
    for (const e of g.fx) {
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1 + 1) continue;
      if ((e.k === 'order' || e.k === 'aorder') && e.owner !== this.pid) continue;
      if (e.k === 'deposit') continue;
      if (!fog.visible(e.x, e.y)) continue;
      // em batalhas enormes, reduz efeitos menores primeiro
      const minor = e.k === 'slash' || e.k === 'hit' || e.k === 'spark' || e.k === 'chop';
      if (this.fxViews.length > budget * (minor ? 0.5 : 1)) continue;
      if (e.k === 'chop') { this.terrain.shake(g.world.idx(Math.floor(e.x), Math.floor(e.y))); if (this.lod > 0) continue; }
      this.spawnFx(e, now);
    }
    g.fx.length = 0;
    // expira efeitos
    let w = 0;
    for (const fx of this.fxViews) {
      if (fx.until <= now) {
        fx.el.style.display = 'none';
        let pool = this.fxPool.get(fx.k);
        if (!pool) { pool = []; this.fxPool.set(fx.k, pool); }
        pool.push(fx.el);
      } else this.fxViews[w++] = fx;
    }
    this.fxViews.length = w;
  }

  private spawnFx(e: FxEvent, now: number) {
    let el = this.fxPool.get(e.k)?.pop();
    if (!el) {
      el = document.createElement('i');
      this.objs.appendChild(el);
    } else el.style.display = '';
    // elementos reaproveitados voltam de display:none, o que reinicia a animação CSS
    el.className = `fx fx-${e.k}`;
    el.style.transform = `translate3d(${(e.x * TILE).toFixed(0)}px,${(e.y * TILE).toFixed(0)}px,0)${e.k === 'slash' && e.a === -1 ? ' scaleX(-1)' : ''}`;
    el.style.zIndex = String(Math.floor(e.y * TILE) + (e.k === 'text' || e.k === 'levelup' ? 300000 : 160000));
    if (e.a !== undefined && (e.k === 'stomp' || e.k === 'collapse' || e.k === 'build' || e.k === 'smoke' || e.k === 'bigexplode' || e.k === 'explode')) el.style.setProperty('--r', String(e.a));
    if (e.color) el.style.setProperty('--fc', e.color); else el.style.removeProperty('--fc');
    el.textContent = e.k === 'text' ? e.text ?? '' : '';
    this.fxViews.push({ el, k: e.k, until: now + (FX_DUR[e.k] ?? 0.6) * 1000 });
  }

  // ------------------------------------------------------------------
  private updateFog() {
    const fog = this.g.fogs[this.pid];
    if (fog.version === this.fogVer) return;
    this.fogVer = fog.version;
    const px = this.fogImg.data, n = fog.vis.length;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (!fog.seen[i]) { px[j] = 12; px[j + 1] = 21; px[j + 2] = 23; px[j + 3] = 255; }      // inexplorado
      else if (!fog.vis[i]) { px[j] = 17; px[j + 1] = 27; px[j + 2] = 34; px[j + 3] = 171; } // explorado, fora de vista
      else px[j + 3] = 0;                                                                     // visível
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
  }


  private drawPlacement() {
    const p = this.placement;
    if (!p) {
      if (this.placeEl.style.display !== 'none') this.placeEl.style.display = 'none';
      return;
    }
    const d = BUILDINGS[p.type];
    this.placeEl.style.display = '';
    this.placeEl.style.transform = `translate3d(${p.tx * TILE}px,${p.ty * TILE}px,0)`;
    if (this.placeGhostType !== p.type) {
      this.placeGhostType = p.type;
      const cells = [];
      for (let i = 0; i < d.size * d.size; i++) cells.push('<i></i>');
      this.placeEl.innerHTML = `<div class="${buildingClass(p.type)} placing" style="--tc:${this.g.players[this.pid].color}">${buildingHTML(p.type)}</div><div class="cells s${d.size}">${cells.join('')}</div>`;
    }
    const cells = this.placeEl.querySelectorAll('.cells i');
    cells.forEach((c, i) => ((c as HTMLElement).className = p.cells[i] ? 'ok' : 'bad'));
    this.placeEl.classList.toggle('bad', !p.ok);
  }

  private drawRally() {
    let b: Entity | undefined;
    for (const id of this.selected) {
      const e = this.g.ents.get(id);
      if (e && e.kind === 'building' && e.owner === this.pid && e.rally) { b = e; break; }
    }
    if (!b) { this.rallyEl.style.display = 'none'; this.rallyLine.style.display = 'none'; return; }
    const r = b.rally!;
    this.rallyEl.style.display = '';
    this.rallyEl.style.transform = `translate3d(${r.x * TILE}px,${r.y * TILE}px,0)`;
    const dx = (r.x - b.cx) * TILE, dy = (r.y - b.cy) * TILE;
    const len = Math.hypot(dx, dy);
    this.rallyLine.style.display = '';
    this.rallyLine.style.width = len + 'px';
    this.rallyLine.style.transform = `translate3d(${b.cx * TILE}px,${b.cy * TILE}px,0) rotate(${Math.atan2(dy, dx)}rad)`;
  }
}

export { UNITS };
export type { Projectile };
