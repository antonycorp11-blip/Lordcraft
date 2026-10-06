import type {
  AttackDef, BuildingDef, FactionDef, FactionId, ResearchDef, UnitDef, ArmorType, DmgType,
} from './types';

// ============================================================================
// Mundo de Aldaris — após a Fratura do Céu, quatro povos disputam os veios de
// prata e os cristais de éter que brotaram das cicatrizes da terra.
// ============================================================================

const atk = (
  dmg: [number, number], range: number, cd: number, type: DmgType,
  extra: Partial<AttackDef> = {},
): AttackDef => ({ dmg, range, cd, type, targets: range > 1.5 ? 'both' : 'ground', windup: range > 1.5 ? 0.3 : 0.35, ...extra });

type UArgs = Omit<UnitDef, 'radius' | 'sight' | 'armorType'> & Partial<Pick<UnitDef, 'radius' | 'sight' | 'armorType'>>;
const U = (u: UArgs): UnitDef => ({
  radius: 0.36, sight: 8, armorType: 'medium' as ArmorType, ...u,
});

type BArgs = Omit<BuildingDef, 'sight' | 'armor'> & Partial<Pick<BuildingDef, 'sight' | 'armor'>>;
const B = (b: BArgs): BuildingDef => ({ sight: 9, armor: 5, ...b });

const workerBuilds = (f: string, list: string[]) => list.map((s) => `${f}_${s}`);

// ---------------------------------------------------------------------------
// VALMIR — Reino de Valmir: muralhas de pedra branca, tropas resistentes.
// ---------------------------------------------------------------------------
const valmirUnits: UnitDef[] = [
  U({
    id: 'v_lavrador', name: 'Lavrador', faction: 'valmir', cls: 'worker',
    desc: 'Coleta prata e madeira, constrói e repara. Vários lavradores aceleram a obra.',
    cost: { silver: 75 }, supply: 1, time: 15, hp: 220, armor: 0, speed: 2.6,
    attack: atk([5, 7], 0.7, 1.6, 'blade'),
    gather: { carry: { silver: 10, wood: 10, aether: 5 }, mineTime: 1.0, chopTime: 0.9, crystalTime: 2.4, woodMode: 'chop' },
    builds: workerBuilds('v', ['paco', 'casa', 'quartel', 'serraria', 'forja', 'torre', 'muralha', 'santuario', 'oficina', 'aviario']),
    art: { body: 'human', gear: ['pick', 'hood'] },
  }),
  U({
    id: 'v_lanceiro', name: 'Lanceiro de Escudo', faction: 'valmir', cls: 'melee',
    desc: 'Infantaria pesada de linha. Parede de Escudos reduz dano perfurante.',
    cost: { silver: 125 }, supply: 2, time: 20, hp: 440, armor: 2, armorType: 'heavy', speed: 2.6,
    attack: atk([13, 16], 0.8, 1.35, 'blade'), abilities: ['shieldwall'],
    art: { body: 'human', gear: ['spear', 'shield', 'helm', 'tabard'] },
  }),
  U({
    id: 'v_besteiro', name: 'Besteiro', faction: 'valmir', cls: 'ranged',
    desc: 'Atirador de besta pesada. Bom contra unidades leves e aéreas.',
    cost: { silver: 135, wood: 25 }, supply: 2, time: 22, hp: 300, armor: 0, speed: 2.6, sight: 9,
    attack: atk([18, 22], 6, 1.7, 'pierce', { proj: 'bolt', projSpeed: 16 }),
    art: { body: 'human', gear: ['crossbow', 'cap', 'tabard'] },
  }),
  U({
    id: 'v_cavaleiro', name: 'Cavaleiro de Valmir', faction: 'valmir', cls: 'cavalry',
    desc: 'Cavalaria couraçada. Rápida e devastadora em investidas.',
    cost: { silver: 240, wood: 70 }, supply: 4, time: 32, hp: 820, armor: 4, armorType: 'heavy', speed: 3.6,
    radius: 0.55, requires: ['tier2', 'v_forja'],
    attack: atk([26, 32], 0.9, 1.5, 'blade'),
    art: { body: 'mount', gear: ['lance', 'helm', 'horse', 'tabard'] },
  }),
  U({
    id: 'v_cleriga', name: 'Clériga da Aurora', faction: 'valmir', cls: 'caster',
    desc: 'Sacerdotisa que cura aliados automaticamente e abençoa escudos.',
    cost: { silver: 150, wood: 30, aether: 20 }, supply: 2, time: 26, hp: 320, mana: 220, armor: 0, armorType: 'light',
    speed: 2.6, requires: ['tier2'], attack: atk([8, 10], 5, 1.8, 'arcane', { proj: 'orb', projSpeed: 12 }),
    abilities: ['heal', 'bless'], manaRegen: 1.1,
    art: { body: 'human', gear: ['staff', 'robe', 'veil'] },
  }),
  U({
    id: 'v_trabuco', name: 'Trabuco', faction: 'valmir', cls: 'siege',
    desc: 'Máquina de cerco de contrapeso. Arrasa fortificações à distância.',
    cost: { silver: 210, wood: 130 }, supply: 4, time: 34, hp: 520, armor: 1, armorType: 'heavy', speed: 1.7, sight: 9,
    radius: 0.6, mech: true, requires: ['tier2'],
    attack: atk([75, 95], 10.5, 4.5, 'siege', { proj: 'boulder', projSpeed: 9, splash: 1.3, minRange: 2, targets: 'ground', windup: 0.8 }),
    art: { body: 'machine', gear: ['trebuchet'] },
  }),
  U({
    id: 'v_falcoeiro', name: 'Falcoeiro', faction: 'valmir', cls: 'air',
    desc: 'Cavaleiro montado em falcão gigante. Domina os céus.',
    cost: { silver: 220, wood: 50, aether: 40 }, supply: 3, time: 34, hp: 560, armor: 1, armorType: 'light',
    speed: 4.2, sight: 10, air: true, radius: 0.5, requires: ['tier3'],
    attack: atk([20, 26], 4, 1.4, 'pierce', { proj: 'javelin', projSpeed: 15, targets: 'both' }),
    art: { body: 'flyer', gear: ['falcon', 'lance'] },
  }),
  U({
    id: 'v_marechal', name: 'Marechal Aldren', faction: 'valmir', cls: 'hero',
    desc: 'Herói. Comandante veterano das muralhas de Valmir.',
    cost: { silver: 425, wood: 100 }, supply: 5, time: 45, hp: 700, mana: 260, armor: 4, armorType: 'hero', speed: 3.0,
    sight: 10, radius: 0.45, attack: atk([24, 30], 0.9, 1.7, 'hero'), regen: 0.6, manaRegen: 0.8,
    hero: { title: 'Marechal', hpPerLvl: 85, dmgPerLvl: 3, manaPerLvl: 22, armorPerLvl: 0.5, abilities: ['stormhammer', 'thunderclap', 'bastion_aura', 'avante'] },
    art: { body: 'human', gear: ['hammer', 'shield', 'helm', 'cape', 'tabard'], scale: 1.25 },
  }),
];

