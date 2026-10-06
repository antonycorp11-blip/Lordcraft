import { expect, test } from 'vitest';
import { createGame } from '../src/sim/setup';
import { BUILDINGS } from '../src/data/factions';

test('quatro IAs mantêm economias, expandem, evoluem e guerreiam durante 14 minutos', () => {
  const { game } = createGame({ mapId: 'vale', seed: 1234, players: [
    { name: 'A', faction: 'valmir', ai: true, team: 1, personality: 'agressiva', color: '#f00', start:0 },
    { name: 'B', faction: 'kragg', ai: true, team: 2, personality: 'equilibrada', color: '#0f0', start:1 },
    { name: 'C', faction: 'veymar', ai: true, team: 3, personality: 'expansionista', color: '#00f', start:2 },
    { name: 'D', faction: 'durn', ai: true, team: 4, personality: 'defensiva', color: '#ff0', start:3 },
  ]});
  let expansions=0, battlesBetweenPlayers=0, maxArmy=0;
  for (let i = 0; i < 20 * 60 * 14; i++) {
    game.update();game.fx.length=0;
    if(i%20===0){
      expansions=Math.max(expansions,game.buildings.filter(b=>b.alive&&b.built&&BUILDINGS[b.type].cat==='hall').length-4);
      maxArmy=Math.max(maxArmy,game.units.filter(u=>u.alive&&u.owner<4&&!u.isWorker).length);
      battlesBetweenPlayers+=game.units.filter(u=>u.alive&&u.owner<4&&u.targetId&&game.ents.get(u.targetId)!.owner<4).length;
    }
  }
  for(const p of game.players){
    expect(p.stats.gathered.silver).toBeGreaterThan(500);
    expect(p.stats.gathered.wood).toBeGreaterThan(100);
    expect(p.stats.buildingsBuilt).toBeGreaterThan(3);
    expect(p.stats.trained).toBeGreaterThan(10);
    expect(p.res.silver).toBeGreaterThanOrEqual(0);
    expect(p.res.wood).toBeGreaterThanOrEqual(0);
  }
  expect(expansions).toBeGreaterThan(0);
  expect(battlesBetweenPlayers).toBeGreaterThan(0);
  expect(maxArmy).toBeGreaterThan(40);
  expect(game.players.some(p=>p.tier>=2)).toBe(true);
  expect(game.path.stats.fieldHits).toBeGreaterThan(0);
  console.info('14 min de simulação:', {expansions,maxArmy,battlesBetweenPlayers,units:game.units.length});
});

test('IA repõe trabalhadores perdidos e retoma a extração',()=>{
  const {game}=createGame({mapId:'coroa',seed:21,players:[
    {name:'Jogador',faction:'valmir',ai:false,team:1,color:'#00f',start:0},
    {name:'IA',faction:'durn',ai:true,team:2,color:'#f00',start:1},
  ]});
  for(const u of game.units)if(u.owner===1&&u.isWorker)game.kill(u,null);
  game.recomputeSupply();
  for(let i=0;i<20*120;i++){game.update();game.fx.length=0;}
  expect(game.units.filter(u=>u.owner===1&&u.alive&&u.isWorker).length).toBeGreaterThan(2);
  expect(game.players[1].stats.gathered.silver).toBeGreaterThan(0);
});
