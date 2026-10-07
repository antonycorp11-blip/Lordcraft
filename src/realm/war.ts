import { UNITS } from '../data/factions';
import type { Game } from '../sim/game';
import { issueMove } from '../sim/commands';
import { clamp, houseName, log, nid, player, realmOf, remember, roll, route, rumor, setRel, vassalsOf } from './core';
import type { Army, ArmyUnit, House, Realm } from './types';

// Exércitos que marcham pelas estradas, batalhas (comandadas no mapa ou resolvidas),
// saques à província do jogador e conquista com vassalagem.

export const RAIDER = 1;            // jogador reservado no mapa da província para invasores
const ARMY_DAYS_MUL = 1.4;          // exércitos são mais lentos que mensageiros
const RAID_SECS = 240;

export function unitPower(type: string, level = 1): number {
  const d = UNITS[type];
  if (!d) return 0;
  const a = d.attack;
  const dps = a ? ((a.dmg[0] + a.dmg[1]) / 2 / a.cd) * (a.splash ? 1.6 : 1) : 4;
  const lvl = d.hero ? 1 + (level - 1) * 0.25 : 1;
  return Math.sqrt(d.hp * (1 + d.armor * 0.06) * dps) * lvl * (d.cls === 'worker' ? 0.3 : 1);
}
export function armyPower(a: Army): number {
  if (!a.units.length) return a.power;
  return a.units.reduce((s, u) => s + unitPower(u.type, u.hero?.level ?? 1) * (u.hp ?? 1), 0);
}

/** Poder militar do jogador: tropas na província + exércitos em marcha. */
export function playerPower(g: Game | null, r: Realm): number {
  let s = 0;
  if (g) for (const u of g.units) if (u.alive && u.owner === 0 && u.udef!.cls !== 'worker') s += unitPower(u.type, u.level) * (u.hp / u.maxHp);
  for (const a of r.armies) if (a.owner === r.player) s += armyPower(a);
  return s;
}

export function armyPos(r: Realm, a: Army): { x: number; y: number } {
  const p = r.provinces[a.path[a.seg]], q = r.provinces[a.path[Math.min(a.path.length - 1, a.seg + 1)]];
  return { x: p.x + (q.x - p.x) * a.t, y: p.y + (q.y - p.y) * a.t };
}

export function armyDays(r: Realm, from: string, to: string): number { return Math.ceil(route(r, from, to).days * ARMY_DAYS_MUL); }

/** Retira unidades do mapa da província e forma um exército que marcha até `target`. */
export function formArmy(g: Game, r: Realm, ids: number[], target: string, intent: Army['intent'] = 'attack'): Army | null {
  const units: ArmyUnit[] = [];
  for (const id of ids) {
    const e = g.ents.get(id);
    if (!e || !e.alive || e.owner !== 0 || e.kind !== 'unit' || e.udef!.cls === 'worker') continue;
    const u: ArmyUnit = { type: e.type, hp: e.hp / e.maxHp };
    if (e.isHero) u.hero = { level: e.level, xp: e.xp, skills: { ...e.skills }, items: [...e.items], skillPts: e.skillPts, person: e.personId || undefined };
    units.push(u);
    if (e.inside) g.releaseFromMine(e);
    e.alive = false;
    e.dying = 0;
    g.removeEntity(e);
  }
  if (!units.length) return null;
  g.recomputeSupply();
  const from = player(r).province;
  const rt = route(r, from, target);
  const a: Army = { id: nid(r), owner: r.player, path: rt.path, seg: 0, t: 0, units, power: 0, target, intent };
  a.power = armyPower(a);
  r.armies.push(a);
  log(r, `Seu exército (${units.length} unidades) partiu rumo a ${r.provinces[target].name}.`, 'war');
  return a;
}

