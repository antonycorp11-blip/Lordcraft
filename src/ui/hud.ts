import { BUILDINGS, FACTIONS, RESEARCHES, UNITS } from '../data/factions';
import { ABILITIES, ITEMS } from '../data/abilities';
import { RES_KEYS, type Cost } from '../data/types';
import type { Entity } from '../sim/entity';
import {
  issueStop, issueHold, issueRetreat, issueReturn, train, research, upgrade, cancelQueue, cancelConstruction,
  canTrain, canResearch, canUpgrade, revive, reviveCost, learn, useHeroItem, buyHeroItem, hire, toggleAutocast, issueCast,
  nearestShop, type Formation,
} from '../sim/commands';
import { canCast } from '../sim/abilities';
import { canLearn, XP_TABLE } from '../sim/heroes';
import { getArmor, getRange, getSpeed, skillLevel } from '../sim/stats';
import { portraitHTML } from '../render/views';
import { icon } from './icons';
import { realmHudInfo } from './realm-ui';
import { atlasPosition, buildingAtlas } from '../render/atlas';
import type { Session } from './session';
import type { Input } from './input';
import { selected, ownSelected, setSelection, selectByClass, selectIdleWorker, centerOnSelection } from './selection';

interface Btn {
  id: string;
  label: string;
  key: string;
  icon: string;
  cost?: Cost;
  desc?: string;
  disabled?: boolean;
  reason?: string;
  active?: boolean;
  auto?: boolean;
  badge?: string;
  run: () => void;
  alt?: () => void;
}

const fmt = (n: number) => Math.floor(n).toLocaleString('pt-BR');
const CLASS_NAMES: Record<string, string> = {
  worker: 'Trabalhador', melee: 'Infantaria', ranged: 'À distância', cavalry: 'Cavalaria', caster: 'Suporte mágico',
  siege: 'Cerco', air: 'Aérea', hero: 'Herói', summon: 'Invocação', creep: 'Criatura',
};
const ARMOR_NAMES: Record<string, string> = { light: 'Leve', medium: 'Média', heavy: 'Pesada', fortified: 'Fortificada', hero: 'Heroica', none: 'Nenhuma' };
const DMG_NAMES: Record<string, string> = { blade: 'Corte', pierce: 'Perfurante', siege: 'Cerco', arcane: 'Arcano', hero: 'Heroico', chaos: 'Caos' };

export class Hud {
  s: Session;
  input!: Input;
  root: HTMLElement;
  el: Record<string, HTMLElement> = {};
  btns: Btn[] = [];
  page: 'main' | 'build' | 'build2' | 'learn' | 'shop' = 'main';
  private sig = '';
  private infoSig = '';
  private lastFull = 0;
  private lastRealm = -1e9;
  private alertSeen = new WeakSet<object>();
  private msgSeen = new WeakSet<object>();
  private toastTimer = 0;
  private tipFor: string | null = null;

  constructor(s: Session, root: HTMLElement) {
    this.s = s;
    this.root = root;
    root.innerHTML = `
      <div class="hud-top">
        <div class="resbar">
          <span class="r r-silver" title="Prata — riqueza mineral">${icon('silver')}<b data-k="silver">0</b></span>
          <span class="r r-wood" title="Madeira — matéria-prima">${icon('wood')}<b data-k="wood">0</b></span>
          <span class="r r-aether" title="Éter — energia rara">${icon('aether')}<b data-k="aether">0</b></span>
          <span class="r r-supply" title="Abastecimento (casas ampliam sem limite fixo)">${icon('supply')}<b data-k="supply">0/0</b></span>
          <span class="r r-upkeep" title="Soldo: exércitos acima de 30 de abastecimento consomem prata">${icon('upkeep')}<b data-k="upkeep">0</b></span>
          ${s.g.realm ? `<span class="r r-pop" title="População civil / moradias. Cada recruta sai daqui.">${icon('house')}<b data-k="pop">0</b></span>
          <span class="r r-food" title="Grãos estocados (variação por minuto)">${icon('food')}<b data-k="food">0</b></span>
          <span class="r r-season" title="Estação e ano">${icon('season')}<b data-k="season"></b></span>` : ''}
        </div>
        <div class="clock"><i class="sun"></i><b class="time">00:00</b></div>
      </div>
      <div class="topbtns">
          ${s.g.realm ? `<button class="tb feudo" data-a="feudo" title="Feudo: casas, cartas, mercado, exército e dinastia">${icon('diplo')}<span>Feudo</span><em class="badge" hidden></em></button>`
            : s.g.mode === 'battle' ? '' : `<button class="tb" data-a="diplo" title="Diplomacia">${icon('diplo')}<span>Diplomacia</span></button>`}
          <button class="tb" data-a="speed" title="Velocidade da partida"><span class="spd">1×</span></button>
          <button class="tb" data-a="pause" title="Pausar (Pause)">${icon('pause')}</button>
          <button class="tb" data-a="menu" title="Menu (F10)">${icon('menu')}<span>Menu</span></button>
      </div>
      ${s.g.realm ? '<button class="quest" data-a="quest" title="Próximo título"></button>' : ''}
      <div class="toasts"></div>
      <div class="msgs"></div>
      <div class="side">
        ${s.g.mode === 'battle' ? '' : `<button class="sb build" data-a="build" title="Construir (B)">${icon('build')}<span>Construir</span></button>`}
        <button class="sb idle" data-a="idle" title="Trabalhador ocioso (.)">${icon('idle')}<b>0</b></button>
        <button class="sb army" data-a="army" title="Selecionar todo o exército">${icon('army')}<b>0</b></button>
        <div class="heroes"></div>
      </div>
      <div class="groupsbar"></div>
      <div class="hud-bottom">
        <div class="mm-wrap"><div class="mm-slot"></div></div>
        <div class="info"><div class="info-in"></div></div>
        <div class="cmds">
          <div class="form" hidden>
            <button data-f="block" title="Formação em bloco">Bloco</button><button data-f="line" title="Formação em linha">Linha</button><button data-f="column" title="Formação em coluna">Coluna</button><button data-f="loose" title="Sem formação">Solta</button>
          </div>
          <div class="grid"></div>
        </div>
      </div>
      <div class="touchbar">
        <button data-t="mm" title="Mostrar/ocultar minimapa">${icon('map')}</button>
        <button data-t="select" class="tg" title="Arrastar seleciona área">${icon('box')}</button>
      </div>
      <div class="placebar"><button data-p="ok">Construir aqui</button><button data-p="cancel">Cancelar</button></div>
      <div class="modebar"><span></span><button data-p="cancel">Cancelar</button></div>
      <div class="tooltip"></div>
      <div class="modal"></div>`;
    const q = (sel: string) => root.querySelector(sel) as HTMLElement;
    this.el = {
      top: q('.hud-top'), clock: q('.clock'), time: q('.clock .time'), sun: q('.clock .sun'), spd: q('.spd'),
      toasts: q('.toasts'), msgs: q('.msgs'), side: q('.side'), idle: q('.side .idle b'), army: q('.side .army b'), heroes: q('.side .heroes'),
      groups: q('.groupsbar'), mmSlot: q('.mm-slot'), info: q('.info-in'), grid: q('.cmds .grid'), form: q('.cmds .form'),
      tip: q('.tooltip'), modal: q('.modal'), touchbar: q('.touchbar'), placebar: q('.placebar'), modebar: q('.modebar'), bottom: q('.hud-bottom'),
    };
    for (const k of RES_KEYS) this.el['r_' + k] = q(`[data-k="${k}"]`);
    this.el.r_supply = q('[data-k="supply"]');
    this.el.r_upkeep = q('[data-k="upkeep"]');
    if (s.g.realm) {
      this.el.r_pop = q('[data-k="pop"]'); this.el.r_food = q('[data-k="food"]'); this.el.r_season = q('[data-k="season"]');
      this.el.badge = q('.tb.feudo .badge');
      this.el.quest = q('.quest');
      this.el.quest.onclick = () => this.openRealm('governo');
      root.classList.add('feudo-mode');
    }
    if (s.isTouch) root.classList.add('hide-mm');
    this.bind();
  }

