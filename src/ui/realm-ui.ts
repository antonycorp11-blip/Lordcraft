import { UNITS } from '../data/factions';
import type { Session } from './session';
import type { Hud } from './hud';
import { age, atWar, avgLegit, clamp, dateText, houseName, isAbove, lordOf, player, provincesUnder, route, secsToDays } from '../realm/core';
import { DAY_SECS, SEASON_NAMES } from '../realm/data';
import { childrenOf, family, marriageable, successionLine } from '../realm/dynasty';
import { LETTER_INFO, answerLetter, daysLeft, sendLetter, travelTo, unread } from '../realm/letters';
import { ESCORT_COST, ESCORT_PROTECT, buyCost, caravanPos, price, sellValue } from '../realm/market';
import { GUILD, TAX_NAMES, home, provinceStats } from '../realm/province';
import { LAW_INFO, advance, appoint, councilCandidates, hasTitle, nextStep, votes } from '../realm/titles';
import { armyDays, armyPos, armyPower, autoResolve, formArmy, playerPower } from '../realm/war';
import { addOrder, buyDebt, debtPrice, localBuy, localSell, playerCaravan } from '../realm/actions';
import { COUNCIL_INFO, GOODS, GOOD_NAMES, PERSONALITY_INFO, TITLE_NAMES, type CouncilSeat, type Crest, type Good, type House, type LetterKind, type Person, type Realm } from '../realm/types';
import { seasonLabel } from '../realm/tick';

// Tela do feudo: mapa estratégico, casas nobres, cartas, mercado, exército, dinastia,
// governo e crônica. Abre por cima do mapa da província e pausa o tempo enquanto aberta.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n0 = (v: number) => Math.round(v).toLocaleString('pt-BR');

export function crestHTML(c: Crest, cls = ''): string {
  return `<i class="crest cp-${c.pattern} ${cls}" style="--c1:${c.c1};--c2:${c.c2}"><b>${c.charge}︎</b></i>`;
}

type Tab = 'mapa' | 'casas' | 'cartas' | 'mercado' | 'exercito' | 'dinastia' | 'governo' | 'cronica';
const TABS: [Tab, string][] = [
  ['mapa', 'Mapa'], ['casas', 'Casas'], ['cartas', 'Cartas'], ['mercado', 'Mercado'], ['exercito', 'Exército'],
  ['dinastia', 'Dinastia'], ['governo', 'Governo'], ['cronica', 'Crônica'],
];

export interface RealmHost {
  startBattle(armyId: number): void;
  feedback(text: string): void;
  gameOver(kind: 'extinta' | 'rei'): void;
}

export class RealmUI {
  s: Session;
  hud: Hud;
  host: RealmHost;
  el: HTMLElement;
  tab: Tab = 'mapa';
  sel = '';                 // província ou casa selecionada
  armyPick: Record<string, number> = {};
  marketDest = '';
  marketGood: Good = 'wood';
  open = false;
  private wasPaused = false;
  private seenEvents = new Set<number>();

  constructor(s: Session, hud: Hud, host: RealmHost) {
    this.s = s;
    this.hud = hud;
    this.host = host;
    this.el = document.createElement('div');
    this.el.className = 'realm';
    this.el.hidden = true;
    hud.root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('change', (e) => this.change(e));
    for (const ev of this.r.events) this.seenEvents.add(ev.id);
  }

  get r(): Realm { return this.s.g.realm!; }

  show(tab?: Tab, sel?: string) {
    if (tab) this.tab = tab;
    if (sel !== undefined) this.sel = sel;
    if (!this.open) { this.wasPaused = this.s.paused; this.s.paused = true; }
    this.open = true;
    this.el.hidden = false;
    this.hud.hideTip();
    this.render();
  }
  close() {
    this.open = false;
    this.el.hidden = true;
    this.el.innerHTML = '';
    this.s.paused = this.wasPaused;
    this.s.dirty = true;
  }

  // ------------------------------------------------------------------
  // Eventos do reino que pedem atenção (batalhas, sucessão, vitória...)
  // ------------------------------------------------------------------
  update() {
    const r = this.r;
    for (const ev of r.events) {
      if (this.seenEvents.has(ev.id)) continue;
      this.seenEvents.add(ev.id);
      if (ev.kind === 'battle') { this.show('exercito'); this.host.feedback('Seu exército chegou ao destino. Escolha como lutar.'); }
      if (ev.kind === 'succession') this.host.feedback(`${r.persons[Number(ev.data.person)]?.name} é o novo senhor da casa.`);
      if (ev.kind === 'victory') this.host.gameOver('rei');
      if (ev.kind === 'gameover') this.host.gameOver('extinta');
      if (ev.kind === 'assembly') this.show('governo');
    }
    if (r.events.length > 30) r.events.splice(0, r.events.length - 30);
  }

