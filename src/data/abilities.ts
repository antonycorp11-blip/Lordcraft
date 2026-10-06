import type { AbilityDef, ItemDef } from './types';

// Parâmetros por nível: arrays indexados por (nível-1).
const A = (a: AbilityDef) => a;

export const ABILITIES: Record<string, AbilityDef> = {
  // ---------- Valmir ----------
  stormhammer: A({
    id: 'stormhammer', name: 'Martelo de Tormenta', icon: 'hammer', hotkey: 'T', kind: 'active', target: 'enemy', levels: 3,
    desc: 'Arremessa um martelo que causa dano e atordoa o alvo.', range: 6, mana: [75, 75, 75], cd: [9, 9, 9],
    p: { dmg: [100, 170, 240], stun: [2, 2.5, 3] },
  }),
  thunderclap: A({
    id: 'thunderclap', name: 'Estrondo', icon: 'clap', hotkey: 'E', kind: 'active', target: 'none', levels: 3,
    desc: 'Golpeia o chão, ferindo e desacelerando inimigos próximos.', range: 0, mana: [90, 90, 90], cd: [8, 8, 8],
    p: { dmg: [60, 100, 140], radius: [3, 3.3, 3.6], slow: [0.5, 0.5, 0.5], dur: [4, 5, 6], maxTargets: [12, 14, 16] },
  }),
  bastion_aura: A({
    id: 'bastion_aura', name: 'Aura de Bastião', icon: 'shield', hotkey: 'D', kind: 'aura', target: 'none', levels: 3,
    desc: 'Aliados próximos recebem armadura adicional.', range: 0, mana: [0, 0, 0], cd: [0, 0, 0],
    p: { armor: [1.5, 3, 4.5], radius: [8, 8, 8] },
  }),
  avante: A({
    id: 'avante', name: 'Avante!', icon: 'banner', hotkey: 'R', kind: 'active', target: 'none', levels: 1, ultimate: true,
    desc: 'Grito de guerra: aliados próximos ganham dano e velocidade por 15s.', range: 0, mana: [150], cd: [90],
    p: { dmg: [0.3], speed: [0.25], radius: [10], dur: [15] },
  }),
  heal: A({
    id: 'heal', name: 'Cura', icon: 'heal', hotkey: 'C', kind: 'autocast', target: 'ally', levels: 1,
    desc: 'Restaura vida de um aliado ferido. Lançado automaticamente.', range: 6, mana: [20], cd: [1.5],
    p: { heal: [45] },
  }),
  bless: A({
    id: 'bless', name: 'Bênção do Escudo', icon: 'shield', hotkey: 'B', kind: 'active', target: 'ally', levels: 1,
    desc: 'Concede +4 de armadura a um aliado por 25s.', range: 7, mana: [50], cd: [4],
    p: { armor: [4], dur: [25] },
  }),
  shieldwall: A({
    id: 'shieldwall', name: 'Parede de Escudos', icon: 'shield', hotkey: '', kind: 'passive', target: 'none', levels: 1,
    desc: 'Recebe 35% menos dano perfurante.', range: 0, mana: [0], cd: [0], p: { reduce: [0.35] },
  }),
  // ---------- Kragg ----------
  seismic_stomp: A({
    id: 'seismic_stomp', name: 'Pisão Sísmico', icon: 'clap', hotkey: 'E', kind: 'active', target: 'none', levels: 3,
    desc: 'Faz a terra tremer, ferindo e atordoando brevemente os inimigos ao redor.', range: 0, mana: [100, 100, 100], cd: [10, 10, 10],
    p: { dmg: [70, 115, 160], radius: [3, 3.3, 3.6], stun: [0.8, 1.1, 1.4], maxTargets: [12, 14, 16] },
  }),
  war_cry: A({
    id: 'war_cry', name: 'Brado de Sangue', icon: 'fist', hotkey: 'D', kind: 'aura', target: 'none', levels: 3,
    desc: 'Aliados próximos causam mais dano.', range: 0, mana: [0, 0, 0], cd: [0, 0, 0],
    p: { dmg: [0.1, 0.18, 0.26], radius: [8, 8, 8] },
  }),
  blood_thirst: A({
    id: 'blood_thirst', name: 'Sede Rubra', icon: 'drop', hotkey: 'F', kind: 'passive', target: 'none', levels: 3,
    desc: 'Rouba vida a cada golpe.', range: 0, mana: [0, 0, 0], cd: [0, 0, 0],
    p: { steal: [0.15, 0.25, 0.35] },
  }),
  ash_avatar: A({
    id: 'ash_avatar', name: 'Avatar das Cinzas', icon: 'flame', hotkey: 'R', kind: 'active', target: 'none', levels: 1, ultimate: true,
    desc: 'Torna-se uma colossal fúria de cinzas: +8 armadura, +40 dano e imunidade a atordoamento por 20s.',
    range: 0, mana: [150], cd: [100], p: { armor: [8], dmg: [40], dur: [20] },
  }),
  bloodfury: A({
    id: 'bloodfury', name: 'Fúria Ancestral', icon: 'fist', hotkey: 'F', kind: 'autocast', target: 'ally', levels: 1,
    desc: 'Inflama um aliado: +35% velocidade de ataque e +20% movimento por 30s.', range: 7, mana: [45], cd: [2],
    p: { atk: [0.35], speed: [0.2], dur: [30] },
  }),
  ashveil: A({
    id: 'ashveil', name: 'Véu de Cinzas', icon: 'cloud', hotkey: 'V', kind: 'active', target: 'point', levels: 1,
    desc: 'Nuvem de cinzas que reduz a armadura dos inimigos em 3 por 12s.', range: 8, mana: [70], cd: [12],
    p: { armor: [3], radius: [3], dur: [12] },
  }),
  // ---------- Veymar ----------
  moonbeam: A({
    id: 'moonbeam', name: 'Raio Lunar', icon: 'moon', hotkey: 'T', kind: 'active', target: 'enemy', levels: 3,
    desc: 'Um feixe de luz lunar atinge um inimigo.', range: 7, mana: [80, 90, 100], cd: [7, 7, 7],
    p: { dmg: [110, 180, 250] },
  }),
  roots: A({
    id: 'roots', name: 'Raízes Famintas', icon: 'root', hotkey: 'E', kind: 'active', target: 'enemy', levels: 3,
    desc: 'Raízes prendem o alvo, causando dano contínuo.', range: 7, mana: [75, 75, 75], cd: [12, 12, 12],
    p: { dur: [2.5, 3.5, 4.5], dps: [15, 22, 30] },
  }),
  dew_aura: A({
    id: 'dew_aura', name: 'Aura de Orvalho', icon: 'drop', hotkey: 'D', kind: 'aura', target: 'none', levels: 3,
    desc: 'Aliados próximos regeneram vida mais rápido.', range: 0, mana: [0, 0, 0], cd: [0, 0, 0],
    p: { regen: [1, 2, 3], radius: [8, 8, 8] },
  }),
  starfall: A({
    id: 'starfall', name: 'Chuva Estelar', icon: 'star', hotkey: 'R', kind: 'active', target: 'point', levels: 1, ultimate: true,
    desc: 'Estrelas caem sobre uma área por 8s, atingindo até 10 inimigos por onda.', range: 9, mana: [175], cd: [110],
    p: { dmg: [45], radius: [5], dur: [8], maxTargets: [10] },
  }),
  summon_wolves: A({
    id: 'summon_wolves', name: 'Lobos Espirituais', icon: 'wolf', hotkey: 'W', kind: 'active', target: 'none', levels: 1,
    desc: 'Invoca dois lobos espirituais por 45s.', range: 0, mana: [100], cd: [22], p: { count: [2], dur: [45] },
  }),
  entangle: A({
    id: 'entangle', name: 'Enlaçar', icon: 'root', hotkey: 'E', kind: 'active', target: 'enemy', levels: 1,
    desc: 'Prende um inimigo ao solo por 3s.', range: 6, mana: [60], cd: [10], p: { dur: [3], dps: [8] },
  }),
  dust: A({
    id: 'dust', name: 'Pó Sonolento', icon: 'cloud', hotkey: '', kind: 'passive', target: 'none', levels: 1,
    desc: 'Ataques desaceleram o alvo em 25%.', range: 0, mana: [0], cd: [0], p: { slow: [0.25], dur: [3] },
  }),
  // ---------- Durn ----------
  frag_grenade: A({
    id: 'frag_grenade', name: 'Granada de Fragmentação', icon: 'bomb', hotkey: 'T', kind: 'active', target: 'point', levels: 3,
    desc: 'Lança uma granada que explode em área.', range: 8, mana: [85, 85, 85], cd: [8, 8, 8],
    p: { dmg: [70, 115, 160], radius: [2.2, 2.4, 2.6], maxTargets: [10, 12, 14] },
  }),
  turret: A({
    id: 'turret', name: 'Torreta Portátil', icon: 'gear', hotkey: 'E', kind: 'active', target: 'point', levels: 3,
    desc: 'Monta uma torreta automática por 30s.', range: 4, mana: [90, 90, 90], cd: [16, 16, 16],
    p: { dur: [30, 35, 40], lvl: [1, 2, 3] },
  }),
  plating_aura: A({
    id: 'plating_aura', name: 'Blindagem Rúnica', icon: 'shield', hotkey: 'D', kind: 'aura', target: 'none', levels: 3,
    desc: 'Aliados próximos ganham armadura; máquinas também regeneram.', range: 0, mana: [0, 0, 0], cd: [0, 0, 0],
    p: { armor: [1, 2, 3], regen: [2, 3, 4], radius: [8, 8, 8] },
  }),
  barrage: A({
    id: 'barrage', name: 'Bombardeio', icon: 'bomb', hotkey: 'R', kind: 'active', target: 'point', levels: 1, ultimate: true,
    desc: 'Chama um bombardeio de 8 obuses sobre a área.', range: 12, mana: [175], cd: [110],
    p: { dmg: [90], radius: [5], shells: [8], maxTargets: [8] },
  }),
  field_repair: A({
    id: 'field_repair', name: 'Reparo de Campo', icon: 'gear', hotkey: 'R', kind: 'autocast', target: 'ally', levels: 1,
    desc: 'Repara máquinas e edifícios aliados. Lançado automaticamente.', range: 5, mana: [12], cd: [1.5],
    p: { heal: [40] },
  }),
  flare: A({
    id: 'flare', name: 'Sinalizador', icon: 'star', hotkey: 'F', kind: 'active', target: 'point', levels: 1,
    desc: 'Revela uma área distante por 12s.', range: 30, mana: [40], cd: [20], p: { radius: [8], dur: [12] },
  }),
  // ---------- Edifícios ----------
  war_drums: A({
    id: 'war_drums', name: 'Tambores de Guerra', icon: 'drum', hotkey: '', kind: 'aura', target: 'none', levels: 1,
    desc: 'Unidades próximas atacam 20% mais rápido.', range: 0, mana: [0], cd: [0], p: { atk: [0.2], radius: [10] },
  }),
  healing_spring: A({
    id: 'healing_spring', name: 'Fonte Restauradora', icon: 'drop', hotkey: '', kind: 'aura', target: 'none', levels: 1,
    desc: 'Restaura vida e mana de todas as unidades próximas.', range: 0, mana: [0], cd: [0], p: { regen: [10], mregen: [4], radius: [5] },
  }),
};

