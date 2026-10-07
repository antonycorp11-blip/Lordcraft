// Camada estratégica (o "feudo"): províncias, casas nobres, pessoas, cartas, caravanas,
// exércitos e mercados. Tudo é dado puro (JSON) para entrar direto no salvamento.

export type Good = 'food' | 'wood' | 'aether';
export const GOODS: Good[] = ['food', 'wood', 'aether'];
export const GOOD_NAMES: Record<Good, string> = { food: 'Grãos', wood: 'Madeira', aether: 'Éter' };

export type Personality = 'ambicioso' | 'honrado' | 'mercador' | 'cauteloso' | 'cruel';
export const PERSONALITY_INFO: Record<Personality, string> = {
  ambicioso: 'Ambicioso — quer terras e títulos; ataca quem parece fraco.',
  honrado: 'Honrado — cumpre a palavra e lembra de traições por muito tempo.',
  mercador: 'Mercador — valoriza ouro e comércio acima da glória.',
  cauteloso: 'Cauteloso — evita guerras e se curva diante da força.',
  cruel: 'Cruel — teme apenas quem o assusta; saqueia caravanas.',
};

export type Title = 'senhor' | 'lorde' | 'graolorde' | 'rei';
export const TITLE_NAMES: Record<Title, string> = { senhor: 'Senhor', lorde: 'Lorde', graolorde: 'Grão-lorde', rei: 'Rei' };

export type CrestPattern = 'plain' | 'party' | 'fess' | 'bend' | 'cross' | 'chevron' | 'quarter' | 'pale' | 'chief';
export interface Crest { c1: string; c2: string; pattern: CrestPattern; charge: string }

export interface Person {
  id: number;
  name: string;
  house: string;
  female: boolean;
  born: number;          // ano (fração) de nascimento
  alive: boolean;
  spouse: number;        // 0 = solteiro(a)
  father: number;
  mother: number;
  trait: string;
  sworn?: boolean;       // herói jurado à casa (não é de sangue)
  heroType?: string;     // tipo da unidade herói ligada a esta pessoa
  diedAt?: number;
  cause?: string;
}

export interface Opinion { trust: number; fear: number; legit: number }

export interface Debt { id: number; debtor: string; creditor: string; amount: number; due: number; interest: number }

export interface House {
  id: string;
  name: string;
  motto: string;
  crest: Crest;
  personality: Personality;
  lord: number;
  province: string;
  liege: string | null;
  title: Title;
  treasury: number;
  army: number;          // poder militar abstrato
  alive: boolean;
  /** opinião desta casa sobre o jogador */
  op: Opinion;
  /** relações com as outras casas: 'war' | 'ally' (ausente = neutro) */
  rel: Record<string, 'war' | 'ally'>;
  lastLetter: number;    // tempo (s) da última carta enviada ao jogador
  warSince?: number;
  casusBelli?: boolean;  // o jogador tem motivo justo contra esta casa
  pact?: boolean;        // pacto comercial com o jogador
}

export interface Market { stock: Record<Good, number>; target: Record<Good, number>; base: Record<Good, number> }

export interface Province {
  id: string;
  name: string;
  x: number; y: number;  // 0..100 no mapa do feudo
  owner: string;         // casa que governa
  pop: number;
  housing: number;
  food: number;
  security: number;
  content: number;       // contentamento 0..100
  wealth: number;        // multiplicador de prosperidade
  prod: Record<Good, number>; // produção relativa
  market: Market;
  desc: string;
  mapId?: string;        // campo de batalha RTS desta província
}

export interface Road { a: string; b: string; days: number; danger: number }

export type LetterKind =
  | 'presente' | 'alianca' | 'casamento' | 'emprestimo' | 'comercio' | 'vassalagem' | 'paz' | 'guerra'
  | 'pagar' | 'ameaca' | 'cobrar' | 'titulo' | 'aviso' | 'tributo' | 'pedido_ajuda' | 'oferta_compra' | 'resposta';