const valmirBuildings: BuildingDef[] = [
  B({
    id: 'v_paco', name: 'Paço Real', faction: 'valmir', cat: 'hall', desc: 'Centro do reino. Recebe recursos e treina lavradores.',
    cost: { silver: 400, wood: 180 }, time: 80, hp: 1800, size: 4, arch: 'hall', supply: 12, tier: 1,
    trains: ['v_lavrador', 'v_marechal'], dropoff: ['silver', 'wood', 'aether'], upgradesTo: 'v_fortaleza', heroRevive: true,
  }),
  B({
    id: 'v_fortaleza', name: 'Fortaleza', faction: 'valmir', cat: 'hall', desc: 'Paço fortificado. Libera o segundo nível tecnológico.',
    cost: { silver: 300, wood: 200 }, time: 70, hp: 2300, size: 4, arch: 'hall', supply: 12, tier: 2, armor: 6,
    trains: ['v_lavrador', 'v_marechal'], dropoff: ['silver', 'wood', 'aether'], upgradesTo: 'v_cidadela', heroRevive: true,
  }),
  B({
    id: 'v_cidadela', name: 'Cidadela Branca', faction: 'valmir', cat: 'hall', desc: 'Coração inexpugnável de Valmir. Nível tecnológico máximo.',
    cost: { silver: 350, wood: 250, aether: 50 }, time: 90, hp: 2900, size: 4, arch: 'hall', supply: 12, tier: 3, armor: 7,
    trains: ['v_lavrador', 'v_marechal'], dropoff: ['silver', 'wood', 'aether'], heroRevive: true,
  }),
  B({ id: 'v_casa', name: 'Casa de Colono', faction: 'valmir', cat: 'house', desc: '+10 de abastecimento.', cost: { silver: 80, wood: 20 }, time: 30, hp: 520, size: 2, arch: 'house', supply: 10 }),
  B({
    id: 'v_quartel', name: 'Quartel', faction: 'valmir', cat: 'production', desc: 'Treina infantaria e cavalaria.',
    cost: { silver: 180, wood: 60 }, time: 55, hp: 1300, size: 3, arch: 'barracks', trains: ['v_lanceiro', 'v_besteiro', 'v_cavaleiro'],
  }),
  B({
    id: 'v_serraria', name: 'Serraria', faction: 'valmir', cat: 'economy', desc: 'Depósito de madeira. Pesquisa técnicas de corte e alvenaria.',
    cost: { silver: 120 }, time: 40, hp: 900, size: 3, arch: 'mill', dropoff: ['wood', 'silver'], researches: ['v_r_serras', 'v_r_alvenaria'],
  }),
  B({
    id: 'v_forja', name: 'Forja Real', faction: 'valmir', cat: 'research', desc: 'Aprimora armas e armaduras.',
    cost: { silver: 140, wood: 60 }, time: 50, hp: 1100, size: 3, arch: 'forge',
    researches: ['v_r_armas1', 'v_r_armas2', 'v_r_armad1', 'v_r_armad2'],
  }),
  B({
    id: 'v_santuario', name: 'Santuário da Aurora', faction: 'valmir', cat: 'production', desc: 'Treina clérigas.',
    cost: { silver: 160, wood: 120 }, time: 50, hp: 1000, size: 3, arch: 'temple', requires: ['tier2'],
    trains: ['v_cleriga'], researches: ['v_r_votos'],
  }),
  B({
    id: 'v_oficina', name: 'Oficina de Cerco', faction: 'valmir', cat: 'production', desc: 'Constrói trabucos.',
    cost: { silver: 160, wood: 140 }, time: 50, hp: 1100, size: 3, arch: 'workshop', requires: ['tier2', 'v_forja'],
    trains: ['v_trabuco'], researches: ['v_r_contrapeso'],
  }),
  B({
    id: 'v_aviario', name: 'Aviário Real', faction: 'valmir', cat: 'production', desc: 'Adestra falcões de guerra.',
    cost: { silver: 200, wood: 160, aether: 40 }, time: 60, hp: 1200, size: 3, arch: 'aviary', requires: ['tier3'], trains: ['v_falcoeiro'],
  }),
  B({
    id: 'v_torre', name: 'Torre de Vigia', faction: 'valmir', cat: 'defense', desc: 'Torre de pedra com besteiros.',
    cost: { silver: 110, wood: 70 }, time: 35, hp: 650, size: 2, arch: 'tower', sight: 11,
    attack: atk([20, 24], 7.5, 1.0, 'pierce', { proj: 'arrow', projSpeed: 18, targets: 'both' }),
  }),
  B({
    id: 'v_muralha', name: 'Muralha', faction: 'valmir', cat: 'wall', desc: 'Segmento de muralha. Bloqueia passagens.',
    cost: { silver: 10, wood: 15 }, time: 10, hp: 450, size: 1, arch: 'wall', armor: 8, sight: 3,
  }),
];

// ---------------------------------------------------------------------------
// KRAGG — Clãs de Kragg: povo-fera das terras de cinza. Hordas numerosas.
// ---------------------------------------------------------------------------
const kraggUnits: UnitDef[] = [
  U({
    id: 'k_carregador', name: 'Carregador', faction: 'kragg', cls: 'worker',
    desc: 'Trabalhador robusto. Carrega fardos maiores, porém demora mais na mina.',
    cost: { silver: 65 }, supply: 1, time: 15, hp: 260, armor: 0, speed: 2.7,
    attack: atk([6, 8], 0.7, 1.6, 'blade'),
    gather: { carry: { silver: 15, wood: 15, aether: 6 }, mineTime: 1.6, chopTime: 0.8, crystalTime: 2.8, woodMode: 'chop' },
    builds: workerBuilds('k', ['fogueira', 'tenda', 'arena', 'deposito', 'forja', 'torre', 'tambores', 'circulo', 'patio', 'ninho']),
    art: { body: 'beastman', gear: ['pick', 'sack'] },
  }),
  U({
    id: 'k_brutamonte', name: 'Brutamonte', faction: 'kragg', cls: 'melee',
    desc: 'Guerreiro de machado. Barato e treinado rapidamente.',
    cost: { silver: 105 }, supply: 2, time: 18, hp: 470, armor: 1, speed: 2.8,
    attack: atk([15, 19], 0.8, 1.4, 'blade'), regen: 0.4,
    art: { body: 'beastman', gear: ['axe', 'horns', 'pauldron'] },
  }),
  U({
    id: 'k_arremessador', name: 'Arremessador', faction: 'kragg', cls: 'ranged',
    desc: 'Lança azagaias farpadas. Eficaz contra unidades leves e aéreas.',
    cost: { silver: 115, wood: 20 }, supply: 2, time: 20, hp: 320, armor: 0, speed: 2.8,
    attack: atk([19, 23], 5.5, 1.8, 'pierce', { proj: 'javelin', projSpeed: 14 }),
    art: { body: 'beastman', gear: ['javelins', 'mohawk'] },
  }),
  U({
    id: 'k_javali', name: 'Cavaleiro de Javali', faction: 'kragg', cls: 'cavalry',
    desc: 'Saqueador veloz com tochas: dano extra contra edifícios.',
    cost: { silver: 190, wood: 40 }, supply: 3, time: 26, hp: 640, armor: 2, speed: 4.0, radius: 0.55,
    requires: ['tier2'], attack: atk([18, 22], 0.9, 1.4, 'blade', { bonusVsBuild: 1.6 }),
    art: { body: 'mount', gear: ['boar', 'torch', 'horns'] },
  }),
  U({
    id: 'k_xama', name: 'Xamã das Cinzas', faction: 'kragg', cls: 'caster',
    desc: 'Inflama aliados com fúria ancestral e cega inimigos com cinzas.',
    cost: { silver: 140, wood: 20, aether: 20 }, supply: 2, time: 24, hp: 330, mana: 200, armor: 0, armorType: 'light',
    speed: 2.7, requires: ['tier2'], attack: atk([9, 11], 5, 1.8, 'arcane', { proj: 'fire', projSpeed: 12 }),
    abilities: ['bloodfury', 'ashveil'], manaRegen: 1.0,
    art: { body: 'beastman', gear: ['staff', 'skull', 'robe'] },
  }),
  U({
    id: 'k_lancapedras', name: 'Lança-Pedras', faction: 'kragg', cls: 'siege',
    desc: 'Catapulta de ossos e couro que arremessa rochas incandescentes.',
    cost: { silver: 190, wood: 110 }, supply: 4, time: 30, hp: 500, armor: 1, armorType: 'heavy', speed: 1.8,
    radius: 0.6, mech: true, requires: ['tier2'],
    attack: atk([70, 90], 10, 4.2, 'siege', { proj: 'stone', projSpeed: 9, splash: 1.4, minRange: 2, targets: 'ground', windup: 0.8 }),
    art: { body: 'machine', gear: ['catapult'] },
  }),
  U({
    id: 'k_abutre', name: 'Abutre de Guerra', faction: 'kragg', cls: 'air',
    desc: 'Montaria alada que cospe bile corrosiva.',
    cost: { silver: 200, wood: 40, aether: 30 }, supply: 3, time: 30, hp: 520, armor: 0, armorType: 'light',
    speed: 4.4, sight: 10, air: true, radius: 0.5, requires: ['tier3'],
    attack: atk([18, 24], 3.5, 1.3, 'pierce', { proj: 'spit', projSpeed: 13, targets: 'both' }),
    art: { body: 'vulture', gear: [] },
  }),
  U({
    id: 'k_ruvak', name: 'Grão-Chefe Ruvak', faction: 'kragg', cls: 'hero',
    desc: 'Herói. Senhor da guerra dos clãs, alimentado por fúria e sangue.',
    cost: { silver: 400, wood: 90 }, supply: 5, time: 42, hp: 760, mana: 220, armor: 3, armorType: 'hero', speed: 3.1,
    sight: 10, radius: 0.48, attack: atk([26, 32], 0.9, 1.6, 'hero'), regen: 0.8, manaRegen: 0.6,
    hero: { title: 'Senhor da Guerra', hpPerLvl: 95, dmgPerLvl: 3.4, manaPerLvl: 16, armorPerLvl: 0.4, abilities: ['seismic_stomp', 'war_cry', 'blood_thirst', 'ash_avatar'] },
    art: { body: 'beastman', gear: ['greataxe', 'horns', 'pauldron', 'cape'], scale: 1.3 },
  }),
];

