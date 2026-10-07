import { PEACE_SEASONS } from './data';
import {
  allied, atWar, chance, clamp, daysToSecs, houseName, log, lordOf, nid, pick, player, provincesUnder, remember, roll,
  route, rumor, secsToDays, setRel,
} from './core';
import { marriageable, marriageValue, marry } from './dynasty';
import { sendCaravan } from './market';
import { GUILD } from './province';
import { launchAttack, launchAttackOnPlayer, playerPower, subjugate } from './war';
import type { Good, House, Letter, LetterKind, Realm } from './types';
import type { Game } from '../sim/game';

// Cartas viajam pelas estradas: a resposta só chega depois da ida e da volta do mensageiro.

export const LETTER_INFO: Partial<Record<LetterKind, { name: string; desc: string }>> = {
  presente: { name: 'Enviar presente', desc: 'Prata para melhorar a confiança.' },
  alianca: { name: 'Propor aliança', desc: 'Aliados não se atacam e ajudam na guerra.' },
  casamento: { name: 'Propor casamento', desc: 'Une as famílias: confiança, legitimidade e aliança.' },
  emprestimo: { name: 'Pedir empréstimo', desc: '300 de prata, a devolver com juros em 2 estações.' },
  comercio: { name: 'Propor pacto comercial', desc: 'Caravanas suas vendem sem taxa nas terras deles.' },
  vassalagem: { name: 'Exigir vassalagem', desc: 'Se temerem ou respeitarem você, juram lealdade.' },
  paz: { name: 'Propor paz', desc: 'Encerra a guerra.' },
  guerra: { name: 'Declarar guerra', desc: 'Sem motivo justo, as outras casas confiarão menos em você.' },
  ameaca: { name: 'Ameaçar', desc: 'Aumenta o medo, diminui a confiança.' },
  cobrar: { name: 'Cobrar dívida', desc: 'Exige o pagamento de uma dívida vencida — ou a casa.' },
  pagar: { name: 'Pagar dívida', desc: 'Quita o que você deve a esta casa.' },
};

function letterDays(r: Realm, a: string, b: string): number {
  const d = route(r, r.houses[a].province, r.houses[b].province).days;
  return Math.max(1, Math.round(d * (r.council.chanceler && (a === r.player || b === r.player) ? 0.65 : 1)));
}

export function travelTo(r: Realm, house: string): number { return letterDays(r, r.player, house); }

function post(r: Realm, from: string, to: string, kind: LetterKind, text: string, extra: Partial<Letter> = {}): Letter {
  const l: Letter = { id: nid(r), from, to, kind, text, sentAt: r.time, arriveAt: r.time + daysToSecs(letterDays(r, from, to)), delivered: false, ...extra };
  r.letters.push(l);
  if (r.letters.length > 120) r.letters = r.letters.filter((x) => !x.delivered || !x.read || r.time - x.arriveAt < 1500).slice(-120);
  return l;
}

