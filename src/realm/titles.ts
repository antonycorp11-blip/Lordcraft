import type { Game } from '../sim/game';
import { atWar, avgLegit, houseName, log, nid, player, provincesUnder, realmOf, remember, rumor, setRel } from './core';
import { adult, family } from './dynasty';
import { home } from './province';
import { crown, launchAttackOnPlayer } from './war';
import { sendLetter } from './letters';
import { SEASON_SECS } from './data';
import type { CouncilSeat, Person, Realm, Title } from './types';

// Progressão: fundar a casa (Senhor) → Lorde → Grão-lorde (conselho e leis) → disputar a Coroa.

export interface Req { text: string; ok: boolean }
export interface TitleStep { next: Title | null; name: string; reqs: Req[]; action: string; how: string }

export function nextStep(g: Game, r: Realm): TitleStep {
  const pl = player(r);
  const legit = avgLegit(r);
  const pop = home(r).pop;
  const silver = g.players[0].res.silver;
  const provs = provincesUnder(r, r.player);
  if (pl.title === 'senhor') {
    const liege = pl.liege ? r.houses[pl.liege] : null;
    return {
      next: 'lorde', name: 'Lorde',
      reqs: [
        { text: `População de 40 (agora ${Math.floor(pop)})`, ok: pop >= 40 },
        { text: `Legitimidade média 25 (agora ${Math.round(legit)})`, ok: legit >= 25 },
        { text: `500 de prata para a investidura (agora ${Math.floor(silver)})`, ok: silver >= 500 },
        { text: liege ? `Confiança da ${houseName(r, liege.id)} 25 ou medo 50 (agora ${Math.round(liege.op.trust)} / ${Math.round(liege.op.fear)})` : 'Sem suserano: proclamar-se', ok: !liege || liege.op.trust >= 25 || liege.op.fear >= 50 },
        { text: liege ? `Não estar em guerra com seu suserano` : 'Sem guerra', ok: !liege || !atWar(r, liege.id, r.player) },
      ],
      action: liege ? 'pedir' : 'proclamar',
      how: liege ? `Peça a investidura por carta à ${houseName(r, liege.id)}. Lordes podem ter vassalos.` : 'Proclame-se Lorde.',
    };
  }
  if (pl.title === 'lorde') {
    return {
      next: 'graolorde', name: 'Grão-lorde',
      reqs: [
        { text: `3 províncias sob sua bandeira (agora ${provs})`, ok: provs >= 3 },
        { text: `Legitimidade média 40 (agora ${Math.round(legit)})`, ok: legit >= 40 },
        { text: `População de 70 (agora ${Math.floor(pop)})`, ok: pop >= 70 },
      ],
      action: 'proclamar',
      how: 'Conquiste vassalos (guerra, dívida ou submissão voluntária) e proclame-se Grão-lorde. Libera o conselho e as leis.',
    };
  }
  if (pl.title === 'graolorde') {
    return {
      next: 'rei', name: 'Rei',
      reqs: [
        { text: `5 províncias sob sua bandeira (agora ${provs})`, ok: provs >= 5 },
        { text: `Legitimidade média 55 (agora ${Math.round(legit)})`, ok: legit >= 55 },
        { text: r.assemblyAt ? 'Assembleia já convocada' : 'Nenhuma assembleia em andamento', ok: !r.assemblyAt },
      ],
      action: 'assembleia',
      how: `Convoque a Assembleia dos Lordes. Se a maioria votar em você, a coroa é sua. Se não, a ${houseName(r, r.crown)} declara guerra — tome Alta Coroa à força.`,
    };
  }
  return { next: null, name: 'Rei', reqs: [], action: '', how: 'Você é o Rei de Aldaris. Mantenha seus vassalos leais e sua dinastia viva.' };
}