  private bind() {
    const s = this.s;
    this.root.querySelector('.topbtns')!.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a;
      if (a === 'menu') this.openMenu();
      if (a === 'diplo') this.openDiplomacy();
      if (a === 'feudo') this.openRealm();
      if (a === 'pause') { s.paused = !s.paused; s.dirty = true; }
      if (a === 'speed') { const sp = [1, 1.5, 2, 3, 0.5]; s.speed = sp[(sp.indexOf(s.speed) + 1) % sp.length]; this.el.spd.textContent = s.speed + '×'; }
    });
    this.el.side.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.a === 'idle') selectIdleWorker(s);
      if (b.dataset.a === 'build') this.openBuild();
      if (b.dataset.a === 'army') { selectByClass(s, (u) => u.udef!.cls !== 'worker'); }
      if (b.dataset.hero) {
        const id = Number(b.dataset.hero);
        if (s.selection.length === 1 && s.selection[0] === id) centerOnSelection(s);
        setSelection(s, [id]);
      }
    });
    this.el.groups.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const n = Number(b.dataset.g);
      if (b.classList.contains('set')) {
        s.groups[n] = ownSelected(s).map((x) => x.id);
        this.feedback(`Grupo ${n} definido`);
        s.dirty = true;
        return;
      }
      const ids = (s.groups[n] ?? []).filter((id) => s.g.ents.get(id)?.alive);
      if (!ids.length) return;
      if (s.selection.join() === sortedJoin(s, ids)) centerOnSelection(s);
      setSelection(s, ids);
    });
    this.el.form.addEventListener('click', (e) => {
      const f = (e.target as HTMLElement).dataset.f as Formation;
      if (f) { s.formation = f; this.refreshForm(); }
    });
    this.refreshForm();
    // botões de comando
    let pressT = 0, pressTimer = 0, longFired = false;
    this.el.grid.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      pressT = performance.now();
      longFired = false;
      if (e.pointerType === 'touch') {
        pressTimer = window.setTimeout(() => {
          const btn = this.btns.find((x) => x.id === b.dataset.id);
          if (btn?.alt) { btn.alt(); longFired = true; navigator.vibrate?.(15); this.sig = ''; }
          else if (btn) { this.showTip(btn, b); longFired = true; }
        }, 500);
      }
    });
    this.el.grid.addEventListener('pointerup', () => clearTimeout(pressTimer));
    this.el.grid.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || longFired) return;
      const btn = this.btns.find((x) => x.id === b.dataset.id);
      if (!btn) return;
      if (btn.disabled) { this.feedback(btn.reason || 'Indisponível'); return; }
      btn.run();
      this.sig = '';
      void pressT;
    });
    this.el.grid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const b = (e.target as HTMLElement).closest('button');
      const btn = b && this.btns.find((x) => x.id === b.dataset.id);
      if (btn?.alt) { btn.alt(); this.sig = ''; }
    });
    this.el.grid.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || (e as PointerEvent).pointerType === 'touch') return;
      const btn = this.btns.find((x) => x.id === b.dataset.id);
      if (btn) this.showTip(btn, b);
    });
    this.el.grid.addEventListener('pointerout', () => this.hideTip());
    // painel de informação (clicar em tipos, fila, itens)
    this.el.info.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const ty = t.closest<HTMLElement>('[data-type]');
      const qi = t.closest<HTMLElement>('[data-q]');
      const it = t.closest<HTMLElement>('[data-item]');
      const cf = t.closest<HTMLElement>('[data-cls]');
      if (qi) { cancelQueue(s.g, s.pid, Number(qi.dataset.b), Number(qi.dataset.q)); this.infoSig = ''; return; }
      if (it) { useHeroItem(s.g, s.pid, Number(it.dataset.h), Number(it.dataset.item)); this.infoSig = ''; return; }
      if (cf) { this.filterClass(cf.dataset.cls!); return; }
      if (ty) {
        const type = ty.dataset.type!;
        const ids = ownSelected(s).filter((x) => x.type === type).map((x) => x.id);
        const me = e as MouseEvent;
        if (me.ctrlKey || me.metaKey || me.shiftKey) setSelection(s, s.selection.filter((id) => !ids.includes(id)));
        else if (ty.dataset.single) { setSelection(s, [Number(ty.dataset.single)]); }
        else setSelection(s, ids);
      }
    });
    this.el.info.addEventListener('pointerover', (e) => {
      const it = (e.target as HTMLElement).closest<HTMLElement>('[data-itemid]');
      if (it) {
        const d = ITEMS[it.dataset.itemid!];
        if (d) this.showTipHTML(`<b>${d.name}</b><p>${d.desc}</p>${d.kind === 'consumable' ? '<p class="hint">Clique para usar</p>' : ''}`, it);
      }
    });
    this.el.info.addEventListener('pointerout', () => this.hideTip());
    // barra de toque
    this.el.touchbar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const t = b.dataset.t;
      if (t === 'army') selectByClass(s, (u) => u.udef!.cls !== 'worker');
      if (t === 'melee') selectByClass(s, (u) => ['melee', 'cavalry'].includes(u.udef!.cls));
      if (t === 'ranged') selectByClass(s, (u) => ['ranged', 'siege', 'caster', 'air'].includes(u.udef!.cls));
      if (t === 'idle') selectIdleWorker(s);
      if (t === 'hero') { const h = s.g.units.find((u) => u.alive && u.owner === s.pid && u.isHero); if (h) { setSelection(s, [h.id]); centerOnSelection(s); } }
      if (t === 'select') { s.touchSelectMode = !s.touchSelectMode; b.classList.toggle('on', s.touchSelectMode); this.feedback(s.touchSelectMode ? 'Arrastar seleciona área' : 'Arrastar move a câmera'); }
      if (t === 'quick') { s.quickOrders = !s.quickOrders; b.classList.toggle('on', s.quickOrders); this.feedback(s.quickOrders ? 'Toque no mapa envia ordens' : 'Toque no mapa apenas seleciona'); }
      if (t === 'mm') this.root.classList.toggle('hide-mm');
      if (t === 'panel') this.root.classList.toggle('collapsed');
    });
    this.el.placebar.addEventListener('click', (e) => {
      const p = (e.target as HTMLElement).dataset.p;
      if (p === 'ok') this.input.confirmPlacement(false);
      if (p === 'cancel') this.input.endMode();
    });
    this.el.modebar.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.p === 'cancel') this.input.endMode();
    });
    this.el.toasts.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-x]');
      if (t) s.r.cam.centerOn(Number(t.dataset.x), Number(t.dataset.y));
    });
  }

  private refreshForm() {
    this.el.form.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === this.s.formation));
  }

  feedback(text: string) {
    const d = document.createElement('div');
    d.className = 'toast fb';
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 2200);
  }

  private filterClass(cls: string) {
    const s = this.s;
    const keep = ownSelected(s).filter((e) => {
      const c = e.udef?.cls;
      if (cls === 'front') return c === 'melee' || c === 'cavalry' || c === 'summon';
      if (cls === 'back') return c === 'ranged' || c === 'caster' || c === 'siege';
      return c === cls;
    });
    if (keep.length) setSelection(s, keep.map((e) => e.id));
  }

  // ------------------------------------------------------------------
  // Atualização
  // ------------------------------------------------------------------
  update(now: number) {
    const s = this.s, g = s.g;
    const p = g.players[s.pid];
    for (const k of RES_KEYS) setText(this.el['r_' + k], fmt(p.res[k]));
    setText(this.el.r_supply, `${p.supplyUsed}/${p.supplyCap}`);
    this.el.r_supply.parentElement!.classList.toggle('warn', p.supplyUsed >= p.supplyCap);
    setText(this.el.r_upkeep, p.upkeep > 0 ? `-${Math.round(p.upkeep)}/min` : '0');
    if (g.realm && this.el.r_pop && now - this.lastRealm >= 500) {
      this.lastRealm = now;
      const ri = realmHudInfo(g.realm, g);
      setText(this.el.r_pop, `${ri.pop}/${ri.housing}`);
      this.el.r_pop.parentElement!.classList.toggle('warn', ri.pop < 1);
      setText(this.el.r_food, `${fmt(ri.food)} ${ri.foodDay >= 0 ? '+' : ''}${Math.round(ri.foodDay * 12)}`);
      this.el.r_food.parentElement!.classList.toggle('warn', ri.foodDay < 0 && ri.food < 60);
      setText(this.el.r_season, ri.season);
      setText(this.el.r_upkeep, ri.wages > 0 ? `-${Math.round(ri.wages)}/min` : '0');
      this.el.r_upkeep.parentElement!.classList.toggle('on', ri.wages > 0);
      this.el.r_upkeep.parentElement!.title = 'Salários de trabalhadores e soldados (prata por minuto)';
      setText(this.el.quest, ri.quest);
      setText(this.el.badge, ri.unread ? String(ri.unread) : '');
      this.el.badge.hidden = !ri.unread;
      this.el.badge.parentElement!.classList.toggle('alarm', ri.danger);
      this.onRealmTick();
    }
    this.el.r_upkeep.parentElement!.classList.toggle('warn', p.debt > 0);
    this.el.r_upkeep.parentElement!.classList.toggle('on', p.upkeep > 0);
    const tm = Math.floor(g.time);
    setText(this.el.time, `${String(Math.floor(tm / 60)).padStart(2, '0')}:${String(tm % 60).padStart(2, '0')}`);
    const ph = g.dayPhase();
    this.el.sun.style.transform = `rotate(${ph * 360}deg)`;
    this.el.clock.classList.toggle('isnight', g.isNight());
    this.root.classList.toggle('paused', s.paused);
    // alertas
    for (const a of g.alerts) {
      if (this.alertSeen.has(a)) continue;
      this.alertSeen.add(a);
      if (a.owner !== s.pid) continue;
      s.lastAlert = { x: a.x, y: a.y };
      const d = document.createElement('div');
      d.className = `toast ${a.kind}`;
      d.dataset.x = String(a.x); d.dataset.y = String(a.y);
      d.textContent = a.text;
      this.el.toasts.appendChild(d);
      setTimeout(() => d.remove(), 4500);
      while (this.el.toasts.children.length > 5) this.el.toasts.firstElementChild?.remove();
    }
    for (const m of g.messages) {
      if (this.msgSeen.has(m)) continue;
      this.msgSeen.add(m);
      if (m.owner !== s.pid) continue;
      const d = document.createElement('div');
      d.className = 'msg';
      d.textContent = m.text;
      if (m.color) d.style.color = m.color;
      this.el.msgs.appendChild(d);
      setTimeout(() => d.remove(), 7000);
      while (this.el.msgs.children.length > 6) this.el.msgs.firstElementChild?.remove();
    }
    // propostas de diplomacia recebidas
    if (!g.realm && g.proposals.some((x) => x.to === s.pid) && !this.root.querySelector('.modal.open')) this.openDiplomacy();

    if (now - this.lastFull < 120 && !s.dirty) return;
    this.lastFull = now;
    s.dirty = false;
    s.selection = s.selection.filter((id) => { const e = g.ents.get(id); return e?.alive && (e.owner === s.pid || g.canSee(s.pid, e)); });
    s.r.selected = new Set(s.selection);
    this.updateSide();
    this.updateInfo();
    this.updateCommands();
    const touchMode = s.mode.k === 'build' && s.isTouch;
    this.el.placebar.classList.toggle('on', touchMode);
    const showMode = s.mode.k !== 'none' && s.mode.k !== 'build';
    this.el.modebar.classList.toggle('on', showMode);
    if (showMode) setText(this.el.modebar.firstElementChild as HTMLElement, modeText(s));
  }

  private updateSide() {
    const s = this.s, g = s.g;
    const idle = g.units.filter((u) => u.alive && u.owner === s.pid && u.isWorker && !u.order && !u.inside).length;
    setText(this.el.idle, String(idle));
    this.el.idle.parentElement!.classList.toggle('has', idle > 0);
    const army = g.units.filter((u) => u.alive && u.owner === s.pid && u.udef!.cls !== 'worker').length;
    setText(this.el.army, String(army));
    this.el.army.parentElement!.classList.toggle('has', army > 0);
    const heroes = g.units.filter((u) => u.alive && u.owner === s.pid && u.isHero);
    const hsig = heroes.map((h) => `${h.id}:${h.level}:${Math.round((h.hp / h.maxHp) * 20)}:${h.skillPts}`).join('|');
    if (this.el.heroes.dataset.sig !== hsig) {
      this.el.heroes.dataset.sig = hsig;
      this.el.heroes.innerHTML = heroes.map((h) => `<button class="sb hero-b" data-hero="${h.id}" title="${h.udef!.name} (F1)">${portraitHTML(h.type, s.g.players[s.pid].color)}<i class="hbar"><b style="transform:scaleX(${h.hp / h.maxHp})"></b></i><em>${h.level}</em>${h.skillPts ? '<u>+</u>' : ''}</button>`).join('');
    }
    let gh = '';
    for (let n = 1; n <= 9; n++) {
      const ids = (s.groups[n] ?? []).filter((id) => g.ents.get(id)?.alive);
      if (!ids.length) continue;
      gh += `<button data-g="${n}" class="${ids.length ? '' : 'empty'}">${n}<b>${ids.length || ''}</b></button>`;
    }
    if (this.el.groups.dataset.sig !== gh) { this.el.groups.dataset.sig = gh; this.el.groups.innerHTML = gh; }
  }

  // ------------------------------------------------------------------
  private updateInfo() {
    const s = this.s, g = s.g;
    const sel = selected(s);
    const color = g.players[s.pid].color;
    this.root.classList.toggle('nosel', !sel.length);
    if (!sel.length) {
      if (this.infoSig !== '') { this.infoSig = ''; this.el.info.innerHTML = ''; }
      return;
    }
    if (sel.length === 1) {
      const e = sel[0];
      const html = this.singleInfo(e, color);
      if (html !== this.infoSig) { this.infoSig = html; this.el.info.innerHTML = html; }
      return;
    }
    // múltipla seleção: uma fileira de retratos com a contagem por tipo (toque = só esse tipo)
    const groups = new Map<string, Entity[]>();
    for (const e of sel) { if (!groups.has(e.type)) groups.set(e.type, []); groups.get(e.type)!.push(e); }
    let tiles = '';
    for (const [type, es] of groups) {
      const name = UNITS[type]?.name ?? BUILDINGS[type]?.name ?? type;
      const own = es[0].owner === s.pid;
      tiles += `<button class="ut ${s.subgroup === type ? 'act' : ''}" data-type="${type}" title="${name} — toque: selecionar só este tipo">${portraitHTML(type, own ? color : g.players[es[0].owner]?.color ?? '#999')}<em>${es.length}</em></button>`;
    }
    const html = `<div class="multi"><div class="tiles">${tiles}</div></div>`;
    if (html !== this.infoSig) { this.infoSig = html; this.el.info.innerHTML = html; }
  }

  private singleInfo(e: Entity, color: string): string {
    const s = this.s, g = s.g;
    const own = e.owner === s.pid;
    const pc = g.players[e.owner]?.color ?? (e.owner === 8 ? '#8a7a66' : '#c9b48a');
    const owner = g.players[e.owner]?.name ?? (e.owner === 8 ? 'Criaturas neutras' : e.owner === 9 ? 'Neutro' : '');
    if (e.kind === 'mine' || e.kind === 'crystal') {
      return `<div class="single"><div class="por res-por ${e.kind}"></div><div class="det"><h3>${e.kind === 'mine' ? 'Veio de Prata' : 'Cristal de Éter'}</h3><p class="sub">Jazida</p><p class="big">${fmt(e.amount)} <small>${e.kind === 'mine' ? 'prata' : 'éter'} restantes</small></p><p class="hint">${e.extractor ? 'Extrator instalado.' : 'Trabalhadores coletam com clique direito.'}</p></div></div>`;
    }
    if (e.kind === 'item' || e.kind === 'chest') {
      const d = ITEMS[e.itemId];
      return `<div class="single"><div class="por">${icon(e.kind === 'chest' ? 'chest' : d?.icon ?? 'item')}</div><div class="det"><h3>${e.kind === 'chest' ? 'Baú de Tesouro' : d?.name}</h3><p>${e.kind === 'chest' ? 'Toque com qualquer unidade para abrir.' : d?.desc}</p><p class="hint">${e.kind === 'item' ? 'Clique direito com um herói para pegar.' : ''}</p></div></div>`;
    }
    // vida/mana em passos de 5%: o cartão só é redesenhado quando a barra muda de verdade
    const step = (v: number) => (Math.round(v * 20) / 20).toFixed(2);
    const hpLine = `<div class="bars"><div class="bar hp"><b style="transform:scaleX(${step(e.hp / e.maxHp)})" class="${e.hp / e.maxHp < 0.35 ? 'lo' : ''}"></b></div>${e.maxMana > 0 ? `<div class="bar mp"><b style="transform:scaleX(${step(e.mana / e.maxMana)})"></b></div>` : ''}</div>`;
    if (e.kind === 'unit') {
      const d = e.udef!;
      const a = d.attack;
      const dmgBase = a ? `${Math.round(a.dmg[0] + (d.hero ? (e.level - 1) * d.hero.dmgPerLvl : 0))}–${Math.round(a.dmg[1] + (d.hero ? (e.level - 1) * d.hero.dmgPerLvl : 0))}` : '—';
      const stats = `<div class="stats">
        ${a ? `<span title="Dano (${DMG_NAMES[a.type]})">${icon('sword')}${dmgBase}</span>` : ''}
        <span title="Armadura (${ARMOR_NAMES[d.armorType]})">${icon('shield')}${getArmor(g, e).toFixed(1)}</span>
        ${a ? `<span title="Alcance">${icon('range')}${getRange(g, e).toFixed(1)}</span>` : ''}
        <span title="Velocidade">${icon('boots')}${getSpeed(g, e).toFixed(1)}</span>
        ${e.carry ? `<span title="Carregando">${icon(e.carry)}${e.carryAmt}</span>` : ''}
      </div>`;
      let hero = '';
      if (d.hero) {
        const next = XP_TABLE[e.level] ?? XP_TABLE[XP_TABLE.length - 1];
        const prev = XP_TABLE[e.level - 1] ?? 0;
        const xpP = e.level >= 10 ? 1 : (e.xp - prev) / (next - prev);
        hero = `<div class="xp"><b style="transform:scaleX(${xpP.toFixed(3)})"></b><span>Nível ${e.level} · ${d.hero.title}</span></div>`;
        hero += `<div class="inv">${e.items.map((it, i) => `<button class="slot ${it ? 'full' : ''}" ${it && own ? `data-item="${i}" data-h="${e.id}"` : ''} ${it ? `data-itemid="${it}"` : ''}>${it ? icon(ITEMS[it].icon) : ''}</button>`).join('')}</div>`;
      }
      const ord = e.order ? orderText(e) : e.targetId ? 'Combatendo' : 'Aguardando ordens';
      const buffs = e.buffs.filter((b) => !b.id.startsWith('a_') || b.armor || b.dmgMul || b.atkMul || b.regen).map((b) => `<i class="bf" title="${buffName(b.id)}">${buffName(b.id)}</i>`).join('');
      void stats; void ord; void buffs; // detalhes ficam fora do cartão compacto
      const person = e.personId && g.realm ? g.realm.persons[e.personId] : null;
      const title = person ? `${person.name} <small>${d.hero?.title ?? d.name}</small>` : d.name;
      return `<div class="single"><div class="por" style="--tc:${pc}">${portraitHTML(e.type, pc)}</div><div class="det"><h3>${title}${own ? '' : ` <small>${owner}</small>`}</h3>${hpLine}${hero}</div></div>`;
    }
    // edifício
    const d = e.bdef!;
    let extra = '';
    if (!e.built) extra = `<div class="bar prog"><b style="transform:scaleX(${step(e.progress)})"></b><span>Construindo ${Math.floor(e.progress * 20) * 5}%</span></div>`;
    else if (e.bqueue.length && own) {
      extra = `<div class="queue">${e.bqueue.map((q, i) => {
        const name = q.kind === 'research' ? RESEARCHES[q.id].name : q.kind === 'upgrade' ? BUILDINGS[q.id].name : UNITS[q.id].name;
        const ic = q.kind === 'unit' || q.kind === 'revive' ? portraitHTML(q.id, color) : icon(q.kind === 'research' ? RESEARCHES[q.id].icon : 'upgrade');
        const active = i < (d.parallel ?? 1);
        return `<button class="qi ${active ? 'act' : ''}" data-q="${i}" data-b="${e.id}" title="${name} — clique para cancelar">${ic}${active ? `<i class="qp"><b style="transform:scaleX(${step(q.t / q.total)})"></b></i>` : ''}</button>`;
      }).join('')}</div>`;
      const first = e.bqueue[0];
      if (first.kind === 'unit' && first.t === 0 && g.supplyFree(s.pid) < UNITS[first.id].supply) extra += `<p class="warn">Abastecimento insuficiente — construa mais ${BUILDINGS[FACTIONS[g.players[s.pid].faction].houses].name.toLowerCase()}s.</p>`;
    }
    let st = `<div class="stats"><span title="Armadura (Fortificada)">${icon('shield')}${getArmor(g, e).toFixed(0)}</span>`;
    if (d.attack) st += `<span title="Dano">${icon('sword')}${d.attack.dmg[0]}–${d.attack.dmg[1]}</span><span title="Alcance">${icon('range')}${d.attack.range}</span>`;
    if (d.supply) st += `<span title="Abastecimento">${icon('supply')}+${d.supply}</span>`;
    if (d.aetherPerMin) st += `<span title="Éter por minuto">${icon('aether')}+${d.aetherPerMin}/min</span>`;
    st += '</div>';
    void st;
    return `<div class="single"><div class="por bpor" style="--tc:${pc}">${portraitHTML(e.type, pc)}</div><div class="det"><h3>${d.name}${own ? '' : ` <small>${owner}</small>`}</h3>${hpLine}${extra}</div></div>`;
  }

  // ------------------------------------------------------------------
  private updateCommands() {
    const s = this.s;
    this.btns = this.computeButtons();
    const sig = this.btns.map((b) => `${b.id}${b.disabled ? 0 : 1}${b.active ? 1 : 0}${b.auto ? 1 : 0}${b.badge ?? ''}`).join('|') + this.page + s.mode.k;
    if (sig === this.sig) return;
    this.sig = sig;
    const cards = this.page === 'build' || this.page === 'build2';
    this.root.classList.toggle('bmenu', cards);
    this.el.grid.classList.toggle('cards', cards);
    if (cards) {
      // menu de construção: cartões com a arte do prédio, nome e custo
      const res = s.g.players[s.pid].res;
      this.el.grid.innerHTML = this.btns.map((b) => {
        if (b.id === 'back') return `<button data-id="back" class="bc back">${icon('back')}<b>Voltar</b></button>`;
        const type = b.id.slice(2);
        const a = buildingAtlas(type);
        const art = a ? `<i class="bimg" style="background-image:url('${a.url}');background-size:${a.cols * 100}% ${a.rows * 100}%;background-position:${atlasPosition(a, 2)}"></i>` : `<i class="bimg alt">${b.icon}</i>`;
        const cost = RES_KEYS.filter((k) => b.cost?.[k]).map((k) => `<span class="${res[k] < (b.cost![k] ?? 0) ? 'no' : ''}">${icon(k)}${b.cost![k]}</span>`).join('');
        const why = b.disabled && b.reason && !b.reason.startsWith('Recursos') ? `<small class="why">${b.reason.replace('Requer: ', 'Requer ')}</small>` : '';
        return `<button data-id="${b.id}" class="bc ${b.disabled ? 'dis' : ''}">${art}<b>${b.label}</b><span class="cost">${cost}</span>${why}</button>`;
      }).join('');
    } else
    this.el.grid.innerHTML = this.btns.map((b) => `<button data-id="${b.id}" class="cb ${b.disabled ? 'dis' : ''} ${b.active ? 'act' : ''} ${b.auto ? 'auto' : ''}">${b.icon}<kbd>${b.key}</kbd>${b.badge ? `<em>${b.badge}</em>` : ''}<span class="lbl">${b.label}</span></button>`).join('');
    const own = ownSelected(s);
    this.el.form.hidden = s.isTouch || !(own.filter((e) => e.kind === 'unit' && !e.isWorker).length > 1);
    this.root.classList.toggle('nocmd', !this.btns.length);
  }

  /** Abre o menu de construção com um trabalhador (o selecionado, um ocioso ou o mais próximo). */
  openBuild() {
    const s = this.s, g = s.g;
    let w = ownSelected(s).find((e) => e.isWorker);
    if (!w) {
      const [cx, cy] = s.r.cam.center();
      const ws = g.units.filter((u) => u.alive && u.owner === s.pid && u.isWorker);
      const idle = ws.filter((u) => !u.order && !u.inside);
      const pool = idle.length ? idle : ws.filter((u) => !u.inside).length ? ws.filter((u) => !u.inside) : ws;
      w = pool.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
    }
    if (!w) { this.feedback('Sem trabalhadores: treine um no paço.'); return; }
    setSelection(s, [w.id]);
    this.page = 'build';
    this.sig = '';
    s.dirty = true;
  }

  hotkey(key: string): boolean {
    const k = key.toUpperCase();
    const b = this.btns.find((x) => x.key === k);
    if (!b && k === 'B' && this.page !== 'build') { this.openBuild(); return true; }
    if (!b) return false;
    if (b.disabled) { this.feedback(b.reason || 'Indisponível'); return true; }
    b.run();
    this.sig = '';
    this.s.dirty = true;
    return true;
  }

  private computeButtons(): Btn[] {
    const s = this.s, g = s.g;
    const own = ownSelected(s);
    if (!own.length) {
      // acampamento mercenário selecionado
      const sel = selected(s)[0];
      if (sel?.bdef?.hires) {
        return sel.bdef.hires.map((u, i) => ({
          id: 'hire:' + u, label: UNITS[u].name, key: 'QWE'[i], icon: portraitHTML(u, g.players[s.pid].color), cost: UNITS[u].cost,
          desc: `Contratar ${UNITS[u].name}. Requer uma unidade sua próxima ao acampamento.`, run: () => hire(g, s.pid, sel.id, u),
        }));
      }
      this.page = 'main';
      return [];
    }
    const sub = own.filter((e) => e.type === s.subgroup);
    const active = sub.length ? sub : own;
    const lead = active[0];
    const ids = own.map((e) => e.id);
    const unitIds = own.filter((e) => e.kind === 'unit').map((e) => e.id);
    const out: Btn[] = [];
    if (lead.kind === 'building') return this.buildingButtons(active, lead);
    const d = lead.udef!;
    const worker = lead.isWorker;
    const p = g.players[s.pid];
    if (this.page === 'build' || this.page === 'build2') {
      const list = d.builds ?? [];
      list.forEach((bid, i) => {
        const bd = BUILDINGS[bid];
        const miss = g.missingReqs(s.pid, bd.requires);
        out.push({
          id: 'b:' + bid, label: bd.name, key: 'QWERASDFZXCV'[i] ?? '', icon: portraitHTML(bid, p.color), cost: bd.cost, desc: bd.desc,
          disabled: miss.length > 0 || !g.canAfford(s.pid, bd.cost), reason: miss.length ? 'Requer: ' + miss.join(', ') : 'Recursos insuficientes',
          run: () => { s.mode = { k: 'build', type: bid }; this.page = 'main'; if (s.isTouch) { const [cx, cy] = s.r.cam.center(); this.input.updatePlacement(cx, cy); } },
        });
      });
      out.push({ id: 'back', label: 'Voltar', key: 'ESCAPE', icon: icon('back'), run: () => { this.page = 'main'; } });
      return out;
    }
    if (this.page === 'learn' && d.hero) {
      d.hero.abilities.forEach((ab, i) => {
        const a = ABILITIES[ab];
        const lvl = lead.skills[ab] ?? 0;
        out.push({
          id: 'l:' + ab, label: a.name, key: 'QWER'[i], icon: icon(a.icon), badge: `${lvl}/${a.levels}`,
          desc: a.desc + (a.ultimate ? ' (Suprema — nível 6)' : ''), disabled: !canLearn(lead, ab), reason: 'Indisponível neste nível',
          run: () => { learn(g, s.pid, lead.id, ab); if (lead.skillPts <= 0) this.page = 'main'; },
        });
      });
      out.push({ id: 'back', label: 'Voltar', key: 'ESCAPE', icon: icon('back'), run: () => { this.page = 'main'; } });
      return out;
    }
    if (this.page === 'shop') {
      const shop = nearestShop(g, lead, 'sells');
      if (!shop) { this.page = 'main'; }
      else {
        shop.bdef!.sells!.forEach((it, i) => {
          const def = ITEMS[it];
          out.push({ id: 'buy:' + it, label: def.name, key: 'QWERAS'[i], icon: icon(def.icon), cost: { silver: def.cost }, desc: def.desc, disabled: !g.canAfford(s.pid, { silver: def.cost }) || !lead.items.includes(null), reason: 'Prata ou espaço insuficiente', run: () => buyHeroItem(g, s.pid, lead.id, it) });
        });
        out.push({ id: 'back', label: 'Voltar', key: 'ESCAPE', icon: icon('back'), run: () => { this.page = 'main'; } });
        return out;
      }
    }
    this.page = 'main';
    const mode = s.mode.k;
    const full = !s.isTouch; // no celular tocar no mapa já move/ataca/coleta; o resto fica no teclado
    if (full) out.push({ id: 'move', label: 'Mover', key: 'M', icon: icon('move'), active: mode === 'move', desc: 'Move as unidades (sem reagir a inimigos).', run: () => { s.mode = { k: 'move' }; } });
    out.push({ id: 'stop', label: 'Parar', key: 'S', icon: icon('stop'), desc: 'Interrompe todas as ordens.', run: () => issueStop(g, s.pid, unitIds) });
    if (full) out.push({ id: 'hold', label: 'Manter posição', key: 'H', icon: icon('hold'), desc: 'Não abandona a posição para perseguir inimigos.', run: () => issueHold(g, s.pid, unitIds, this.input.shift) });
    if (own.some((e) => e.udef?.attack)) out.push({ id: 'amove', label: 'Atacar', key: 'A', icon: icon('attack'), active: mode === 'amove', desc: 'Ataca um alvo ou avança atacando o que encontrar.', run: () => { s.mode = { k: 'amove' }; } });
    if (full) out.push({ id: 'patrol', label: 'Patrulhar', key: 'P', icon: icon('patrol'), active: mode === 'patrol', desc: 'Patrulha entre a posição atual e o destino.', run: () => { s.mode = { k: 'patrol' }; } });
    if (full && (!worker || own.some((e) => !e.isWorker))) {
      out.push({ id: 'guard', label: 'Defender região', key: 'G', icon: icon('guard'), active: mode === 'guard', desc: 'Defende uma área: ataca invasores e retorna.', run: () => { s.mode = { k: 'guard' }; } });
      out.push({ id: 'retreat', label: 'Recuar', key: 'X', icon: icon('retreat'), desc: 'Retirada organizada até o centro mais próximo, sem revidar.', run: () => issueRetreat(g, s.pid, unitIds) });
    }
    if (worker) {
      out.push({ id: 'build', label: 'Construir', key: 'B', icon: icon('build'), desc: 'Abre o menu de construção.', run: () => { this.page = 'build'; } });
      if (own.some((e) => e.carry)) out.push({ id: 'ret', label: 'Entregar carga', key: 'C', icon: icon('deliver'), desc: 'Leva a carga ao depósito mais próximo.', run: () => issueReturn(g, s.pid, unitIds) });
    }
    // habilidades
    const abs = d.hero ? d.hero.abilities : d.abilities ?? [];
    for (const ab of abs) {
      const a = ABILITIES[ab];
      if (a.kind === 'passive' || a.kind === 'aura') {
        const lvl = skillLevel(lead, ab);
        if (d.hero && !lvl) continue;
        out.push({ id: 'pa:' + ab, label: a.name, key: '', icon: icon(a.icon), badge: d.hero ? String(lvl) : '', desc: a.desc + ' (passiva)', disabled: true, reason: 'Habilidade passiva', run: () => {} });
        continue;
      }
      const lvl = skillLevel(lead, ab);
      if (d.hero && !lvl) continue;
      const casters = active.filter((u) => canCast(g, u, ab).ok);
      const chk = canCast(g, lead, ab);
      const cd = lead.cds[ab] ?? 0;
      out.push({
        id: 'ab:' + ab, label: a.name, key: a.hotkey, icon: icon(a.icon), badge: cd > 0 ? String(Math.ceil(cd)) : d.hero ? String(lvl) : '',
        desc: `${a.desc} Mana: ${a.mana[Math.max(0, lvl - 1)]}. Recarga: ${a.cd[Math.max(0, lvl - 1)]}s.${a.kind === 'autocast' ? ' Clique direito (ou toque longo) alterna o uso automático.' : ''}`,
        disabled: !casters.length, reason: chk.reason, active: s.mode.k === 'cast' && s.mode.ability === ab, auto: a.kind === 'autocast' && !!lead.autocast[ab],
        run: () => {
          if (a.target === 'none') issueCast(g, s.pid, active.map((u) => u.id), ab);
          else s.mode = { k: 'cast', ability: ab };
        },
        alt: a.kind === 'autocast' ? () => toggleAutocast(g, s.pid, active.map((u) => u.id), ab) : undefined,
      });
    }
    if (d.hero && own.length === 1) {
      if (lead.skillPts > 0) out.push({ id: 'learn', label: 'Aprender habilidade', key: 'O', icon: icon('learn'), badge: String(lead.skillPts), desc: 'Gaste pontos de habilidade.', run: () => { this.page = 'learn'; } });
      if (nearestShop(g, lead, 'sells')) out.push({ id: 'shop', label: 'Mercado', key: 'K', icon: icon('shop'), desc: 'Comprar itens no mercado próximo.', run: () => { this.page = 'shop'; } });
    }
    void ids;
    return out;
  }

  private buildingButtons(active: Entity[], lead: Entity): Btn[] {
    const s = this.s, g = s.g;
    const d = lead.bdef!;
    const p = g.players[s.pid];
    const out: Btn[] = [];
    const used = new Set(['ESCAPE', 'Y']);
    const keyFor = (name: string) => {
      for (const ch of name.toUpperCase().replace(/[^A-Z]/g, '')) if (!used.has(ch)) { used.add(ch); return ch; }
      for (const ch of 'QWERTASDFGZXCV') if (!used.has(ch)) { used.add(ch); return ch; }
      return '';
    };
    if (!lead.built) {
      out.push({ id: 'cancelc', label: 'Cancelar construção', key: 'ESCAPE', icon: icon('cancel'), desc: 'Devolve 75% do custo.', run: () => cancelConstruction(g, s.pid, lead.id) });
      return out;
    }
    // treinar: distribui entre as estruturas selecionadas (ordens simultâneas)
    const pickB = (unit: string) => {
      const cands = active.filter((b) => b.bdef!.trains?.includes(unit) && canTrain(g, s.pid, b, unit).ok);
      cands.sort((a, b) => a.bqueue.length - b.bqueue.length);
      return cands[0];
    };
    for (const u of d.trains ?? []) {
      const ud = UNITS[u];
      const c = canTrain(g, s.pid, lead, u);
      const queued = active.reduce((n, b) => n + b.bqueue.filter((q) => q.id === u).length, 0);
      out.push({
        id: 't:' + u, label: ud.name, key: keyFor(ud.name), icon: portraitHTML(u, p.color), cost: ud.cost, badge: queued ? String(queued) : '',
        desc: `${ud.desc} (${CLASS_NAMES[ud.cls]}, ${ud.supply} abast., ${Math.round(ud.time * FACTIONS[p.faction].trainMul)}s)`,
        disabled: !c.ok && !active.some((b) => canTrain(g, s.pid, b, u).ok), reason: c.reason,
        run: () => {
          const n = this.input.shift ? 5 : 1;
          for (let i = 0; i < n; i++) { const b = pickB(u); if (b) train(g, s.pid, b.id, u); }
        },
      });
    }
    // reviver heróis
    if (d.heroRevive) {
      for (const [hid, rec] of g.heroRecords) {
        if (rec.owner !== s.pid) continue;
        const cost = reviveCost(rec.level, rec.type);
        out.push({ id: 'rv:' + hid, label: `Reviver ${UNITS[rec.type].name}`, key: keyFor('V'), icon: portraitHTML(rec.type, p.color), cost, desc: `Restaura o herói no nível ${rec.level}, com itens e habilidades.`, disabled: !g.canAfford(s.pid, cost), reason: 'Recursos insuficientes', run: () => revive(g, s.pid, lead.id, hid) });
      }
    }
    for (const rid of d.researches ?? []) {
      const r = RESEARCHES[rid];
      if (p.upgrades[rid]) continue;
      const c = canResearch(g, s.pid, lead, rid);
      out.push({ id: 'r:' + rid, label: r.name, key: keyFor(r.name), icon: icon(r.icon), cost: r.cost, desc: r.desc, disabled: !c.ok, reason: c.reason, run: () => research(g, s.pid, lead.id, rid) });
    }
    if (d.upgradesTo) {
      const nd = BUILDINGS[d.upgradesTo];
      const c = canUpgrade(g, s.pid, lead);
      out.push({ id: 'up', label: `Evoluir: ${nd.name}`, key: 'U', icon: icon('upgrade'), cost: nd.cost, desc: nd.desc + ' Libera novas unidades, edifícios e pesquisas.', disabled: !c.ok, reason: c.reason, run: () => upgrade(g, s.pid, lead.id) });
    }
    if (d.trains?.length || d.cat === 'hall') out.push({ id: 'rally', label: 'Ponto de reunião', key: 'Y', icon: icon('rally'), active: s.mode.k === 'rally', desc: 'Define para onde as novas unidades vão. Clique numa mina para mandar trabalhadores coletarem.', run: () => { s.mode = { k: 'rally' }; } });
    return out;
  }

  // ------------------------------------------------------------------
  private showTip(b: Btn, anchor: HTMLElement) {
    const costs = b.cost ? `<div class="cost">${RES_KEYS.filter((k) => b.cost![k]).map((k) => `<span class="${this.s.g.players[this.s.pid].res[k] < (b.cost![k] ?? 0) ? 'no' : ''}">${icon(k)}${b.cost![k]}</span>`).join('')}</div>` : '';
    this.showTipHTML(`<b>${b.label}</b>${b.key && b.key !== 'ESCAPE' ? ` <kbd>${b.key}</kbd>` : ''}${costs}${b.desc ? `<p>${b.desc}</p>` : ''}${b.disabled && b.reason ? `<p class="no">${b.reason}</p>` : ''}`, anchor);
  }
  private showTipHTML(html: string, anchor: HTMLElement) {
    const t = this.el.tip;
    t.innerHTML = html;
    t.style.display = 'block';
    const r = anchor.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    t.style.left = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2)) + 'px';
    t.style.top = Math.max(6, r.top - th - 8) + 'px';
  }
  hideTip() { this.el.tip.style.display = 'none'; }

  // ------------------------------------------------------------------
  // Janelas
  // ------------------------------------------------------------------
  openModal(html: string, onClick: (a: string, el: HTMLElement) => void) {
    const m = this.el.modal;
    m.innerHTML = `<div class="dlg frame">${html}</div>`;
    m.classList.add('open');
    m.onclick = (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (t) onClick(t.dataset.a!, t);
    };
  }
  closeModal() {
    this.el.modal.classList.remove('open');
    this.el.modal.innerHTML = '';
  }

  openMenu: () => void = () => {};
  openDiplomacy: () => void = () => {};
  openRealm: (tab?: 'governo') => void = () => {};
  onRealmTick: () => void = () => {};
}

