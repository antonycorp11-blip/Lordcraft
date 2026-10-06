# Reinos de Aldaris

Protótipo jogável de estratégia em tempo real para navegador, com quatro povos originais, três mapas, IA adversária, economia, construção, heróis, combate, diplomacia e partidas salvas localmente.

## Executar

Requer Node.js. Na pasta do projeto:

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite. Para validar o projeto:

```bash
npm test
npm run build
```

## Controles

- Clique ou arraste para selecionar. **Shift** adiciona ou remove unidades da seleção.
- Clique direito dá uma ordem contextual; **Shift + clique direito** encadeia ordens.
- **A + clique** avança atacando; **S** para; **H** mantém posição.
- **Ctrl + número** salva um grupo; **número** seleciona o grupo.
- Setas, bordas da tela ou arraste com o botão central movem a câmera. A roda do mouse altera o zoom.
- **F1** seleciona o herói; **.** encontra um trabalhador ocioso; **Espaço** vai ao último alerta; **F10** abre o menu.

No celular, toque para selecionar e dar ordens, arraste para mover a câmera e faça pinça para alterar o zoom. O menu **Como jogar** dentro do jogo explica a economia e o objetivo.

As partidas são salvas no armazenamento local do navegador usado para jogar.

## Arte e animação

- **Animações quadro a quadro (humanos de Valmir):** as folhas geradas ficam em `tools/sprites/source/` e são limpas e alinhadas por `python3 tools/sprites/build_sprites.py`, que grava `src/assets/sprites/` e `src/render/sprite-manifest.ts`. Formato e lista de pedidos: [tools/sprites/PEDIDOS.md](tools/sprites/PEDIDOS.md).
- **Interface da partida:** `src/styles/hud.css` — limpa, pensada primeiro para o celular; o mapa ocupa a tela e os painéis flutuam por cima.
- **Clima e vida no cenário:** chuva automática (`src/render/weather.ts`), árvores ao vento (só na qualidade Alta) e fumaça nas chaminés (`src/styles/sprites.css`).
- **Mapas fixos:** cada campo de batalha tem uma semente fixa em `src/world/mapgen.ts` (`seed`), então o terreno é sempre o mesmo.
- **Desempenho:** a qualidade visual inicial é escolhida pelo aparelho (sem aceleração de vídeo → Baixa; até 4 núcleos → Média). O chão é pintado em canvas por bloco (`src/render/ground-paint.ts`) e a névoa é um canvas de 1 pixel por tile.

O campo de batalha usa atlases WebP em `src/assets`: texturas de solo e água, objetos, edifícios por povo e sequências de quatro quadros para todas as unidades. Caminhada, trabalho, ataque, magia e morte respondem aos estados da simulação; interface, neblina e efeitos continuam em camadas HTML/CSS.