const kraggBuildings: BuildingDef[] = [
  B({
    id: 'k_fogueira', name: 'Grande Fogueira', faction: 'kragg', cat: 'hall', desc: 'Coração do clã. Recebe recursos e treina carregadores.',
    cost: { silver: 360, wood: 160 }, time: 75, hp: 1600, size: 4, arch: 'hall', supply: 14, tier: 1,
    trains: ['k_carregador', 'k_ruvak'], dropoff: ['silver', 'wood', 'aether'], upgradesTo: 'k_bastiao', heroRevive: true,
  }),
  B({
    id: 'k_bastiao', name: 'Bastião de Ossos', faction: 'kragg', cat: 'hall', desc: 'Fogueira cercada por paliçadas. Segundo nível.',
    cost: { silver: 280, wood: 180 }, time: 65, hp: 2100, size: 4, arch: 'hall', supply: 14, tier: 2,
    trains: ['k_carregador', 'k_ruvak'], dropoff: ['silver', 'wood', 'aether'], upgradesTo: 'k_trono', heroRevive: true,
  }),
  B({
    id: 'k_trono', name: 'Trono de Cinzas', faction: 'kragg', cat: 'hall', desc: 'Fortaleza dos senhores da guerra. Nível máximo.',
    cost: { silver: 330, wood: 230, aether: 50 }, time: 85, hp: 2600, size: 4, arch: 'hall', supply: 14, tier: 3,
    trains: ['k_carregador', 'k_ruvak'], dropoff: ['silver', 'wood', 'aether'], heroRevive: true,
  }),
  B({ id: 'k_tenda', name: 'Tenda do Clã', faction: 'kragg', cat: 'house', desc: '+12 de abastecimento.', cost: { silver: 70, wood: 20 }, time: 25, hp: 420, size: 2, arch: 'house', supply: 12, armor: 3 }),
  B({
    id: 'k_arena', name: 'Arena de Guerra', faction: 'kragg', cat: 'production', desc: 'Treina guerreiros — dois de cada vez.',
    cost: { silver: 170, wood: 50 }, time: 50, hp: 1150, size: 3, arch: 'barracks', parallel: 2, armor: 4,
    trains: ['k_brutamonte', 'k_arremessador', 'k_javali'],
  }),
  B({
    id: 'k_deposito', name: 'Depósito de Toras', faction: 'kragg', cat: 'economy', desc: 'Recebe madeira e prata. Pesquisa ferramentas.',
    cost: { silver: 110 }, time: 35, hp: 800, size: 3, arch: 'mill', dropoff: ['wood', 'silver'], armor: 4,
    researches: ['k_r_machados', 'k_r_palicada'],
  }),
  B({
    id: 'k_forja', name: 'Forja de Ossos', faction: 'kragg', cat: 'research', desc: 'Aprimora armas e armaduras dos clãs.',
    cost: { silver: 130, wood: 50 }, time: 45, hp: 1000, size: 3, arch: 'forge', armor: 4,
    researches: ['k_r_armas1', 'k_r_armas2', 'k_r_armad1', 'k_r_armad2'],
  }),
  B({
    id: 'k_circulo', name: 'Círculo de Totens', faction: 'kragg', cat: 'production', desc: 'Treina xamãs.',
    cost: { silver: 150, wood: 100 }, time: 45, hp: 950, size: 3, arch: 'temple', requires: ['tier2'], trains: ['k_xama'], parallel: 2, armor: 4,
  }),
  B({
    id: 'k_patio', name: 'Pátio de Cerco', faction: 'kragg', cat: 'production', desc: 'Monta lança-pedras.',
    cost: { silver: 150, wood: 130 }, time: 45, hp: 1000, size: 3, arch: 'workshop', requires: ['tier2'], trains: ['k_lancapedras'], armor: 4,
  }),
  B({
    id: 'k_ninho', name: 'Ninho de Abutres', faction: 'kragg', cat: 'production', desc: 'Cria abutres de guerra.',
    cost: { silver: 190, wood: 150, aether: 30 }, time: 55, hp: 1100, size: 3, arch: 'aviary', requires: ['tier3'], trains: ['k_abutre'], parallel: 2, armor: 4,
  }),
  B({
    id: 'k_torre', name: 'Torre de Espinhos', faction: 'kragg', cat: 'defense', desc: 'Atalaia de madeira com arremessadores.',
    cost: { silver: 100, wood: 70 }, time: 30, hp: 560, size: 2, arch: 'tower', sight: 11, armor: 4,
    attack: atk([22, 26], 7, 1.1, 'pierce', { proj: 'javelin', projSpeed: 16, targets: 'both' }),
  }),
  B({
    id: 'k_tambores', name: 'Tambores de Guerra', faction: 'kragg', cat: 'special', desc: 'Unidades próximas atacam 20% mais rápido.',
    cost: { silver: 150, wood: 80, aether: 20 }, time: 40, hp: 700, size: 2, arch: 'drums', requires: ['tier2'],
    aura: { ability: 'war_drums', radius: 10 }, armor: 4,
  }),
];

