import type { Entity } from './entity';

// Hash espacial uniforme reconstruído a cada tick (O(n)).
export class SpatialHash {
  cell: number;
  cols: number;
  rows: number;
  cells: Entity[][];
  constructor(w: number, h: number, cell = 4) {
    this.cell = cell;
    this.cols = Math.ceil(w / cell);
    this.rows = Math.ceil(h / cell);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }
  clear() {
    for (const c of this.cells) c.length = 0;
  }
  insert(e: Entity) {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(e.cx / this.cell)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(e.cy / this.cell)));
    this.cells[cy * this.cols + cx].push(e);
  }
  /** Consulta entidades em um retângulo (coordenadas em tiles). */
  queryRect(x0: number, y0: number, x1: number, y1: number, out: Entity[]): Entity[] {
    out.length = 0;
    const c0 = Math.max(0, Math.floor(x0 / this.cell)), c1 = Math.min(this.cols - 1, Math.floor(x1 / this.cell));
    const r0 = Math.max(0, Math.floor(y0 / this.cell)), r1 = Math.min(this.rows - 1, Math.floor(y1 / this.cell));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[r * this.cols + c];
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          if (e.cx >= x0 && e.cx <= x1 && e.cy >= y0 && e.cy <= y1) out.push(e);
        }
      }
    return out;
  }
  queryRadius(x: number, y: number, r: number, out: Entity[]): Entity[] {
    out.length = 0;
    const c0 = Math.max(0, Math.floor((x - r) / this.cell)), c1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cell));
    const r0 = Math.max(0, Math.floor((y - r) / this.cell)), r1 = Math.min(this.rows - 1, Math.floor((y + r) / this.cell));
    const r2 = r * r;
    for (let rr = r0; rr <= r1; rr++)
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[rr * this.cols + c];
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          const dx = e.cx - x, dy = e.cy - y;
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
      }
    return out;
  }
}