/** Carta do jogador para uma casa. Custos são pagos na hora do envio. */
export function sendLetter(g: Game, r: Realm, to: string, kind: LetterKind, data: Record<string, number | string> = {}): string {
  const h = r.houses[to];
  if (!h?.alive) return 'Esta casa não existe mais.';
  if (r.letters.some((l) => !l.delivered && l.from === r.player && l.to === to && l.kind === kind)) return 'Já há um mensageiro a caminho com esse pedido.';
  const pl = g.players[0];
  if (kind === 'presente') {
    const v = Number(data.silver ?? 100);
    if (pl.res.silver < v) return 'Prata insuficiente.';
    pl.res.silver -= v;
  }
  if (kind === 'pagar') {
    const d = r.debts.find((x) => x.id === Number(data.debt));
    if (!d) return 'Dívida não encontrada.';
    if (pl.res.silver < d.amount) return 'Prata insuficiente para quitar a dívida.';
    pl.res.silver -= d.amount;
  }
  if (kind === 'titulo') {
    if (pl.res.silver < 500) return 'A investidura custa 500 de prata.';
    pl.res.silver -= 500;
  }
  const texts: Partial<Record<LetterKind, string>> = {
    presente: `Envio ${data.silver} de prata como sinal de amizade.`,
    alianca: 'Proponho uma aliança entre nossas casas.',
    casamento: `Proponho o casamento de ${r.persons[Number(data.mine)]?.name} com ${r.persons[Number(data.theirs)]?.name}.`,
    emprestimo: 'Peço um empréstimo de 300 de prata.',
    comercio: 'Proponho um pacto comercial entre nossas terras.',
    vassalagem: 'Exijo que sua casa jure vassalagem à minha.',
    paz: 'Proponho o fim desta guerra.',
    guerra: 'Declaro guerra à sua casa.',
    ameaca: 'Lembre-se de quem tem a espada mais afiada.',
    cobrar: 'Sua dívida venceu. Pague — ou entregue sua casa.',
    pagar: 'Quito aqui minha dívida.',
    titulo: 'Peço a investidura como Lorde, com o tributo da investidura.',
  };
  post(r, r.player, to, kind, texts[kind] ?? '', { data });
  return `Mensageiro enviado. Chega em ${letterDays(r, r.player, to)} dias.`;
}