  // ------------------------------------------------------------------
  // Desenho
  // ------------------------------------------------------------------
  render() {
    if (!this.open) return;
    const r = this.r, pl = player(r), lord = lordOf(r, pl);
    const un = unread(r);
    const body = ({
      mapa: () => this.mapTab(), casas: () => this.housesTab(), cartas: () => this.lettersTab(), mercado: () => this.marketTab(),
      exercito: () => this.armyTab(), dinastia: () => this.dynastyTab(), governo: () => this.govTab(), cronica: () => this.chronicleTab(),
    } as Record<Tab, () => string>)[this.tab]();
    const scroll = this.el.querySelector('.realm-body')?.scrollTop ?? 0;
    this.el.innerHTML = `<div class="realm-win">
      <header class="realm-head">${crestHTML(pl.crest, 'big')}<div><h2>Casa ${esc(pl.name)}</h2><p>${esc(lord?.name ?? '')}, ${TITLE_NAMES[pl.title]} de ${esc(home(r).name)} · ${dateText(r)}</p></div><button class="realm-x" data-r="close" aria-label="Fechar">✕</button></header>
      <nav class="realm-tabs">${TABS.map(([k, n]) => `<button data-tab="${k}" class="${k === this.tab ? 'on' : ''}">${n}${k === 'cartas' && un ? `<em>${un}</em>` : ''}</button>`).join('')}</nav>
      <div class="realm-body">${body}</div>
    </div>`;
    const b = this.el.querySelector('.realm-body');
    if (b && this.tab !== 'cartas') b.scrollTop = scroll;
  }

  private relChip(h: House): string {
    const r = this.r;
    if (h.id === r.player) return '<span class="chip me">Você</span>';
    if (h.liege === r.player) return '<span class="chip vas">Vassalo</span>';
    if (isAbove(r, h.id, r.player)) return '<span class="chip lord">Suserano</span>';
    if (atWar(r, h.id, r.player)) return '<span class="chip war">Guerra</span>';
    if (h.rel[r.player] === 'ally') return '<span class="chip ally">Aliado</span>';
    return '<span class="chip">Neutro</span>';
  }

  private fuzzy(v: number): string {
    if (this.r.council.espiao) return n0(v);
    const step = v > 2000 ? 500 : 200;
    return `~${n0(Math.round(v / step) * step)}`;
  }

  // ---------- Mapa ----------
  private mapTab(): string {
    const r = this.r;
    const roads = r.roads.map((x) => {
      const a = r.provinces[x.a], b = r.provinces[x.b];
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${x.danger >= 0.09 ? 'danger' : ''}"/>`;
    }).join('');
    const labels = r.roads.map((x) => {
      const a = r.provinces[x.a], b = r.provinces[x.b];
      return `<span class="rd" style="left:${(a.x + b.x) / 2}%;top:${(a.y + b.y) / 2}%">${x.days}d</span>`;
    }).join('');
    const nodes = Object.values(r.provinces).map((p) => {
      const h = r.houses[p.owner];
      return `<button class="prov ${p.id === this.sel ? 'sel' : ''} ${p.owner === r.player ? 'mine' : ''}" data-prov="${p.id}" style="left:${p.x}%;top:${p.y}%">${crestHTML(h.crest)}<span>${esc(p.name)}</span>${this.relChip(h)}</button>`;
    }).join('');
    const tokens = [
      ...r.caravans.map((c) => { const q = caravanPos(r, c); return `<i class="tok car ${c.owner === r.player ? 'mine' : ''}" style="left:${q.x}%;top:${q.y}%" title="Caravana"></i>`; }),
      ...r.armies.map((a) => { const q = armyPos(r, a); return `<i class="tok army ${a.owner === r.player ? 'mine' : a.target === home(r).id ? 'foe' : ''}" style="left:${q.x}%;top:${q.y}%;--hc:${r.houses[a.owner]?.crest.c1}" title="Exército da ${esc(houseName(r, a.owner))}"></i>`; }),
      ...r.letters.filter((l) => !l.delivered && (l.from === r.player || l.to === r.player)).map((l) => {
        const from = r.provinces[r.houses[l.from].province], to = r.provinces[r.houses[l.to].province];
        const t = clamp((r.time - l.sentAt) / Math.max(1, l.arriveAt - l.sentAt), 0, 1);
        return `<i class="tok letter" style="left:${from.x + (to.x - from.x) * t}%;top:${from.y + (to.y - from.y) * t}%" title="Mensageiro"></i>`;
      }),
    ].join('');
    return `<div class="fmap"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${roads}</svg>${labels}${tokens}${nodes}</div>
      <p class="hint legend"><i class="tok car mine"></i> caravana <i class="tok army mine"></i> seu exército <i class="tok army foe"></i> inimigo <i class="tok letter"></i> mensageiro · estradas tracejadas são perigosas</p>
      ${this.sel ? this.provPanel(this.sel) : '<p class="hint">Toque numa província para ver quem a governa e agir.</p>'}`;
  }

  private provPanel(id: string): string {
    const r = this.r;
    const p = r.provinces[id];
    if (!p) return '';
    const h = r.houses[p.owner];
    const mine = p.owner === r.player;
    const rt = route(r, home(r).id, id);
    const best = GOODS.map((g) => `${GOOD_NAMES[g]} ${price(p.market, g).toFixed(1)}`).join(' · ');
    return `<section class="card">
      <div class="card-h">${crestHTML(h.crest)}<div><h3>${esc(p.name)}</h3><p class="hint">${esc(p.desc)}</p></div></div>
      <p>Governada pela <b>${esc(houseName(r, h.id))}</b> ${this.relChip(h)} · população ${this.fuzzy(p.pop)} · ${mine ? 'sua sede' : `${rt.days} dias de estrada`}</p>
      <p class="hint">Preços: ${best}</p>
      <div class="acts">${mine ? '<button data-tab="governo">Governar</button><button data-tab="mercado">Mercado</button>'
        : `<button data-house="${h.id}">Casa ${esc(h.name)}</button><button data-r="caravan" data-prov="${id}">Enviar caravana</button><button data-r="march" data-prov="${id}">Marchar exército</button>`}</div>
    </section>`;
  }