// ---------------------------------------------------------------------------
// VEYMAR — Círculo de Veymar: povo das florestas lunares. Magia e invocações.
// ---------------------------------------------------------------------------
const veymarUnits: UnitDef[] = [
  U({
    id: 'y_lanterneiro', name: 'Lanterneiro', faction: 'veymar', cls: 'worker',
    desc: 'Espírito-lanterna. Extrai seiva das árvores sem derrubá-las. Planta edifícios que crescem sozinhos.',
    cost: { silver: 70 }, supply: 1, time: 15, hp: 190, armor: 0, speed: 2.9, armorType: 'light',
    attack: atk([4, 6], 0.7, 1.6, 'arcane'),
    gather: { carry: { silver: 10, wood: 8, aether: 6 }, mineTime: 1.0, chopTime: 1.15, crystalTime: 2.2, woodMode: 'tap' },
    builds: workerBuilds('y', ['arvore_mae', 'poco', 'bosque', 'raiz', 'ambar', 'vigia', 'santuario', 'jardim', 'casulario']),
    art: { body: 'spirit', gear: ['lantern'] },
  }),
  U({
    id: 'y_guardiao', name: 'Guardião de Casca', faction: 'veymar', cls: 'melee',
    desc: 'Guerreiro revestido de casca viva. Lento, resistente e regenera.',
    cost: { silver: 140, wood: 20 }, supply: 3, time: 24, hp: 620, armor: 3, armorType: 'heavy', speed: 2.3, radius: 0.42,
    attack: atk([15, 19], 0.9, 1.6, 'blade'), regen: 1.5,
    art: { body: 'sylvan', gear: ['glaive', 'bark', 'antlers'] },
  }),
  U({
    id: 'y_arqueira', name: 'Arqueira Lunar', faction: 'veymar', cls: 'ranged',
    desc: 'Arqueira de longo alcance. Enxerga mais longe à noite.',
    cost: { silver: 130, wood: 30 }, supply: 2, time: 22, hp: 280, armor: 0, armorType: 'light', speed: 2.9, sight: 10, nightSight: 3,
    attack: atk([17, 21], 6.5, 1.5, 'pierce', { proj: 'moon', projSpeed: 18 }),
    art: { body: 'sylvan', gear: ['bow', 'hood', 'ears'] },
  }),
  U({
    id: 'y_invocadora', name: 'Invocadora', faction: 'veymar', cls: 'caster',
    desc: 'Chama lobos espirituais e prende inimigos com raízes.',
    cost: { silver: 150, wood: 30, aether: 20 }, supply: 2, time: 26, hp: 300, mana: 240, armor: 0, armorType: 'light', speed: 2.7,
    requires: ['tier2'], attack: atk([9, 12], 5.5, 1.8, 'arcane', { proj: 'orb', projSpeed: 12 }),
    abilities: ['summon_wolves', 'entangle'], manaRegen: 1.2,
    art: { body: 'sylvan', gear: ['staff', 'robe', 'ears'] },
  }),
  U({
    id: 'y_anciao', name: 'Ancião Arremessador', faction: 'veymar', cls: 'siege',
    desc: 'Árvore desperta que arremessa pedras contra muralhas.',
    cost: { silver: 200, wood: 120 }, supply: 4, time: 32, hp: 760, armor: 2, armorType: 'heavy', speed: 1.6, radius: 0.62,
    requires: ['tier2'], regen: 2,
    attack: atk([65, 85], 9, 4.0, 'siege', { proj: 'boulder', projSpeed: 9, splash: 1.2, minRange: 2, targets: 'ground', windup: 0.8 }),
    art: { body: 'treant', gear: [], scale: 1.1 },
  }),
  U({
    id: 'y_mariposa', name: 'Mariposa Colossal', faction: 'veymar', cls: 'air',
    desc: 'Inseto gigante cujo pó desacelera inimigos.',
    cost: { silver: 210, wood: 40, aether: 50 }, supply: 3, time: 32, hp: 500, armor: 0, armorType: 'light', speed: 3.8,
    sight: 10, air: true, radius: 0.55, requires: ['tier3'], abilities: ['dust'],
    attack: atk([22, 28], 4, 1.5, 'arcane', { proj: 'orb', projSpeed: 12, targets: 'both' }),
    art: { body: 'moth', gear: [] },
  }),
  U({
    id: 'y_lobo', name: 'Lobo Espiritual', faction: 'veymar', cls: 'summon',
    desc: 'Invocação temporária.', cost: {}, supply: 0, time: 0, hp: 260, armor: 1, speed: 3.6, radius: 0.4,
    attack: atk([10, 13], 0.8, 1.2, 'blade'), timedLife: 45, art: { body: 'beast', gear: ['spirit'] },
  }),
  U({
    id: 'y_sylra', name: 'Oráculo Sylra', faction: 'veymar', cls: 'hero',
    desc: 'Herói. Vidente que comanda a luz da lua e as raízes antigas.',
    cost: { silver: 400, wood: 100 }, supply: 5, time: 45, hp: 560, mana: 320, armor: 2, armorType: 'hero', speed: 3.1,
    sight: 11, radius: 0.42, attack: atk([20, 26], 5, 1.6, 'hero', { proj: 'moon', projSpeed: 16 }), regen: 0.5, manaRegen: 1.2,
    hero: { title: 'Oráculo', hpPerLvl: 70, dmgPerLvl: 3, manaPerLvl: 28, armorPerLvl: 0.4, abilities: ['moonbeam', 'roots', 'dew_aura', 'starfall'] },
    art: { body: 'sylvan', gear: ['staff', 'robe', 'ears', 'crown'], scale: 1.25 },
  }),
];

const veymarBuildings: BuildingDef[] = [
  B({
    id: 'y_arvore_mae', name: 'Árvore-Mãe', faction: 'veymar', cat: 'hall', desc: 'Centro do círculo. Cresce sozinha e regenera.',
    cost: { silver: 380, wood: 150 }, time: 80, hp: 1700, size: 4, arch: 'hall', supply: 12, tier: 1, regen: 2,
    trains: ['y_lanterneiro', 'y_sylra'], dropoff: ['silver', 'wood', 'aether'], upgradesTo: 'y_arvore_antiga', heroRevive: true,
  }),
  B({
    id: 'y_arvore_antiga', name: 'Árvore Antiga', faction: 'veymar', cat: 'hall', desc: 'A árvore desperta. Segundo nível.',
    cost: { silver: 290, wood: 200 }, time: 70, hp: 2200, size: 4, arch: 'hall', supply: 12, tier: 2, regen: 3,
    trains: ['y_lanterneiro', 'y_sylra'], dropoff: ['silver', 'wood', 'aether'], upgradesTo: 'y_arvore_eterna', heroRevive: true,
  }),
  B({
    id: 'y_arvore_eterna', name: 'Árvore Eterna', faction: 'veymar', cat: 'hall', desc: 'Copa que toca as estrelas. Nível máximo.',
    cost: { silver: 340, wood: 240, aether: 50 }, time: 90, hp: 2700, size: 4, arch: 'hall', supply: 12, tier: 3, regen: 4,
    trains: ['y_lanterneiro', 'y_sylra'], dropoff: ['silver', 'wood', 'aether'], heroRevive: true,
  }),
  B({
    id: 'y_poco', name: 'Poço Lunar', faction: 'veymar', cat: 'house', desc: '+10 abastecimento. Condensa éter (dobro à noite).',
    cost: { silver: 100, wood: 40 }, time: 30, hp: 480, size: 2, arch: 'house', supply: 10, aetherPerMin: 6, regen: 1,
  }),
  B({
    id: 'y_bosque', name: 'Bosque de Guerra', faction: 'veymar', cat: 'production', desc: 'Treina guardiões e arqueiras.',
    cost: { silver: 170, wood: 70 }, time: 55, hp: 1200, size: 3, arch: 'barracks', regen: 1.5, trains: ['y_guardiao', 'y_arqueira'],
  }),
  B({
    id: 'y_raiz', name: 'Raiz Coletora', faction: 'veymar', cat: 'economy', desc: 'Recebe seiva e prata. Pesquisa extração.',
    cost: { silver: 110 }, time: 35, hp: 850, size: 3, arch: 'mill', dropoff: ['wood', 'silver'], regen: 1.5,
    researches: ['y_r_seiva', 'y_r_casca'],
  }),
  B({
    id: 'y_ambar', name: 'Câmara de Âmbar', faction: 'veymar', cat: 'research', desc: 'Fortalece armas e cascas.',
    cost: { silver: 140, wood: 60 }, time: 50, hp: 1000, size: 3, arch: 'forge', regen: 1.5,
    researches: ['y_r_armas1', 'y_r_armas2', 'y_r_armad1', 'y_r_armad2'],
  }),
  B({
    id: 'y_santuario', name: 'Santuário Estelar', faction: 'veymar', cat: 'production', desc: 'Treina invocadoras.',
    cost: { silver: 160, wood: 120 }, time: 50, hp: 1000, size: 3, arch: 'temple', requires: ['tier2'], regen: 1.5,
    trains: ['y_invocadora'], researches: ['y_r_lua'],
  }),
  B({
    id: 'y_jardim', name: 'Jardim de Pedra', faction: 'veymar', cat: 'production', desc: 'Desperta anciões arremessadores.',
    cost: { silver: 160, wood: 150 }, time: 50, hp: 1100, size: 3, arch: 'workshop', requires: ['tier2'], regen: 1.5, trains: ['y_anciao'],
  }),
  B({
    id: 'y_casulario', name: 'Casulário', faction: 'veymar', cat: 'production', desc: 'Faz eclodir mariposas colossais.',
    cost: { silver: 200, wood: 160, aether: 40 }, time: 60, hp: 1150, size: 3, arch: 'aviary', requires: ['tier3'], regen: 1.5, trains: ['y_mariposa'],
  }),
  B({
    id: 'y_vigia', name: 'Vigia Espinhosa', faction: 'veymar', cat: 'defense', desc: 'Árvore-sentinela que dispara orbes lunares.',
    cost: { silver: 110, wood: 80 }, time: 35, hp: 600, size: 2, arch: 'tower', sight: 11, regen: 1.5,
    attack: atk([18, 22], 7, 1.0, 'arcane', { proj: 'moon', projSpeed: 16, targets: 'both' }),
  }),
];