/** Resposta do jogador a uma carta que pede decisão. */
export function answerLetter(g: Game, r: Realm, id: number, accept: boolean): string {
  const l = r.letters.find((x) => x.id === id);
  if (!l || !l.ask || l.answered) return '';
  l.answered = true;
  l.read = true;
  const h = r.houses[l.from];
  const pl = g.players[0];
  const reply = (text: string, extra: Partial<Letter> = {}) => post(r, r.player, l.from, 'resposta', text, { accepted: accept, replyTo: l.id, ...extra });
  if (!h?.alive) return '';
  switch (l.kind) {
    case 'casamento': {
      const mine = r.persons[Number(l.data?.mine)], theirs = r.persons[Number(l.data?.theirs)];
      if (accept && mine?.alive && theirs?.alive && !mine.spouse && !theirs.spouse) {
        marry(r, mine, theirs);
        setRel(r, r.player, h.id, 'ally');
        remember(r, h.id, `Casamento de ${mine.name} e ${theirs.name}`, 25, 0, 8);
        log(r, `${mine.name} casou-se com ${theirs.name} da ${houseName(r, h.id)}. As casas agora são aliadas.`, 'dynasty');
      } else if (!accept) remember(r, h.id, 'Recusou nossa proposta de casamento', -6);
      reply(accept ? 'Aceito o casamento.' : 'Recuso o casamento.');
      return accept ? 'Casamento celebrado.' : 'Proposta recusada.';
    }
    case 'emprestimo': {
      if (accept) {
        const amt = Number(l.data?.amount ?? 300);
        pl.res.silver += amt;
        h.treasury -= amt;
        r.debts.push({ id: nid(r), debtor: r.player, creditor: h.id, amount: Math.round(amt * 1.2), due: r.time + 300, interest: 0.05 });
        remember(r, h.id, 'Aceitou nosso empréstimo', 3);
        reply('Aceito o empréstimo.');
        return `+${amt} de prata. Devolva ${Math.round(amt * 1.2)} em 2 estações.`;
      }
      reply('Recuso o empréstimo.');
      return '';
    }
    case 'oferta_compra': {
      const good = String(l.data?.good) as Good, qty = Number(l.data?.qty), pr = Number(l.data?.price);
      if (accept) {
        const have = good === 'food' ? r.provinces[player(r).province].food : pl.res[good as 'wood' | 'aether'];
        if (have < qty) { l.answered = false; return 'Você não tem mercadoria suficiente.'; }
        if (good === 'food') r.provinces[player(r).province].food -= qty; else pl.res[good as 'wood' | 'aether'] -= qty;
        const c = sendCaravan(r, r.player, h.province, good, qty, 1);
        if (c) c.fixedPrice = pr;
        remember(r, h.id, 'Aceitou nosso pedido de compra', 6);
        reply('Aceito. A caravana já partiu.');
        return 'Caravana enviada com escolta leve.';
      }
      remember(r, h.id, 'Recusou nosso pedido de compra', -2);
      reply('Não temos como atender.');
      return '';
    }
    case 'pedido_ajuda': {
      const v = Number(l.data?.silver ?? 150);
      if (accept) {
        if (pl.res.silver < v) { l.answered = false; return 'Prata insuficiente.'; }
        pl.res.silver -= v;
        h.army += v * 0.8;
        remember(r, h.id, 'Ajudou-nos na hora da guerra', 14);
      } else remember(r, h.id, 'Negou ajuda na hora da guerra', allied(r, h.id, r.player) ? -12 : -4);
      reply(accept ? 'Envio a ajuda pedida.' : 'Não posso ajudar agora.');
      return accept ? 'Ajuda enviada.' : '';
    }
    case 'tributo': {
      const v = Number(l.data?.silver ?? 150);
      if (accept) {
        if (pl.res.silver < v) { l.answered = false; return 'Prata insuficiente.'; }
        pl.res.silver -= v;
        h.treasury += v;
        remember(r, h.id, 'Pagou o tributo que exigimos', 10, 6, -2);
      } else declareWarOnPlayer(r, h, 'recusou nosso tributo');
      reply(accept ? 'Envio o tributo.' : 'Não pagarei.');
      return accept ? `Pagou ${v} de prata. A ${houseName(r, h.id)} recuou.` : 'Recusado. Prepare suas defesas.';
    }
    case 'paz': {
      if (accept) makePeace(r, h);
      reply(accept ? 'Aceito a paz.' : 'A guerra continua.');
      return accept ? 'A paz foi selada.' : '';
    }
    case 'alianca': {
      if (accept) { setRel(r, r.player, h.id, 'ally'); remember(r, h.id, 'Aceitou nossa aliança', 12); log(r, `Aliança firmada com a ${houseName(r, h.id)}.`, 'politics'); }
      else remember(r, h.id, 'Recusou nossa aliança', -5);
      reply(accept ? 'Aceito a aliança.' : 'Recuso a aliança.');
      return accept ? 'Aliança firmada.' : '';
    }
    case 'vassalagem': {
      // uma casa forte exige que o jogador se curve
      if (accept) {
        subjugate(r, player(r), h, 'voluntaria');
        makePeace(r, h);
      } else {
        remember(r, h.id, 'Recusou curvar-se', -8);
        if (h.personality !== 'cauteloso' && chance(r, 0.6)) declareWarOnPlayer(r, h, 'recusou-se a se curvar');
      }
      reply(accept ? 'Juro vassalagem.' : 'Jamais.');
      return '';
    }
  }
  reply(accept ? 'Aceito.' : 'Recuso.');
  return '';
}

export function makePeace(r: Realm, h: House) {
  setRel(r, r.player, h.id, null);
  for (const a of r.armies) if ((a.owner === h.id && a.target === player(r).province) || (a.owner === r.player && r.provinces[a.target].owner === h.id)) {
    if (a.owner === r.player) { a.intent = 'return'; a.waiting = false; }
  }
  r.armies = r.armies.filter((a) => !(a.owner === h.id && a.intent === 'raid'));
  log(r, `Paz selada com a ${houseName(r, h.id)}.`, 'politics');
}

export function declareWarOnPlayer(r: Realm, h: House, why: string) {
  if (atWar(r, h.id, r.player)) return;
  setRel(r, h.id, r.player, 'war');
  post(r, h.id, r.player, 'guerra', `A ${houseName(r, h.id)} declara guerra contra você: ${why}.`);
  launchAttackOnPlayer(r, h);
}