/** Recoloca as unidades de um exército que voltou no mapa da província. */
export function disband(g: Game, r: Realm, a: Army) {
  const hall = g.buildings.find((b) => b.owner === 0 && b.alive && b.bdef!.cat === 'hall') ?? g.buildings.find((b) => b.owner === 0 && b.alive);
  const x = hall ? hall.cx : g.players[0].startX, y = hall ? hall.ty + hall.size + 2 : g.players[0].startY;
  a.units.forEach((u, i) => {
    const e = g.spawnUnit(u.type, 0, x + (i % 6) - 2.5, y + Math.floor(i / 6));
    if (u.hero) {
      e.level = u.hero.level; e.xp = u.hero.xp; e.skills = { ...u.hero.skills }; e.items = [...u.hero.items]; e.skillPts = u.hero.skillPts;
      e.personId = u.hero.person ?? 0;
      g.refreshUnit(e);
    }
    e.hp = e.maxHp * clamp(u.hp ?? 1, 0.2, 1);
  });
  g.recomputeSupply();
  r.armies = r.armies.filter((x) => x !== a);
  if (a.units.length) g.msg(0, `Seu exército voltou para casa com ${a.units.length} unidades.`, '#9fe0a0');
}

/** Um dia de marcha para todos os exércitos. */
export function dayArmies(g: Game | null, r: Realm) {
  for (const a of [...r.armies]) {
    if (a.waiting) continue;
    if (a.path.length < 2) { arrive(g, r, a); continue; }
    const rd = r.roads.find((x) => (x.a === a.path[a.seg] && x.b === a.path[a.seg + 1]) || (x.b === a.path[a.seg] && x.a === a.path[a.seg + 1]));
    a.t += 1 / ((rd?.days ?? 4) * ARMY_DAYS_MUL);
    if (a.t >= 1) {
      a.t = 0;
      a.seg++;
      if (a.seg >= a.path.length - 1) { a.seg = a.path.length - 1; arrive(g, r, a); }
    }
  }
}

function arrive(g: Game | null, r: Realm, a: Army) {
  const prov = r.provinces[a.target];
  const owner = r.houses[prov.owner];
  if (a.owner === r.player) {
    if (a.intent === 'return' || prov.owner === r.player) {
      if (g) disband(g, r, a);
      return;
    }
    if (owner && owner.rel[r.player] === 'war') {
      a.waiting = true;
      r.events.push({ id: nid(r), kind: 'battle', data: { army: a.id, province: prov.id }, t: r.time });
      log(r, `Seu exército chegou a ${prov.name}. A batalha contra a ${houseName(r, owner.id)} vai começar.`, 'war');
      return;
    }
    // sem guerra: volta para casa
    sendHome(r, a);
    log(r, `Seu exército chegou a ${prov.name}, mas não há guerra com a ${houseName(r, prov.owner)}. Voltando.`, 'war');
    return;
  }
  // exército de IA
  const att = r.houses[a.owner];
  if (a.intent === 'return') {
    if (att?.alive) att.army += a.power;
    r.armies = r.armies.filter((x) => x !== a);
    return;
  }
  if (prov.owner === r.player) {
    if (!att?.alive || att.rel[r.player] !== 'war') { a.intent = 'return'; sendBack(r, a); return; }
    if (r.raid || !g) { a.waiting = true; return; }   // espera o saque atual terminar
    startRaid(g, r, a);
    return;
  }
  // IA contra IA: resolvido na hora
  if (owner && att && owner.rel[att.id] === 'war') {
    const atk = a.power * (0.8 + roll(r) * 0.4), def = owner.army * 0.7 * 1.2;
    if (atk > def) {
      owner.army *= 0.45;
      a.power *= clamp(1 - def / atk * 0.7, 0.1, 1);
      subjugate(r, owner, att);
    } else {
      owner.army = Math.max(0, owner.army - atk * 0.5);
      a.power *= 0.25;
      log(r, `A ${houseName(r, owner.id)} repeliu o ataque da ${houseName(r, att.id)} em ${prov.name}.`, 'war');
    }
  }
  a.intent = 'return';
  sendBack(r, a);
}

function sendBack(r: Realm, a: Army) {
  const homeP = r.houses[a.owner]?.province;
  if (!homeP) { r.armies = r.armies.filter((x) => x !== a); return; }
  const rt = route(r, a.path[a.path.length - 1], homeP);
  a.path = rt.path; a.seg = 0; a.t = 0; a.target = homeP; a.waiting = false; a.intent = 'return';
}
export function sendHome(r: Realm, a: Army) { sendBack(r, a); }

// ----------------------------------------------------------------------
// Batalha resolvida automaticamente
// ----------------------------------------------------------------------
export interface BattleResult { won: boolean; lost: number; text: string }