// ---------------------------------------------------------------------------
// DURN — Forjas de Durn: clãs anões das alturas nevadas. Engenharia e vapor.
// ---------------------------------------------------------------------------
const durnUnits: UnitDef[] = [
  U({
    id: 'd_mineiro', name: 'Mineiro', faction: 'durn', cls: 'worker',
    desc: 'Lento, mas carrega o dobro de prata por viagem. Repara máquinas.',
    cost: { silver: 85 }, supply: 1, time: 17, hp: 300, armor: 1, speed: 2.3,
    attack: atk([7, 9], 0.7, 1.6, 'blade'),
    gather: { carry: { silver: 20, wood: 14, aether: 8 }, mineTime: 2.2, chopTime: 1.0, crystalTime: 3.0, woodMode: 'chop' },
    builds: workerBuilds('d', ['salao', 'alojamento', 'caserna', 'armazem', 'forja', 'torre', 'extrator', 'oficina', 'hangar', 'fundicao']),
    art: { body: 'dwarf', gear: ['pick', 'lamp', 'beard'] },
  }),
  U({
    id: 'd_couracado', name: 'Couraçado', faction: 'durn', cls: 'melee',
    desc: 'Infantaria em armadura de placas e martelo de guerra.',
    cost: { silver: 150, wood: 20 }, supply: 3, time: 24, hp: 560, armor: 5, armorType: 'heavy', speed: 2.2, radius: 0.4,
    attack: atk([16, 20], 0.8, 1.5, 'blade'),
    art: { body: 'dwarf', gear: ['warhammer', 'towershield', 'beard', 'helm'] },
  }),
  U({
    id: 'd_arcabuzeiro', name: 'Arcabuzeiro', faction: 'durn', cls: 'ranged',
    desc: 'Disparo lento e devastador de longo alcance.',
    cost: { silver: 150, wood: 40 }, supply: 2, time: 24, hp: 330, armor: 1, speed: 2.3, sight: 10,
    attack: atk([26, 32], 7.5, 2.4, 'pierce', { proj: 'bullet', projSpeed: 26 }),
    art: { body: 'dwarf', gear: ['musket', 'beard', 'cap'] },
  }),
  U({
    id: 'd_mecanico', name: 'Mecânico', faction: 'durn', cls: 'caster',
    desc: 'Repara máquinas e edifícios automaticamente. Lança sinalizadores.',
    cost: { silver: 120, wood: 40, aether: 20 }, supply: 2, time: 22, hp: 340, mana: 200, armor: 1, armorType: 'light', speed: 2.4,
    requires: ['tier2'], attack: atk([8, 10], 0.8, 1.6, 'blade'), abilities: ['field_repair', 'flare'], manaRegen: 1.0,
    art: { body: 'dwarf', gear: ['wrench', 'goggles', 'beard', 'pack'] },
  }),
  U({
    id: 'd_girocoptero', name: 'Girocóptero', faction: 'durn', cls: 'air',
    desc: 'Aeronave rápida, especialista em abater alvos aéreos.',
    cost: { silver: 170, wood: 60, aether: 20 }, supply: 2, time: 24, hp: 380, armor: 1, armorType: 'light', speed: 4.6, sight: 11,
    air: true, mech: true, radius: 0.45, requires: ['tier2'],
    attack: atk([14, 18], 4.5, 1.0, 'pierce', { proj: 'bullet', projSpeed: 24, targets: 'both', bonusVsAir: 2.0 }),
    art: { body: 'gyro', gear: [] },
  }),
  U({
    id: 'd_canhao', name: 'Canhão a Vapor', faction: 'durn', cls: 'siege',
    desc: 'Artilharia de longuíssimo alcance.',
    cost: { silver: 220, wood: 100, aether: 20 }, supply: 4, time: 34, hp: 560, armor: 2, armorType: 'heavy', speed: 1.6, radius: 0.6,
    mech: true, requires: ['tier2'],
    attack: atk([85, 105], 11, 4.8, 'siege', { proj: 'cannon', projSpeed: 14, splash: 1.5, minRange: 2.5, targets: 'ground', windup: 0.6 }),
    art: { body: 'machine', gear: ['cannon'] },
  }),
  U({
    id: 'd_golem', name: 'Golem de Bronze', faction: 'durn', cls: 'melee',
    desc: 'Colosso rúnico movido a éter. Esmaga muralhas e linhas inimigas.',
    cost: { silver: 320, wood: 100, aether: 80 }, supply: 6, time: 42, hp: 1600, armor: 6, armorType: 'heavy', speed: 2.0, radius: 0.75,
    mech: true, requires: ['tier3'], attack: atk([40, 52], 1.0, 2.0, 'siege', { splash: 0.9 }),
    art: { body: 'golem', gear: ['bronze'], scale: 1.5 },
  }),
  U({
    id: 'd_torreta', name: 'Torreta', faction: 'durn', cls: 'summon',
    desc: 'Torreta automática temporária.', cost: {}, supply: 0, time: 0, hp: 320, armor: 3, armorType: 'heavy', speed: 0, mech: true, radius: 0.45,
    attack: atk([14, 18], 6.5, 0.8, 'pierce', { proj: 'bullet', projSpeed: 24, targets: 'both' }), timedLife: 30,
    art: { body: 'turret', gear: [] },
  }),
  U({
    id: 'd_brunna', name: 'Engenheira-Mor Brunna', faction: 'durn', cls: 'hero',
    desc: 'Herói. Gênio das forjas, armada com um bacamarte rúnico.',
    cost: { silver: 425, wood: 100 }, supply: 5, time: 45, hp: 680, mana: 280, armor: 4, armorType: 'hero', speed: 2.8,
    sight: 10, radius: 0.45, attack: atk([22, 28], 4.5, 1.7, 'hero', { proj: 'bullet', projSpeed: 24 }), regen: 0.6, manaRegen: 0.9,
    hero: { title: 'Engenheira', hpPerLvl: 80, dmgPerLvl: 3, manaPerLvl: 22, armorPerLvl: 0.5, abilities: ['frag_grenade', 'turret', 'plating_aura', 'barrage'] },
    art: { body: 'dwarf', gear: ['musket', 'goggles', 'braids', 'pack', 'cape'], scale: 1.3 },
  }),
];

