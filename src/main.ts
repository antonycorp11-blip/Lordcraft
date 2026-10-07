import './styles/theme.css';
import './styles/world.css';
import './styles/units.css';
import './styles/buildings.css';
import './styles/ui.css';
import './styles/sprites.css';
import './styles/hud.css';
import './styles/front.css';
import './styles/atlas.css';
import { FACTIONS, FACTION_IDS, FACTION_SHOWCASE, UNITS, BUILDINGS } from './data/factions';
import { MAPS } from './world/mapgen';
import { PLAYER_COLORS } from './sim/entity';
import { createGame, type MatchConfig } from './sim/setup';
import { deserialize, serialize, listSaves, writeSave, readSave } from './sim/save';
import { AIController, PERSONALITIES, PERSONALITY_NAMES, type Difficulty } from './ai/ai';
import { Renderer } from './render/renderer';
import { Minimap } from './render/minimap';
import { buildingClass, buildingHTML, portraitHTML } from './render/views';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import type { Session } from './ui/session';
import { setSelection } from './ui/selection';
import { propose, respond, declareWar } from './sim/diplomacy';
import type { FactionId } from './data/types';
import valmirArt from './assets/factions/valmir.webp';
import valmirCrest from './assets/factions/valmir-crest.webp';
import valmirLand from './assets/factions/valmir-land.webp';
import veymarArt from './assets/factions/veymar.webp';
import veymarCrest from './assets/factions/veymar-crest.webp';
import veymarLand from './assets/factions/veymar-land.webp';
import durnArt from './assets/factions/durn.webp';
import durnCrest from './assets/factions/durn-crest.webp';
import durnLand from './assets/factions/durn-land.webp';
import kraggArt from './assets/factions/kragg.webp';
import kraggCrest from './assets/factions/kragg-crest.webp';
import kraggLand from './assets/factions/kragg-land.webp';
import salinosArt from './assets/factions/salinos.webp';
import salinosCrest from './assets/factions/salinos-crest.webp';
import salinosLand from './assets/factions/salinos-land.webp';


const app = document.querySelector<HTMLElement>('#app')!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));
let dispose: (() => void) | undefined;
let faction: FactionId = 'valmir';
let mapId = 'vale';
const FACTION_ART: Record<FactionId, { art: string; crest: string; land: string }> = {
  valmir: { art: valmirArt, crest: valmirCrest, land: valmirLand },
  veymar: { art: veymarArt, crest: veymarCrest, land: veymarLand },
  durn: { art: durnArt, crest: durnCrest, land: durnLand },
  kragg: { art: kraggArt, crest: kraggCrest, land: kraggLand },
  salinos: { art: salinosArt, crest: salinosCrest, land: salinosLand },
};

