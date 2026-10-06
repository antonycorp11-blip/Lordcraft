import { BUILDINGS } from '../data/factions';
import { ABILITIES } from '../data/abilities';
import type { Entity } from '../sim/entity';
import {
  issueSmart, issueMove, issueAttack, setRally, issueBuild, issueCast,
} from '../sim/commands';
import { canPlaceAt } from '../sim/units';
import type { Session } from './session';
import {
  pickAt, boxSelect, setSelection, selectSameType, ownUnitsSelected, ownSelected, centerOnSelection, selectIdleWorker,
} from './selection';

// Entrada: mouse/teclado (desktop) e gestos (toque), com separação clara entre
// gestos de câmera e de seleção.

export interface InputHooks {
  blocked?(): boolean;
  hotkey(key: string, ev: KeyboardEvent): boolean;
  toggleDiag(): void;
  toggleMenu(): void;
  feedback(text: string): void;
}

export class Input {
  s: Session;
  vp: HTMLElement;
  selBox: HTMLElement;
  hooks: InputHooks;
  mouse = { x: 0, y: 0, inside: false };
  private drag: { x: number; y: number; id: number; box: boolean; pan: boolean; button: number; t: number; moved: boolean; long: boolean } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; cx: number; cy: number } | null = null;
  private longTimer = 0;
  private lastTap = { t: 0, id: 0 };
  private lastGroupKey = { k: '', t: 0 };
  private keys = new Set<string>();
  shift = false;
  ctrl = false;
  private disposers: (() => void)[] = [];

  constructor(s: Session, vp: HTMLElement, hooks: InputHooks) {
    this.s = s;
    this.vp = vp;
    this.hooks = hooks;
    this.selBox = document.createElement('div');
    this.selBox.className = 'selbox';
    vp.appendChild(this.selBox);
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, ev: K, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(ev, fn as EventListener, opts));
    };
    on(vp, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(window, 'pointermove', (e: PointerEvent) => this.move(e));
    on(window, 'pointerup', (e: PointerEvent) => this.up(e));
    on(window, 'pointercancel', (e: PointerEvent) => this.cancel(e));
    on(vp, 'contextmenu', (e: Event) => e.preventDefault());
    on(vp, 'wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
    on(window, 'keydown', (e: KeyboardEvent) => this.keydown(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.keyup(e));
    const leave = () => { this.mouse.inside = false; };
    document.documentElement.addEventListener('mouseleave', leave);
    this.disposers.push(() => document.documentElement.removeEventListener('mouseleave', leave));
    on(window, 'blur', () => { this.keys.clear(); this.shift = this.ctrl = false; });
  }

  dispose() {
    clearTimeout(this.longTimer);
    for (const d of this.disposers) d();
    this.selBox.remove();
  }

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.vp.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ------------------------------------------------------------------
  private down(e: PointerEvent) {
    if (this.hooks.blocked?.()) return;
    const s = this.s;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const [x, y] = this.local(e);
    if (e.pointerType === 'touch') {
      this.pointers.set(e.pointerId, { x, y });
      if (this.pointers.size === 2) {
        clearTimeout(this.longTimer);
        this.drag = null;
        this.selBox.style.display = 'none';
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        return;
      }
      if (this.pointers.size > 2) return;
      this.drag = { x, y, id: e.pointerId, box: s.touchSelectMode, pan: false, button: 0, t: performance.now(), moved: false, long: false };
      clearTimeout(this.longTimer);
      this.longTimer = window.setTimeout(() => {
        if (this.drag && !this.drag.moved && !this.drag.pan) {
          this.drag.box = true;
          this.drag.long = true;
          navigator.vibrate?.(15);
          this.hooks.feedback('Arraste para selecionar uma área');
        }
      }, 420);
      return;
    }
    this.vp.setPointerCapture?.(e.pointerId);
    if (e.button === 1) {
      e.preventDefault();
      this.drag = { x, y, id: e.pointerId, box: false, pan: true, button: 1, t: performance.now(), moved: false, long: false };
      return;
    }
    if (e.button === 2) {
      this.rightClick(x, y, e.shiftKey);
      return;
    }
    if (e.button === 0) {
      this.drag = { x, y, id: e.pointerId, box: s.mode.k === 'none', pan: false, button: 0, t: performance.now(), moved: false, long: false };
    }
  }

  private move(e: PointerEvent) {
    const s = this.s;
    const [x, y] = this.local(e);
    if (e.pointerType !== 'touch') { this.mouse.x = x; this.mouse.y = y; this.mouse.inside = x >= 0 && y >= 0 && x <= this.vp.clientWidth && y <= this.vp.clientHeight && this.vp.contains(e.target as Node); }
    if (e.pointerType === 'touch' && this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x, y });
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        s.r.cam.pan(this.pinch.cx - cx, this.pinch.cy - cy);
        s.r.cam.zoomAt(cx, cy, d / (this.pinch.d || d));
        this.pinch = { d, cx, cy };
        return;
      }
    }
    // pré-visualização de construção
    if (s.mode.k === 'build' && (e.pointerType !== 'touch' || (this.drag && !this.drag.pan))) {
      const [wx, wy] = s.r.cam.toWorld(x, y);
      if (e.pointerType !== 'touch') this.updatePlacement(wx, wy);
    }
    const overVp = e.target === this.vp || this.vp.contains(e.target as Node);
    const hov = e.pointerType !== 'touch' && overVp ? pickAt(s, ...s.r.cam.toWorld(x, y)) : null;
    s.r.hover = hov?.id ?? 0;
    this.vp.dataset.cursor = this.cursorFor(hov);

    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dist = Math.hypot(x - d.x, y - d.y);
    if (dist > (e.pointerType === 'touch' ? 10 : 5)) d.moved = true;
    if (d.pan || (e.pointerType === 'touch' && !d.box && d.moved)) {
      if (e.pointerType === 'touch' && s.mode.k === 'build') {
        const [wx, wy] = s.r.cam.toWorld(x, y);
        this.updatePlacement(wx, wy);
        return;
      }
      if (!d.pan) { d.pan = true; clearTimeout(this.longTimer); }
      s.r.cam.pan(d.x - x, d.y - y);
      d.x = x; d.y = y;
      return;
    }
    if (d.box && d.moved) {
      const bx = Math.min(d.x, x), by = Math.min(d.y, y);
      Object.assign(this.selBox.style, { display: 'block', left: bx + 'px', top: by + 'px', width: Math.abs(x - d.x) + 'px', height: Math.abs(y - d.y) + 'px' });
    }
  }

  private up(e: PointerEvent) {
    const s = this.s;
    const [x, y] = this.local(e);
    if (e.pointerType === 'touch') {
      this.pointers.delete(e.pointerId);
      if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.drag = null; return; }
    }
    clearTimeout(this.longTimer);
    const d = this.drag;
    this.drag = null;
    this.selBox.style.display = 'none';
    if (!d || d.id !== e.pointerId) return;
    if (d.pan) return;
    const [wx, wy] = s.r.cam.toWorld(x, y);
    if (d.box && d.moved) {
      const [ax, ay] = s.r.cam.toWorld(d.x, d.y);
      boxSelect(s, ax, ay, wx, wy, e.shiftKey);
      return;
    }
    if (d.moved) return;
    if (e.pointerType === 'touch') this.tap(wx, wy);
    else this.leftClick(wx, wy, e.shiftKey, e.ctrlKey || e.metaKey);
  }

  private cancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    this.drag = null;
    this.selBox.style.display = 'none';
    clearTimeout(this.longTimer);
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const [x, y] = this.local(e);
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    this.s.r.cam.zoomAt(x, y, f);
  }

  // ------------------------------------------------------------------
  updatePlacement(wx: number, wy: number) {
    const s = this.s;
    if (s.mode.k !== 'build') return;
    const type = s.mode.type;
    const d = BUILDINGS[type];
    let tx = Math.floor(wx - d.size / 2 + 0.5), ty = Math.floor(wy - d.size / 2 + 0.5);
    if (d.cat === 'extractor') {
      const c = s.g.resources.find((r) => r.kind === 'crystal' && r.alive && Math.hypot(r.cx - wx, r.cy - wy) < 2.5);
      if (c) { tx = c.tx; ty = c.ty; }
    }
    const builder = ownUnitsSelected(s).find((u) => u.udef!.builds?.includes(type));
    const ok = canPlaceAt(s.g, s.pid, type, tx, ty, builder?.id ?? 0).ok;
    const cells: boolean[] = [];
    const w = s.g.world, fog = s.g.fogs[s.pid];
    for (let y = ty; y < ty + d.size; y++)
      for (let x = tx; x < tx + d.size; x++) cells.push(d.cat === 'extractor' ? ok : w.free(x, y) && fog.explored(x, y));
    s.r.placement = { type, tx, ty, cells, ok };
  }

  confirmPlacement(queue: boolean): boolean {
    const s = this.s;
    const p = s.r.placement;
    if (s.mode.k !== 'build' || !p) return false;
    const builders = ownUnitsSelected(s).filter((u) => u.udef!.builds?.includes(p.type));
    if (!builders.length) { this.endMode(); return false; }
    // trabalhador mais próximo que não está construindo
    builders.sort((a, b) => Math.hypot(a.x - p.tx, a.y - p.ty) - Math.hypot(b.x - p.tx, b.y - p.ty));
    const free = builders.find((b) => b.order?.t !== 'build') ?? builders[0];
    if (issueBuild(s.g, s.pid, free.id, p.type, p.tx, p.ty, queue)) {
      s.g.emit('order', p.tx + BUILDINGS[p.type].size / 2, p.ty + BUILDINGS[p.type].size / 2, { owner: s.pid });
      if (!queue) this.endMode();
      return true;
    }
    return false;
  }

  endMode() {
    this.s.mode = { k: 'none' };
    this.s.r.placement = null;
    this.s.dirty = true;
  }

  private cursorFor(hov: Entity | null): string {
    const s = this.s;
    if (s.mode.k !== 'none') return s.mode.k === 'build' ? 'build' : 'target';
    if (!hov) return '';
    if (hov.owner !== s.pid && s.g.isEnemy(s.pid, hov.owner) && (hov.kind === 'unit' || hov.kind === 'building')) return ownUnitsSelected(s).length ? 'attack' : 'enemy';
    if ((hov.kind === 'mine' || hov.kind === 'crystal') && ownUnitsSelected(s).some((u) => u.isWorker)) return 'gather';
    return 'select';
  }

  // ------------------------------------------------------------------
  private leftClick(wx: number, wy: number, shift: boolean, ctrl: boolean) {
    const s = this.s;
    if (s.mode.k === 'build') { this.confirmPlacement(shift); return; }
    if (s.mode.k !== 'none') { this.execMode(wx, wy, shift); return; }
    const e = pickAt(s, wx, wy);
    if (!e) {
      if (!shift && ownUnitsSelected(s).length) this.smart(wx, wy, false);
      else if (!shift) setSelection(s, []);
      return;
    }
    const now = performance.now();
    const dbl = now - this.lastTap.t < 320 && this.lastTap.id === e.id;
    this.lastTap = { t: now, id: e.id };
    if ((ctrl || dbl) && e.owner === s.pid) { selectSameType(s, e.type, shift); return; }
    if (shift && e.owner === s.pid && (e.kind === 'unit' || e.kind === 'building')) {
      const has = s.selection.includes(e.id);
      setSelection(s, has ? s.selection.filter((x) => x !== e.id) : [...s.selection.filter((id) => s.g.ents.get(id)?.owner === s.pid), e.id]);
      return;
    }
    // Com tropas próprias selecionadas, clicar em árvore, mina, inimigo ou neutro dá a ordem contextual
    // (coletar, atacar, seguir) em vez de trocar a seleção — mesmo comportamento do toque.
    const ownEntity = e.owner === s.pid && (e.kind === 'unit' || e.kind === 'building');
    if (!ownEntity && s.quickOrders && ownUnitsSelected(s).length) { this.smart(wx, wy, shift); return; }
    setSelection(s, [e.id]);
  }

  private rightClick(x: number, y: number, shift: boolean) {
    const s = this.s;
    if (s.mode.k !== 'none') { this.endMode(); return; }
    const [wx, wy] = s.r.cam.toWorld(x, y);
    this.smart(wx, wy, shift);
  }

  /** Ordem contextual. */
  smart(wx: number, wy: number, queue: boolean) {
    const s = this.s;
    const own = ownSelected(s);
    if (!own.length) return;
    const target = pickAt(s, wx, wy);
    const units = own.filter((e) => e.kind === 'unit').map((e) => e.id);
    const bIds = own.filter((e) => e.kind === 'building').map((e) => e.id);
    if (bIds.length && !units.length) {
      setRally(s.g, s.pid, bIds, target ? target.cx : wx, target ? target.cy : wy, target && (target.kind === 'mine' || target.kind === 'crystal') ? target.id : 0);
      s.g.emit('order', wx, wy, { owner: s.pid });
      return;
    }
    if (units.length) issueSmart(s.g, s.pid, units, wx, wy, target, queue, s.formation);
  }

  private tap(wx: number, wy: number) {
    const s = this.s;
    if (s.mode.k === 'build') { this.updatePlacement(wx, wy); return; }
    if (s.mode.k !== 'none') { this.execMode(wx, wy, false); return; }
    const e = pickAt(s, wx, wy, 0.95);
    const now = performance.now();
    const own = ownUnitsSelected(s);
    if (e) {
      const dbl = now - this.lastTap.t < 350 && this.lastTap.id === e.id;
      this.lastTap = { t: now, id: e.id };
      if (e.owner === s.pid && (e.kind === 'unit' || e.kind === 'building')) {
        if (dbl) selectSameType(s, e.type);
        else setSelection(s, [e.id]);
        return;
      }
      // alvo de ordem rápida
      if (own.length && s.quickOrders) { this.smart(wx, wy, false); return; }
      setSelection(s, [e.id]);
      return;
    }
    if (own.length && s.quickOrders) this.smart(wx, wy, false);
    else setSelection(s, []);
  }

  execMode(wx: number, wy: number, queue: boolean) {
    const s = this.s;
    const m = s.mode;
    const units = ownUnitsSelected(s).map((u) => u.id);
    const target = pickAt(s, wx, wy);
    switch (m.k) {
      case 'move': issueMove(s.g, s.pid, units, wx, wy, { queue, formation: s.formation }); break;
      case 'amove':
        if (target && s.g.isEnemy(s.pid, target.owner) && (target.kind === 'unit' || target.kind === 'building')) issueAttack(s.g, s.pid, units, target.id, queue);
        else issueMove(s.g, s.pid, units, wx, wy, { attack: true, queue, formation: s.formation });
        break;
      case 'patrol': issueMove(s.g, s.pid, units, wx, wy, { patrol: true, queue, formation: s.formation }); break;
      case 'guard': issueMove(s.g, s.pid, units, wx, wy, { guard: true, queue, formation: 'loose' }); break;
      case 'rally': {
        const bIds = ownSelected(s).filter((e) => e.kind === 'building').map((e) => e.id);
        setRally(s.g, s.pid, bIds, wx, wy, target && (target.kind === 'mine' || target.kind === 'crystal') ? target.id : 0);
        s.g.emit('order', wx, wy, { owner: s.pid });
        break;
      }
      case 'cast': {
        const def = ABILITIES[m.ability];
        if (def.target === 'point') issueCast(s.g, s.pid, units, m.ability, undefined, wx, wy);
        else if (target && (target.kind === 'unit' || target.kind === 'building')) {
          const enemy = s.g.isEnemy(s.pid, target.owner);
          if ((def.target === 'enemy' && !enemy) || (def.target === 'ally' && enemy)) { this.hooks.feedback('Alvo inválido'); return; }
          issueCast(s.g, s.pid, units, m.ability, target.id);
        } else { this.hooks.feedback('Selecione um alvo'); return; }
        break;
      }
    }
    if (!queue || m.k === 'cast') this.endMode();
  }

  // ------------------------------------------------------------------
  private keydown(e: KeyboardEvent) {
    if (this.hooks.blocked?.()) {
      if (e.key === 'Escape' || e.key === 'F10') { e.preventDefault(); this.hooks.toggleMenu(); }
      return;
    }
    const s = this.s;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    this.keys.add(k);
    if (k === 'Alt') { s.r.showAllHp = true; e.preventDefault(); return; }
    if (k === 'F3' || k === '§' || (k === 'd' && e.ctrlKey && e.shiftKey)) { e.preventDefault(); this.hooks.toggleDiag(); return; }
    if (k === 'F10' || (k === 'Escape' && s.mode.k === 'none' && !s.selection.length)) { e.preventDefault(); this.hooks.toggleMenu(); return; }
    if (k === 'Escape') { if (s.mode.k !== 'none') this.endMode(); else if (!this.hooks.hotkey(k, e)) setSelection(s, []); return; }
    if (k === 'Pause') { s.paused = !s.paused; s.dirty = true; return; }
    // grupos de controle
    if (/^[0-9]$/.test(k)) {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        s.groups[n] = ownSelected(s).map((x) => x.id);
        this.hooks.feedback(`Grupo ${n} definido (${s.groups[n].length})`);
        s.dirty = true;
      } else if (e.shiftKey) {
        s.groups[n] = [...new Set([...(s.groups[n] ?? []), ...ownSelected(s).map((x) => x.id)])];
        s.dirty = true;
      } else {
        const ids = (s.groups[n] ?? []).filter((id) => s.g.ents.get(id)?.alive);
        if (ids.length) {
          setSelection(s, ids);
          const now = performance.now();
          if (this.lastGroupKey.k === k && now - this.lastGroupKey.t < 350) centerOnSelection(s);
          this.lastGroupKey = { k, t: now };
        }
      }
      return;
    }
    if (k === ' ') { e.preventDefault(); if (s.lastAlert) s.r.cam.centerOn(s.lastAlert.x, s.lastAlert.y); return; }
    if (k === 'F1') {
      e.preventDefault();
      const h = s.g.units.find((u) => u.alive && u.owner === s.pid && u.isHero);
      if (h) { if (s.selection.length === 1 && s.selection[0] === h.id) centerOnSelection(s); setSelection(s, [h.id]); }
      return;
    }
    if (k === '.' || k === '`' || k === "'") { selectIdleWorker(s); return; }
    if (k === 'Tab') {
      e.preventDefault();
      const types = [...new Set(ownSelected(s).map((x) => x.type))];
      if (types.length > 1) { s.subgroup = types[(types.indexOf(s.subgroup) + 1) % types.length]; s.dirty = true; }
      return;
    }
    if (k.startsWith('Arrow')) return;
    if (this.hooks.hotkey(k, e)) e.preventDefault();
  }

  private keyup(e: KeyboardEvent) {
    this.keys.delete(e.key);
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Alt') this.s.r.showAllHp = false;
  }

  /** Rolagem por teclado e bordas da tela (desktop). */
  update(dt: number, edgePan: boolean) {
    const cam = this.s.r.cam;
    const sp = 900 * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= sp;
    if (this.keys.has('ArrowRight')) dx += sp;
    if (this.keys.has('ArrowUp')) dy -= sp;
    if (this.keys.has('ArrowDown')) dy += sp;
    if (edgePan && this.mouse.inside && !this.drag && document.hasFocus()) {
      const m = 6;
      const r = this.vp.getBoundingClientRect();
      if (this.mouse.x < m) dx -= sp;
      if (this.mouse.x > r.width - m) dx += sp;
      if (this.mouse.y < m) dy -= sp;
      if (this.mouse.y > r.height - m) dy += sp;
    }
    if (dx || dy) cam.pan(dx, dy);
  }
}