  // ---------- Casas ----------
  private housesTab(): string {
    const r = this.r;
    const list = Object.values(r.houses).filter((h) => h.id !== r.player).sort((a, b) => (b.alive ? 1 : 0) - (a.alive ? 1 : 0));
    return list.map((h) => this.houseCard(h)).join('');
  }

  private bar(label: string, v: number, min: number, max: number, cls: string): string {
    const f = (v - min) / (max - min);
    return `<div class="obar ${cls}"><span>${label}</span><i><b style="width:${Math.round(clamp(f, 0, 1) * 100)}%"></b></i><em>${Math.round(v)}</em></div>`;
  }

  private houseCard(h: House): string {
    const r = this.r;
    const lord = lordOf(r, h);
    const open = this.sel === h.id;
    if (!h.alive) return `<section class="card dead"><div class="card-h">${crestHTML(h.crest)}<div><h3>Casa ${esc(h.name)}</h3><p class="hint">Extinta.</p></div></div></section>`;
    const liege = h.liege ? `vassala da ${esc(houseName(r, h.liege))}` : 'sem suserano';
    let more = '';
    if (open) {
      const mem = r.memories.filter((m) => m.house === h.id).slice(-5).reverse()
        .map((m) => `<li class="${m.trust < 0 ? 'neg' : 'pos'}">${esc(m.text)} <small>${m.trust > 0 ? '+' : ''}${Math.round(m.trust)}</small></li>`).join('');
      const debtsTo = r.debts.filter((d) => d.debtor === h.id);
      const debtsMine = r.debts.filter((d) => d.debtor === r.player && d.creditor === h.id);
      more = `<div class="hmore">
        <p class="hint">${PERSONALITY_INFO[h.personality]}</p>
        <p class="hint">Exército ${this.fuzzy(h.army)} · Tesouro ${this.fuzzy(h.treasury)} · ${travelTo(r, h.id)} dias de mensageiro${h.pact ? ' · pacto comercial' : ''}${h.casusBelli ? ' · <b class="warn">você tem motivo justo para guerra</b>' : ''}</p>
        ${debtsTo.length ? `<p class="hint">Dívidas: ${debtsTo.map((d) => `${n0(d.amount)} com ${d.creditor === r.player ? '<b>você</b>' : d.creditor === GUILD ? 'a Guilda' : esc(houseName(r, d.creditor))}${r.time > d.due ? ' (vencida)' : ''}`).join(', ')}</p>` : ''}
        ${mem ? `<ul class="mem">${mem}</ul>` : ''}
        <div class="acts">${this.letterButtons(h, debtsTo.filter((d) => d.creditor === r.player), debtsMine)}</div>
      </div>`;
    }
    return `<section class="card ${open ? 'open' : ''}">
      <button class="card-h" data-house="${h.id}">${crestHTML(h.crest)}<div><h3>Casa ${esc(h.name)} ${this.relChip(h)}</h3><p class="hint">${esc(lord?.name ?? '?')}, ${TITLE_NAMES[h.title]} · ${lord ? age(r, lord) : '?'} anos · ${liege}</p><p class="motto">“${esc(h.motto)}”</p></div></button>
      <div class="obars">${this.bar('Confiança', h.op.trust, -100, 100, 'trust')}${this.bar('Medo', h.op.fear, 0, 100, 'fear')}${this.bar('Legitimidade', h.op.legit, 0, 100, 'legit')}</div>
      ${more}
    </section>`;
  }

  private letterButtons(h: House, owedToMe: { id: number; amount: number; due: number }[], iOwe: { id: number; amount: number }[]): string {
    const r = this.r;
    const war = atWar(r, h.id, r.player);
    const vassal = h.liege === r.player;
    const btn = (k: LetterKind, extra = '', label = LETTER_INFO[k]!.name) => `<button data-letter="${k}" data-house="${h.id}" ${extra} title="${esc(LETTER_INFO[k]!.desc)}">${label}</button>`;
    const out: string[] = [];
    out.push(btn('presente', 'data-silver="100"', 'Presente (100)'));
    out.push(btn('presente', 'data-silver="300"', 'Presente (300)'));
    if (war) out.push(btn('paz'));
    else {
      if (h.rel[r.player] !== 'ally') out.push(btn('alianca'));
      if (!h.pact) out.push(btn('comercio'));
      out.push(btn('emprestimo'));
      if (!vassal && h.id !== r.crown && !isAbove(r, h.id, r.player)) out.push(btn('vassalagem'));
      out.push(btn('ameaca'));
      if (!vassal) out.push(btn('guerra', 'class="danger"'));
    }
    for (const d of owedToMe) if (r.time > d.due) out.push(btn('cobrar', `data-debt="${d.id}"`, `Cobrar ${n0(d.amount)}`));
    for (const d of iOwe) out.push(btn('pagar', `data-debt="${d.id}"`, `Pagar ${n0(d.amount)}`));
    // casamento
    const theirs = marriageable(r, h.id).filter((p) => p.id !== h.lord);
    const mine = marriageable(r, r.player);
    if (theirs.length && mine.length && !war) {
      out.push(`<span class="wed"><select data-wed="mine">${mine.map((p) => `<option value="${p.id}">${esc(p.name)} (${age(r, p)})${p.id === player(r).lord ? ' — você' : p.sworn ? ' — jurado' : ''}</option>`).join('')}</select>×<select data-wed="theirs">${theirs.map((p) => `<option value="${p.id}">${esc(p.name)} (${age(r, p)})</option>`).join('')}</select><button data-r="wed" data-house="${h.id}">Propor casamento</button></span>`);
    }
    return out.join('');
  }