export function defenderStrength(r: Realm, h: House): number {
  const allies = Object.values(r.houses).filter((x) => x.alive && x.id !== h.id && x.rel[h.id] === 'ally' && x.rel[r.player] !== 'ally');
  return h.army * 0.75 + allies.reduce((s, x) => s + x.army * 0.15, 0);
}

export function autoResolve(r: Realm, a: Army): BattleResult {
  const prov = r.provinces[a.target];
  const h = r.houses[prov.owner];
  let atk = armyPower(a) * (r.council.marechal ? 1.15 : 1);
  if (r.laws.levy) atk += vassalsOf(r, r.player).reduce((s, v) => s + v.army * 0.25, 0);
  atk *= 0.8 + roll(r) * 0.4;
  const def = defenderStrength(r, h) * 1.25; // muralhas e conhecimento do terreno
  const won = atk > def;
  const lossFrac = won ? clamp(def / atk * 0.65, 0.05, 0.9) : clamp(0.6 + def / atk * 0.2, 0.6, 1);
  const before = a.units.length;
  // remove unidades começando pelas mais fracas (o herói é o último a cair)
  // os heróis ficam por último e sempre escapam com vida
  a.units.sort((x, y) => (x.hero ? 1 : 0) - (y.hero ? 1 : 0) || unitPower(x.type) - unitPower(y.type));
  let toLose = armyPower(a) * lossFrac;
  while (toLose > 0 && a.units.length && !a.units[0].hero) {
    const u = a.units.shift()!;
    toLose -= unitPower(u.type) * (u.hp ?? 1);
  }
  for (const u of a.units) u.hp = clamp((u.hp ?? 1) * (0.6 + roll(r) * 0.3), 0.2, 1);
  const lost = before - a.units.length;
  let text: string;
  if (won) {
    h.army = Math.max(0, h.army * 0.35);
    text = `Vitória em ${prov.name}! Você perdeu ${lost} de ${before} unidades.`;
    log(r, text, 'war');
    subjugate(r, h, player(r));
  } else {
    h.army = Math.max(0, h.army - atk * 0.45);
    text = `Derrota em ${prov.name}. Você perdeu ${lost} de ${before} unidades e recuou.`;
    log(r, text, 'war');
    remember(r, h.id, 'Atacou nossas terras e foi repelido', -5, -6);
  }
  a.waiting = false;
  a.power = armyPower(a);
  if (a.units.length) sendBack(r, a); else r.armies = r.armies.filter((x) => x !== a);
  return { won, lost, text };
}

/** Resultado de uma batalha comandada no mapa RTS. */
export function applyBattle(r: Realm, a: Army, survivors: ArmyUnit[], won: boolean): string {
  const prov = r.provinces[a.target];
  const h = r.houses[prov.owner];
  const before = a.units.length;
  a.units = survivors;
  a.waiting = false;
  a.power = armyPower(a);
  let text: string;
  if (won) {
    h.army = Math.max(0, h.army * 0.3);
    text = `Vitória em ${prov.name}! ${survivors.length} de ${before} unidades sobreviveram.`;
    log(r, text, 'war');
    subjugate(r, h, player(r));
  } else {
    h.army = Math.max(0, h.army * 0.85);
    text = `Derrota em ${prov.name}. ${survivors.length} de ${before} unidades recuaram.`;
    log(r, text, 'war');
  }
  if (a.units.length) sendBack(r, a); else r.armies = r.armies.filter((x) => x !== a);
  return text;
}

