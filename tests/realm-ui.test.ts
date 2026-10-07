// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createCampaign } from '../src/sim/setup';
import { RealmUI } from '../src/ui/realm-ui';
import { formArmy } from '../src/realm/war';
import type { Session } from '../src/ui/session';

function setup() {
  const { game: g } = createCampaign({ lordName: 'Aldo', houseName: 'Ravel', crest: { c1: '#123', c2: '#eee', pattern: 'cross', charge: '✦' }, female: false, seed: 5, faction: 'valmir' });
  const root = document.createElement('div');
  document.body.appendChild(root);
  const s = { g, paused: false, dirty: false, selection: [] } as unknown as Session;
  const said: string[] = [];
  const battles: number[] = [];
  const ui = new RealmUI(s, { root, hideTip() {} } as any, { startBattle: (id) => battles.push(id), feedback: (t) => said.push(t), gameOver() {} });
  return { g, ui, s, said, battles, root };
}

describe('tela do feudo', () => {
  it('abre, pausa, desenha todas as abas e fecha', () => {
    const { ui, s, root } = setup();
    ui.show('mapa');
    expect(s.paused).toBe(true);
    for (const tab of ['mapa', 'casas', 'cartas', 'mercado', 'exercito', 'dinastia', 'governo', 'cronica'] as const) {
      ui.show(tab);
      expect(root.querySelector('.realm-body')!.innerHTML.length, tab).toBeGreaterThan(40);
    }
    expect(root.querySelectorAll('.prov').length).toBe(0); // aba atual é a crônica
    ui.show('mapa');
    expect(root.querySelectorAll('.prov').length).toBe(8);
    (root.querySelector('[data-r=close]') as HTMLElement).click();
    expect(s.paused).toBe(false);
  });

  it('clicar em todos os botões de todas as abas não quebra', () => {
    const { g, ui, root, said } = setup();
    g.players[0].res = { silver: 5000, wood: 800, aether: 200 };
    for (let i = 0; i < 6; i++) g.spawnUnit('v_lanceiro', 0, 30 + i, 30);
    const tabs = ['mapa', 'casas', 'cartas', 'mercado', 'exercito', 'dinastia', 'governo', 'cronica'] as const;
    for (const tab of tabs) {
      ui.show(tab, '');
      // primeiro abre uma província/casa para mostrar as ações
      (root.querySelector('[data-prov], [data-house]') as HTMLElement | null)?.click();
      for (let k = 0; k < 40; k++) {
        const btns = [...root.querySelectorAll<HTMLButtonElement>('.realm-body button')].filter((b) => !b.disabled && !b.dataset.battle);
        const b = btns[k];
        if (!b) break;
        b.click();
        if (!ui.open) ui.show(tab);
        if (ui.tab !== tab) ui.show(tab);
      }
    }
    expect(said.length).toBeGreaterThan(3);
  });

  it('marcha e batalha pelo painel do exército', () => {
    const { g, ui, root, battles } = setup();
    const r = g.realm!;
    const ids = [g.spawnUnit('v_lanceiro', 0, 30, 30).id, g.spawnUnit('v_lanceiro', 0, 31, 30).id];
    r.houses.draven.rel[r.player] = 'war';
    r.houses[r.player].rel.draven = 'war';
    const a = formArmy(g, r, ids, 'pinhal')!;
    a.waiting = true;
    r.events.push({ id: 999, kind: 'battle', data: { army: a.id, province: 'pinhal' }, t: 0 });
    ui.update();
    expect(ui.open).toBe(true);
    expect(ui.tab).toBe('exercito');
    (root.querySelector('[data-battle]') as HTMLElement).click();
    expect(battles).toEqual([a.id]);
  });
});

describe('HUD no modo feudo', () => {
  it('mostra população, comida, estação, objetivo e o botão Feudo', async () => {
    const { Hud } = await import('../src/ui/hud');
    const { game: g } = createCampaign({ lordName: 'Aldo', houseName: 'Ravel', crest: { c1: '#123', c2: '#eee', pattern: 'cross', charge: '✦' }, female: false, seed: 5, faction: 'valmir' });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const s = { g, r: { selected: new Set(), cam: { centerOn() {} } }, pid: 0, selection: [], groups: Array.from({ length: 10 }, () => []), mode: { k: 'none' }, formation: 'block', speed: 1, paused: false, quality: 'media', isTouch: false, touchSelectMode: false, quickOrders: true, subgroup: '', lastAlert: null, dirty: true, onExit() {} } as any;
    const hud = new Hud(s, root);
    let opened = '';
    hud.openRealm = (t?: string) => { opened = t ?? 'feudo'; };
    hud.update(1000);
    expect(root.querySelector('[data-k=pop]')!.textContent).toMatch(/^\d+\/\d+$/);
    expect(root.querySelector('[data-k=season]')!.textContent).toContain('Primavera');
    expect(root.querySelector('.quest')!.textContent).toContain('Rumo a Lorde');
    expect(root.querySelector('[data-a=diplo]')).toBeNull();
    (root.querySelector('[data-a=feudo]') as HTMLElement).click();
    expect(opened).toBe('feudo');
    (root.querySelector('.quest') as HTMLElement).click();
    expect(opened).toBe('governo');
    expect((root.querySelector('.tb.feudo .badge') as HTMLElement).hidden).toBe(false); // carta de boas-vindas
  });
});
