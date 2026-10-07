// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { createCampaign } from '../src/sim/setup';
import { paintScenery, sceneryReady } from '../src/render/scenery';

it('cenário do bloco é desenhado no canvas: árvores, tocos, pedras e enfeites', () => {
  const { game: g } = createCampaign({ lordName: 'A', houseName: 'B', crest: { c1: '#123', c2: '#eee', pattern: 'fess', charge: '✦' }, female: false, seed: 3, faction: 'valmir' });
  const calls: string[] = [];
  const ctx: any = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? null : (...a: any[]) => { calls.push(String(k)); void a; }), set: () => true });
  const w = g.world;
  // pega um bloco cheio de árvores
  let best = 0, bx = 0, by = 0;
  for (let cy = 0; cy < w.h / 16; cy++) for (let cx = 0; cx < w.w / 16; cx++) {
    let n = 0;
    for (let y = cy * 16; y < cy * 16 + 16; y++) for (let x = cx * 16; x < cx * 16 + 16; x++) if (w.tree[w.idx(x, y)]) n++;
    if (n > best) { best = n; bx = cx; by = cy; }
  }
  sceneryReady(() => {});
  const t0 = performance.now();
  paintScenery(ctx, w, g.seed, g.decor, new Set([w.idx(bx * 16 + 1, by * 16 + 1)]), bx * 512 - 56, by * 512 - 56, 624, 624);
  const ms = performance.now() - t0;
  expect(best).toBeGreaterThan(20);
  expect(calls.filter((c) => c === 'drawImage').length).toBeGreaterThanOrEqual(best);
  expect(ms).toBeLessThan(200);
});