// ----------------------------------------------------------------------
// Conquista e vassalagem
// ----------------------------------------------------------------------
export function subjugate(r: Realm, loser: House, winner: House, how: 'guerra' | 'divida' | 'voluntaria' = 'guerra') {
  const wasLiegeOfWinner = winner.liege === loser.id;
  if (wasLiegeOfWinner) winner.liege = loser.liege;     // o vassalo derrubou o próprio suserano
  loser.liege = winner.id;
  setRel(r, loser.id, winner.id, null);
  // quem estava em guerra com o vencedor por causa do perdedor sossega
  for (const a of r.armies) if (a.owner === loser.id && a.intent !== 'return') sendBack(r, a);
  const verb = how === 'guerra' ? 'foi conquistada e jurou vassalagem' : how === 'divida' ? 'não pagou a dívida e jurou vassalagem' : 'jurou vassalagem voluntariamente';
  log(r, `A ${houseName(r, loser.id)} ${verb} à ${houseName(r, winner.id)}.`, how === 'guerra' ? 'war' : 'politics');
  if (winner.id === r.player) {
    remember(r, loser.id, how === 'guerra' ? 'Fomos conquistados' : how === 'divida' ? 'Tomou nossa casa por dívida' : 'Aceitou nossa submissão com honra',
      how === 'voluntaria' ? 10 : how === 'divida' ? -10 : -20, how === 'guerra' ? 35 : 20, 8);
    rumor(r, `Subjugou a ${houseName(r, loser.id)}`, how === 'guerra' ? -2 : 0, how === 'guerra' ? 8 : 4, 5, loser.id);
    // vencer o rei (ou o suserano dele) conta para a coroa
    if (loser.id === r.crown && (winner.title === 'graolorde' || winner.title === 'rei')) crown(r);
  } else if (loser.id === r.player) {
    // a casa do jogador virou vassala de outra
    log(r, `Agora você deve lealdade à ${houseName(r, winner.id)}.`, 'politics');
  }
}

export function crown(r: Realm) {
  const pl = player(r);
  const old = r.houses[r.crown];
  pl.title = 'rei';
  pl.liege = null;
  if (old && old.id !== pl.id) { old.liege = pl.id; if (old.title === 'rei') old.title = 'graolorde'; }
  r.crown = pl.id;
  for (const h of Object.values(r.houses)) if (h.alive && h.id !== pl.id && !h.liege) h.liege = pl.id;
  rumor(r, 'Foi coroado rei de Aldaris', 5, 15, 30);
  log(r, `${r.persons[pl.lord].name} da ${houseName(r, pl.id)} foi coroado(a) Rei de Aldaris!`, 'title');
  if (!r.over) { r.over = 'rei'; r.events.push({ id: nid(r), kind: 'victory', data: {}, t: r.time }); }
}

// ----------------------------------------------------------------------
// Saque à província do jogador (acontece no mapa RTS de verdade)
// ----------------------------------------------------------------------
const RAID_MIX: [string, number][] = [['v_lanceiro', 0.5], ['v_besteiro', 0.35], ['v_cavaleiro', 0.15]];

export function startRaid(g: Game, r: Realm, a: Army) {
  const h = r.houses[a.owner];
  const raider = g.players[RAIDER];
  if (!raider) return;
  raider.name = `Casa ${h.name}`;
  raider.defeated = false;
  // de onde vêm: direção da estrada no mapa do feudo
  const prev = r.provinces[a.path[Math.max(0, a.path.length - 2)]] ?? r.provinces[h.province];
  const hp = r.provinces[player(r).province];
  let dx = prev.x - hp.x, dy = prev.y - hp.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const W = g.world.w, H = g.world.h;
  const sx = clamp(W / 2 + dx * W * 0.44, 4, W - 5), sy = clamp(H / 2 + dy * H * 0.44, 4, H - 5);
  const ids: number[] = [];
  let pw = a.power;
  const maxUnits = Math.min(26, 6 + Math.floor(r.seasonIndex * 1.2)); // primeiras invasões são pequenas
  while (pw > 30 && ids.length < maxUnits) {
    let k = roll(r), type = RAID_MIX[0][0];
    for (const [t, w] of RAID_MIX) { if (k < w) { type = t; break; } k -= w; }
    if (type === 'v_cavaleiro' && a.power < 700) type = 'v_lanceiro';
    const u = g.spawnUnit(type, RAIDER, sx + (ids.length % 5) - 2, sy + Math.floor(ids.length / 5) - 2);
    ids.push(u.id);
    pw -= unitPower(type);
  }
  g.recomputeSupply();
  r.raid = { house: h.id, units: ids, until: r.time + RAID_SECS, power: a.power, armyId: a.id };
  a.waiting = true;
  g.alert(0, sx, sy, `Tropas da Casa ${h.name} invadiram sua província!`, 'attack');
  g.msg(0, `Invasão! ${ids.length} soldados da Casa ${h.name} atacam o Vale.`, '#ff6a6a');
  log(r, `A ${houseName(r, h.id)} invadiu sua província com ${ids.length} soldados.`, 'war');
  orderRaid(g, r);
  r.events.push({ id: nid(r), kind: 'raid', data: { house: h.id, n: ids.length }, t: r.time });
}