const durnBuildings: BuildingDef[] = [
  B({
    id: 'd_salao', name: 'Salão da Forja', faction: 'durn', cat: 'hall', desc: 'Salão de pedra e bronze. Recebe recursos.',
    cost: { silver: 420, wood: 180 }, time: 85, hp: 2000, size: 4, arch: 'hall', supply: 12, tier: 1, armor: 6,
    trains: ['d_mineiro', 'd_brunna'], dropoff: ['silver', 'wood', 'aether'], upgradesTo: 'd_bastiao', heroRevive: true,
  }),
  B({
    id: 'd_bastiao', name: 'Bastião a Vapor', faction: 'durn', cat: 'hall', desc: 'Salão blindado. Segundo nível.',
    cost: { silver: 300, wood: 200, aether: 20 }, time: 70, hp: 2500, size: 4, arch: 'hall', supply: 12, tier: 2, armor: 7,
    trains: ['d_mineiro', 'd_brunna'], dropoff: ['silver', 'wood', 'aether'], upgradesTo: 'd_cidadela', heroRevive: true,
  }),
  B({
    id: 'd_cidadela', name: 'Cidadela Rúnica', faction: 'durn', cat: 'hall', desc: 'Obra-prima de engenharia. Nível máximo.',
    cost: { silver: 350, wood: 250, aether: 60 }, time: 90, hp: 3100, size: 4, arch: 'hall', supply: 12, tier: 3, armor: 8,
    trains: ['d_mineiro', 'd_brunna'], dropoff: ['silver', 'wood', 'aether'], heroRevive: true,
  }),
  B({ id: 'd_alojamento', name: 'Alojamento', faction: 'durn', cat: 'house', desc: '+10 de abastecimento.', cost: { silver: 90, wood: 30 }, time: 30, hp: 700, size: 2, arch: 'house', supply: 10, armor: 6 }),
  B({
    id: 'd_caserna', name: 'Caserna', faction: 'durn', cat: 'production', desc: 'Treina couraçados e arcabuzeiros.',
    cost: { silver: 190, wood: 60 }, time: 55, hp: 1500, size: 3, arch: 'barracks', armor: 6, trains: ['d_couracado', 'd_arcabuzeiro'],
  }),
  B({
    id: 'd_armazem', name: 'Armazém', faction: 'durn', cat: 'economy', desc: 'Recebe madeira e prata. Pesquisa logística.',
    cost: { silver: 120 }, time: 40, hp: 1000, size: 3, arch: 'mill', armor: 6, dropoff: ['wood', 'silver'], researches: ['d_r_vagonetas', 'd_r_blindagem'],
  }),
  B({
    id: 'd_forja', name: 'Grande Forja', faction: 'durn', cat: 'research', desc: 'Armas, armaduras e pólvora.',
    cost: { silver: 150, wood: 60 }, time: 50, hp: 1200, size: 3, arch: 'forge', armor: 6,
    researches: ['d_r_armas1', 'd_r_armas2', 'd_r_armad1', 'd_r_armad2', 'd_r_polvora'],
  }),
  B({
    id: 'd_oficina', name: 'Oficina a Vapor', faction: 'durn', cat: 'production', desc: 'Constrói canhões e treina mecânicos.',
    cost: { silver: 170, wood: 140 }, time: 50, hp: 1250, size: 3, arch: 'workshop', armor: 6, requires: ['tier2'], trains: ['d_canhao', 'd_mecanico'],
  }),
  B({
    id: 'd_hangar', name: 'Hangar', faction: 'durn', cat: 'production', desc: 'Monta girocópteros.',
    cost: { silver: 170, wood: 120, aether: 20 }, time: 50, hp: 1100, size: 3, arch: 'aviary', armor: 6, requires: ['tier2'], trains: ['d_girocoptero'],
  }),
  B({
    id: 'd_fundicao', name: 'Fundição Rúnica', faction: 'durn', cat: 'production', desc: 'Forja golens de bronze.',
    cost: { silver: 220, wood: 160, aether: 60 }, time: 60, hp: 1400, size: 3, arch: 'temple', armor: 6, requires: ['tier3'], trains: ['d_golem'],
  }),
  B({
    id: 'd_torre', name: 'Torre de Canhão', faction: 'durn', cat: 'defense', desc: 'Dispara obuses com dano em área. Apenas alvos terrestres.',
    cost: { silver: 140, wood: 80 }, time: 40, hp: 750, size: 2, arch: 'tower', armor: 7, sight: 11,
    attack: atk([34, 42], 8, 2.4, 'siege', { proj: 'shell', projSpeed: 14, splash: 1.1, targets: 'ground' }),
  }),
  B({
    id: 'd_extrator', name: 'Extrator de Éter', faction: 'durn', cat: 'extractor', desc: 'Construído sobre cristais. Extrai éter automaticamente.',
    cost: { silver: 140, wood: 60 }, time: 40, hp: 650, size: 2, arch: 'extractor', armor: 6,
  }),
];

// ---------------------------------------------------------------------------
// Pesquisas
// ---------------------------------------------------------------------------
const MIL = ['melee', 'ranged', 'cavalry', 'air', 'siege', 'summon'] as const;
const weapons = (p: string, names: [string, string]): ResearchDef[] => [
  { id: `${p}_r_armas1`, name: names[0], desc: '+12% de dano para tropas.', cost: { silver: 125, wood: 75 }, time: 40, effects: [{ stat: 'dmg', mul: 0.12, cls: [...MIL] }], icon: 'sword' },
  { id: `${p}_r_armas2`, name: names[1], desc: '+12% de dano adicional para tropas.', cost: { silver: 200, wood: 150, aether: 25 }, time: 55, requires: ['tier2', `${p}_r_armas1`], effects: [{ stat: 'dmg', mul: 0.12, cls: [...MIL] }], icon: 'sword2' },
];
const armors = (p: string, names: [string, string]): ResearchDef[] => [
  { id: `${p}_r_armad1`, name: names[0], desc: '+2 de armadura para tropas.', cost: { silver: 125, wood: 75 }, time: 40, effects: [{ stat: 'armor', add: 2, cls: [...MIL] }], icon: 'armor' },
  { id: `${p}_r_armad2`, name: names[1], desc: '+2 de armadura adicional para tropas.', cost: { silver: 200, wood: 150, aether: 25 }, time: 55, requires: ['tier2', `${p}_r_armad1`], effects: [{ stat: 'armor', add: 2, cls: [...MIL] }], icon: 'armor2' },
];