export const ITEMS: Record<string, ItemDef> = {
  pocao_vida: { id: 'pocao_vida', name: 'Poção de Seiva Rubra', desc: 'Restaura 350 de vida.', kind: 'consumable', cost: 100, icon: 'potion-red', use: { heal: 350 } },
  pocao_mana: { id: 'pocao_mana', name: 'Frasco de Éter', desc: 'Restaura 175 de mana.', kind: 'consumable', cost: 90, icon: 'potion-blue', use: { mana: 175 } },
  tomo_saber: { id: 'tomo_saber', name: 'Tomo das Eras', desc: 'Concede 150 de experiência.', kind: 'consumable', cost: 220, icon: 'tome', use: { xp: 150 } },
  anel_protecao: { id: 'anel_protecao', name: 'Anel de Granito', desc: '+3 de armadura.', kind: 'passive', cost: 160, icon: 'ring', stats: { armor: 3 } },
  lamina_rubra: { id: 'lamina_rubra', name: 'Lâmina Rubra', desc: '+8 de dano.', kind: 'passive', cost: 260, icon: 'blade', stats: { dmg: 8 } },
  botas_vento: { id: 'botas_vento', name: 'Botas do Vento Norte', desc: '+0.5 de velocidade.', kind: 'passive', cost: 200, icon: 'boots', stats: { speed: 0.5 } },
  amuleto_vigor: { id: 'amuleto_vigor', name: 'Amuleto do Vigor', desc: '+175 de vida e +1 regeneração.', kind: 'passive', cost: 220, icon: 'amulet', stats: { hp: 175, regen: 1 } },
  orbe_lunar: { id: 'orbe_lunar', name: 'Orbe Lunar', desc: '+120 de mana.', kind: 'passive', cost: 180, icon: 'orb', stats: { mana: 120 } },
};

export const ITEM_DROP_TABLE = {
  low: ['pocao_vida', 'pocao_mana', 'pocao_vida'],
  mid: ['anel_protecao', 'botas_vento', 'pocao_vida', 'orbe_lunar', 'tomo_saber'],
  high: ['lamina_rubra', 'amuleto_vigor', 'tomo_saber', 'anel_protecao'],
};