function orderRaid(g: Game, r: Realm) {
  if (!r.raid) return;
  const alive = r.raid.units.filter((id) => g.ents.get(id)?.alive);
  if (!alive.length) return;
  const u0 = g.ents.get(alive[0])!;
  let best = null as null | { x: number; y: number }, bd = Infinity;
  for (const b of g.buildings) {
    if (!b.alive || b.owner !== 0) continue;
    const d = Math.hypot(b.cx - u0.x, b.cy - u0.y);
    if (d < bd) { bd = d; best = { x: b.cx, y: b.cy }; }
  }
  if (best) issueMove(g, RAIDER, alive, best.x, best.y, { attack: true, formation: 'loose' });
}

/** A cada segundo durante um saque. */
export function raidTick(g: Game, r: Realm) {
  const raid = r.raid;
  if (!raid) {
    // exércitos que esperavam o saque anterior terminar
    const waiting = r.armies.find((a) => a.owner !== r.player && a.waiting && a.target === player(r).province);
    if (waiting) startRaid(g, r, waiting);
    return;
  }
  const alive = raid.units.map((id) => g.ents.get(id)).filter((e) => e && e.alive);
  const army = r.armies.find((a) => a.id === raid.armyId);
  const h = r.houses[raid.house];
  if (!alive.length) {
    // invasão derrotada
    r.raid = null;
    if (army) r.armies = r.armies.filter((x) => x !== army);
    remember(r, raid.house, 'Nossa invasão foi esmagada', -2, 15);
    rumor(r, 'Repeliu uma invasão', 0, 4, 2, raid.house);
    if (h) h.casusBelli = true;
    g.msg(0, `A invasão da Casa ${h?.name ?? ''} foi derrotada!`, '#9fe0a0');
    log(r, `Você repeliu a invasão da ${houseName(r, raid.house)}.`, 'war');
    return;
  }
  if (r.time >= raid.until) {
    // recuam com o saque
    const pl = g.players[0];
    const loot = Math.round(Math.min(pl.res.silver * 0.15, 300));
    pl.res.silver -= loot;
    if (h) h.treasury += loot;
    let left = 0;
    for (const e of alive) { left += unitPower(e!.type) * (e!.hp / e!.maxHp); e!.alive = false; e!.dying = 0; g.removeEntity(e!); }
    g.recomputeSupply();
    r.raid = null;
    if (army) { army.power = left; army.waiting = false; sendBack(r, army); }
    g.msg(0, `Os invasores recuaram levando ${loot} de prata.`, '#ff9a6a');
    log(r, `Os soldados da ${houseName(r, raid.house)} recuaram com ${loot} de prata saqueada.`, 'war');
    return;
  }
  if (Math.floor(r.time) % 8 === 0) orderRaid(g, r);
}

/** A IA declara guerra e manda um exército contra a província do jogador. */
export function launchAttackOnPlayer(r: Realm, h: House) {
  const send = h.army * (h.personality === 'cruel' || h.personality === 'ambicioso' ? 0.45 : 0.35);
  if (send < 150) return;
  h.army -= send;
  const rt = route(r, h.province, player(r).province);
  r.armies.push({ id: nid(r), owner: h.id, path: rt.path, seg: 0, t: 0, units: [], power: send, target: player(r).province, intent: 'raid' });
  log(r, `Batedores avisam: um exército da ${houseName(r, h.id)} marcha contra o Vale (${Math.ceil(rt.days * ARMY_DAYS_MUL)} dias).`, 'war');
}

/** Exércitos da IA contra outras casas da IA. */
export function launchAttack(r: Realm, from: House, to: House) {
  const send = from.army * 0.55;
  if (send < 150) return;
  from.army -= send;
  const rt = route(r, from.province, to.province);
  r.armies.push({ id: nid(r), owner: from.id, path: rt.path, seg: 0, t: 0, units: [], power: send, target: to.province, intent: 'attack' });
}

export function underBanner(r: Realm): House[] { return realmOf(r, r.player); }
