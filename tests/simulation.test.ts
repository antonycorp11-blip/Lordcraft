import { describe, expect, test } from 'vitest';
import { Game } from '../src/sim/game';
import { World, BL_TERRAIN } from '../src/world/world';
import { Player } from '../src/sim/entity';
import { FACTIONS, BUILDINGS, UNITS } from '../src/data/factions';
import { issueBuild, issueGather, issueRepair, issueMove, issueAttack, issueHold, train, cancelQueue, issueStop } from '../src/sim/commands';
import { canPlaceAt } from '../src/sim/units';
import { canAttackTarget } from '../src/sim/combat';
import { serialize, deserialize } from '../src/sim/save';
import { AIController } from '../src/ai/ai';
import { createGame } from '../src/sim/setup';
import { applyPact, propose } from '../src/sim/diplomacy';
import { Camera } from '../src/render/camera';
import type { FactionId } from '../src/data/types';

function sandbox(faction: FactionId = 'valmir') {
  const g = new Game(new World(64,64),42,'test');
  g.addPlayer(new Player(0,'A','#48a',faction,false,1));
  g.addPlayer(new Player(1,'B','#a64','kragg',false,2));
  g.players.forEach(p=>{p.res={silver:5000,wood:5000,aether:1000};g.fogs[p.id].revealAll=true;g.updateFog(p.id);});
  g.initRelations();
  g.placeBuilding(FACTIONS[faction].hall,0,3,3,true);
  g.placeBuilding('k_fogueira',1,55,55,true);
  g.recomputeSupply();
  return g;
}
function advance(g:Game,seconds:number,check?:()=>void) {
  for(let i=0;i<seconds/g.dt;i++){g.update();check?.();g.fx.length=0;}
}

// Sem DOM: todos os resultados são consequências de ordens na mesma simulação usada pela interface.
describe('economia e construção',()=>{
  test('trabalhador retira prata, volta ao centro e entrega a carga',()=>{
    const g=sandbox();const mine=g.spawnResource('mine',12,4,200);
    const u=g.spawnUnit('v_lavrador',0,9,7);const before=g.players[0].res.silver;
    issueGather(g,0,[u.id],mine);advance(g,45);
    expect(g.players[0].res.silver).toBeGreaterThan(before);
    expect(mine.amount).toBeLessThan(200);
    expect(g.players[0].stats.gathered.silver).toBeGreaterThan(0);
    expect(g.world.freeAt(u.x,u.y)||u.inside).toBe(true);
  });
  test('árvore esgotada libera passagem e a madeira chega ao depósito',()=>{
    const g=sandbox();const i=g.world.idx(9,9);g.world.setTree(i,10);
    const u=g.spawnUnit('v_lavrador',0,9.5,8.5);const before=g.players[0].res.wood;
    issueGather(g,0,[u.id],null,i);advance(g,65);
    expect(g.world.tree[i]).toBe(0);expect(g.world.free(9,9)).toBe(true);
    expect(g.players[0].res.wood).toBeGreaterThan(before);
  });
  test('construção cobra recursos, progride e permite reparo',()=>{
    const g=sandbox();const u=g.spawnUnit('v_lavrador',0,10,10);advance(g,.05);
    const before=g.players[0].res.silver;
    expect(issueBuild(g,0,u.id,'v_quartel',12,10)).toBe(true);
    expect(g.players[0].res.silver).toBe(before-BUILDINGS.v_quartel.cost.silver!);
    advance(g,75);
    const b=g.buildings.find(b=>b.type==='v_quartel')!;
    expect(b?.built).toBe(true);expect(g.world.free(12,10)).toBe(false);
    b.hp=b.maxHp/2;const hp=b.hp;issueRepair(g,0,[u.id],b.id);advance(g,15);
    expect(b.hp).toBeGreaterThan(hp);
  });
  test('recusa fundação sobre árvores, unidades e edifícios',()=>{
    const g=sandbox();g.world.setTree(g.world.idx(12,12),100);
    expect(canPlaceAt(g,0,'v_casa',12,12).ok).toBe(false);
    expect(canPlaceAt(g,0,'v_casa',3,3).ok).toBe(false);
    g.spawnUnit('v_lavrador',0,20.5,20.5);advance(g,.05);
    expect(canPlaceAt(g,0,'v_casa',20,20).ok).toBe(false);
  });
  test('interromper ordem de construção ainda não iniciada devolve o pagamento',()=>{
    const g=sandbox();const u=g.spawnUnit('v_lavrador',0,9,9);const before=g.players[0].res.silver;
    expect(issueBuild(g,0,u.id,'v_casa',30,30)).toBe(true);
    issueStop(g,0,[u.id]);expect(g.players[0].res.silver).toBe(before);
  });
  test('dois quartéis produzem simultaneamente e cancelamento devolve recursos',()=>{
    const g=sandbox();const a=g.placeBuilding('v_quartel',0,12,12,true),b=g.placeBuilding('v_quartel',0,18,12,true);
    expect(train(g,0,a.id,'v_lanceiro')).toBe(true);expect(train(g,0,b.id,'v_lanceiro')).toBe(true);
    advance(g,UNITS.v_lanceiro.time+1);
    expect(g.units.filter(u=>u.type==='v_lanceiro')).toHaveLength(2);
    const before=g.players[0].res.silver;train(g,0,a.id,'v_lanceiro');cancelQueue(g,0,a.id,0);
    expect(g.players[0].res.silver).toBe(before);
  });
  test('Veymar extrai madeira sem derrubar a árvore e edifícios crescem sem prender trabalhador',()=>{
    const g=sandbox('veymar');const i=g.world.idx(10,9);g.world.setTree(i,100);
    const u=g.spawnUnit('y_lanterneiro',0,9,9);const before=g.players[0].res.wood;
    issueGather(g,0,[u.id],null,i);advance(g,25);
    expect(g.players[0].res.wood).toBeGreaterThan(before);expect(g.world.tree[i]).toBe(100);
    expect(issueBuild(g,0,u.id,'y_poco',14,12)).toBe(true);advance(g,50);
    expect(g.buildings.find(b=>b.type==='y_poco')?.built).toBe(true);
    expect(u.order?.t).not.toBe('build');
  });
});