// Qualidade inicial pelo aparelho: sem aceleração de vídeo ou com poucos núcleos começa
// em "média" (sem árvores balançando, menos chuva). O jogador pode mudar no menu.
function autoQuality(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    const software = !gl || /swiftshader|llvmpipe|software/i.test(renderer);
    if (software) return 'baixa';
    return (navigator.hardwareConcurrency || 4) <= 4 ? 'media' : 'alta';
  } catch { return 'media'; }
}
let quality = autoQuality();
const options = (entries: [string, string][], value = '') => entries.map(([k, v]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${v}</option>`).join('');

function frontPage() {
  dispose?.(); dispose = undefined;
  app.className = 'lobby';
  const f = FACTIONS[faction];
  const show = FACTION_SHOWCASE[faction];
  const names = (ids: string[]) => ids.map(id => `<li>${esc(UNITS[id]?.name ?? BUILDINGS[id]?.name ?? id)}</li>`).join('');
  app.innerHTML = `<div class="lobby-bg" style="--land:url('${FACTION_ART[faction].land}')"></div>
    <header class="lobby-brand"><h1>LORDCRAFT</h1><p>Construa uma dinastia. Conquiste do seu jeito.</p></header>
    <main class="lobby-main">
      <nav class="lobby-crests" aria-label="Escolha seu povo">${FACTION_IDS.map(id => `<button class="lobby-crest ${id === faction ? 'on' : ''}" data-faction="${id}" aria-pressed="${id === faction}" style="--crest:url('${FACTION_ART[id].crest}')"><i></i><span>${esc(FACTIONS[id].name)}</span></button>`).join('')}</nav>
      <section class="lobby-hero f-${faction}">
        <div class="lobby-art" style="--art:url('${FACTION_ART[faction].art}')"></div>
        <div class="lobby-info">
          <h2>${esc(f.name)}</h2>
          <p class="lobby-motto">${esc(f.motto ?? '')}</p>
          <p class="lobby-desc">${esc(f.desc)}</p>
          <div class="lobby-lists"><div><h3>Unidades</h3><ul>${names(show.units)}</ul></div><div><h3>Construções</h3><ul>${names(show.buildings)}</ul></div></div>
        </div>
      </section>
      <div class="lobby-actions">
        <button class="primary lobby-play" id="start">Jogar</button>
        <div class="lobby-row"><button id="load" ${listSaves().length ? '' : 'disabled'}>Continuar</button><button id="guide">Como jogar</button><button id="opts">Opções da partida</button></div>
        <p class="setup-error" role="alert"></p>
      </div>
      <section class="lobby-opts" hidden>
        <div class="match-fields"><label>Campo de batalha<select id="map">${options(MAPS.map(m => [m.id, m.name]), mapId)}</select></label><label>Dificuldade<select id="difficulty">${options([['facil','Fácil'],['normal','Normal'],['dificil','Difícil']], 'normal')}</select></label><label>Qualidade visual<select id="quality">${options([['alta','Alta'],['media','Média'],['baixa','Baixa']], quality)}</select></label></div>
        <p class="map-desc"></p><div class="roster"></div>
      </section>
    </main><div class="front-modal"></div>`;
  app.querySelector<HTMLButtonElement>('#opts')!.onclick = () => { const o = app.querySelector<HTMLElement>('.lobby-opts')!; o.hidden = !o.hidden; };
  const fillRoster = () => {
    const map = MAPS.find(m => m.id === mapId)!;
    app.querySelector('.map-desc')!.textContent = map.desc;
    app.querySelector('.roster')!.innerHTML = `<div class="roster-head"><span>Reinos</span><span>Povo</span><span>Aliança</span><span>Posição</span><span>Personalidade</span></div>` + Array.from({length:map.starts.length}, (_, i) => `<div class="roster-row" data-player="${i}"><span class="player-name"><i style="background:${PLAYER_COLORS[i]}"></i>${i === 0 ? 'Você' : 'Reino ' + (i+1)}</span><select class="rf" aria-label="Povo do reino ${i+1}" ${i===0?'disabled':''}>${options([...(i ? [['off','Desativado'] as [string,string]] : []), ...FACTION_IDS.map(id => [id,FACTIONS[id].name] as [string,string])], i ? FACTION_IDS[(FACTION_IDS.indexOf(faction)+i)%FACTION_IDS.length] : faction)}</select><select class="rt" aria-label="Aliança do reino ${i+1}">${options(Array.from({length:4},(_,j)=>[String(j+1),'Aliança '+(j+1)]),String(i+1))}</select><select class="rs" aria-label="Posição do reino ${i+1}">${options([['random','Aleatória'], ...map.starts.map((_,j)=>[String(j),'Posição '+(j+1)] as [string,string])],String(i))}</select><select class="rp" aria-label="Personalidade do reino ${i+1}" ${i===0?'disabled':''}>${options(PERSONALITIES.map(p=>[p,PERSONALITY_NAMES[p]]), PERSONALITIES[i])}</select></div>`).join('');
  };
  fillRoster();
  app.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach(b => b.onclick = () => { faction = b.dataset.faction as FactionId; frontPage(); });
  app.querySelector<HTMLSelectElement>('#map')!.onchange = e => { mapId = (e.target as HTMLSelectElement).value; fillRoster(); };
  app.querySelector<HTMLSelectElement>('#quality')!.onchange = e => { quality = (e.target as HTMLSelectElement).value; };
  app.querySelector<HTMLButtonElement>('#start')!.onclick = () => {
    const players: MatchConfig['players'] = [];
    app.querySelectorAll<HTMLElement>('[data-player]').forEach((row, i) => {
      const val = (c:string) => row.querySelector<HTMLSelectElement>(c)!.value;
      if (val('.rf') === 'off') return;
      players.push({name:i===0?'Você':FACTIONS[val('.rf') as FactionId].name, faction:val('.rf') as FactionId, color:PLAYER_COLORS[i], ai:i!==0, team:Number(val('.rt')), start:val('.rs')==='random'?undefined:Number(val('.rs')), personality:val('.rp'), difficulty:(app.querySelector<HTMLSelectElement>('#difficulty')!.value as Difficulty)});
    });
    const error = (msg:string) => { app.querySelector('.setup-error')!.textContent=msg; };
    if (players.length < 2 || players.every(p=>p.team===players[0].team)) return error('Escolha pelo menos um reino de outra aliança.');
    const starts=players.flatMap(p=>p.start===undefined?[]:[p.start]);
    if (new Set(starts).size!==starts.length) return error('Cada reino precisa de uma posição inicial diferente.');
    // mapa fixo: cada campo de batalha tem sempre o mesmo terreno
    const seed=MAPS.find(m=>m.id===mapId)!.seed;
    app.querySelector<HTMLButtonElement>('#start')!.disabled=true;
    error('Preparando o campo de batalha…');
    requestAnimationFrame(()=>setTimeout(()=>{
      try { launch(createGame({mapId,seed,players})); }
      catch(e) { error('Não foi possível iniciar a partida.'); console.error(e); app.querySelector<HTMLButtonElement>('#start')!.disabled=false; }
    },0));
  };
  app.querySelector<HTMLButtonElement>('#load')!.onclick = () => {
    const modal = app.querySelector<HTMLElement>('.front-modal')!;
    modal.innerHTML=`<div class="dlg frame"><h2>Partidas salvas</h2>${listSaves().map(s=>`<button class="save-row" data-slot="${esc(s.slot)}"><b>${esc(s.meta.name)}</b><span>${new Date(s.meta.date).toLocaleString('pt-BR')} · ${Math.floor(s.meta.time/60)} min</span></button>`).join('')}<button data-close>Voltar</button><p role="alert"></p></div>`;
    modal.classList.add('open');
    modal.querySelector<HTMLElement>('[data-close]')!.onclick=()=>modal.classList.remove('open');
    modal.querySelectorAll<HTMLElement>('[data-slot]').forEach(b=>b.onclick=()=>{
      try {
        const data=readSave(b.dataset.slot!); if (!data || data.v!==1) throw new Error('Save inválido');
        const game=deserialize(data); const ais=data.ai.map(AIController.from); game.ais=ais; launch({game,ais});
      } catch(e) { modal.querySelector('[role=alert]')!.textContent='Não foi possível carregar este salvamento.'; console.error(e); }
    });
  };
  app.querySelector<HTMLButtonElement>('#guide')!.onclick=()=>{
    const m=app.querySelector<HTMLElement>('.front-modal')!;
    m.innerHTML=`<div class="dlg frame">${helpHTML()}<button class="primary" data-close>Entendido</button></div>`; m.classList.add('open');
    m.querySelector<HTMLElement>('[data-close]')!.onclick=()=>m.classList.remove('open');
  };
}

function helpHTML() {
  return `<span class="eyebrow">SEU REINO, SUAS ORDENS</span><h2>Como jogar</h2><p>Seus cinco trabalhadores começam extraindo prata. Selecione alguns e envie-os às árvores para obter madeira. Construa casas, um quartel e um depósito; amplie seu exército e explore novas jazidas.</p><dl class="help"><dt>Selecionar</dt><dd>Clique ou arraste uma área. Shift adiciona/remove; duplo clique reúne unidades do mesmo tipo.</dd><dt>Dar ordens</dt><dd>Após selecionar tropas, clique em um ponto vazio para movê-las. Clique direito dá ordens contextuais para coletar, atacar, reparar ou seguir. Shift encadeia ordens.</dd><dt>Câmera</dt><dd>Setas, bordas do mapa ou botão central arrastado. Roda do mouse controla o zoom. Clique no minimapa para viajar.</dd><dt>Exército</dt><dd>A + clique avança atacando. S para, H mantém posição. Ctrl + número cria grupo; número seleciona; duas vezes centraliza.</dd><dt>Celular</dt><dd>Arraste para mover a câmera; pinça altera o zoom. Toque seleciona e envia ordens. O botão de seleção por área muda o gesto. Segure um comando para ver detalhes.</dd><dt>Objetivo</dt><dd>Destrua todos os edifícios dos reinos adversários. Aliados compartilham visão. Casas ampliam o abastecimento sem teto fixo.</dd><dt>Atalhos</dt><dd>F1 herói · ponto seleciona trabalhador ocioso · espaço vai ao último alerta · F10 menu · F3 diagnóstico.</dd></dl>`;
}

function launch({game:g,ais}: ReturnType<typeof createGame>) {
  dispose?.();
  app.className='playing';
  app.innerHTML='<div class="viewport" aria-label="Campo de batalha"></div><div class="hud"></div><pre class="diagnostics" hidden></pre><div class="pause-sign" hidden>PARTIDA PAUSADA</div>';
  const vp=app.querySelector<HTMLElement>('.viewport')!, hudRoot=app.querySelector<HTMLElement>('.hud')!;
  const r=new Renderer(g,vp,0);
  const s:Session={g,r,mm:null!,ais,pid:0,selection:[],groups:Array.from({length:10},()=>[]),mode:{k:'none'},formation:'block',speed:1,paused:false,quality,isTouch:matchMedia('(pointer: coarse)').matches,touchSelectMode:false,quickOrders:true,subgroup:'',lastAlert:null,dirty:true,onExit:frontPage};
  app.classList.toggle('touch',s.isTouch);
  const hud=new Hud(s,hudRoot);
  s.mm=new Minimap(g,hud.el.mmSlot);
  const diag=app.querySelector<HTMLElement>('.diagnostics')!;
  const pause=app.querySelector<HTMLElement>('.pause-sign')!;
  const toggleDiag=()=>{diag.hidden=!diag.hidden;};
  let modalPaused=false;
  const close=()=>{hud.closeModal();s.paused=modalPaused;s.dirty=true;};
  const open=(html:string, fn:(a:string,el:HTMLElement)=>void)=>{
    if (!hud.el.modal.classList.contains('open')) modalPaused=s.paused;
    s.paused=true; hud.hideTip(); hud.openModal(html,fn);
  };
  const save=(slot:string)=>{
    const ok=writeSave(slot,serialize(g,ais.map(a=>a.toJSON()),`${FACTIONS[g.players[0].faction].name} — ${MAPS.find(m=>m.id===g.mapId)?.name ?? g.mapId}`));
    hud.feedback(ok?'Partida salva neste navegador.':'Não foi possível salvar: armazenamento indisponível ou cheio.'); return ok;
  };
  const menu=()=>{
    open(`<span class="eyebrow">REINOS DE ALDARIS</span><h2>Partida pausada</h2><div class="menu-actions"><button class="primary" data-a="resume">Retornar à conquista</button><button data-a="save">Salvar partida</button><button data-a="help">Como jogar</button><label>Qualidade visual<select id="game-quality">${options([['alta','Alta'],['media','Média'],['baixa','Baixa']],s.quality)}</select></label><button data-a="diag">${diag.hidden?'Mostrar':'Ocultar'} diagnóstico (F3)</button><button data-a="exit">Salvar e voltar ao início</button><button data-a="quit">Sair sem salvar</button></div>`,a=>{
      if(a==='resume')close();
      if(a==='save')save('manual');
      if(a==='diag'){toggleDiag();menu();}
      if(a==='exit' && save('manual'))frontPage();
      if(a==='quit')frontPage();
      if(a==='help')open(`${helpHTML()}<button data-a="back">Voltar</button>`,()=>menu());
    });
    hud.el.modal.querySelector<HTMLSelectElement>('#game-quality')!.onchange=e=>{s.quality=quality=(e.target as HTMLSelectElement).value;r.setQuality(quality);};
  };
  const diplomacy=()=>{
    const proposals=g.proposals.filter(p=>p.to===s.pid);
    open(`<span class="eyebrow">CONSELHO DOS REINOS</span><h2>Diplomacia</h2>${proposals.map(p=>`<div class="pact"><p>${esc(g.players[p.from].name)} propõe ${p.kind==='alliance'?'uma aliança':'uma trégua de cinco minutos'}.</p><button data-a="accept" data-id="${p.id}">Aceitar</button><button data-a="reject" data-id="${p.id}">Recusar</button></div>`).join('')}<div class="diplo-list">${g.players.filter(p=>p.id!==s.pid).map(p=>`<div class="diplo-row"><b style="color:${p.color}">${esc(p.name)}</b><span>${p.defeated?'Derrotado':({war:'Em guerra',peace:'Trégua',ally:'Aliado'}[g.rel[s.pid][p.id]])}</span>${p.defeated?'':`<div>${g.rel[s.pid][p.id]!=='war'?`<button data-a="war" data-id="${p.id}">Declarar guerra</button>`:`<button data-a="truce" data-id="${p.id}">Propor trégua</button>`}${g.rel[s.pid][p.id]!=='ally'?`<button data-a="alliance" data-id="${p.id}">Propor aliança</button>`:''}</div>`}</div>`).join('')}</div><p class="hint">Tréguas duram cinco minutos. Alianças compartilham visão. Cada reino decide se aceita sua proposta.</p><button data-a="close">Retornar</button>`,(a,el)=>{
      const id=Number(el.dataset.id);
      if(a==='close'){close();return;}
      if(a==='accept'||a==='reject')respond(g,id,a==='accept');
      if(a==='war')declareWar(g,s.pid,id);
      if(a==='truce'||a==='alliance'){const result=propose(g,s.pid,id,a);hud.feedback(result==='accepted'?'Proposta aceita.':result==='rejected'?'O reino recusou sua proposta.':'Proposta enviada.');}
      diplomacy();
    });
  };
  hud.openMenu=menu; hud.openDiplomacy=diplomacy;
  const input=new Input(s,vp,{blocked:()=>hud.el.modal.classList.contains('open'),hotkey:k=>hud.hotkey(k),toggleDiag,toggleMenu:()=>hud.el.modal.classList.contains('open')?close():menu(),feedback:t=>hud.feedback(t)});
  hud.input=input;
  // O minimapa também emite ordens contextuais e destinos de comandos.
  let mmDrag=false;
  const mmPoint=(e:PointerEvent)=>{
    const [x,y]=s.mm.toTile(e.clientX,e.clientY);
    if(e.button===2)input.smart(x,y,e.shiftKey);
    else if(s.mode.k!=='none' && s.mode.k!=='build')input.execMode(x,y,e.shiftKey);
    else r.cam.centerOn(x,y);
  };
  s.mm.el.oncontextmenu=e=>e.preventDefault();
  s.mm.el.onpointerdown=e=>{e.preventDefault();mmDrag=e.button===0;s.mm.el.setPointerCapture(e.pointerId);mmPoint(e);};
  s.mm.el.onpointermove=e=>{if(mmDrag)mmPoint(e);};
  s.mm.el.onpointerup=s.mm.el.onpointercancel=()=>{mmDrag=false;};
  const resize=new ResizeObserver(()=>{
    const [cx,cy]=r.cam.center();
    r.cam.resize(vp.clientWidth,vp.clientHeight);
    r.cam.centerOn(cx,cy);
    s.isTouch=matchMedia('(pointer: coarse)').matches || vp.clientWidth<=820;
    app.classList.toggle('touch',s.isTouch);s.dirty=true;
  }); resize.observe(vp);
  r.cam.resize(vp.clientWidth,vp.clientHeight);r.cam.zoom=s.isTouch?0.85:1.15;r.cam.centerOn(g.players[0].startX,g.players[0].startY+1);
  r.setQuality(quality);
  for(const u of g.units)if(u.alive&&!u.inside)g.spatial.insert(u);
  const hall=g.buildings.find(b=>b.owner===0&&b.alive);if(hall)setSelection(s,[hall.id]);
  let raf=0,last=performance.now(),acc=0,lastUI=0,lastMM=0,lastSave=g.time,fps=60,resultShown=false,ended=false;
  const visibility=()=>{if(document.hidden){s.paused=true;s.dirty=true;acc=0;}last=performance.now();};
  document.addEventListener('visibilitychange',visibility);
  const frame=(now:number)=>{
    if(ended)return;
    const elapsed=Math.min(0.25,(now-last)/1000);last=now;fps=fps*0.95+0.05/Math.max(elapsed,0.001);
    const modal=hud.el.modal.classList.contains('open');
    if(!modal)input.update(elapsed,!s.isTouch);
    if(!s.paused&&!g.over&&!g.players[0].defeated){
      acc+=elapsed*s.speed;let steps=0;
      while(acc>=g.dt&&steps<8){g.update();acc-=g.dt;steps++;if(g.over)break;}
      if(steps===8)acc=Math.min(acc,g.dt); // evita espiral de atraso em aparelhos lentos
    }else acc=0;
    r.render(s.paused?1:acc/g.dt,now);
    if(now-lastUI>100||s.dirty){hud.update(now);lastUI=now;}
    if(now-lastMM>250){s.mm.update(0,r.cam,now);lastMM=now;}
    pause.hidden=!s.paused||modal;
    if(!diag.hidden&&now-lastMM<20)diag.textContent=`DIAGNÓSTICO · F3 para fechar\n${fps.toFixed(0)} FPS · simulação ${g.perf.simMs.toFixed(1)} ms · desenho ${r.stats.renderMs.toFixed(1)} ms\n${g.units.filter(u=>u.alive).length} unidades simuladas · ${r.stats.units} visíveis · ${r.stats.nodes} nós no mapa\nLOD ${r.stats.lod} · ${r.stats.proj} projéteis · ${r.stats.fx} efeitos\nNavegação: ${JSON.stringify(g.path.stats)}\n${ais.map(a=>`${g.players[a.playerId].name}: ${a.decision}`).join('\n')}`;
    if(g.time-lastSave>=120&&!g.over){save('auto');lastSave=g.time;}
    if(!resultShown&&(g.over||g.players[0].defeated)){
      resultShown=true;const won=!g.players[0].defeated;
      open(`<span class="eyebrow">A CRÔNICA FOI ESCRITA</span><h2 class="result">${won?'Vitória':'Derrota'}</h2><p>${won?'Seu reino e seus aliados conquistaram Aldaris.':'Seu último edifício caiu. Uma nova história espera por você.'}</p><div class="results">${g.players.map(p=>`<div><b>${esc(p.name)}</b><span>${p.stats.trained} recrutados · ${p.stats.kills} abates · ${p.stats.buildingsBuilt} construções</span></div>`).join('')}</div><button class="primary" data-a="home">Voltar ao início</button>`,()=>frontPage());
    }
    raf=requestAnimationFrame(frame);
  };
  raf=requestAnimationFrame(frame);
  dispose=()=>{ended=true;cancelAnimationFrame(raf);input.dispose();resize.disconnect();document.removeEventListener('visibilitychange',visibility);};
  hud.feedback('Selecione trabalhadores e envie-os às árvores para coletar madeira.');
  if(import.meta.env.DEV)(window as any).__aldaris={session:s,hud,input};
}

frontPage();

// PWA: só na versão publicada (no desenvolvimento o cache atrapalharia as edições).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}); });
}