export function advance(g: Game, r: Realm): string {
  const st = nextStep(g, r);
  if (!st.next) return '';
  if (!st.reqs.every((x) => x.ok)) return 'Requisitos ainda não cumpridos.';
  const pl = player(r);
  if (st.next === 'lorde') {
    if (st.action === 'pedir' && pl.liege) return sendLetter(g, r, pl.liege, 'titulo');
    pl.title = 'lorde';
    log(r, 'Você se proclamou Lorde.', 'title');
    return 'Agora você é Lorde.';
  }
  if (st.next === 'graolorde') {
    pl.title = 'graolorde';
    const old = pl.liege ? r.houses[pl.liege] : null;
    if (old && old.title === 'graolorde') {
      // a marca agora tem dois grão-lordes: o antigo suserano não gosta disso
      pl.liege = old.liege;
      remember(r, old.id, 'Tomou o título de Grão-lorde da Marca', -25, 10, -5);
      log(r, `Você deixou de dever lealdade à ${houseName(r, old.id)} e responde direto à coroa.`, 'title');
    }
    rumor(r, 'Proclamou-se Grão-lorde', 0, 6, 10);
    log(r, 'Você se proclamou Grão-lorde! O conselho e as leis estão abertos.', 'title');
    return 'Agora você é Grão-lorde. Nomeie seu conselho.';
  }
  if (st.next === 'rei') {
    r.assemblyAt = r.time + SEASON_SECS;
    log(r, 'Você convocou a Assembleia dos Lordes pela coroa. A votação será em uma estação.', 'title');
    rumor(r, 'Reivindicou a coroa', -2, 4, 0);
    return 'Assembleia convocada para daqui a uma estação. Conquiste votos!';
  }
  return '';
}

/** Votos: vassalos votam com você; os outros pesam confiança, legitimidade e medo. */
export function votes(r: Realm): { mine: string[]; theirs: string[] } {
  const mine: string[] = [], theirs: string[] = [];
  const under = new Set(realmOf(r, r.player).map((h) => h.id));
  for (const h of Object.values(r.houses)) {
    if (!h.alive || h.id === r.player) continue;
    if (h.id === r.crown) { theirs.push(h.id); continue; }
    const score = h.op.trust * 0.5 + h.op.legit * 0.6 + h.op.fear * 0.4;
    if (under.has(h.id) ? h.op.trust > -40 : score > 55) mine.push(h.id); else theirs.push(h.id);
  }
  return { mine, theirs };
}

export function checkAssembly(r: Realm) {
  if (!r.assemblyAt || r.time < r.assemblyAt) return;
  r.assemblyAt = 0;
  const v = votes(r);
  const total = v.mine.length + v.theirs.length + 1; // o próprio jogador vota em si
  if (v.mine.length + 1 > total / 2) {
    log(r, `A Assembleia votou: ${v.mine.length + 1} votos contra ${v.theirs.length}.`, 'title');
    crown(r);
  } else {
    const c = r.houses[r.crown];
    log(r, `A Assembleia rejeitou sua reivindicação (${v.mine.length + 1} contra ${v.theirs.length}). A ${houseName(r, r.crown)} declara guerra!`, 'war');
    r.events.push({ id: nid(r), kind: 'assembly', data: { mine: v.mine.length + 1, theirs: v.theirs.length }, t: r.time });
    if (c?.alive && !atWar(r, c.id, r.player)) {
      setRel(r, c.id, r.player, 'war');
      c.casusBelli = true;
      launchAttackOnPlayer(r, c);
    }
  }
}

// ----------------------------------------------------------------------
// Conselho e leis
// ----------------------------------------------------------------------
export function councilCandidates(r: Realm): Person[] {
  const out = family(r, r.player).filter((p) => adult(r, p) && p.id !== player(r).lord);
  for (const v of realmOf(r, r.player)) { const l = r.persons[v.lord]; if (l?.alive) out.push(l); }
  return out;
}

export function appoint(r: Realm, seat: CouncilSeat, person: number) {
  for (const k of Object.keys(r.council) as CouncilSeat[]) if (r.council[k] === person) delete r.council[k];
  if (person) r.council[seat] = person; else delete r.council[seat];
  const p = r.persons[person];
  if (p && p.house !== r.player) remember(r, p.house, 'Nosso lorde ganhou um lugar no conselho', 12);
}

export const LAW_INFO = {
  tax: { name: 'Impostos', opts: ['Baixos', 'Normais', 'Altos'], desc: 'Mais imposto, mais prata e menos contentamento.', min: 'senhor' as Title },
  trade: { name: 'Comércio', opts: ['Livre', 'Protecionista'], desc: 'Protecionista: vendas no seu mercado rendem 8% a mais, mas casas mercadoras se irritam.', min: 'lorde' as Title },
  levy: { name: 'Convocação', opts: ['Voluntária', 'Obrigatória'], desc: 'Obrigatória: vassalos lutam com você em batalhas resolvidas, mas a lealdade deles cai.', min: 'graolorde' as Title },
};
const ORDER: Title[] = ['senhor', 'lorde', 'graolorde', 'rei'];
export function hasTitle(r: Realm, t: Title): boolean { return ORDER.indexOf(player(r).title) >= ORDER.indexOf(t); }