export const RESEARCHES: Record<string, ResearchDef> = {};
const addR = (list: ResearchDef[]) => list.forEach((r) => (RESEARCHES[r.id] = r));
addR(weapons('v', ['Aço Temperado', 'Aço de Valmir']));
addR(armors('v', ['Cota Reforçada', 'Placas Brancas']));
addR(weapons('k', ['Gumes Serrilhados', 'Lâminas de Obsidiana']));
addR(armors('k', ['Couro Endurecido', 'Ossadas Blindadas']));
addR(weapons('y', ['Pontas de Âmbar', 'Seiva Afiada']));
addR(armors('y', ['Casca Grossa', 'Casca de Ferro-Pinho']));
addR(weapons('d', ['Ligas de Bronze', 'Aço Rúnico']));
addR(armors('d', ['Rebites Duplos', 'Placas Rúnicas']));
addR([
  { id: 'v_r_serras', name: 'Serras Afiadas', desc: 'Lavradores carregam +4 de madeira.', cost: { silver: 100, wood: 50 }, time: 30, effects: [{ stat: 'carry', add: 4, cls: ['worker'] }], icon: 'saw' },
  { id: 'v_r_alvenaria', name: 'Alvenaria Real', desc: 'Edifícios: +2 armadura e +20% vida.', cost: { silver: 150, wood: 100 }, time: 45, effects: [{ stat: 'bArmor', add: 2 }, { stat: 'bHp', mul: 0.2 }], icon: 'brick' },
  { id: 'v_r_votos', name: 'Votos da Aurora', desc: 'Clérigas: +100 mana e cura +50%.', cost: { silver: 150, wood: 100, aether: 30 }, time: 45, effects: [{ stat: 'mana', add: 100, units: ['v_cleriga'] }, { stat: 'heal', mul: 0.5, units: ['v_cleriga'] }], icon: 'heal' },
  { id: 'v_r_contrapeso', name: 'Contrapesos', desc: 'Trabucos: +1.5 de alcance.', cost: { silver: 150, wood: 150 }, time: 45, effects: [{ stat: 'range', add: 1.5, units: ['v_trabuco'] }], icon: 'gear' },
  { id: 'k_r_machados', name: 'Machados de Pedra-Negra', desc: 'Carregadores: +5 madeira por viagem.', cost: { silver: 90, wood: 40 }, time: 30, effects: [{ stat: 'carry', add: 5, cls: ['worker'] }], icon: 'saw' },
  { id: 'k_r_palicada', name: 'Paliçadas', desc: 'Edifícios: +3 armadura.', cost: { silver: 120, wood: 120 }, time: 40, effects: [{ stat: 'bArmor', add: 3 }], icon: 'brick' },
  { id: 'y_r_seiva', name: 'Canais de Seiva', desc: 'Extração de madeira 25% mais rápida.', cost: { silver: 120, wood: 40 }, time: 35, effects: [{ stat: 'gather', mul: 0.25, cls: ['worker'] }], icon: 'drop' },
  { id: 'y_r_casca', name: 'Casca Encantada', desc: 'Edifícios: +2 armadura e +15% vida.', cost: { silver: 130, wood: 110 }, time: 40, effects: [{ stat: 'bArmor', add: 2 }, { stat: 'bHp', mul: 0.15 }], icon: 'brick' },
  { id: 'y_r_lua', name: 'Rito da Lua Cheia', desc: 'Invocadoras: +80 mana. Arqueiras: +1 alcance.', cost: { silver: 150, wood: 100, aether: 30 }, time: 45, effects: [{ stat: 'mana', add: 80, units: ['y_invocadora'] }, { stat: 'range', add: 1, units: ['y_arqueira'] }], icon: 'moon' },
  { id: 'd_r_vagonetas', name: 'Vagonetas', desc: 'Mineiros: +5 prata e madeira por viagem.', cost: { silver: 120, wood: 60 }, time: 35, effects: [{ stat: 'carry', add: 5, cls: ['worker'] }], icon: 'saw' },
  { id: 'd_r_blindagem', name: 'Blindagem de Muralha', desc: 'Edifícios: +3 armadura.', cost: { silver: 150, wood: 100 }, time: 40, effects: [{ stat: 'bArmor', add: 3 }], icon: 'brick' },
  { id: 'd_r_polvora', name: 'Pólvora Negra', desc: 'Arcabuzeiros: +1.5 de alcance.', cost: { silver: 150, wood: 100, aether: 20 }, time: 40, requires: ['tier2'], effects: [{ stat: 'range', add: 1.5, units: ['d_arcabuzeiro'] }], icon: 'bomb' },
]);

// ---------------------------------------------------------------------------
// Neutros: criaturas, edifícios neutros e mercenários
// ---------------------------------------------------------------------------
const neutralUnits: UnitDef[] = [
  U({ id: 'c_lobo', name: 'Lobo-Cinzento', faction: 'neutral', cls: 'creep', desc: 'Predador das colinas.', cost: { silver: 90 }, supply: 2, time: 0, hp: 300, armor: 1, speed: 3.3, attack: atk([10, 13], 0.8, 1.3, 'blade'), xp: 30, bounty: 10, art: { body: 'beast', gear: ['gray'] } }),
  U({ id: 'c_lobo_alfa', name: 'Lobo Alfa', faction: 'neutral', cls: 'creep', desc: 'Líder da matilha.', cost: { silver: 170 }, supply: 3, time: 0, hp: 560, armor: 2, speed: 3.4, radius: 0.45, attack: atk([18, 22], 0.9, 1.3, 'blade'), xp: 55, bounty: 20, art: { body: 'beast', gear: ['dark'], scale: 1.3 } }),
  U({ id: 'c_saqueador', name: 'Saqueador', faction: 'neutral', cls: 'creep', desc: 'Bandido das estradas.', cost: { silver: 110 }, supply: 2, time: 0, hp: 380, armor: 1, speed: 2.8, attack: atk([12, 16], 0.8, 1.4, 'blade'), xp: 35, bounty: 15, art: { body: 'human', gear: ['sword', 'bandit'] } }),
  U({ id: 'c_batedor', name: 'Batedor Fora-da-Lei', faction: 'neutral', cls: 'creep', desc: 'Arqueiro bandido.', cost: { silver: 120 }, supply: 2, time: 0, hp: 300, armor: 0, speed: 2.8, attack: atk([14, 18], 6, 1.6, 'pierce', { proj: 'arrow', projSpeed: 16 }), xp: 35, bounty: 15, art: { body: 'human', gear: ['bow', 'bandit'] } }),
  U({ id: 'c_ogro', name: 'Ogro das Colinas', faction: 'neutral', cls: 'creep', desc: 'Brutamontes de clava.', cost: { silver: 260 }, supply: 4, time: 0, hp: 950, armor: 2, armorType: 'heavy', speed: 2.4, radius: 0.6, attack: atk([28, 36], 1.0, 1.8, 'blade'), xp: 90, bounty: 35, art: { body: 'ogre', gear: ['club'], scale: 1.5 } }),
  U({ id: 'c_aranha', name: 'Aranha-de-Breu', faction: 'neutral', cls: 'creep', desc: 'Aracnídeo venenoso das ruínas.', cost: { silver: 140 }, supply: 2, time: 0, hp: 420, armor: 1, speed: 3.0, radius: 0.45, attack: atk([14, 18], 0.8, 1.2, 'blade'), xp: 40, bounty: 15, art: { body: 'spider', gear: [] } }),
  U({ id: 'c_golem', name: 'Golem de Ruína', faction: 'neutral', cls: 'creep', desc: 'Guardião de pedra das eras antigas.', cost: {}, supply: 5, time: 0, hp: 1150, armor: 6, armorType: 'heavy', speed: 2.0, radius: 0.65, attack: atk([30, 38], 1.0, 2.0, 'blade'), xp: 110, bounty: 45, art: { body: 'golem', gear: ['stone'], scale: 1.4 } }),
  U({ id: 'c_dragao', name: 'Dragão Jovem de Brasa', faction: 'neutral', cls: 'creep', desc: 'Guardião do grande cristal.', cost: {}, supply: 8, time: 0, hp: 2600, mana: 0, armor: 4, armorType: 'heavy', speed: 2.6, radius: 0.9, sight: 9, attack: atk([50, 64], 3.5, 2.0, 'chaos', { proj: 'fire', projSpeed: 12, splash: 1.2 }), xp: 320, bounty: 180, art: { body: 'dragon', gear: [], scale: 1.8 } }),
];

