import type { Crest, Good, Personality, Province, Road } from './types';

// O reino de Aldaris: oito províncias ligadas por estradas. A Casa Valcrest detém a coroa;
// Morvane governa a Marca Ocidental (onde o jogador funda sua casa) e Thorne a Oriental.

export const SEASON_SECS = 150;              // uma estação = 2,5 min de jogo
export const DAYS_PER_SEASON = 30;
export const DAY_SECS = SEASON_SECS / DAYS_PER_SEASON;
export const SEASON_NAMES = ['Primavera', 'Verão', 'Outono', 'Inverno'];
export const START_YEAR = 312;
export const PEACE_SEASONS = 4;              // ninguém declara guerra ao jogador antes disso

export interface HouseSeed {
  id: string; name: string; motto: string; crest: Crest; personality: Personality;
  province: string; liege: string | null; title: 'senhor' | 'lorde' | 'graolorde' | 'rei';
  treasury: number; army: number; lordAge: number; lordFemale?: boolean;
}

export const HOUSE_SEEDS: HouseSeed[] = [
  { id: 'valcrest', name: 'Valcrest', motto: 'A coroa não se curva.', crest: { c1: '#3b2a6b', c2: '#e8c25a', pattern: 'chief', charge: '♛' },
    personality: 'honrado', province: 'coroa', liege: null, title: 'rei', treasury: 2600, army: 2400, lordAge: 67 },
  { id: 'morvane', name: 'Morvane', motto: 'Muralhas antes de palavras.', crest: { c1: '#24476b', c2: '#d9dde3', pattern: 'fess', charge: '♜' },
    personality: 'cauteloso', province: 'morvane', liege: 'valcrest', title: 'graolorde', treasury: 1500, army: 1500, lordAge: 54 },
  { id: 'thorne', name: 'Thorne', motto: 'O fogo forja reis.', crest: { c1: '#7a1d1d', c2: '#1b1b1b', pattern: 'bend', charge: '✠' },
    personality: 'cruel', province: 'brasa', liege: 'valcrest', title: 'graolorde', treasury: 1300, army: 1700, lordAge: 46 },
  { id: 'velsa', name: 'Velsa', motto: 'Toda maré tem seu preço.', crest: { c1: '#1d6b6b', c2: '#f2e6c4', pattern: 'chevron', charge: '⚓' },
    personality: 'mercador', province: 'salgado', liege: 'thorne', title: 'lorde', treasury: 1900, army: 700, lordAge: 51, lordFemale: true },
  { id: 'draven', name: 'Draven', motto: 'Sob os pinheiros, paciência.', crest: { c1: '#21402a', c2: '#c8b27a', pattern: 'pale', charge: '♣' },
    personality: 'cauteloso', province: 'pinhal', liege: 'morvane', title: 'lorde', treasury: 700, army: 650, lordAge: 39 },
  { id: 'ostrel', name: 'Ostrel', motto: 'O trigo alimenta a honra.', crest: { c1: '#c9a227', c2: '#5a3a14', pattern: 'party', charge: '❦' },
    personality: 'honrado', province: 'trigal', liege: 'morvane', title: 'lorde', treasury: 900, army: 800, lordAge: 58 },
  { id: 'brannoc', name: 'Brannoc', motto: 'O que brilha, é nosso.', crest: { c1: '#4b2f6b', c2: '#7fd6e8', pattern: 'quarter', charge: '✦' },
    personality: 'ambicioso', province: 'cristal', liege: 'thorne', title: 'lorde', treasury: 1100, army: 1000, lordAge: 33 },
];

type ProvSeed = Omit<Province, 'market' | 'pop' | 'housing' | 'food' | 'security' | 'content'> & { pop: number };