// ----------------------------------------------------------------------
// Chegada das cartas
// ----------------------------------------------------------------------
export function deliverLetters(g: Game, r: Realm) {
  for (const l of r.letters) {
    if (l.delivered || r.time < l.arriveAt) continue;
    l.delivered = true;
    if (l.to === r.player) {
      if (l.data?.silver && l.kind === 'resposta' && l.accepted) g.players[0].res.silver += Number(l.data.silver);
      g.msg(0, `Carta da Casa ${r.houses[l.from]?.name ?? ''} chegou.`, '#f0d48e');
      continue;
    }
    if (l.from === r.player) decide(g, r, l);
  }
}

/** A casa recebe a carta do jogador e decide. */
function decide(g: Game, r: Realm, l: Letter) {
  const h = r.houses[l.to];
  if (!h?.alive) return;
  const pl = player(r);
  const myPow = playerPower(g, r) + 1;
  const strength = myPow / (h.army + 50);
  const answer = (accepted: boolean, text: string, data?: Record<string, number | string>) =>
    post(r, h.id, r.player, 'resposta', text, { accepted, replyTo: l.id, data });
  const op = h.op;
  const lordName = lordOf(r, h)?.name ?? 'O lorde';
  switch (l.kind) {
    case 'presente': {
      const v = Number(l.data?.silver ?? 0);
      const recent = r.memories.some((m) => m.house === h.id && m.text.startsWith('Presente') && r.time - m.t < 300);
      const gain = clamp(v / (h.personality === 'mercador' ? 10 : 15), 2, 20) * (recent ? 0.4 : 1);
      remember(r, h.id, `Presente de ${v} de prata`, gain);
      h.treasury += v;
      answer(true, `${lordName} agradece o presente generoso.`);
      break;
    }
    case 'alianca': {
      const enemies = Object.keys(h.rel).filter((k) => h.rel[k] === 'war' && k !== r.player);
      const ok = !atWar(r, h.id, r.player) && (op.trust >= 35 && op.legit >= 15 || (op.trust >= 15 && enemies.length > 0)) && h.personality !== 'cruel';
      if (ok) { setRel(r, h.id, r.player, 'ally'); remember(r, h.id, 'Aliança firmada', 8); log(r, `A ${houseName(r, h.id)} aceitou sua aliança.`, 'politics'); }
      else remember(r, h.id, 'Pediu aliança cedo demais', -1);
      answer(ok, ok ? `${lordName} aceita a aliança. Nossas espadas são suas.` : `${lordName} recusa: ainda não confia o bastante em você.`);
      break;
    }
    case 'casamento': {
      const mine = r.persons[Number(l.data?.mine)], theirs = r.persons[Number(l.data?.theirs)];
      const valid = mine?.alive && theirs?.alive && !mine.spouse && !theirs.spouse;
      const ok = valid && !atWar(r, h.id, r.player) && marriageValue(r, mine, theirs) + op.trust * 0.2 > 22;
      if (ok) {
        marry(r, mine, theirs);
        setRel(r, h.id, r.player, 'ally');
        remember(r, h.id, `Casamento de ${mine.name} e ${theirs.name}`, 20, 0, 10);
        rumor(r, 'Uniu-se por casamento a outra casa', 0, 0, 3, h.id);
        log(r, `${mine.name} casou-se com ${theirs.name} da ${houseName(r, h.id)}. As casas agora são aliadas.`, 'dynasty');
      } else remember(r, h.id, 'Propôs um casamento indigno', valid ? -3 : 0);
      answer(!!ok, ok ? `${lordName} aceita. Que o casamento una nossas casas.` : `${lordName} recusa o casamento.`);
      break;
    }
    case 'emprestimo': {
      const lenient = h.personality === 'mercador' ? 15 : 0;
      const ok = h.treasury > 450 && op.trust + lenient >= 10 && !atWar(r, h.id, r.player);
      if (ok) {
        h.treasury -= 300;
        r.debts.push({ id: nid(r), debtor: r.player, creditor: h.id, amount: 360, due: r.time + 300 + daysToSecs(letterDays(r, h.id, r.player)), interest: 0.05 });
        remember(r, h.id, 'Emprestamos prata', 2);
      }
      answer(ok, ok ? `${lordName} envia 300 de prata. Esperamos 360 de volta em duas estações.` : `${lordName} não pode emprestar agora.`, ok ? { silver: 300 } : undefined);
      break;
    }
    case 'comercio': {
      const ok = op.trust >= (h.personality === 'mercador' ? -5 : 5) && !atWar(r, h.id, r.player);
      if (ok) { h.pact = true; remember(r, h.id, 'Pacto comercial', 6); }
      answer(ok, ok ? `${lordName} aceita o pacto. Suas caravanas serão bem-vindas.` : `${lordName} recusa o pacto comercial.`);
      break;
    }
    case 'vassalagem': {
      const canHold = pl.title !== 'senhor';
      const ease = { cauteloso: 15, mercador: 8, honrado: -5, ambicioso: -15, cruel: -10 }[h.personality];
      const score = op.fear * 1.1 + op.legit * 0.5 + op.trust * 0.3 + Math.min(40, (strength - 1) * 25) + ease;
      const isTop = h.id === r.crown;
      const ok = canHold && !isTop && h.liege !== r.player && score > 85;
      if (ok) {
        answer(true, `${lordName} se curva. A ${houseName(r, h.id)} é sua vassala.`);
        subjugate(r, h, pl, 'voluntaria');
      } else {
        remember(r, h.id, 'Exigiu nossa submissão', -8, 2);
        answer(false, !canHold ? `${lordName} ri: um simples senhor não tem vassalos. Torne-se Lorde primeiro.` : `${lordName} recusa curvar-se diante de você.`);
        if ((h.personality === 'ambicioso' || h.personality === 'cruel') && strength < 0.8 && chance(r, 0.5)) declareWarOnPlayer(r, h, 'insultou nossa casa');
      }
      break;
    }
    case 'paz': {
      const tired = h.warSince !== undefined && r.time - h.warSince > 300;
      const ok = atWar(r, h.id, r.player) && (strength > 1.3 || (tired && op.trust > -40) || op.fear > 55 || (h.personality === 'cauteloso' && tired));
      if (ok) makePeace(r, h);
      answer(ok, ok ? `${lordName} aceita a paz.` : `${lordName} recusa: a guerra continua.`);
      break;
    }
    case 'guerra': {
      if (atWar(r, h.id, r.player)) break;
      const just = h.casusBelli || r.debts.some((d) => d.debtor === h.id && d.creditor === r.player && r.time > d.due);
      setRel(r, h.id, r.player, 'war');
      remember(r, h.id, 'Declarou guerra contra nós', -30, 5);
      if (!just) rumor(r, 'Declarou uma guerra sem motivo justo', -6, 2, -8, h.id);
      else rumor(r, 'Declarou uma guerra justa', 0, 2, 1, h.id);
      log(r, `Você está em guerra com a ${houseName(r, h.id)}${just ? '' : ' (sem motivo justo: sua legitimidade caiu)'}.`, 'war');
      // aliados dos dois lados
      for (const x of Object.values(r.houses)) if (x.alive && x.id !== r.player && x.rel[h.id] === 'ally' && x.rel[r.player] !== 'ally' && chance(r, 0.5)) {
        setRel(r, x.id, r.player, 'war');
        log(r, `A ${houseName(r, x.id)} entrou na guerra ao lado da ${houseName(r, h.id)}.`, 'war');
      }
      if (h.army > myPow * 0.6) launchAttackOnPlayer(r, h);
      break;
    }
    case 'ameaca': {
      const f = clamp(strength * 8, 2, 16);
      remember(r, h.id, 'Ameaçou nossa casa', -10, f);
      if ((h.personality === 'cruel' || h.personality === 'ambicioso') && strength < 0.7) {
        answer(false, `${lordName} responde: venha tentar.`);
        if (chance(r, 0.5)) declareWarOnPlayer(r, h, 'ameaçou nossa casa');
      } else answer(true, `${lordName} toma nota de suas palavras.`);
      break;
    }
    case 'cobrar': {
      const d = r.debts.find((x) => x.id === Number(l.data?.debt));
      if (!d) break;
      if (h.treasury >= d.amount) {
        h.treasury -= d.amount;
        answer(true, `${lordName} paga a dívida de ${d.amount} de prata.`, { silver: d.amount });
        d.amount = 0;
        remember(r, h.id, 'Cobrou nossa dívida', -2);
      } else {
        const submit = op.fear >= 30 || h.personality === 'cauteloso' || h.personality === 'mercador' || strength > 1.5;
        if (submit && pl.title !== 'senhor') {
          d.amount = 0;
          answer(true, `${lordName} não tem como pagar e entrega a casa como garantia.`);
          subjugate(r, h, pl, 'divida');
        } else {
          h.casusBelli = true;
          remember(r, h.id, 'Cobrou uma dívida impagável', -10);
          answer(false, `${lordName} não paga nem se curva. Você tem motivo justo para a guerra.`);
        }
      }
      r.debts = r.debts.filter((x) => x.amount > 0);
      break;
    }
    case 'pagar': {
      const d = r.debts.find((x) => x.id === Number(l.data?.debt));
      if (d) { h.treasury += d.amount; d.amount = 0; remember(r, h.id, 'Pagou a dívida em dia', r.time <= d.due ? 6 : 2); }
      r.debts = r.debts.filter((x) => x.amount > 0);
      answer(true, `${lordName} confirma: dívida quitada.`);
      break;
    }
    case 'titulo': {
      const ok = op.trust >= 25 || op.fear >= 50 || (op.legit >= 40 && op.trust >= 10);
      if (ok) {
        pl.title = 'lorde';
        h.treasury += 500;
        rumor(r, 'Investido como Lorde', 2, 2, 10);
        log(r, `A ${houseName(r, h.id)} investiu você como Lorde. Agora você pode ter vassalos.`, 'title');
        answer(true, `${lordName} concede a investidura. Ajoelhe-se, Lorde.`);
      } else {
        remember(r, h.id, 'Pediu um título que não merece', -3);
        answer(false, `${lordName} nega o título. Conquiste nossa confiança primeiro (confiança 25+).`, { silver: 500 });
      }
      break;
    }
  }
}