const neutralBuildings: BuildingDef[] = [
  B({ id: 'n_mercado', name: 'Mercado Errante', faction: 'neutral', cat: 'neutral', desc: 'Heróis próximos podem comprar itens.', cost: {}, time: 0, hp: 5000, size: 3, arch: 'market', invulnerable: true, sells: ['pocao_vida', 'pocao_mana', 'anel_protecao', 'botas_vento', 'tomo_saber', 'orbe_lunar'] }),
  B({ id: 'n_mercenarios', name: 'Acampamento Mercenário', faction: 'neutral', cat: 'neutral', desc: 'Contrate mercenários com um herói ou unidade próxima.', cost: {}, time: 0, hp: 5000, size: 3, arch: 'mercs', invulnerable: true, hires: ['c_saqueador', 'c_batedor', 'c_ogro'] }),
  B({ id: 'n_fonte', name: 'Fonte Restauradora', faction: 'neutral', cat: 'neutral', desc: 'Restaura vida e mana das unidades próximas.', cost: {}, time: 0, hp: 5000, size: 2, arch: 'fountain', invulnerable: true, aura: { ability: 'healing_spring', radius: 5 } }),
];

// ---------------------------------------------------------------------------
// Facções
// ---------------------------------------------------------------------------
export const FACTIONS: Record<FactionId, FactionDef> = {
  valmir: {
    id: 'valmir', name: 'Reino de Valmir', people: 'Valmirenses', biome: 0,
    desc: 'Cavaleiros e pedreiros das planícies verdes. Tropas resistentes, muralhas e torres.',
    lore: 'Quando o céu se partiu, Valmir ergueu muralhas brancas onde outros fugiram. Seus marechais juram que nenhuma pedra cairá enquanto houver um escudo de pé.',
    traits: ['Lavradores somam esforços na construção', 'Muralhas e alvenaria reforçada', 'Infantaria pesada e cavalaria de choque'],
    worker: 'v_lavrador', hall: 'v_paco', hero: 'v_marechal', houses: 'v_casa',
    units: valmirUnits.map((u) => u.id), buildings: valmirBuildings.map((b) => b.id),
    researches: Object.keys(RESEARCHES).filter((k) => k.startsWith('v_')),
    trainMul: 1, builderMode: 'build',
    ai: {
      comp: { melee: 0.4, ranged: 0.3, cavalry: 0.12, caster: 0.08, siege: 0.06, air: 0.04 },
      antiAir: ['v_besteiro', 'v_falcoeiro'], siege: ['v_trabuco'],
      core: ['v_quartel', 'v_serraria', 'v_forja', 'v_santuario', 'v_oficina', 'v_aviario'],
    },
  },
  kragg: {
    id: 'kragg', name: 'Clãs de Kragg', people: 'Kraggar', biome: 1,
    desc: 'Povo-fera das terras de cinza. Produção veloz, unidades baratas e hordas imensas.',
    lore: 'Das cinzas da Fratura nasceram os clãs. Eles não constroem para durar — constroem para marchar. Cada fogueira acesa é um novo exército.',
    traits: ['Treinamento 25% mais rápido', 'Arenas e ninhos treinam 2 unidades ao mesmo tempo', 'Tambores aceleram ataques'],
    worker: 'k_carregador', hall: 'k_fogueira', hero: 'k_ruvak', houses: 'k_tenda',
    units: kraggUnits.map((u) => u.id), buildings: kraggBuildings.map((b) => b.id),
    researches: Object.keys(RESEARCHES).filter((k) => k.startsWith('k_')),
    trainMul: 0.75, builderMode: 'build',
    ai: {
      comp: { melee: 0.48, ranged: 0.26, cavalry: 0.12, caster: 0.06, siege: 0.05, air: 0.03 },
      antiAir: ['k_arremessador', 'k_abutre'], siege: ['k_lancapedras'],
      core: ['k_arena', 'k_deposito', 'k_forja', 'k_tambores', 'k_circulo', 'k_patio', 'k_ninho'],
    },
  },
  veymar: {
    id: 'veymar', name: 'Círculo de Veymar', people: 'Veymari', biome: 2,
    desc: 'Guardiões das florestas lunares. Magia, invocações e edifícios vivos que se regeneram.',
    lore: 'Os Veymari ouviram a floresta chorar quando o céu caiu. Desde então nunca derrubam uma árvore — bebem sua seiva e a defendem com lua e raiz.',
    traits: ['Extraem madeira sem derrubar árvores', 'Edifícios crescem sozinhos e regeneram', 'Poços Lunares produzem éter'],
    worker: 'y_lanterneiro', hall: 'y_arvore_mae', hero: 'y_sylra', houses: 'y_poco',
    units: veymarUnits.map((u) => u.id), buildings: veymarBuildings.map((b) => b.id),
    researches: Object.keys(RESEARCHES).filter((k) => k.startsWith('y_')),
    trainMul: 1, builderMode: 'grow',
    ai: {
      comp: { melee: 0.36, ranged: 0.36, caster: 0.12, siege: 0.08, air: 0.08 },
      antiAir: ['y_arqueira', 'y_mariposa'], siege: ['y_anciao'],
      core: ['y_bosque', 'y_raiz', 'y_ambar', 'y_santuario', 'y_jardim', 'y_casulario'],
    },
  },
  durn: {
    id: 'durn', name: 'Forjas de Durn', people: 'Durnianos', biome: 3,
    desc: 'Engenheiros anões das alturas nevadas. Tecnologia, artilharia e máquinas de guerra.',
    lore: 'Sob a neve eterna, as forjas de Durn nunca se apagaram. Onde outros veem cristais caídos do céu, os Durnianos veem combustível.',
    traits: ['Mineiros carregam o dobro de prata', 'Extratores de éter automáticos', 'Artilharia de longo alcance e golens'],
    worker: 'd_mineiro', hall: 'd_salao', hero: 'd_brunna', houses: 'd_alojamento',
    units: durnUnits.map((u) => u.id), buildings: durnBuildings.map((b) => b.id),
    researches: Object.keys(RESEARCHES).filter((k) => k.startsWith('d_')),
    trainMul: 1, builderMode: 'build',
    ai: {
      comp: { melee: 0.38, ranged: 0.34, caster: 0.06, siege: 0.1, air: 0.12 },
      antiAir: ['d_arcabuzeiro', 'd_girocoptero'], siege: ['d_canhao'],
      core: ['d_caserna', 'd_armazem', 'd_forja', 'd_oficina', 'd_hangar', 'd_fundicao'],
    },
  },
};

export const UNITS: Record<string, UnitDef> = {};
export const BUILDINGS: Record<string, BuildingDef> = {};
for (const u of [...valmirUnits, ...kraggUnits, ...veymarUnits, ...durnUnits, ...neutralUnits]) UNITS[u.id] = u;
for (const b of [...valmirBuildings, ...kraggBuildings, ...veymarBuildings, ...durnBuildings, ...neutralBuildings]) BUILDINGS[b.id] = b;

export const FACTION_IDS: FactionId[] = ['valmir', 'kragg', 'veymar', 'durn'];

/** Edifício base de uma linha de evolução (ex.: v_cidadela -> v_paco). */
export function baseOf(id: string): string {
  for (const b of Object.values(BUILDINGS)) if (b.upgradesTo === id) return baseOf(b.id);
  return id;
}

/** Todas as formas que cumprem o requisito "id" (inclui evoluções). */
export function satisfies(have: string, need: string): boolean {
  let cur: string | undefined = need;
  // have satisfaz need se have é need ou uma evolução de need
  let h: string | undefined = have;
  while (h) {
    if (h === need) return true;
    h = Object.values(BUILDINGS).find((b) => b.upgradesTo === h)?.id;
  }
  void cur;
  return false;
}
