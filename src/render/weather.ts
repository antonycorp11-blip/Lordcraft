// Clima visual (não afeta a simulação): chuva desenhada num canvas sobre o campo de
// batalha, com gotas inclinadas pelo vento, respingos no chão e céu mais escuro.
// A chuva começa e para sozinha; a intensidade sobe e desce suavemente.

interface Drop { x: number; y: number; vy: number; len: number; groundY: number; a: number }
interface Splash { x: number; y: number; t: number }

const WIND = 0.28;               // deslocamento horizontal por pixel de queda
const FADE_PER_S = 0.18;         // quanto a intensidade muda por segundo
const CLEAR_S: [number, number] = [70, 160];   // duração do tempo bom (s)
const RAIN_S: [number, number] = [45, 100];    // duração da chuva (s)

export class Weather {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tint: HTMLElement;
  private drops: Drop[] = [];
  private splashes: Splash[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private last = 0;
  private intensity = 0;          // 0 = seco, 1 = tempestade
  private target = 0;
  private nextChange: number;
  private forced: boolean | null = null;
  private drawn = false;
  maxDrops = 650;

  constructor(private root: HTMLElement, seed = 1) {
    this.tint = document.createElement('div');
    this.tint.className = 'weather-tint';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'weather-rain';
    root.append(this.tint, this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    // primeira chuva entre 40 s e 2 min de partida
    this.nextChange = 40 + (seed % 80);
  }

  /** true = chuva sempre, false = sempre seco, null = automático. */
  force(rain: boolean | null) {
    this.forced = rain;
    if (rain !== null) this.target = rain ? 1 : 0;
  }

  get raining() {
    return this.intensity > 0.2;
  }

  update(now: number) {
    const t = now / 1000;
    const dt = this.last ? Math.min(0.1, t - this.last) : 0;
    this.last = t;

    if (this.forced === null && t >= this.nextChange) {
      const startRain = this.target === 0;
      this.target = startRain ? 0.55 + Math.random() * 0.45 : 0;
      const [a, b] = startRain ? RAIN_S : CLEAR_S;
      this.nextChange = t + a + Math.random() * (b - a);
    }
    const step = FADE_PER_S * dt;
    this.intensity += Math.max(-step, Math.min(step, this.target - this.intensity));

    this.root.classList.toggle('raining', this.raining);
    this.tint.style.opacity = (this.intensity * 0.38).toFixed(3);

    if (this.intensity < 0.01 && !this.drops.length && !this.splashes.length) {
      if (this.drawn) { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.drawn = false; }
      return;
    }
    this.resize();
    this.simulate(dt);
    this.draw();
  }

  private resize() {
    const w = this.root.clientWidth, h = this.root.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  private spawn(fromTop: boolean): Drop {
    const vy = 900 + Math.random() * 500;
    const groundY = this.h * (0.08 + Math.random() * 0.95);
    const y = fromTop ? -30 - Math.random() * 60 : Math.random() * groundY;
    return {
      x: Math.random() * (this.w + this.h * WIND) - this.h * WIND,
      y, vy, groundY,
      len: 12 + Math.random() * 14,
      a: 0.18 + Math.random() * 0.28,
    };
  }

  private simulate(dt: number) {
    const want = Math.round(this.maxDrops * this.intensity);
    while (this.drops.length < want) this.drops.push(this.spawn(this.drops.length > want * 0.5));
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y += d.vy * dt;
      d.x += d.vy * dt * WIND;
      if (d.y >= d.groundY) {
        if (this.splashes.length < 220) this.splashes.push({ x: d.x, y: d.groundY, t: 0 });
        if (this.drops.length > want) this.drops.splice(i, 1);
        else this.drops[i] = this.spawn(true);
      }
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      this.splashes[i].t += dt;
      if (this.splashes[i].t > 0.28) this.splashes.splice(i, 1);
    }
  }

  private draw() {
    const c = this.ctx, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.lineCap = 'round';
    c.lineWidth = 1.1;
    for (const d of this.drops) {
      c.strokeStyle = `rgba(206,222,236,${d.a})`;
      c.beginPath();
      c.moveTo(d.x, d.y);
      c.lineTo(d.x - d.len * WIND, d.y - d.len);
      c.stroke();
    }
    c.lineWidth = 1;
    for (const s of this.splashes) {
      const p = s.t / 0.28;
      c.strokeStyle = `rgba(214,228,238,${0.45 * (1 - p)})`;
      c.beginPath();
      c.ellipse(s.x, s.y, 2 + p * 6, 1 + p * 2.2, 0, 0, Math.PI * 2);
      c.stroke();
    }
    this.drawn = true;
  }
}