export interface Letter {
  id: number;
  from: string;          // casa
  to: string;
  kind: LetterKind;
  text: string;
  sentAt: number;        // tempo do reino (s)
  arriveAt: number;
  delivered: boolean;
  read?: boolean;
  /** cartas que pedem resposta do jogador */
  ask?: boolean;
  answered?: boolean;
  /** dados da proposta (pessoas do casamento, valor, mercadoria...) */
  data?: Record<string, number | string>;
  /** em respostas: aceita ou recusada; em perguntas: a carta de origem */
  accepted?: boolean;
  replyTo?: number;
}

export interface Caravan {
  id: number;
  owner: string;
  path: string[];        // províncias da rota
  seg: number;           // segmento atual (path[seg] -> path[seg+1])
  t: number;             // progresso no segmento 0..1
  good: Good;
  qty: number;
  silver: number;        // prata trazida de volta
  escort: number;        // 0..2
  returning: boolean;
  dest: string;
  fixedPrice?: number;   // venda combinada por carta
}

export interface ArmyUnit { type: string; hp?: number; hero?: { level: number; xp: number; skills: Record<string, number>; items: (string | null)[]; skillPts: number; person?: number } }

export interface Army {
  id: number;
  owner: string;
  path: string[];
  seg: number;
  t: number;
  units: ArmyUnit[];     // exército do jogador (unidades reais retiradas da província)
  power: number;         // exércitos das IAs são só poder
  target: string;
  intent: 'attack' | 'return' | 'raid' | 'help';
  waiting?: boolean;     // chegou e aguarda decisão de batalha
}

export interface Memory { house: string; t: number; text: string; trust: number; fear: number; legit: number }

export interface SellOrder { id: number; good: Good; qty: number; min: number }

export interface Budget { taxes: number; sales: number; tributeIn: number; salaries: number; tributeOut: number; interest: number; purchases: number }

export interface ChronicleEntry { t: number; year: number; season: number; text: string; kind: 'info' | 'war' | 'politics' | 'dynasty' | 'trade' | 'title' }

export interface RealmEvent { id: number; kind: 'battle' | 'assembly' | 'raid' | 'succession' | 'victory' | 'gameover'; data: Record<string, number | string>; t: number }

export type CouncilSeat = 'tesoureiro' | 'marechal' | 'chanceler' | 'espiao';
export const COUNCIL_INFO: Record<CouncilSeat, { name: string; desc: string }> = {
  tesoureiro: { name: 'Tesoureiro', desc: '+12% de impostos e juros menores.' },
  marechal: { name: 'Marechal', desc: '+15% de força em batalhas resolvidas e +segurança.' },
  chanceler: { name: 'Chanceler', desc: 'Cartas 35% mais rápidas e opiniões melhoram mais.' },
  espiao: { name: 'Mestre de espiões', desc: 'Mostra tesouro, exército e dívidas exatas das casas.' },
};

export interface Laws { tax: 0 | 1 | 2; trade: 0 | 1; levy: 0 | 1 }

export interface Raid { house: string; units: number[]; until: number; power: number; armyId: number }

export interface Realm {
  v: 1;
  time: number;          // segundos de jogo decorridos no reino
  rngS: number;
  nextId: number;
  player: string;        // id da casa do jogador
  crown: string;         // casa que detém a coroa
  houses: Record<string, House>;
  provinces: Record<string, Province>;
  roads: Road[];
  persons: Record<number, Person>;
  letters: Letter[];
  caravans: Caravan[];
  armies: Army[];
  memories: Memory[];
  debts: Debt[];
  orders: SellOrder[];
  chronicle: ChronicleEntry[];
  events: RealmEvent[];
  budget: Budget;
  lastBudget: Budget | null;
  laws: Laws;
  council: Partial<Record<CouncilSeat, number>>;
  heir: number;          // herdeiro designado (0 = primogenitura)
  raid: Raid | null;
  assemblyAt: number;    // tempo da assembleia pela coroa (0 = nenhuma)
  over: '' | 'rei' | 'extinta' | 'derrota';
  /** prata que chegou de fora (tributos, caravanas) e ainda vai para o cofre do jogador */
  pendingSilver: number;
  seasonIndex: number;   // estações completas
  unpaidDays?: number;   // dias seguidos sem pagar o soldo
  lastMined?: number;
  flow?: { mine: number; tax: number; wage: number }; // prata por minuto
}
