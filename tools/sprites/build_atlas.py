#!/usr/bin/env python3
"""
Atlas de objetos estáticos/animados (construções, minas, árvores, ícones, efeitos) a partir
das folhas geradas por IA em tools/sprites/incoming. Configuração: tools/sprites/atlas.json.

As folhas não têm grade exata (linhas de alturas diferentes, prédios que transbordam a célula,
fumaça solta). Para cada folha:
  1. encontra as regiões desenhadas; pedaços pequenos (fumaça, faíscas) se juntam ao objeto
     grande mais próximo;
  2. divide os objetos em linhas pelos maiores vãos verticais e, em cada linha, em colunas;
  3. alinha cada quadro pela base (pés/alicerce) e pelo centro da base, com escala única;
  4. grava src/assets/sprites/<key>.webp (quadros na ordem de leitura, `cols` por linha).

Uso:  python3 tools/sprites/build_atlas.py [chave ...]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
OUT = ROOT / 'src' / 'assets' / 'sprites'
MANIFEST = ROOT / 'src' / 'render' / 'atlas-manifest.ts'
ALPHA = 24


def split_1d(values, groups):
    """Índices de corte que separam `values` (ordenados) em `groups` grupos pelos maiores vãos."""
    if groups <= 1 or len(values) <= 1:
        return []
    gaps = sorted(range(len(values) - 1), key=lambda i: values[i + 1] - values[i], reverse=True)[:groups - 1]
    return sorted(g + 1 for g in gaps)


def objects(img, rows, cols, min_frac):
    """Grade regular; em cada célula fica a peça principal + pedaços soltos que não tocam a borda
    (fumaça, faíscas). O que vaza da vizinha encosta na borda e é descartado."""
    a = np.array(img)
    H, W = a.shape[:2]
    frames, counts = [], []
    for r in range(rows):
        n = 0
        for c in range(cols):
            x0, x1 = round(c * W / cols), round((c + 1) * W / cols)
            y0, y1 = round(r * H / rows), round((r + 1) * H / rows)
            cell = a[y0:y1, x0:x1].copy()
            mask = cell[..., 3] > ALPHA
            lab, k = ndimage.label(mask, structure=np.ones((3, 3)))
            if k == 0:
                frames.append(None)
                continue
            area = ndimage.sum(mask, lab, range(1, k + 1))
            main = int(np.argmax(area)) + 1
            if area[main - 1] < 300:
                frames.append(None)
                continue
            keep = lab == main
            for i, sl in enumerate(ndimage.find_objects(lab), start=1):
                if i == main or area[i - 1] < 40:
                    continue
                ys, xs = sl
                edge = ys.start == 0 or xs.start == 0 or ys.stop >= cell.shape[0] or xs.stop >= cell.shape[1]
                if not edge or area[i - 1] >= area[main - 1] * 0.25:
                    keep |= lab == i
            keep = ndimage.binary_dilation(keep, iterations=2)
            cell[..., 3] = np.where(keep, cell[..., 3], 0)
            frames.append(cell)
            n += 1
        counts.append(n)
    return frames, counts


def base_center(fr):
    m = fr[..., 3] > ALPHA
    ys, xs = np.nonzero(m)
    bottom = ys.max()
    h = bottom - ys.min() + 1
    band = ys >= bottom - h * 0.25
    return float(np.median(xs[band])), int(bottom), int(xs.max() - xs.min() + 1), int(h)


def build(key, conf):
    img = Image.open(TOOLS / 'incoming' / conf['src']).convert('RGBA')
    rows, cols = conf['grid'][1], conf['grid'][0]
    frames, counts = objects(img, rows, cols, conf.get('min_frac', 0.08))
    if len(counts) != rows:
        print(f'  aviso {key}: {len(counts)} linhas detectadas')
    cell = conf.get('cell', 256)
    base = round(cell * conf.get('baseline', 0.94))
    ref = frames[conf.get('ref', 0)] if frames[conf.get('ref', 0)] is not None else next(f for f in frames if f is not None)
    _, _, rw, rh = base_center(ref)
    fit = conf.get('fit', 0.9)
    scale = min(cell * fit / rw, (base - cell * 0.02) / rh)
    out_cols = conf.get('out_cols', cols)
    n = len(frames)
    out_rows = (n + out_cols - 1) // out_cols
    sheet = Image.new('RGBA', (cell * out_cols, cell * out_rows), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        if fr is None:
            continue
        cx, bottom, _, _ = base_center(fr)
        im = Image.fromarray(fr)
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        col, row = i % out_cols, i // out_cols
        px = round(col * cell + cell / 2 - cx * scale)
        py = round(row * cell + base - (bottom + 1) * scale)
        layer = Image.new('RGBA', sheet.size, (0, 0, 0, 0))
        layer.paste(im, (px, py))
        box = (col * cell, row * cell, (col + 1) * cell, (row + 1) * cell)
        sheet.alpha_composite(layer.crop(box), (box[0], box[1]))
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f'{key}.webp'
    sheet.save(path, 'WEBP', quality=conf.get('quality', 84), method=6)
    missing = sum(1 for f in frames if f is None)
    print(f'{key}: {n} quadros ({missing} vazios), linhas {counts}, {path.stat().st_size // 1024} KB')
    return {'cols': out_cols, 'rows': out_rows, 'cell': cell, 'baseline': base, 'frames': n}


def main():
    conf = json.loads((TOOLS / 'atlas.json').read_text())
    only = set(sys.argv[1:])
    meta = {}
    old = {}
    if MANIFEST.exists():
        txt = MANIFEST.read_text()
        start = txt.find('/*JSON')
        if start >= 0:
            old = json.loads(txt[start + 6:txt.find('JSON*/')])
    for key, c in conf['atlases'].items():
        if only and key not in only:
            meta[key] = old.get(key)
            continue
        meta[key] = build(key, c)
    meta = {k: v for k, v in meta.items() if v}
    lines = ['// GERADO por tools/sprites/build_atlas.py — não edite à mão.', '']
    for k in meta:
        lines.append(f"import {k}Url from '../assets/sprites/{k}.webp';")
    lines += ['', 'export interface AtlasInfo { url: string; cols: number; rows: number; cell: number; baseline: number; frames: number }',
              'export const ATLAS: Record<string, AtlasInfo> = {']
    for k, v in meta.items():
        lines.append(f"  {k}: {{ url: {k}Url, cols: {v['cols']}, rows: {v['rows']}, cell: {v['cell']}, baseline: {v['baseline']}, frames: {v['frames']} }},")
    lines += ['};', f'/*JSON{json.dumps(meta)}JSON*/', '']
    MANIFEST.write_text('\n'.join(lines))


if __name__ == '__main__':
    main()
