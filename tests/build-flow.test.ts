// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { createCampaign } from '../src/sim/setup';
import { Renderer } from '../src/render/renderer';
const ctx: any = new Proxy({}, { get: (_t, k) => k === 'createImageData' || k === 'getImageData' ? (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }) : k === 'canvas' ? null : () => ctx, set: () => true });
(HTMLCanvasElement.prototype as any).getContext = () => ctx;
it('celular: Construir → Casa → posicionar → confirmar, sem travar nem pausar, e a casa fica pronta', async () => {
  const { Hud } = await import('../src/ui/hud');
  const { game: g } = createCampaign({ lordName: 'A', houseName: 'B', crest: { c1: '#123', c2: '#eee', pattern: 'fess', charge: '✦' }, female: false, seed: 3, faction: 'valmir' });
  const vp = document.createElement('div'); document.body.appendChild(vp);
  const r = new Renderer(g, vp, 0);
  r.cam.resize(900, 400); r.cam.centerOn(g.players[0].startX, g.players[0].startY);
  const root = document.createElement('div'); document.body.appendChild(root);
  const s = { g, r, pid: 0, selection: [], groups: Array.from({ length: 10 }, () => []), mode: { k: 'none' }, formation: 'block', speed: 1, paused: false, quality: 'media', isTouch: true, touchSelectMode: false, quickOrders: true, subgroup: '', lastAlert: null, dirty: true, onExit() {} } as any;
  const hud = new Hud(s, root); hud.input = { shift: false, updatePlacement() {} } as any;
  const { Input } = await import('../src/ui/input');
  const input = new Input(s, vp, { blocked: () => false, hotkey: () => false, toggleDiag() {}, toggleMenu() {}, feedback() {} } as any);
  hud.input = input;
  const { Minimap } = await import('../src/render/minimap');
  s.mm = new Minimap(g, hud.el.mmSlot);
  // fluxo do celular: botão Construir -> casa -> posicionar -> confirmar
  hud.update(0);
  (root.querySelector('.sb.build') as HTMLElement).click(); hud.update(16);
  expect(root.classList.contains('bmenu')).toBe(true);
  expect(root.querySelector('[data-id="b:v_casa"] .bimg')!.getAttribute('style')).toContain('background-image');
  (root.querySelector('[data-id="b:v_casa"]') as HTMLElement).click(); hud.update(200);
  expect(s.mode.k).toBe('build');
  expect(root.classList.contains('bmenu')).toBe(false); // saiu do menu de cartões ao escolher
  for (let i = 0; i < 5; i++) { r.render(0.5, 100 + i * 16); hud.update(100 + i * 16); input.update(0.016, false); }
  input.updatePlacement(g.players[0].startX + 7, g.players[0].startY + 7);
  r.render(0.5, 300);
  (root.querySelector('.placebar [data-p=ok]') as HTMLElement).click();
  expect(s.mode.k).toBe('none');
  expect(s.paused).toBe(false);
  expect(g.units.filter((u) => u.order?.t === 'build').length).toBe(1);
  for (let i = 0; i < 3000; i++) {
    g.update();
    if (i % 10 === 0) { try { r.render(0.5, 400 + i * 16); hud.update(400 + i * 16); input.update(0.016, false); s.mm.update(0, r.cam, 400 + i * 16); } catch (e) { throw e; } }
  }
  expect(g.buildings.some((b) => b.owner === 0 && b.type === 'v_casa' && b.built)).toBe(true);
});

it('obra abandonada: tocar nela com um trabalhador retoma; botão Retomar obra chama alguém', async () => {
  const { Hud } = await import('../src/ui/hud');
  const { Input } = await import('../src/ui/input');
  const { issueBuild, issueMove } = await import('../src/sim/commands');
  const { game: g } = createCampaign({ lordName: 'A', houseName: 'B', crest: { c1: '#123', c2: '#eee', pattern: 'fess', charge: '✦' }, female: false, seed: 3, faction: 'valmir' });
  const vp = document.createElement('div'); document.body.appendChild(vp);
  const r = new Renderer(g, vp, 0);
  r.cam.resize(900, 400); r.cam.centerOn(g.players[0].startX, g.players[0].startY);
  const root = document.createElement('div'); document.body.appendChild(root);
  const s = { g, r, pid: 0, selection: [], groups: Array.from({ length: 10 }, () => []), mode: { k: 'none' }, formation: 'block', speed: 1, paused: false, quality: 'media', isTouch: true, touchSelectMode: false, quickOrders: true, subgroup: '', lastAlert: null, dirty: true, onExit() {} } as any;
  const hud = new Hud(s, root);
  const input = new Input(s, vp, { blocked: () => false, hotkey: () => false, toggleDiag() {}, toggleMenu() {}, feedback() {} } as any);
  hud.input = input;
  const w = g.units.find((u) => u.owner === 0 && u.isWorker)!;
  const tx = g.players[0].startX + 6, ty = g.players[0].startY + 6;
  expect(issueBuild(g, 0, w.id, 'v_casa', tx, ty)).toBe(true);
  for (let i = 0; i < 400 && !g.buildings.some((b) => b.type === 'v_casa'); i++) g.update();
  const site = g.buildings.find((b) => b.type === 'v_casa')!;
  issueMove(g, 0, [w.id], 30, 30); // tirado da obra
  for (let i = 0; i < 20; i++) g.update();
  const p0 = site.progress;
  // tocar na obra com o trabalhador selecionado manda continuar (não seleciona a obra)
  s.selection = [w.id];
  (input as any).tap(site.cx, site.cy);
  expect(s.selection).toEqual([w.id]);
  expect(w.order?.t).toBe('repair');
  // botão da obra também chama um construtor
  s.selection = [site.id]; s.dirty = true; hud.update(1000);
  expect(root.querySelector('[data-id=resume]')).not.toBeNull();
  for (let i = 0; i < 2500 && !site.built; i++) g.update();
  expect(site.progress).toBeGreaterThan(p0);
  expect(site.built).toBe(true);
});
