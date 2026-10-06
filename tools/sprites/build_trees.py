#!/usr/bin/env python3
"""
Atlas limpo das árvores a partir de src/assets/world-props.webp (linha 1, 4 árvores).

No atlas original as copas invadem a célula vizinha e o pé encosta na borda de baixo,
então cada árvore aparecia com uma fatia da vizinha e a base cortada reta. Aqui:
  1. cada célula é ampliada para incluir o que transborda;
  2. fica só a árvore principal (maior região conectada perto do centro da célula);
  3. o pé ganha um degradê suave no lugar do corte reto;
  4. tudo é reempacotado em células com margem, alinhado pela base do tronco.

Uso:  python3 tools/sprites/build_trees.py   ->  src/assets/sprites/trees.webp (4 colunas)
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'src' / 'assets' / 'world-props.webp'
OUT = ROOT / 'src' / 'assets' / 'sprites' / 'trees.webp'
CELL = 256        # célula de saída
BASE = 232        # linha do pé na célula de saída
FADE = 14         # pixels de degradê no pé


def main():
    im = np.array(Image.open(SRC).convert('RGBA'))
    H, W = im.shape[:2]
    cw, ch = W / 4, H / 3
    out = Image.new('RGBA', (CELL * 4, CELL), (0, 0, 0, 0))
    for k in range(4):
        # janela larga: célula + meia célula de cada lado (para pegar o que transborda)
        x0, x1 = int(max(0, (k - 0.5) * cw)), int(min(W, (k + 1.5) * cw))
        win = im[0:int(ch), x0:x1].copy()
        mask = win[..., 3] > 24
        labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
        # a árvore desta célula é a maior região cujo centro cai dentro da célula original
        best, best_size = 0, 0
        cx_cell = (k + 0.5) * cw - x0
        for i, sl in enumerate(ndimage.find_objects(labels), start=1):
            cx = (sl[1].start + sl[1].stop) / 2
            size = int((labels[sl] == i).sum())
            if abs(cx - cx_cell) < cw * 0.45 and size > best_size:
                best, best_size = i, size
        keep = ndimage.binary_dilation(labels == best, iterations=2)
        win[..., 3] = np.where(keep, win[..., 3], 0)
        ys, xs = np.nonzero(win[..., 3] > 24)
        top, bottom, left, right = ys.min(), ys.max(), xs.min(), xs.max()
        tree = win[top:bottom + 1, left:right + 1].copy()
        # pé: degradê nas últimas linhas, que estavam cortadas reto pela borda da célula
        h = tree.shape[0]
        ramp = np.ones(h)
        ramp[h - FADE:] = np.linspace(1, 0, FADE)
        tree[..., 3] = (tree[..., 3] * ramp[:, None]).astype(np.uint8)
        img = Image.fromarray(tree)
        scale = min((CELL - 16) / img.width, (BASE - 8) / img.height, 1.0)
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
        px = k * CELL + (CELL - img.width) // 2
        py = BASE - img.height
        out.alpha_composite(img, (px, py))
        print(f'árvore {k}: {tree.shape[1]}x{tree.shape[0]} -> {img.width}x{img.height}')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, 'WEBP', quality=88, method=6)
    print(f'{OUT.relative_to(ROOT)}  {OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