// ----------------------------------------------------------------------
// Iniciativa das casas (a cada estação)
// ----------------------------------------------------------------------
function ask(r: Realm, h: House, kind: LetterKind, text: string, data: Record<string, number | string> = {}) {
  h.lastLetter = r.time;
  post(r, h.id, r.player, kind, text, { ask: true, data });
}

export function seasonPolitics(g: Game, r: Realm) {
  const pl = player(r);
  const myPow = playerPower(g, r) + 1;
  const seasons = r.seasonIndex;
  for (const h of Object.values(r.houses)) {
    if (!h.alive || h.id === r.player) continue;
    // opiniões voltam devagar para o "normal"
    const base = { senhor: 15, lorde: 30, graolorde: 50, rei: 80 }[pl.title] + provincesUnder(r, r.player) * 3;
    h.op.trust *= 0.95;
    h.op.legit += (base - h.op.legit) * 0.12;
    const fearBase = clamp(myPow / (h.army + 50) * 18, 0, 60);
    h.op.fear += (fearBase - h.op.fear) * 0.2;
    if (r.laws.trade === 1 && h.personality === 'mercador') remember(r, h.id, 'Tarifas protecionistas', -2);
    if (r.laws.levy === 1 && h.liege === r.player) h.op.trust -= 1.5;
    if (r.time - h.lastLetter < 240) continue;
    const lord = lordOf(r, h)?.name ?? 'O lorde';
    const war = atWar(r, h.id, r.player);
    const strength = myPow / (h.army + 50);
    // guerra contra o jogador: só depois do início pacífico
    if (!war && seasons >= PEACE_SEASONS && h.liege !== r.player && h.id !== pl.liege) {
      const hostile = h.op.trust < -25 || ((h.personality === 'ambicioso' || h.personality === 'cruel') && strength < 0.55 && h.op.trust < 20);
      // uma exigência de tributo ignorada ou recusada vira guerra
      const demand = r.letters.find((l) => l.from === h.id && l.kind === 'tributo' && l.delivered && !l.answered);
      if (demand && r.time - demand.arriveAt > 150) { demand.answered = true; declareWarOnPlayer(r, h, 'você ignorou nossa exigência'); continue; }
      if (hostile && !demand && chance(r, h.personality === 'cruel' ? 0.45 : 0.3)) {
        if (h.op.trust < -40) { declareWarOnPlayer(r, h, 'suas ofensas não serão esquecidas'); continue; }
        const v = Math.round(120 + r.seasonIndex * 25);
        ask(r, h, 'tributo', `${lord} exige ${v} de prata como sinal de respeito. Recuse ou ignore por uma estação, e a ${houseName(r, h.id)} marchará contra você.`, { silver: v });
        continue;
      }
    }
    if (war) {
      // propõe paz quando cansa ou tem medo
      const tired = h.warSince !== undefined && r.time - h.warSince > 450;
      if ((tired || h.op.fear > 50) && chance(r, 0.35)) { ask(r, h, 'paz', `${lord} propõe encerrar a guerra.`); continue; }
      // manda outra leva de soldados
      if (!r.armies.some((a) => a.owner === h.id) && h.army > 300 && chance(r, 0.5)) launchAttackOnPlayer(r, h);
      continue;
    }
    // suserano forte exige submissão de um senhor sem título? não: cobra tributo (feito na estação)
    // casamento
    const theirs = marriageable(r, h.id).filter((p) => p.id !== h.lord);
    const mine = marriageable(r, r.player);
    if (theirs.length && mine.length && h.op.trust >= 15 && chance(r, 0.25)) {
      const m = mine.find((x) => x.id === pl.lord) ?? mine[0];
      const t = theirs.find((x) => x.female !== m.female);
      if (t) { ask(r, h, 'casamento', `${lord} oferece a mão de ${t.name} a ${m.name}.`, { mine: m.id, theirs: t.id }); continue; }
    }
    // empréstimo quando o jogador está sem prata
    if (g.players[0].res.silver < 120 && h.treasury > 600 && h.op.trust >= 0 && (h.personality === 'mercador' || chance(r, 0.3)) && chance(r, 0.5)) {
      ask(r, h, 'emprestimo', `${lord} soube de suas dificuldades e oferece 300 de prata (devolver 360 em duas estações).`, { amount: 300 });
      continue;
    }
    // pedido de compra (comércio)
    if (chance(r, h.personality === 'mercador' ? 0.3 : 0.08)) {
      const goods: Good[] = ['wood', 'food', 'aether'];
      const good = pick(r, goods);
      const m = r.provinces[h.province].market;
      const pr = Math.round(m.base[good] * (1.3 + roll(r) * 0.4) * 10) / 10;
      const qty = good === 'aether' ? 20 + Math.floor(roll(r) * 20) : 60 + Math.floor(roll(r) * 80);
      const names = { wood: 'madeira', food: 'grãos', aether: 'éter' };
      ask(r, h, 'oferta_compra', `${lord} quer comprar ${qty} de ${names[good]} a ${pr} de prata cada (${Math.round(qty * pr)} no total). Uma caravana precisa levar a carga até ${r.provinces[h.province].name}.`, { good, qty, price: pr });
      continue;
    }
    // pedido de ajuda de um aliado em guerra
    const enemy = Object.keys(h.rel).find((k) => h.rel[k] === 'war' && k !== r.player);
    if (enemy && allied(r, h.id, r.player) && chance(r, 0.4)) {
      ask(r, h, 'pedido_ajuda', `${lord} pede ajuda na guerra contra a ${houseName(r, enemy)}: 150 de prata para armar seus homens.`, { silver: 150, enemy });
      continue;
    }
    // casas muito fortes e pouco amigas exigem que um senhor se curve
    if (pl.title === 'senhor' && strength < 0.35 && h.op.trust < 10 && h.personality !== 'honrado' && h.id !== pl.liege && seasons >= PEACE_SEASONS + 2 && chance(r, 0.15)) {
      ask(r, h, 'vassalagem', `${lord} exige que você se curve à ${houseName(r, h.id)}. Recusar pode significar guerra.`);
      continue;
    }
  }
}