function setText(el: HTMLElement, t: string) {
  if (el.textContent !== t) el.textContent = t;
}

function sortedJoin(s: Session, ids: number[]): string {
  return [...ids].join();
}

function modeText(s: Session): string {
  switch (s.mode.k) {
    case 'move': return 'Escolha o destino';
    case 'amove': return 'Escolha alvo ou destino do ataque';
    case 'patrol': return 'Escolha o ponto de patrulha';
    case 'guard': return 'Escolha a região a defender';
    case 'rally': return 'Escolha o ponto de reunião';
    case 'cast': return `${ABILITIES[s.mode.ability].name}: escolha o alvo`;
  }
  return '';
}

function orderText(e: Entity): string {
  const o = e.order!;
  switch (o.t) {
    case 'move': return 'Movendo';
    case 'retreat': return 'Recuando';
    case 'amove': return e.targetId ? 'Combatendo' : 'Avançando em ataque';
    case 'attack': return 'Atacando alvo';
    case 'hold': return 'Mantendo posição';
    case 'patrol': return 'Patrulhando';
    case 'guard': return 'Defendendo região';
    case 'follow': return 'Seguindo';
    case 'gather': return e.inside ? 'Minerando' : o.tile !== undefined ? (e.carry ? 'Levando madeira' : 'Cortando madeira') : e.carry ? 'Levando carga' : 'Indo coletar';
    case 'return': return 'Entregando carga';
    case 'build': return o.site ? 'Construindo' : 'Indo construir';
    case 'repair': return 'Reparando';
    case 'cast': return 'Lançando habilidade';
    case 'pickup': return 'Pegando item';
  }
  return '';
}

function buffName(id: string): string {
  const n: Record<string, string> = {
    stun: 'Atordoado', slow: 'Lento', dust: 'Pó sonolento', root: 'Enraizado', avante: 'Avante!', bless: 'Bênção', bloodfury: 'Fúria',
    ashveil: 'Cinzas', avatar: 'Avatar', a_bastion: 'Bastião', a_warcry: 'Brado', a_dew: 'Orvalho', a_plating: 'Blindagem', a_drums: 'Tambores', a_spring: 'Fonte',
  };
  return n[id] ?? id;
}

export { icon };
