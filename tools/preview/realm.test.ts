// @vitest-environment happy-dom
// Prévia do mapa político (território) + bolinhas aproximadas. Uso: PREVIEW=1 PREVIEW_OUT=x.jpg npx vitest run tools/preview/realm.test.ts
import { it } from 'vitest';
import { writeFileSync } from 'fs';
import { createCanvas, Image as NImage } from '@napi-rs/canvas';
import { createCampaign } from '../../src/sim/setup';
import { realmMapImage, MAP_W, MAP_H, ballMood } from '../../src/ui/realm-map';
import { subjugate } from '../../src/realm/war';

(HTMLCanvasElement.prototype as any).getContext = function () {
  if (!this._napi || this._napi.width !== this.width || this._napi.height !== this.height) this._napi = createCanvas(this.width, this.height);
  return this._napi.getContext('2d');
};
(HTMLCanvasElement.prototype as any).toDataURL = function (t: string, q: number) { return this._napi.toDataURL(t, q); };

it('prévia do reino', async () => {
  const { game: g } = createCampaign({ lordName: 'A', houseName: 'Ravel', crest: { c1: '#24476b', c2: '#e8c25a', pattern: 'fess', charge: '✦' }, female: false, seed: 3, faction: 'valmir' });
  const r = g.realm!;
  if (process.env.PREVIEW_CONQUER) { r.houses[r.player].title = 'lorde'; subjugate(r, r.houses.draven, r.houses[r.player]); r.houses.brannoc.rel[r.player] = 'war'; r.houses[r.player].rel.brannoc = 'war'; }
  const url = realmMapImage(r);
  const img = new NImage();
  await new Promise<void>((res) => { img.onload = () => res(); img.src = Buffer.from(url.split(',')[1], 'base64'); });
  const S = 2;
  const out = createCanvas(MAP_W * S, MAP_H * S);
  const c = out.getContext('2d');
  c.drawImage(img, 0, 0, out.width, out.height);
  for (const p of Object.values(r.provinces)) {
    const h = r.houses[p.owner];
    const x = (p.x / 100) * out.width, y = (p.y / 100) * out.height, rad = 17 * S / 1.4;
    c.fillStyle = h.crest.c1; c.strokeStyle = '#140c06'; c.lineWidth = 3;
    c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = h.crest.c2; c.fillRect(x - rad, y - 4, rad * 2, 8);
    const mood = ballMood(r, h);
    for (const dx of [-7, 7]) { c.fillStyle = '#fff'; c.beginPath(); c.ellipse(x + dx, y - 3, 5, mood === 'war' ? 3 : 6, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#111'; c.beginPath(); c.arc(x + dx, y - 3, 2.5, 0, 7); c.fill(); }
    c.fillStyle = '#fff'; c.font = 'bold 18px sans-serif'; c.textAlign = 'center'; c.fillText(p.name + ' · ' + mood, x, y + rad + 18);
  }
  writeFileSync(process.env.PREVIEW_OUT ?? 'realm.jpg', await out.encode('jpeg', 82));
});