/** Guerras entre as casas da IA: mantêm o mapa vivo. */
export function seasonAIWars(r: Realm) {
  const hs = Object.values(r.houses).filter((h) => h.alive && h.id !== r.player);
  for (const h of hs) {
    // paz
    for (const k of Object.keys(h.rel)) if (h.rel[k] === 'war' && k !== r.player && chance(r, 0.2)) {
      setRel(r, h.id, k, null);
      log(r, `A ${houseName(r, h.id)} e a ${houseName(r, k)} fizeram as pazes.`, 'politics');
    }
    if (h.personality !== 'ambicioso' && h.personality !== 'cruel') continue;
    if (r.seasonIndex < 4 || !chance(r, 0.06)) continue;
    const targets = hs.filter((x) => x.id !== h.id && x.id !== r.crown && x.liege !== r.player && x.liege !== h.id && h.liege !== x.id && x.rel[h.id] !== 'ally' && x.army < h.army * 0.8);
    if (!targets.length) continue;
    const t = pick(r, targets);
    setRel(r, h.id, t.id, 'war');
    log(r, `A ${houseName(r, h.id)} declarou guerra à ${houseName(r, t.id)}.`, 'war');
    launchAttack(r, h, t);
  }
}

/** Dívidas do jogador: juros, vencimento e cobranças. */
export function seasonDebts(g: Game, r: Realm) {
  for (const d of r.debts) {
    if (d.debtor !== r.player) continue;
    const intr = Math.round(d.amount * (r.council.tesoureiro ? d.interest * 0.6 : d.interest));
    d.amount += intr;
    r.budget.interest += intr;
    if (r.time > d.due && d.creditor !== GUILD) {
      const h = r.houses[d.creditor];
      if (!h?.alive) { d.amount = 0; continue; }
      remember(r, h.id, 'Não pagou a dívida no prazo', -8);
      if (h.op.trust < -30 && chance(r, 0.4) && !atWar(r, h.id, r.player)) declareWarOnPlayer(r, h, 'você não paga o que deve');
      else if (r.time - h.lastLetter > 200) { h.lastLetter = r.time; post(r, h.id, r.player, 'aviso', `${lordOf(r, h)?.name} exige o pagamento dos ${d.amount} de prata que você deve.`); }
    }
  }
  r.debts = r.debts.filter((d) => d.amount > 0);
  void g;
}

/** Cartas que ainda viajam (para o mapa). */
export function lettersInTransit(r: Realm) { return r.letters.filter((l) => !l.delivered); }
export function unread(r: Realm): number { return r.letters.filter((l) => l.delivered && l.to === r.player && !l.read).length; }
export function daysLeft(r: Realm, l: Letter): number { return secsToDays(l.arriveAt - r.time); }