describe('navegação, combate e névoa',()=>{
  test('120 soldados atravessam corredor sem entrar em terreno bloqueado',()=>{
    const g=sandbox();
    for(let y=0;y<64;y++)if(y<28||y>33)g.world.block[g.world.idx(30,y)]=BL_TERRAIN;
    g.world.version++;
    const us=Array.from({length:120},(_,i)=>g.spawnUnit('v_lanceiro',0,10+(i%12)*.85,23+Math.floor(i/12)*.85));
    issueMove(g,0,us.map(u=>u.id),46,30,{formation:'column'});
    let crossed=false;
    advance(g,70,()=>{for(const u of us)if(!g.world.freeAt(u.x,u.y))crossed=true;});
    expect(crossed).toBe(false);
    expect(us.filter(u=>u.x>31).length).toBeGreaterThan(108);
    expect(new Set(us.map(u=>`${u.x.toFixed(1)}:${u.y.toFixed(1)}`)).size).toBeGreaterThan(108);
  });
  test('ordens encadeadas são cumpridas em sequência',()=>{
    const g=sandbox();const u=g.spawnUnit('v_lanceiro',0,12,12);
    issueMove(g,0,[u.id],18,12);issueMove(g,0,[u.id],18,22,{queue:true});advance(g,20);
    expect(Math.hypot(u.x-18,u.y-22)).toBeLessThan(.7);expect(u.queue).toHaveLength(0);
  });
  test('atacantes perseguem, destroem estruturas e geram derrota',()=>{
    const g=sandbox();const target=g.buildings.find(b=>b.owner===1)!;
    const us=Array.from({length:25},(_,i)=>g.spawnUnit('v_lanceiro',0,47+(i%5),48+Math.floor(i/5)));
    issueAttack(g,0,us.map(u=>u.id),target.id);advance(g,100);
    expect(target.alive).toBe(false);expect(g.players[1].defeated).toBe(true);expect(g.over).toBe(true);
  });
  test('manter posição permite ataque sem perseguir',()=>{
    const g=sandbox();const u=g.spawnUnit('v_lanceiro',0,20,20);g.spawnUnit('k_brutamonte',1,24,20);
    issueHold(g,0,[u.id]);const x=u.x,y=u.y;advance(g,1);
    expect(Math.hypot(u.x-x,u.y-y)).toBeLessThan(.2);
  });
  test('herói ganha experiência em combate',()=>{
    const g=sandbox();const h=g.spawnUnit('v_marechal',0,20,20);const e=g.spawnUnit('c_ogro',8,21,20);e.hp=1;
    issueAttack(g,0,[h.id],e.id);advance(g,5);
    expect(e.alive).toBe(false);expect(h.xp).toBeGreaterThan(0);
  });
  test('inimigo que sai da visão perde rastreamento e alianças cancelam ataques',()=>{
    const g=sandbox();g.fogs[0].revealAll=false;g.fogs[0].seen.fill(0);
    const u=g.spawnUnit('v_lanceiro',0,20,20),e=g.spawnUnit('k_brutamonte',1,22,20);g.updateFog(0);
    issueAttack(g,0,[u.id],e.id);e.x=45;e.y=45;g.updateFog(0);
    expect(g.fogs[0].explored(22,20)).toBe(true);expect(g.canSee(0,e)).toBe(false);
    advance(g,.05);expect(u.order?.t).not.toBe('attack');
    e.x=22;e.y=20;g.updateFog(0);applyPact(g,0,1,'alliance');
    expect(canAttackTarget(g,u,e,true)).toBe(false);
  });
});

