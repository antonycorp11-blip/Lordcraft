// Grade do mundo: terreno, elevação, bloqueios e árvores. Sem DOM.

export const enum Ter {
  Grass = 0, Dirt = 1, Sand = 2, Snow = 3, Ash = 4, Water = 5, Shallow = 6, Rock = 7, Road = 8, Moss = 9, Bridge = 10,
}
export const TER_NAMES = ['grass', 'dirt', 'sand', 'snow', 'ash', 'water', 'shallow', 'rock', 'road', 'moss', 'bridge'];

// Flags de bloqueio
export const BL_TERRAIN = 1; // água profunda, rocha, penhasco
export const BL_TREE = 2;
export const BL_BUILD = 4;
export const BL_RES = 8; // minas/cristais

export class World {
  w: number;
  h: number;
  ter: Uint8Array;
  elev: Uint8Array;
  biome: Uint8Array;
  block: Uint8Array;
  cliff: Uint8Array; // 1 = borda de penhasco (bloqueada)
  tree: Uint16Array; // madeira restante (0 = sem árvore)
  treeKind: Uint8Array;
  buildingAt: Int32Array; // id do edifício que ocupa a célula (0 = nenhum)
  version = 1; // muda quando bloqueios mudam (invalida caminhos)
  treeVersion = 1;
  changedTrees: number[] = []; // células alteradas para o renderizador
  damagedTrees: number[] = []; // árvores que perderam madeira (o desenho mostra o dano)
  grownTrees: number[] = []; // árvores que voltaram a crescer (o desenho tira o toco)
  felled: number[] = []; // árvores derrubadas, para a simulação plantar de novo

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.ter = new Uint8Array(n);
    this.elev = new Uint8Array(n);
    this.biome = new Uint8Array(n);
    this.block = new Uint8Array(n);
    this.cliff = new Uint8Array(n);
    this.tree = new Uint16Array(n);
    this.treeKind = new Uint8Array(n);
    this.buildingAt = new Int32Array(n);
  }

  idx(x: number, y: number) {
    return y * this.w + x;
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /** Passável para unidades terrestres. */
  free(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.block[y * this.w + x] === 0;
  }
  freeI(i: number): boolean {
    return this.block[i] === 0;
  }
  /** Verifica um ponto contínuo (coordenadas em tiles). */
  freeAt(x: number, y: number): boolean {
    return this.free(Math.floor(x), Math.floor(y));
  }

  setTree(i: number, wood: number, kind = 0) {
    this.tree[i] = wood;
    this.treeKind[i] = kind;
    if (wood > 0) this.block[i] |= BL_TREE;
    else this.block[i] &= ~BL_TREE;
  }

  /** Um golpe de machado: tira 1 de madeira e avisa o desenho. */
  chopTree(i: number) {
    if (!this.tree[i]) return;
    this.tree[i]--;
    if (this.tree[i] > 0) this.damagedTrees.push(i);
  }

  removeTree(i: number) {
    if (!this.tree[i]) return;
    this.tree[i] = 0;
    this.block[i] &= ~BL_TREE;
    this.treeVersion++;
    this.changedTrees.push(i);
    this.felled.push(i);
  }

  setBuilding(x0: number, y0: number, size: number, id: number, on: boolean) {
    for (let y = y0; y < y0 + size; y++)
      for (let x = x0; x < x0 + size; x++) {
        if (!this.inside(x, y)) continue;
        const i = this.idx(x, y);
        if (on) {
          this.block[i] |= BL_BUILD;
          this.buildingAt[i] = id;
        } else if (this.buildingAt[i] === id) {
          this.block[i] &= ~BL_BUILD;
          this.buildingAt[i] = 0;
        }
      }
    this.version++;
  }

  setRes(x0: number, y0: number, size: number, on: boolean) {
    for (let y = y0; y < y0 + size; y++)
      for (let x = x0; x < x0 + size; x++) {
        const i = this.idx(x, y);
        if (on) this.block[i] |= BL_RES;
        else this.block[i] &= ~BL_RES;
      }
    this.version++;
  }

  /** Linha de passagem livre entre dois pontos (para suavizar caminhos). */
  lineFree(x0: number, y0: number, x1: number, y1: number, rad = 0.3): boolean {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / 0.35);
    if (steps === 0) return true;
    const nx = (-dy / (dist || 1)) * rad, ny = (dx / (dist || 1)) * rad;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + dx * t, y = y0 + dy * t;
      if (!this.freeAt(x, y) || !this.freeAt(x + nx, y + ny) || !this.freeAt(x - nx, y - ny)) return false;
    }
    return true;
  }

  /** Busca a célula livre mais próxima (BFS em anéis). */
  nearestFree(x: number, y: number, maxR = 12): [number, number] | null {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (this.free(cx, cy)) return [cx, cy];
    for (let r = 1; r <= maxR; r++) {
      let best: [number, number] | null = null;
      let bd = 1e9;
      for (let yy = cy - r; yy <= cy + r; yy++)
        for (let xx = cx - r; xx <= cx + r; xx++) {
          if (Math.max(Math.abs(xx - cx), Math.abs(yy - cy)) !== r) continue;
          if (!this.free(xx, yy)) continue;
          const d = (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2;
          if (d < bd) {
            bd = d;
            best = [xx, yy];
          }
        }
      if (best) return best;
    }
    return null;
  }
}
