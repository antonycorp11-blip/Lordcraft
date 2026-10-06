#!/usr/bin/env python3
"""
Constrói as folhas de animação usadas no jogo a partir das folhas geradas por IA.

As folhas geradas raramente vêm alinhadas: o personagem "escorrega" dentro da célula,
muda de escala e às vezes invade a célula vizinha. Para cada quadro este script:
  1. recorta a célula e isola o personagem (maior região conectada + pedaços internos);
  2. mede a base (pés) e o centro do corpo;
  3. alinha todos os quadros na mesma linha de chão e no mesmo eixo vertical
     (modo "lock": trava o tronco, ideal para caminhada; modo "cell": preserva o
     avanço do corpo, ideal para estocadas e golpes);
  4. aplica uma escala única por personagem e reempacota em células iguais.

Saídas:
  src/assets/sprites/<key>.webp        uma linha por animação, quadros na horizontal
  src/render/sprite-manifest.ts        dados para o renderizador (gerado)
  tools/sprites/preview/<key>.png      prancha com guias para conferir o alinhamento

Uso:  python3 tools/sprites/build_sprites.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
OUT_DIR = ROOT / 'src' / 'assets' / 'sprites'
PREVIEW_DIR = TOOLS / 'preview'
MANIFEST = ROOT / 'src' / 'render' / 'sprite-manifest.ts'

ALPHA_MIN = 24          # pixels mais transparentes que isto não contam como corpo
KEEP_RATIO = 0.015      # pedaços soltos menores que 1,5% do corpo são descartados


def cell_boxes(width, height, cols, rows):
    xs = [round(c * width / cols) for c in range(cols + 1)]
    ys = [round(r * height / rows) for r in range(rows + 1)]
    return [(xs[c], ys[r], xs[c + 1], ys[r + 1]) for r in range(rows) for c in range(cols)]


def isolate(rgba):
    """Mantém o personagem: maior componente + componentes relevantes que não tocam a borda."""
    mask = rgba[..., 3] > ALPHA_MIN
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    if count == 0:
        return rgba, mask
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    main = int(np.argmax(sizes)) + 1
    keep = np.zeros(count + 1, dtype=bool)
    keep[main] = True
    h, w = mask.shape
    slices = ndimage.find_objects(labels)
    for i, sl in enumerate(slices, start=1):
        if i == main or sizes[i - 1] < sizes[main - 1] * KEEP_RATIO:
            continue
        ys, xs = sl
        touches = ys.start == 0 or xs.start == 0 or ys.stop >= h or xs.stop >= w
        if not touches:
            keep[i] = True
    kept = keep[labels]
    # suaviza: inclui o halo semitransparente vizinho das partes mantidas
    halo = ndimage.binary_dilation(kept, iterations=2)
    out = rgba.copy()
    out[..., 3] = np.where(halo, out[..., 3], 0)
    return out, kept


def measure(mask):
    rows = np.where(mask.sum(axis=1) >= 3)[0]
    cols = np.where(mask.any(axis=0))[0]
    top, bottom = int(rows.min()), int(rows.max())
    left, right = int(cols.min()), int(cols.max())
    height = bottom - top + 1
    # centro do corpo: mediana das colunas na faixa do quadril/pernas (robusto a armas)
    band = mask[top + int(height * 0.55): bottom + 1]
    ys, xs = np.nonzero(band)
    cx = float(np.median(xs)) if len(xs) else (left + right) / 2
    return {'top': top, 'bottom': bottom, 'left': left, 'right': right, 'height': height, 'cx': cx}


def torso_shift(ref_mask, mask, ref_m, m, search=28):
    """Deslocamento horizontal que melhor sobrepõe o tronco deste quadro ao de referência."""
    def torso(msk, mm):
        t = mm['top'] + int(mm['height'] * 0.15)
        b = mm['top'] + int(mm['height'] * 0.6)
        band = np.zeros_like(msk)
        band[t:b] = msk[t:b]
        return band
    a = torso(ref_mask, ref_m)
    b = torso(mask, m)
    # recortes de tamanhos diferentes (folhas sem grade): mesma tela, origem no canto superior
    h, w = max(a.shape[0], b.shape[0]), max(a.shape[1], b.shape[1])
    a = np.pad(a, ((0, h - a.shape[0]), (0, w - a.shape[1])))
    b = np.pad(b, ((0, h - b.shape[0]), (0, w - b.shape[1])))
    # alinha verticalmente pela base antes de comparar
    dy = ref_m['bottom'] - m['bottom']
    b = np.roll(b, dy, axis=0)
    best, best_dx = -1, 0
    for dx in range(-search, search + 1):
        score = np.logical_and(a, np.roll(b, dx, axis=1)).sum()
        if score > best:
            best, best_dx = score, dx
    return best_dx


def component_rows(src_rgba, min_area=300, row_gap=40, pad=6):
    """Folhas sem grade: cada figura é uma região conectada; linhas = mesma altura dos pés."""
    mask = src_rgba[..., 3] > ALPHA_MIN
    labels, count = ndimage.label(mask, structure=np.ones((3, 3)))
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    comps = []
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sizes[i - 1] >= min_area:
            comps.append((i, sl[0].start, sl[0].stop, sl[1].start, sl[1].stop))
    comps.sort(key=lambda c: c[2])
    rows = []
    for c in comps:
        if rows and abs(c[2] - rows[-1][-1][2]) < row_gap:
            rows[-1].append(c)
        else:
            rows.append([c])
    out = []
    H, W = mask.shape
    for r in rows:
        r.sort(key=lambda c: c[3])
        frames = []
        for lab, y0, y1, x0, x1 in r:
            y0, y1, x0, x1 = max(0, y0 - pad), min(H, y1 + pad), max(0, x0 - pad), min(W, x1 + pad)
            crop = src_rgba[y0:y1, x0:x1].copy()
            own = ndimage.binary_dilation(labels[y0:y1, x0:x1] == lab, iterations=2)
            crop[..., 3] = np.where(own, crop[..., 3], 0)
            frames.append(crop)
        out.append(frames)
    return out


def build_sheet(conf, out_conf):
    src = Image.open(TOOLS / conf['src']).convert('RGBA')
    out_conf = {**out_conf, **conf.get('output', {})}
    cell_w, cell_h = out_conf['cell']
    baseline = out_conf['baseline']

    frames = {}
    if conf.get('layout') == 'components':
        rows = component_rows(np.array(src))
        if len(rows) != len(conf['rows']):
            raise SystemExit(f"{conf['key']}: {len(rows)} linhas encontradas, {len(conf['rows'])} nomes em 'rows'")
        for name, row in zip(conf['rows'], rows):
            if name not in conf['anims']:
                continue  # linha ignorada (ex.: reação a golpe sem uso no jogo)
            frames[name] = []
            for rgba in row:
                clean, mask = isolate(rgba)
                frames[name].append({'img': clean, 'mask': mask, 'm': measure(mask), 'cell_cx': rgba.shape[1] / 2})
            conf['anims'][name]['count'] = len(row)
    else:
        cols, rows_n = conf['grid']
        boxes = cell_boxes(src.width, src.height, cols, rows_n)
        for name, anim in conf['anims'].items():
            frames[name] = []
            for i in range(anim['from'], anim['from'] + anim['count']):
                x0, y0, x1, y1 = boxes[i]
                rgba = np.array(src.crop((x0, y0, x1, y1)))
                clean, mask = isolate(rgba)
                frames[name].append({'img': clean, 'mask': mask, 'm': measure(mask), 'cell_cx': (x1 - x0) / 2})

    # escala única: altura mediana de todos os quadros -> altura alvo
    heights = [f['m']['height'] for fs in frames.values() for f in fs]
    scale = conf['height'] / float(np.median(heights))

    anim_names = [n for n in conf['anims'] if n in frames]
    max_frames = max(conf['anims'][n]['count'] for n in anim_names)
    sheet = Image.new('RGBA', (cell_w * max_frames, cell_h * len(anim_names)), (0, 0, 0, 0))
    clipped = 0

    for row, name in enumerate(anim_names):
        anim = conf['anims'][name]
        fs = frames[name]
        ref = fs[0]
        # deslocamento horizontal de cada quadro em pixels da origem
        if anim.get('align') == 'lock':
            # o ponto cx do quadro de referência corresponde a (cx - dx) em cada quadro
            offsets = [0.0] + [float(torso_shift(ref['mask'], f['mask'], ref['m'], f['m'])) for f in fs[1:]]
            anchor_x = [ref['m']['cx'] - off for off in offsets]
        elif anim.get('align') == 'feet':
            # cada quadro centrado pelas pernas (quedas, onde o tronco muda de lugar)
            anchor_x = [f['m']['cx'] for f in fs]
        else:
            # preserva o movimento relativo à célula, centrado pela média da animação
            rel = [f['m']['cx'] - f['cell_cx'] for f in fs]
            mean_rel = float(np.mean(rel))
            anchor_x = [f['cell_cx'] + mean_rel for f in fs]
        for col, f in enumerate(fs):
            img = Image.fromarray(f['img'])
            w = max(1, round(img.width * scale))
            h = max(1, round(img.height * scale))
            img = img.resize((w, h), Image.LANCZOS)
            ax = anchor_x[col] * scale
            by = (f['m']['bottom'] + 1) * scale
            px = round(col * cell_w + cell_w / 2 - ax)
            py = round(row * cell_h + baseline - by)
            # recorta o que invadiria a célula vizinha
            cell_box = (col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h)
            layer = Image.new('RGBA', sheet.size, (0, 0, 0, 0))
            layer.paste(img, (px, py))
            region = layer.crop(cell_box)
            lost = np.array(layer)[..., 3].sum() - np.array(region)[..., 3].sum()
            if lost > 255 * 40:
                clipped += 1
            sheet.alpha_composite(region, (cell_box[0], cell_box[1]))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{conf['key']}.webp"
    sheet.save(out, 'WEBP', quality=90, method=6)

    preview(conf['key'], sheet, anim_names, conf['anims'], cell_w, cell_h, baseline)
    # altura na tela: "screen" px de personagem -> tamanho de exibição da célula
    display = out_conf['display']
    if 'screen' in conf:
        display = round(conf['screen'] * cell_h / conf['height'], 1)
    meta = {
        'cell': [cell_w, cell_h], 'baseline': baseline, 'display': display,
        'cols': max_frames,
        'rows': len(anim_names),
        'anims': {name: {'row': i, 'frames': conf['anims'][name]['count'], 'fps': conf['anims'][name]['fps'],
                         'loop': bool(conf['anims'][name].get('loop', True))} for i, name in enumerate(anim_names)},
    }
    print(f"{conf['key']}: {sheet.width}x{sheet.height}  escala {scale:.3f}  {out.stat().st_size // 1024} KB"
          + (f"  ({clipped} quadro(s) cortados na borda)" if clipped else ''))
    return meta


def preview(key, sheet, anim_names, anims, cell_w, cell_h, baseline):
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    bg = Image.new('RGBA', sheet.size, (232, 226, 210, 255))
    draw = ImageDraw.Draw(bg)
    for r in range(len(anim_names)):
        y = r * cell_h + baseline
        draw.line([(0, y), (sheet.width, y)], fill=(200, 60, 40, 255), width=2)
        for c in range(anims[anim_names[r]]['count'] + 1):
            x = c * cell_w
            draw.line([(x, r * cell_h), (x, (r + 1) * cell_h)], fill=(150, 140, 120, 255), width=1)
            if c < anims[anim_names[r]]['count']:
                cx = x + cell_w // 2
                draw.line([(cx, r * cell_h), (cx, (r + 1) * cell_h)], fill=(60, 110, 200, 160), width=1)
    bg.alpha_composite(sheet)
    bg.convert('RGB').save(PREVIEW_DIR / f'{key}.png')


def write_manifest(entries, out_conf):
    lines = [
        '// GERADO por tools/sprites/build_sprites.py — não edite à mão.',
        '// Folhas de animação limpas: uma linha por animação, quadros da esquerda para a direita.',
        '',
    ]
    for key in entries:
        lines.append(f"import {key}Url from '../assets/sprites/{key}.webp';")
    lines += [
        '',
        "// Estados da simulação; folhas podem ter variações (walk_n, work_mine, carry, ...).",
        "export type SpriteAnimName = 'idle' | 'walk' | 'attack' | 'work' | 'cast' | 'die';",
        'export interface SpriteAnim { row: number; frames: number; fps: number; loop: boolean }',
        'export interface SpriteSheet {',
        '  url: string; cols: number; rows: number;',
        '  cellW: number; cellH: number; anchorX: number; anchorY: number;',
        '  display: number; // altura da célula na tela, em px (antes do zoom)',
        '  anims: Partial<Record<string, SpriteAnim>>;',
        '}',
        '',
        'export const SPRITE_SHEETS: Record<string, SpriteSheet> = {',
    ]
    for key, meta in entries.items():
        anims = ', '.join(
            f"{name}: {{ row: {a['row']}, frames: {a['frames']}, fps: {a['fps']}, loop: {str(a['loop']).lower()} }}"
            for name, a in meta['anims'].items()
        )
        cw, ch = meta['cell']
        lines.append(
            f"  {key}: {{ url: {key}Url, cols: {meta['cols']}, rows: {meta['rows']}, cellW: {cw}, cellH: {ch}, "
            f"anchorX: {cw // 2}, anchorY: {meta['baseline']}, display: {meta['display']}, anims: {{ {anims} }} }},"
        )
    lines += ['};', '']
    MANIFEST.write_text('\n'.join(lines), encoding='utf-8')


def main():
    conf = json.loads((TOOLS / 'sources.json').read_text(encoding='utf-8'))
    entries = {}
    for sheet in conf['sheets']:
        entries[sheet['key']] = build_sheet(sheet, conf['output'])
    write_manifest(entries, conf['output'])
    print(f'manifesto: {MANIFEST.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