describe('salvamento e câmera',()=>{
  test('preserva economia, ordens, magias, diplomacia, heróis e IA após JSON',()=>{
    const g=sandbox();const h=g.spawnUnit('v_marechal',0,15,15),u=g.spawnUnit('v_lanceiro',0,15,17);
    h.level=3;h.xp=500;h.items[0]='potion';
    issueMove(g,0,[h.id,u.id],35,20,{formation:'loose'});
    g.pendingCasts.push({at:1,kind:'barrage',owner:0,src:h.id,x:25,y:20,dmg:15,radius:1.8,maxTargets:5});
    propose(g,1,0,'truce');g.nextProjectileId=77;
    const ai=new AIController(1,'expansionista','normal');ai.decision='Expandindo';
    const save=JSON.parse(JSON.stringify(serialize(g,[ai.toJSON()])));
    const restored=deserialize(save);restored.ais=save.ai.map(AIController.from);
    expect(restored.players[0].res).toEqual(g.players[0].res);
    expect(restored.ents.get(h.id)?.items).toEqual(h.items);
    expect(restored.proposals).toEqual(g.proposals);expect(restored.pendingCasts).toEqual(g.pendingCasts);
    expect(restored.nextProjectileId).toBe(77);
    expect(restored.ents.get(u.id)?.bestDist).toBe(Infinity);
    expect((restored.ents.get(u.id)?.order as any).g.speed).toBe(Infinity);
    restored.ais=[];advance(restored,3);expect(restored.ents.get(u.id)!.x).toBeGreaterThan(16);
    expect(restored.pendingCasts).toHaveLength(0);expect(g.pendingCasts).toHaveLength(1);
  });
  test('zoom mantém ponto sob o cursor e câmera respeita limites',()=>{
    const c=new Camera(160,160);c.resize(900,600);c.centerOn(70,60);
    const before=c.toWorld(300,240);c.zoomAt(300,240,1.4);expect(c.toWorld(300,240)).toEqual(before);
    c.pan(1e6,1e6);expect(c.x).toBeLessThanOrEqual(c.worldW-c.vw/c.zoom);expect(c.y).toBeLessThanOrEqual(c.worldH-c.vh/c.zoom+60);
  });
});