export const PROVINCE_SEEDS: ProvSeed[] = [
  { id: 'ermo', name: 'Vale do Ermo', x: 11, y: 58, owner: '', pop: 30, wealth: 1, prod: { food: 1, wood: 1.2, aether: 0.6 }, mapId: 'vale',
    desc: 'Terras quase vazias na fronteira oeste. Boas florestas e veios de prata intocados.' },
  { id: 'morvane', name: 'Marca de Morvane', x: 29, y: 36, owner: 'morvane', pop: 140, wealth: 1.2, prod: { food: 1, wood: 0.9, aether: 0.7 }, mapId: 'estreito',
    desc: 'Fortalezas cinzentas que guardam a passagem para a capital.' },
  { id: 'pinhal', name: 'Pinhal Negro', x: 22, y: 81, owner: 'draven', pop: 80, wealth: 0.9, prod: { food: 0.7, wood: 1.8, aether: 0.5 }, mapId: 'vale',
    desc: 'Floresta densa. A madeira é barata e as estradas, perigosas.' },
  { id: 'trigal', name: 'Trigal Dourado', x: 42, y: 66, owner: 'ostrel', pop: 120, wealth: 1.1, prod: { food: 1.9, wood: 0.6, aether: 0.4 }, mapId: 'vale',
    desc: 'O celeiro do reino. Grãos fartos, fome rara.' },
  { id: 'coroa', name: 'Alta Coroa', x: 53, y: 44, owner: 'valcrest', pop: 260, wealth: 1.6, prod: { food: 0.6, wood: 0.5, aether: 0.8 }, mapId: 'estreito',
    desc: 'A capital de Aldaris. Mercados ricos e uma corte faminta por tudo.' },
  { id: 'brasa', name: 'Brasaria', x: 71, y: 22, owner: 'thorne', pop: 150, wealth: 1.2, prod: { food: 0.6, wood: 0.8, aether: 1.1 }, mapId: 'coroa',
    desc: 'Forjas e minas sob montanhas fumegantes. Guerreiros duros.' },
  { id: 'salgado', name: 'Porto Salgado', x: 88, y: 52, owner: 'velsa', pop: 170, wealth: 1.5, prod: { food: 1.2, wood: 0.5, aether: 0.6 }, mapId: 'estreito',
    desc: 'O maior porto do reino. Tudo se compra, tudo se vende.' },
  { id: 'cristal', name: 'Picos de Éter', x: 72, y: 80, owner: 'brannoc', pop: 90, wealth: 1.1, prod: { food: 0.5, wood: 0.6, aether: 2.0 }, mapId: 'coroa',
    desc: 'Cristais de éter brotam das rochas. Cobiçados por todas as casas.' },
];

export const ROADS: Road[] = [
  { a: 'ermo', b: 'morvane', days: 5, danger: 0.04 },
  { a: 'ermo', b: 'pinhal', days: 4, danger: 0.12 },
  { a: 'ermo', b: 'trigal', days: 6, danger: 0.06 },
  { a: 'morvane', b: 'coroa', days: 5, danger: 0.02 },
  { a: 'morvane', b: 'pinhal', days: 6, danger: 0.1 },
  { a: 'trigal', b: 'coroa', days: 4, danger: 0.03 },
  { a: 'trigal', b: 'pinhal', days: 5, danger: 0.08 },
  { a: 'trigal', b: 'cristal', days: 7, danger: 0.1 },
  { a: 'coroa', b: 'brasa', days: 5, danger: 0.05 },
  { a: 'coroa', b: 'salgado', days: 7, danger: 0.05 },
  { a: 'coroa', b: 'cristal', days: 6, danger: 0.07 },
  { a: 'brasa', b: 'salgado', days: 5, danger: 0.09 },
  { a: 'salgado', b: 'cristal', days: 5, danger: 0.06 },
];

/** Preço base de cada mercadoria (em prata) antes da oferta e procura locais. */
export const BASE_PRICE: Record<Good, number> = { food: 2, wood: 1.6, aether: 6 };

export const MALE_NAMES = ['Aldo', 'Bernard', 'Cael', 'Dorian', 'Edric', 'Falk', 'Garran', 'Hadric', 'Ivo', 'Joran', 'Kellan', 'Lucan', 'Marek',
  'Niall', 'Osric', 'Peyton', 'Quill', 'Roderic', 'Soren', 'Tobin', 'Ulric', 'Valen', 'Wendel', 'Yorick', 'Alaric', 'Brennan', 'Corwin', 'Darren'];
export const FEMALE_NAMES = ['Alys', 'Brienne', 'Celia', 'Daria', 'Elin', 'Freya', 'Gwen', 'Helena', 'Isolde', 'Jessa', 'Kaia', 'Lyra', 'Maren',
  'Nessa', 'Odelia', 'Petra', 'Rhea', 'Sabine', 'Tamsin', 'Una', 'Vera', 'Wren', 'Yara', 'Aveline', 'Beatrix', 'Catelyn', 'Delphine'];
export const TRAITS = ['corajoso', 'astuto', 'piedoso', 'ganancioso', 'leal', 'impaciente', 'justo', 'ardiloso', 'gentil', 'orgulhoso'];

export const PATTERNS: Crest['pattern'][] = ['plain', 'party', 'fess', 'bend', 'cross', 'chevron', 'quarter', 'pale', 'chief'];
export const CHARGES = ['✦', '♜', '♞', '☀', '❦', '✠', '☾', '♣', '♛', '⚓', '❂', '✧'];
export const CREST_COLORS = ['#7a1d1d', '#24476b', '#21402a', '#c9a227', '#3b2a6b', '#1d6b6b', '#d9dde3', '#1b1b1b', '#8a4b1f', '#e8c25a', '#b9375a', '#f2e6c4'];
