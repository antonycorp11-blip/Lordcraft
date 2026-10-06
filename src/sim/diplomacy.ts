import type { Game } from './game';
import { power } from './stats';

export interface Proposal { id: number; from: number; to: number; kind: 'truce' | 'alliance'; t: number }

export function militaryPower(g: Game, owner: number): number {
  let s = 0;
  for (const u of g.units) if (u.owner === owner && u.alive && u.udef!.cls !== 'worker') s += power(u);
  return s;
}

export function warsOf(g: Game, id: number): number[] {
  return g.players.filter((p) => p && !p.defeated && p.id !== id && g.rel[id][p.id] === 'war').map((p) => p.id);
}

/** A IA decide se aceita a proposta. */
export function aiEvaluate(g: Game, ai: number, from: number, kind: 'truce' | 'alliance'): boolean {
  const p = g.players[ai];
  const mine = militaryPower(g, ai) + 1;
  const theirs = militaryPower(g, from) + 1;
  const wars = warsOf(g, ai).length;
  const pers = p.personality;
  if (kind === 'truce') {
    if (pers === 'agressiva' && theirs < mine * 1.5) return false;
    if (pers === 'defensiva') return true;
    if (theirs > mine * 1.25) return true;
    if (wars >= 2 && theirs > mine * 0.6) return true;
    return pers === 'equilibrada' && g.rng.chance(0.35);
  }
  // aliança: exige inimigo comum mais forte que ambos
  if (pers === 'agressiva') return false;
  const common = warsOf(g, ai).filter((x) => x !== from && g.rel[from][x] === 'war');
  for (const c of common) {
    const cp = militaryPower(g, c);
    if (cp > mine && cp > theirs * 0.8) return true;
  }
  return false;
}

export function propose(g: Game, from: number, to: number, kind: 'truce' | 'alliance'): 'accepted' | 'rejected' | 'pending' {
  const target = g.players[to];
  if (!target || target.defeated) return 'rejected';
  if (target.ai) {
    const ok = aiEvaluate(g, to, from, kind);
    if (ok) applyPact(g, from, to, kind);
    return ok ? 'accepted' : 'rejected';
  }
  if (g.proposals.some((p) => p.from === from && p.to === to)) return 'pending';
  g.proposals.push({ id: g.nextProposalId++, from, to, kind, t: g.time });
  return 'pending';
}

export function applyPact(g: Game, a: number, b: number, kind: 'truce' | 'alliance') {
  if (kind === 'truce') {
    g.setRelation(a, b, 'peace', 300);
    g.msg(a, `Trégua de 5 minutos com ${g.players[b].name}.`, '#9fe0a0');
    g.msg(b, `Trégua de 5 minutos com ${g.players[a].name}.`, '#9fe0a0');
  } else {
    g.setRelation(a, b, 'ally');
    g.msg(a, `Aliança firmada com ${g.players[b].name}. Visão compartilhada.`, '#9fe0a0');
    g.msg(b, `Aliança firmada com ${g.players[a].name}. Visão compartilhada.`, '#9fe0a0');
  }
  // cancela alvos atuais entre as partes
  for (const u of g.units) {
    const t = u.targetId ? g.ents.get(u.targetId) : null;
    if (t && ((u.owner === a && t.owner === b) || (u.owner === b && t.owner === a))) u.targetId = 0;
  }
}

export function respond(g: Game, id: number, accept: boolean) {
  const p = g.proposals.find((x) => x.id === id);
  if (!p) return;
  g.proposals = g.proposals.filter((x) => x.id !== id);
  if (accept) applyPact(g, p.from, p.to, p.kind);
  else g.msg(p.from, `${g.players[p.to].name} recusou a proposta.`, '#ff9a6a');
}

export function declareWar(g: Game, a: number, b: number) {
  if (g.rel[a][b] === 'war') return;
  g.setRelation(a, b, 'war');
  g.msg(b, `${g.players[a].name} declarou guerra!`, '#ff6a6a');
  g.msg(a, `Você declarou guerra a ${g.players[b].name}.`, '#ff6a6a');
}
