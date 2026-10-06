# Folhas de animação — formato e pedidos (foco: humanos de Valmir)

O jogo toca animações quadro a quadro a partir de `src/assets/sprites/*.webp`,
geradas por `tools/sprites/build_sprites.py` a partir das folhas em `tools/sprites/source/`.
O script recorta cada célula, isola o personagem, alinha pés e tronco, aplica uma escala
única por personagem e grava a folha limpa + `src/render/sprite-manifest.ts`.

## Como entregar uma folha

1. Grade de células **iguais**, fundo **transparente**, sem bordas, números ou texto.
2. **Um só personagem**, idêntico em todos os quadros, mesma escala, câmera RTS 3/4
   de cima, **virado para baixo-direita** (o jogo espelha para a esquerda).
3. Cada animação ocupa quadros **consecutivos** (lidos da esquerda para a direita,
   de cima para baixo). Mínimo **10 quadros**, recomendado **12**.
4. Os pés tocam o chão no mesmo nível; nada pode invadir a célula vizinha
   (lanças e armas inclusive — deixe margem).
5. Salve em `tools/sprites/source/` e acrescente em `tools/sprites/sources.json`:

```json
{
  "key": "v_besteiro",
  "src": "source/valmir-besteiro.png",
  "grid": [6, 4],
  "height": 176,
  "anims": {
    "walk":   { "from": 0,  "count": 12, "fps": 16, "loop": true,  "align": "lock" },
    "attack": { "from": 12, "count": 12, "fps": 18, "loop": false, "align": "cell" }
  }
}
```

- `key` = id da unidade em `src/data/factions.ts`.
- `height` = altura do personagem em px na célula final de 256 px (≈ 165–185 para infantaria).
- `align`: `lock` trava o tronco (caminhar, ficar parado); `cell` preserva o avanço do
  corpo (golpes, estocadas, disparos).
- Nomes de animação aceitos: `idle`, `walk`, `attack`, `work`, `cast`, `die`.

6. Rode `python3 tools/sprites/build_sprites.py` e confira `tools/sprites/preview/<key>.png`
   (linha vermelha = chão, azul = eixo do corpo).

## Como o jogo usa cada animação

| Estado da simulação | Animação | Observação |
|---|---|---|
| parado | `idle` (loop) | sem `idle`, usa o 1º quadro de `walk` respirando |
| andando | `walk` (loop) | |
| golpe | `attack` (uma vez por golpe) | reinicia a cada golpe; ~0,6 s no total |
| minerar, cortar, construir | `work` (loop) | sem `work`, usa `attack` |
| magia | `cast` (uma vez) | sem `cast`, usa `attack` |
| morte | `die` (uma vez, para no último) | sem `die`, a figura tomba via CSS |

Se a unidade não tiver `attack`, `work` ou `cast`, o jogo usa o sprite antigo **só naquele
estado**.

## Folhas sem grade (como a do lavrador)

Também dá para entregar uma folha "livre": figuras soltas sobre fundo transparente, uma
animação por linha. Use `"layout": "components"` e dê um nome para cada linha, de cima para
baixo, em `"rows"` (linhas sem animação no jogo, como `"hurt"`, são ignoradas). Exemplo real:
a entrada `v_lavrador` em `sources.json`.

Nomes extras que o jogo entende:

| Nome | Quando é usado |
|---|---|
| `idle_s`, `idle_e`, `idle_n`, `idle_w` | parado, olhando para baixo/direita/cima/esquerda |
| `walk_s`, `walk_e`, `walk_n`, `walk_w` | andando na direção do movimento (sem espelhar) |
| `work_mine`, `work_chop`, `work_build` | minerando, cortando árvore, construindo/reparando |
| `carry` | andando com prata ou éter nos braços |

## Já integradas

| Unidade | Animações |
|---|---|
| `v_lavrador` Lavrador | parado e andando nas 4 direções, minerar, cortar, martelar, carregar, morrer |
| `v_lanceiro` Lanceiro de Escudo | walk 12, attack 12 |

## Pedidos (Valmir, por prioridade)

| # | Unidade | Animações (quadros) | Grade sugerida |
|---|---|---|---|
| 1 | `v_lanceiro` Lanceiro | parado e andando nas 4 direções, die | livre |
| 2 | `v_besteiro` Besteiro | idle 12, walk 12, attack 12 (mirar, disparar, recarregar), die 12 | 6×8 |
| 3 | `v_cavaleiro` Cavaleiro | idle 12, walk 12 (galope), attack 12, die 12 | 6×8 |
| 4 | `v_marechal` Marechal Aldren (herói) | idle 12, walk 12, attack 12, cast 12, die 12 | 6×10 |
| 5 | `v_cleriga` Clériga da Aurora | idle 12, walk 12, cast 12, die 12 | 6×8 |
| 6 | `v_falcoeiro` Falcoeiro | idle 12 (voo parado), walk 12, attack 12, die 12 | 6×8 |
| 7 | `v_trabuco` Trabuco | idle 10, walk 12 (rodas), attack 12 (braço dispara) | 6×6 |

Grade 6×8 = 48 células: linhas 1–2 a 1ª animação, 3–4 a 2ª, e assim por diante.

## Edifícios e cenário (já animados por código)

- Árvores balançam ao vento (mais forte na chuva), fumaça nas chaminés da casa,
  serraria e forja, e chuva com respingos (`src/render/weather.ts`).
- Para animar a roda d'água, bandeiras e fornalhas de verdade, o próximo passo é uma
  folha por edifício (ex.: roda d'água em 12 quadros) e o mesmo pipeline para edifícios.