  // ---------- Cartas ----------
  private lettersTab(): string {
    const r = this.r;
    const inbox = r.letters.filter((l) => l.to === r.player && l.delivered).slice().reverse();
    const transit = r.letters.filter((l) => !l.delivered && (l.from === r.player || l.to === r.player));
    const html = inbox.map((l) => {
      const h = r.houses[l.from];
      const wasUnread = !l.read;
      l.read = true;
      const actions = l.ask && !l.answered ? `<div class="acts"><button class="primary" data-ans="1" data-id="${l.id}">Aceitar</button><button data-ans="0" data-id="${l.id}">Recusar</button></div>` : l.ask ? '<p class="hint">Respondida.</p>' : '';
      const result = l.kind === 'resposta' ? `<span class="chip ${l.accepted ? 'ally' : 'war'}">${l.accepted ? 'Aceito' : 'Recusado'}</span>` : '';
      return `<section class="card letter ${wasUnread ? 'new' : ''}"><div class="card-h">${crestHTML(h.crest)}<div><h3>Casa ${esc(h.name)} ${result}</h3><p class="hint">${dateText(r, l.arriveAt)}</p></div></div><p class="ltext">${esc(l.text)}</p>${actions}</section>`;
    }).join('');
    const tr = transit.map((l) => `<li>${l.from === r.player ? `Seu mensageiro → ${esc(houseName(r, l.to))}` : `Mensageiro da ${esc(houseName(r, l.from))}`}: ${l.from === r.player ? esc(LETTER_INFO[l.kind]?.name ?? l.kind) : 'a caminho'} · ${daysLeft(r, l)} dias</li>`).join('');
    return `${tr ? `<section class="card"><h3>Mensageiros na estrada</h3><ul class="plain">${tr}</ul></section>` : ''}${html || '<p class="hint">Nenhuma carta ainda. Escreva às casas na aba Casas.</p>'}`;
  }

  // ---------- Mercado ----------
  private marketTab(): string {
    const r = this.r, g = this.s.g, pl = g.players[0];
    const m = home(r).market;
    const have = (k: Good) => (k === 'food' ? home(r).food : pl.res[k]);
    const rows = GOODS.map((k) => `<tr><td>${GOOD_NAMES[k]}</td><td>${n0(have(k))}</td><td>${price(m, k).toFixed(2)}</td><td>${n0(m.stock[k])}</td>
      <td class="acts"><button data-sell="${k}" data-q="10">Vender 10 <small>+${sellValue(m, k, 10)}</small></button><button data-sell="${k}" data-q="50">50 <small>+${sellValue(m, k, 50)}</small></button><button data-buy="${k}" data-q="10">Comprar 10 <small>-${buyCost(m, k, 10)}</small></button><button data-buy="${k}" data-q="50">50 <small>-${buyCost(m, k, 50)}</small></button></td></tr>`).join('');
    const orders = r.orders.map((o) => `<li>Vender ${o.qty} de ${GOOD_NAMES[o.good].toLowerCase()} quando o preço passar de ${o.min} <button data-delorder="${o.id}">Cancelar</button></li>`).join('');
    // comparativo de preços
    const provs = Object.values(r.provinces);
    const cmp = `<table class="tbl cmp"><tr><th>Mercado</th>${GOODS.map((k) => `<th>${GOOD_NAMES[k]}</th>`).join('')}<th>Dias</th></tr>${provs.map((p) => {
      const owner = r.houses[p.owner];
      return `<tr class="${p.owner === r.player ? 'mine' : atWar(r, owner.id, r.player) ? 'warrow' : ''}"><td>${esc(p.name)}</td>${GOODS.map((k) => `<td>${price(p.market, k).toFixed(1)}</td>`).join('')}<td>${p.owner === r.player ? '—' : route(r, home(r).id, p.id).days}</td></tr>`;
    }).join('')}</table>`;
    const dests = provs.filter((p) => p.owner !== r.player);
    if (!this.marketDest || !r.provinces[this.marketDest] || r.provinces[this.marketDest].owner === r.player) this.marketDest = dests[0]?.id ?? '';
    const dest = r.provinces[this.marketDest];
    const rt = dest ? route(r, home(r).id, dest.id) : { days: 0, path: [] };
    const danger = rt.path.slice(1).reduce((s, id, i) => s + (r.roads.find((x) => (x.a === rt.path[i] && x.b === id) || (x.b === rt.path[i] && x.a === id))?.danger ?? 0), 0);
    const car = dest ? `<section class="card"><h3>Caravana</h3>
      <div class="form-row"><label>Destino<select data-mk="dest">${dests.map((p) => `<option value="${p.id}" ${p.id === this.marketDest ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Carga<select data-mk="good">${GOODS.map((k) => `<option value="${k}" ${k === this.marketGood ? 'selected' : ''}>${GOOD_NAMES[k]} (lá ${price(dest.market, k).toFixed(1)})</option>`).join('')}</select></label>
      <label>Quantidade<input data-mk="qty" type="number" min="1" step="10" value="${Math.max(10, Math.min(200, Math.floor(have(this.marketGood) / 10) * 10))}"></label>
      <label>Escolta<select data-mk="escort">${[0, 1, 2].map((e) => `<option value="${e}">${['Nenhuma', 'Leve', 'Pesada'][e]}${ESCORT_COST[e] ? ` (${ESCORT_COST[e]} prata)` : ''}</option>`).join('')}</select></label></div>
      <p class="hint">${rt.days} dias até lá (e a volta). Risco de emboscada na rota: ${Math.round(danger * 100)}% sem escolta${ESCORT_PROTECT[1] ? `, ${Math.round(danger * (1 - ESCORT_PROTECT[1]) * 100)}% com escolta leve` : ''}. Casas em guerra com você atacam caravanas.</p>
      <button class="primary" data-r="sendcar">Enviar caravana</button></section>` : '';
    const caravans = r.caravans.filter((c) => c.owner === r.player).map((c) => `<li>${c.returning ? `Voltando de ${esc(r.provinces[c.dest].name)} com ${n0(c.silver)} de prata` : `Levando ${c.qty} de ${GOOD_NAMES[c.good].toLowerCase()} a ${esc(r.provinces[c.dest].name)}`}</li>`).join('');
    const guild = r.debts.filter((d) => d.creditor === GUILD).map((d) => `<li>${esc(houseName(r, d.debtor))} deve ${n0(d.amount)} (${r.time > d.due ? 'vencida' : `vence em ${secsToDays(d.due - r.time)} dias`}) <button data-debtbuy="${d.id}">Comprar por ${n0(debtPrice(r, d.amount, d.due))}</button></li>`).join('');
    return `<section class="card"><h3>Mercado de ${esc(home(r).name)}</h3><table class="tbl"><tr><th>Mercadoria</th><th>Você tem</th><th>Preço</th><th>Estoque</th><th></th></tr>${rows}</table>
      <p class="hint">Vender derruba o preço; comprar faz subir. A cada dia o mercado se recompõe.${r.laws.trade ? ' Lei protecionista: +8% nas suas vendas.' : ''}</p></section>
      <section class="card"><h3>Ordens de venda</h3><div class="form-row"><label>Mercadoria<select data-ord="good">${GOODS.map((k) => `<option value="${k}">${GOOD_NAMES[k]}</option>`).join('')}</select></label><label>Quantidade<input data-ord="qty" type="number" value="100" min="10" step="10"></label><label>Preço mínimo<input data-ord="min" type="number" value="${(price(m, 'wood') * 1.2).toFixed(1)}" step="0.1"></label></div><button data-r="order">Criar ordem</button>${orders ? `<ul class="plain">${orders}</ul>` : ''}<p class="hint">O mercado vende até 10 por dia quando o preço chega ao mínimo.</p></section>
      ${car}${caravans ? `<section class="card"><h3>Suas caravanas</h3><ul class="plain">${caravans}</ul></section>` : ''}
      <section class="card"><h3>Preços no reino</h3>${cmp}</section>
      <section class="card"><h3>Dívidas à venda na Guilda de Lume</h3>${guild ? `<ul class="plain">${guild}</ul><p class="hint">Compre a dívida de uma casa: se ela não pagar no prazo, cobre por carta — sem dinheiro, ela pode jurar vassalagem a você (precisa ser Lorde).</p>` : '<p class="hint">Nenhuma casa está endividada com a guilda agora.</p>'}</section>`;
  }

  // ---------- Exército ----------
  private armyTab(): string {
    const r = this.r, g = this.s.g;
    const groups = new Map<string, number>();
    for (const u of g.units) if (u.alive && u.owner === 0 && u.udef!.cls !== 'worker' && u.udef!.cls !== 'summon') groups.set(u.type, (groups.get(u.type) ?? 0) + 1);
    for (const k of Object.keys(this.armyPick)) if (!groups.has(k)) delete this.armyPick[k];
    const picks = [...groups].map(([t, n]) => {
      const v = clamp(this.armyPick[t] ?? n, 0, n);
      this.armyPick[t] = v;
      return `<div class="pick"><span>${esc(UNITS[t].name)}</span><button data-pick="${t}" data-d="-1">−</button><b>${v}/${n}</b><button data-pick="${t}" data-d="1">+</button></div>`;
    }).join('');
    const targets = Object.values(r.provinces).filter((p) => p.owner !== r.player);
    if (!this.sel || !r.provinces[this.sel] || r.provinces[this.sel].owner === r.player) this.sel = targets.find((p) => atWar(r, p.owner, r.player))?.id ?? targets[0]?.id ?? '';
    const tgt = r.provinces[this.sel];
    const foeH = tgt ? r.houses[tgt.owner] : null;
    const myArmies = r.armies.filter((a) => a.owner === r.player).map((a) => {
      const t = r.provinces[a.target];
      const waiting = a.waiting ? `<div class="acts"><button class="primary" data-battle="${a.id}">Comandar a batalha</button><button data-auto="${a.id}">Resolver (rápido)</button><button data-retreat="${a.id}">Recuar</button></div><p class="hint">Comandar: você controla as tropas no mapa de ${esc(t.name)} e precisa destruir a sede da casa. Resolver: o resultado sai na hora, com sorte e perdas.</p>` : '';
      const left = Math.ceil((a.path.length - 1 - a.seg - a.t) * 6);
      return `<li class="card"><b>${a.units.length} unidades</b> · poder ${n0(armyPower(a))} · ${a.intent === 'return' ? 'voltando para casa' : a.waiting ? `às portas de ${esc(t.name)}` : `marchando para ${esc(t.name)} (~${left} dias)`}${waiting}</li>`;
    }).join('');
    const foes = r.armies.filter((a) => a.owner !== r.player && a.target === home(r).id && a.intent !== 'return').map((a) => {
      const left = Math.max(0, Math.ceil((a.path.length - 1 - a.seg - a.t) * 7));
      return `<li>${crestHTML(r.houses[a.owner].crest)} Exército da ${esc(houseName(r, a.owner))} (poder ${this.fuzzy(a.power)}) chega em ~${left} dias</li>`;
    }).join('');
    const myPow = playerPower(g, r);
    return `${foes ? `<section class="card alert"><h3>Inimigos a caminho</h3><ul class="plain">${foes}</ul><p class="hint">Quando chegam, invadem o mapa da sua província. Prepare torres e soldados.</p></section>` : ''}
      ${myArmies ? `<ul class="plain">${myArmies}</ul>` : ''}
      <section class="card"><h3>Formar exército</h3>${picks || '<p class="hint">Nenhum soldado na província. Treine tropas no quartel.</p>'}
      ${picks ? `<div class="form-row"><label>Destino<select data-army="target">${targets.map((p) => `<option value="${p.id}" ${p.id === this.sel ? 'selected' : ''}>${esc(p.name)} — ${esc(houseName(r, p.owner))}${atWar(r, p.owner, r.player) ? ' (guerra)' : ''}</option>`).join('')}</select></label></div>
      ${tgt && foeH ? `<p class="hint">${armyDays(r, home(r).id, tgt.id)} dias de marcha. Defesa estimada: ${this.fuzzy(foeH.army * 0.75 * 1.25)}. Seu poder total: ${n0(myPow)}. ${atWar(r, foeH.id, r.player) ? '' : '<b class="warn">Você não está em guerra com esta casa: declare guerra por carta antes, ou o exército voltará.</b>'}</p>` : ''}
      <button class="primary" data-r="march">Marchar</button>` : ''}
      <p class="hint">As tropas saem do mapa da província enquanto marcham (e deixam de defendê-la). Soldos continuam sendo pagos.</p></section>`;
  }

  // ---------- Dinastia ----------
  private dynastyTab(): string {
    const r = this.r, pl = player(r), lord = lordOf(r, pl);
    const person = (p: Person, role: string) => `<li class="person ${p.female ? 'f' : 'm'} ${p.alive ? '' : 'dead'}"><b>${esc(p.name)}</b> <small>${role} · ${age(r, p)} anos · ${esc(p.trait)}${p.spouse && r.persons[p.spouse] ? ` · casado(a) com ${esc(r.persons[p.spouse].name)}${r.persons[p.spouse].house !== r.player ? ` (${esc(houseName(r, r.persons[p.spouse].house))})` : ''}` : ''}${p.alive ? '' : ` · morreu ${esc(p.cause ?? '')}`}</small></li>`;
    const spouse = lord?.spouse ? r.persons[lord.spouse] : null;
    const kids = lord ? childrenOf(r, lord.id) : [];
    const fam = family(r, pl.id).filter((p) => p.id !== lord?.id && p.id !== spouse?.id && !kids.includes(p));
    const line = successionLine(r, pl);
    const heirSel = `<select data-heir>${[`<option value="0">Primogenitura (automático)</option>`, ...line.map((p) => `<option value="${p.id}" ${r.heir === p.id ? 'selected' : ''}>${esc(p.name)} (${age(r, p)})${p.sworn ? ' — jurado' : ''}</option>`)].join('')}</select>`;
    return `<section class="card"><h3>Senhor da casa</h3><ul class="plain">${lord ? person(lord, TITLE_NAMES[pl.title]) : ''}${spouse ? person(spouse, 'cônjuge') : '<li class="hint">Solteiro(a). Proponha casamento a outra casa na aba Casas: une as famílias e cria aliados.</li>'}</ul></section>
      <section class="card"><h3>Filhos</h3>${kids.length ? `<ul class="plain">${kids.map((k) => person(k, k.female ? 'filha' : 'filho')).join('')}</ul>` : '<p class="hint">Nenhum filho ainda. Casais têm filhos com o passar das estações.</p>'}</section>
      ${fam.length ? `<section class="card"><h3>Família e jurados</h3><ul class="plain">${fam.map((p) => person(p, p.sworn ? 'herói jurado' : 'parente')).join('')}</ul><p class="hint">Heróis treinados juram lealdade e passam a ser membros da casa: podem casar, ocupar o conselho e, sem herdeiros de sangue, herdar.</p></section>` : ''}
      <section class="card"><h3>Sucessão</h3>${line.length ? `<ol class="plain">${line.slice(0, 5).map((p) => `<li>${esc(p.name)} <small>${age(r, p)} anos${p.sworn ? ' · jurado' : ''}</small></li>`).join('')}</ol>` : '<p class="warn">Sem herdeiros! Se o senhor morrer, a casa acaba e a partida termina.</p>'}
        <label>Herdeiro designado ${heirSel}</label><p class="hint">O senhor envelhece um ano a cada quatro estações (10 minutos).</p></section>`;
  }

  // ---------- Governo ----------
  private govTab(): string {
    const r = this.r, g = this.s.g, pl = player(r);
    const p = home(r);
    const st = provinceStats(g, r);
    const step = nextStep(g, r);
    const per = (v: number) => `${v >= 0 ? '+' : ''}${(v * (60 / DAY_SECS)).toFixed(0)}/min`;
    const b = r.lastBudget;
    const budget = b ? `<table class="tbl"><tr><td>Impostos</td><td>+${n0(b.taxes)}</td></tr><tr><td>Vendas e caravanas</td><td>+${n0(b.sales)}</td></tr><tr><td>Tributo dos vassalos</td><td>+${n0(b.tributeIn)}</td></tr><tr><td>Salários</td><td>-${n0(b.salaries)}</td></tr><tr><td>Tributo ao suserano</td><td>-${n0(b.tributeOut)}</td></tr><tr><td>Juros</td><td>-${n0(b.interest)}</td></tr><tr><td>Compras no mercado</td><td>-${n0(b.purchases)}</td></tr></table>` : '<p class="hint">O primeiro balanço sai no fim desta estação.</p>';
    const laws = (Object.keys(LAW_INFO) as (keyof typeof LAW_INFO)[]).map((k) => {
      const L = LAW_INFO[k];
      const ok = hasTitle(r, L.min);
      return `<label>${L.name}<select data-law="${k}" ${ok ? '' : 'disabled'}>${L.opts.map((o, i) => `<option value="${i}" ${r.laws[k] === i ? 'selected' : ''}>${o}</option>`).join('')}</select><small>${ok ? L.desc : `Requer ${TITLE_NAMES[L.min]}.`}</small></label>`;
    }).join('');
    const cands = councilCandidates(r);
    const council = hasTitle(r, 'graolorde') ? (Object.keys(COUNCIL_INFO) as CouncilSeat[]).map((k) => `<label>${COUNCIL_INFO[k].name}<select data-seat="${k}"><option value="0">— vago —</option>${cands.map((c) => `<option value="${c.id}" ${r.council[k] === c.id ? 'selected' : ''}>${esc(c.name)}${c.house !== r.player ? ` (${esc(houseName(r, c.house))})` : ''}</option>`).join('')}</select><small>${COUNCIL_INFO[k].desc}</small></label>`).join('') : '<p class="hint">O conselho abre quando você for Grão-lorde.</p>';
    const vass = Object.values(r.houses).filter((h) => h.alive && h.liege === r.player);
    const v = votes(r);
    return `<section class="card"><h3>${esc(p.name)}</h3><div class="stats-grid">
        <div><span>População</span><b>${Math.floor(p.pop)} / ${st.housing}</b><small>casas abrigam 8, a sede 20</small></div>
        <div><span>Comida</span><b>${n0(p.food)}</b><small>${per(st.foodDay)} · ${SEASON_NAMES[Math.floor(r.time / 150) % 4]}</small></div>
        <div><span>Segurança</span><b>${Math.round(p.security)}</b><small>soldados, torres, sem feras por perto</small></div>
        <div><span>Contentamento</span><b>${Math.round(p.content)}</b><small>impostos, comida, segurança</small></div>
        <div><span>Impostos</span><b>${per(st.taxDay)}</b><small>${TAX_NAMES[r.laws.tax].toLowerCase()}</small></div>
        <div><span>Salários</span><b>${per(-st.wagesDay)}</b><small>${st.workers} trabalhadores · ${st.soldiers} soldados</small></div>
      </div><p class="hint">Cada unidade treinada sai da população civil. Sem comida o povo foge; com fome e impostos altos, revolta.</p></section>
      <section class="card title-card"><h3>${TITLE_NAMES[pl.title]} ${step.next ? `→ ${step.name}` : ''}</h3><p class="hint">${esc(step.how)}</p>
        ${step.reqs.length ? `<ul class="reqs">${step.reqs.map((q) => `<li class="${q.ok ? 'ok' : ''}">${esc(q.text)}</li>`).join('')}</ul>` : ''}
        ${step.next ? `<button class="primary" data-r="advance" ${step.reqs.every((q) => q.ok) ? '' : 'disabled'}>${step.action === 'pedir' ? 'Pedir investidura (500)' : step.action === 'assembleia' ? 'Convocar a Assembleia' : `Proclamar-se ${step.name}`}</button>` : ''}
        <p class="hint">Províncias sob sua bandeira: ${provincesUnder(r, r.player)} · legitimidade média ${Math.round(avgLegit(r))}${r.assemblyAt ? ` · assembleia em ${secsToDays(r.assemblyAt - r.time)} dias (votos hoje: ${v.mine.length + 1} a favor, ${v.theirs.length} contra)` : ''}</p></section>
      <section class="card"><h3>Balanço da última estação</h3>${budget}</section>
      <section class="card"><h3>Leis</h3><div class="form-row laws">${laws}</div></section>
      <section class="card"><h3>Conselho</h3><div class="form-row laws">${council}</div></section>
      <section class="card"><h3>Vassalos</h3>${vass.length ? `<ul class="plain">${vass.map((h) => `<li>${crestHTML(h.crest)} Casa ${esc(h.name)} · ${esc(r.provinces[h.province].name)} · confiança ${Math.round(h.op.trust)}${h.op.trust < -30 ? ' <b class="warn">pode se rebelar</b>' : ''}</li>`).join('')}</ul>` : '<p class="hint">Nenhum vassalo. Vença guerras, compre dívidas ou exija submissão por carta (como Lorde).</p>'}</section>`;
  }

  private chronicleTab(): string {
    const r = this.r;
    return `<ul class="chron">${r.chronicle.slice().reverse().map((c) => `<li class="k-${c.kind}"><small>${SEASON_NAMES[c.season]} de ${c.year}</small>${esc(c.text)}</li>`).join('') || '<li>A história da sua casa começa agora.</li>'}</ul>`;
  }

  // ------------------------------------------------------------------
  // Cliques
  // ------------------------------------------------------------------
  private say(t: string) { if (t) this.host.feedback(t); }

  private click(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!t || t.disabled) return;
    const r = this.r, g = this.s.g, d = t.dataset;
    if (d.r === 'close') { this.close(); return; }
    if (d.tab) { this.tab = d.tab as Tab; this.render(); return; }
    if (d.letter) {
      const data: Record<string, number | string> = {};
      if (d.silver) data.silver = Number(d.silver);
      if (d.debt) data.debt = Number(d.debt);
      this.say(sendLetter(g, r, d.house!, d.letter as LetterKind, data));
      this.render();
      return;
    }
    if (d.r === 'wed') {
      const box = t.closest('.wed')!;
      const mine = Number(box.querySelector<HTMLSelectElement>('[data-wed=mine]')!.value), theirs = Number(box.querySelector<HTMLSelectElement>('[data-wed=theirs]')!.value);
      this.say(sendLetter(g, r, d.house!, 'casamento', { mine, theirs }));
      this.render();
      return;
    }
    if (d.house && !d.letter) { this.sel = this.tab === 'casas' && this.sel === d.house ? '' : d.house; this.tab = 'casas'; this.render(); return; }
    if (d.prov && !d.r) { this.sel = d.prov; this.render(); return; }
    if (d.r === 'caravan') { this.tab = 'mercado'; this.marketDest = d.prov!; this.render(); return; }
    if (d.r === 'march' && d.prov) { this.tab = 'exercito'; this.sel = d.prov; this.render(); return; }
    if (d.ans) { this.say(answerLetter(g, r, Number(d.id), d.ans === '1')); this.render(); return; }
    if (d.sell) { this.say(localSell(g, r, d.sell as Good, Number(d.q))); this.render(); return; }
    if (d.buy) { this.say(localBuy(g, r, d.buy as Good, Number(d.q))); this.render(); return; }
    if (d.delorder) { r.orders = r.orders.filter((o) => o.id !== Number(d.delorder)); this.render(); return; }
    if (d.debtbuy) { this.say(buyDebt(g, r, Number(d.debtbuy))); this.render(); return; }
    if (d.r === 'order') {
      const q = (k: string) => this.el.querySelector<HTMLInputElement>(`[data-ord=${k}]`)!.value;
      addOrder(r, q('good') as Good, Math.max(1, Number(q('qty'))), Number(q('min')));
      this.say('Ordem criada.');
      this.render();
      return;
    }
    if (d.r === 'sendcar') {
      const q = (k: string) => this.el.querySelector<HTMLInputElement>(`[data-mk=${k}]`)!.value;
      this.say(playerCaravan(g, r, q('dest'), q('good') as Good, Number(q('qty')), Number(q('escort'))));
      this.render();
      return;
    }
    if (d.pick) { this.armyPick[d.pick] = (this.armyPick[d.pick] ?? 0) + Number(d.d); this.render(); return; }
    if (d.r === 'march') {
      const ids: number[] = [];
      const want = { ...this.armyPick };
      for (const u of g.units) {
        if (!u.alive || u.owner !== 0 || !(want[u.type] > 0)) continue;
        ids.push(u.id);
        want[u.type]--;
      }
      if (!ids.length) { this.say('Escolha ao menos uma unidade.'); return; }
      const a = formArmy(g, r, ids, this.sel);
      this.s.selection = this.s.selection.filter((id) => g.ents.get(id)?.alive);
      this.say(a ? `Exército em marcha: ${armyDays(r, home(r).id, this.sel)} dias até ${r.provinces[this.sel].name}.` : 'Não foi possível formar o exército.');
      this.armyPick = {};
      this.render();
      return;
    }
    if (d.battle) { this.close(); this.host.startBattle(Number(d.battle)); return; }
    if (d.auto) {
      const a = r.armies.find((x) => x.id === Number(d.auto));
      if (a) this.say(autoResolve(r, a).text);
      this.render();
      return;
    }
    if (d.retreat) {
      const a = r.armies.find((x) => x.id === Number(d.retreat));
      if (a) { a.waiting = false; a.intent = 'return'; const rt = route(r, a.target, home(r).id); a.path = rt.path; a.seg = 0; a.t = 0; a.target = home(r).id; }
      this.render();
      return;
    }
    if (d.r === 'advance') { this.say(advance(g, r)); this.render(); return; }
  }

  private change(e: Event) {
    const t = e.target as HTMLSelectElement;
    const r = this.r, d = t.dataset;
    if (d.law) { (r.laws as unknown as Record<string, number>)[d.law] = Number(t.value); this.render(); }
    if (d.seat) { appoint(r, d.seat as CouncilSeat, Number(t.value)); this.render(); }
    if (d.heir !== undefined) { r.heir = Number(t.value); }
    if (d.mk === 'dest') { this.marketDest = t.value; this.render(); }
    if (d.mk === 'good') { this.marketGood = t.value as Good; this.render(); }
    if (d.army === 'target') { this.sel = t.value; this.render(); }
  }
}

/** Resumo para o HUD (botão do feudo e barra de recursos). */
export function realmHudInfo(r: Realm, g: Session['g']) {
  const p = home(r);
  const st = provinceStats(g, r);
  const step = nextStep(g, r);
  const quest = step.next ? `Rumo a ${step.name} ${step.reqs.filter((q) => q.ok).length}/${step.reqs.length}` : 'Rei de Aldaris';
  return {
    pop: Math.floor(p.pop), housing: st.housing, food: Math.floor(p.food), foodDay: st.foodDay, season: seasonLabel(r), unread: unread(r),
    wages: st.wagesDay * (60 / DAY_SECS), quest,
    danger: r.armies.some((a) => a.owner !== r.player && a.target === p.id && a.intent !== 'return') || !!r.raid,
  };
}
