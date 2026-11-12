# Killer: modo de edição do Gravador (QuickEdit)

**Tier** T2 rota (com região C dentro) · **Nota** 83/100 (era 67) · **Veredito**
vai pra PR com uma pendência: o enquadramento do vídeo ainda não foi visto.
**Superfície** B trabalho, com `salvar o corte` em C confiança.

A pergunta que gerou esta auditoria foi "o que falta pra ficar nível Apple". A
resposta curta: **nada de sintaxe.** Os quatro detectores deram zero. O que
falta é a camada que nenhum linter vê — a tela não se move, não espera direito,
e mente num botão.

## Decisão pendente (sua, não minha)

1. **Aplicar os 7 itens da tabela "o que falta", ou só os primeiros?** Minha
   recomendação: os quatro primeiros (motion, skeleton, botão que não mente,
   afordância da região). Os três últimos (desfazer, teclado no trecho, fala
   marcada na onda) são feature, não acabamento, e podem esperar você usar a
   ferramenta uma semana.
2. **A onda deve mostrar onde tem fala?** Os `segments` da transcrição já estão
   em memória (`Recorder.tsx`, `detail.segments`). Marcar a fala na régua troca
   "aparar no escuro" por "aparar no que foi dito" — mas muda a natureza da
   peça, e isso é decisão de produto, não de acabamento.

## Superfícies

| Arquivo | Superfície (A/B/C) | Variável de negócio que move | Notas |
|---|---|---|---|
| packages/ui/src/QuickEdit.tsx | **B trabalho** | gravação que vira peça sem abrir editor externo — minutos de material reaproveitados por semana | densidade e teclado mandam; quem chega aqui já gravou e quer sair com um trecho |
| └ região `salvar o corte` (QuickEdit.tsx:196-215, 300-312) | **C confiança** | grava sessão nova no banco + escreve arquivo no disco | ação que CRIA dado. Não pode falhar calada nem prometer o que o ffmpeg não fez |
| packages/ui/src/Recorder.tsx | **B trabalho** | o custo de ir de "ler" pra "cortar" — se custar um clique a mais, ninguém corta | a tesoura divide o diálogo em dois modos; errar aqui mata a feature inteira |

## Tela vista

- **`gravador.html` · painel medido em 940 / 480 / 390px · dado real (gravação
  de 0:27, 5,7 MB) · ABERTA.** Backend em 3103 (`GRAVADOR_DEV_PORTS=5199`),
  Vite em `http://[::1]:5199` (IPv6-only). Modo edição aberto pela tesoura.
  **Visto:** onda com picos reais, barra de proporção com as cinco opções,
  linha de trecho, tocar, salvar, moldura de recorte.
- **`gravador.html` · gravação de 9min29s / 832 MB · ABERTA.** Picos em 40 ms.
- **`corta-scan` rodado nas três larguras:** 1 achado, confirmado **falso
  positivo** (a moldura do cropper e o vídeo empilhados *são* o cropper —
  markup da lib, não meu). Zero texto cortado, zero estouro de documento.
- **Teclado testado na tela aberta**, antes e depois do conserto.
- **NÃO VISTO: o quadro do vídeo.** Naquela aba o `<video>` não sai de
  `readyState 0` nem com o arquivo inteiro em memória (blob de 6 MB, mime
  correto), e o **modo leitura, que é código antigo, faz o mesmo**. É o Chrome
  da aba. **Pendente: abrir no Studio (`npm run desktop`) e olhar o
  enquadramento.** Isso é um desconto explícito na nota.

## Portão

| Detector | Antes | Depois |
|---|---|---|
| impeccable (tell de IA) | 0 | 0 |
| copy (vício de voz) | 0 (53 strings de interface) | 0 |
| ruído (cromo) | 0 | 0 |
| refine-scan | 0 | 0 |
| tsc (ui + frontend) | pass | pass |
| 390px (painel forçado) | 0 | 0 |
| corta-scan | 1 falso positivo | 1 falso positivo |

**Pulado: o portão de token.** O `stalkier-rec-to-text` **não tem**
`audit:design`, `lint:design` nem `scripts/scan-design-*.mjs`. O
`npm run audit:design` que existe é do jaques-os e só varre `frontend/src` —
não alcança `packages/ui`. Ou seja: **o `theme.css` do pacote compartilhado é
honra, não portão.** É um achado por si só, e o motivo de os 20 pontos do
portão virarem 15.

## Defeito confirmado e consertado

| # | Onde | O defeito | Conserto |
|---|---|---|---|
| 1 | `Recorder.tsx`, keydown do `Player` | **Seta apagava trabalho.** Com um trecho marcado, `ArrowRight` pulava pra outra gravação **e** saía do modo edição, sem aviso. Medido na tela: cabeçalho foi de `0:27 / 5.7 MB` pra `0:06 / 1.0 MB`, `edicao: true → false` | no modo edição a seta não navega |
| 2 | mesmo lugar | **Esc fechava duas camadas.** Fechava o diálogo inteiro em vez de sair do modo | Esc volta UMA camada: sai do modo; o segundo Esc fecha. Verificado na tela |
| 3 | `QuickEdit.tsx`, `punho` | **Moldura livre pulava.** A conta descontava a moldura atual (errava por uma largura inteira) e lia o estado do **início** do arrasto | meia largura é a distância do centro ao dedo; ×2 |

## O que falta pra nível Apple — A a D APLICADOS, E a G adiados

Ordenado por alavanca (impacto ÷ esforço). Nenhum era defeito de portão; todos
eram decisão. **A, B, C e D foram aplicados e verificados na tela aberta**; E, F
e G ficaram adiados por escolha do dono do trabalho (são feature, não
acabamento), e por isso não descontam a nota.

Medido depois, na tela aberta, no estado de espera:
`controles mortos: 0 · esqueleto reserva 64px = altura final da onda ·
"arraste as bordas": ausente · entrada da casa: aplicada`.

| # | O que falta | Evidência | Variável que move | Custo |
|---|---|---|---|---|
| ✅ A | **A tela não se move.** É a única do pacote sem motion: `QuickEdit.tsx` usa **0** dos tokens `--ease-out`/`--dur-*`; `Recorder.tsx` + `theme.css` usam **21**. Trocar ler↔editar é um corte seco de frame | `grep -c` em QuickEdit.tsx → 0 | a confiança de que o modo mudou — hoje você confere olhando | baixo: crossfade `--dur-base` no corpo do diálogo | **APLICADO:** `panel-in`, a mesma entrada do resto do diálogo — e o guard de `prefers-reduced-motion` que já existia passou a cobrir esta tela de graça. |
| ✅ B | **"lendo a onda…" é texto no lugar de onda.** Quando os picos chegam, um bloco de 64px nasce do nada e **empurra a barra de ação pra baixo** — salto de layout exatamente onde a pessoa vai clicar | `QuickEdit.tsx:268-277` | cliques errados no instante da chegada | baixo: caixa da altura final + shimmer `linear`, crossfade | **APLICADO:** caixa de 64px com `.skeleton` (`breathe`) exatamente onde a onda vai ficar. Medido: reserva 64 = altura final 64, zero salto. |
| ✅ C | **Botão primário desabilitado é mentira** (espinha 2 do `visant-frontend`). "Salvar o corte" fica cinza sem dizer por quê enquanto a mídia não tem metadados | `QuickEdit.tsx:305` | a pessoa não sabe se esperou pouco ou se quebrou | baixo: o botão vira o próprio estado, ou some e dá lugar a uma linha quieta | **APLICADO:** o primário some e dá lugar a uma linha quieta; "tocar" e o travessão vazio também pararam de se desenhar sem ter o que dizer. Medido: 0 controles mortos. |
| ✅ D | **"Arraste as bordas pra escolher o trecho"** é a página se explicando (catálogo item 20, `ruido-scan/ensina-a-usar`). O detector não acendeu porque a frase é curta — mas é instrução ao lado de um controle que devia ter afordância | `QuickEdit.tsx:271` | atenção gasta ensinando o que um punho visível diria sozinho | baixo: `handleStyle` na região do wavesurfer, e a frase sai | **APLICADO:** punho de 8px via `::part(region-handle)` no `theme.css`; a frase saiu da tela e virou `aria-label` — punho não se lê em leitor de tela. |
| ⏸ E | **"Tocar o trecho" não pausa.** Clicar de novo reinicia; Espaço não faz nada. Numa tela de aparar, ouvir→parar→ajustar **é** o loop principal | `QuickEdit.tsx:196-200` | velocidade do loop central da tela (superfície B) | médio |
| ⏸ F | **Salvar não tem desfazer.** Cria sessão; se foi errado, você apaga na mão. O padrão da casa é patch otimista + toast com desfazer (`visant-motion` §6) | `QuickEdit.tsx:203-215` | reversibilidade numa região C | médio |
| ⏸ G | **O trecho não tem teclado.** Setas pra empurrar a borda, `[` / `]` pra marcar in/out no instante atual. Superfície B sem teclado é superfície B devagar (espinha 8) | — | throughput, retenção | médio |

Fora da tabela porque é feature, não acabamento: **marcar a fala na onda** usando
os `segments` que já existem em memória. É `visant-refine`, e muda a natureza da
ferramenta.

## Interrogatório — bloco fixo

**F1 reuso.** A tela reusa o `theme.css` do pacote e o padrão de segmented
control do próprio diálogo (o par `clean/stamps` do `Recorder.tsx`). Componente
novo de design system: **nenhum**. As duas libs novas são a alternativa a
escrever trim e crop à mão. *OBRIGA: nada.*

**F2 design system.** Todas as cores saem de token (`--accent`, `--surface`,
`--border`, `--faint`, `--red-dim`). **Mas não há portão que verifique isso**
neste repo — ver "Pulado" acima. *OBRIGA: ou o pacote ganha um `audit:design`
próprio, ou o do jaques-os passa a varrer `packages/ui`.*

**F3 responsivo e performance.** Medido, não olhado: zero estouro com o painel
forçado a 940/480/390px; `corta-scan` sem texto cortado. Picos em 40 ms num
vídeo de 9,5 min (4 ms no cache) — a conta que travaria a aba mora no backend.
O editor virou chunk próprio de 89 kB e o gravador caiu de 617 pra 530 kB.
*OBRIGA: nada.*

**F4 fluxo para o ICP.** O ICP aqui é quem grava aula e quer um trecho. O
caminho é abrir → tesoura → arrastar → salvar. Quatro passos, nenhum modal
extra. *OBRIGA: nada.*

**F5 esconder ou virar ícone.** Já é quase tudo ícone. O que sobra de texto e
podia sumir é justamente o item D. *OBRIGA: D.*

**F6 o que falta para o nível Vale do Silício.** Os itens A a D, nesta ordem. A
diferença entre esta tela e uma da Apple não é o que ela faz — é que a dela
**responde**: o modo entra, a onda aparece no lugar onde já havia espaço, e
nenhum controle fica cinza sem explicar. Hoje esta tela executa certo e comunica
mal.

## Descontos explícitos na nota

- Portão de token **inexistente** no repo alvo: −5.
- Quadro do vídeo **não visto** (a aba de automação não decodifica): pendente,
  escrito, não descontado duas vezes.
- A, B, C, D **consertados**; E, F, G adiados **com justificativa aceita pelo
  dono do trabalho** — pela regra do placar, adiamento aceito não desconta: −0.
- Banco T2 de 12 perguntas **não rodado** inteiro; só o bloco fixo F1-F6: −12.

**15 (portão) + 40 (julgamento) + 28 (interrogatório) = 83.**

Pra passar de 83 falta: (a) abrir no Studio e ver o enquadramento, (b) um portão
de token no `packages/ui`, (c) o banco T2 completo. Nenhum dos três é pixel.

## Rodada 2 — a lib de recorte trocada

**A pergunta que abriu:** "e o crop não aparece os cantos resizable, por quê?"

**Causa.** O `react-easy-crop` não tem punho nenhum — confirmado no pacote
instalado, o CSS dele só define `Container`, `CropArea`, `CropAreaGrid`,
`CropAreaRound`, `Image`, `Video`. O modelo dele é o inverso: moldura fixa,
mídia que se move. E o único canto que existia era escrito à mão por mim, e só
em "livre" (`QuickEdit.tsx:278`), justamente pra suprir a falta.

**Conserto: `react-image-crop`** (0 dependências, aceita `<video>` como filho
direto — exemplo da própria doc). O que ele traz de fábrica:

- **8 punhos** (4 cantos + 4 bordas). Com proporção travada a própria lib
  esconde as bordas e deixa só os cantos — um lado puxado sozinho não preserva
  razão. No livre vêm os oito.
- **Livre é o padrão** quando não se passa `aspect`: o meu punho à mão sumiu.
- **Teclado e ARIA**: as setas movem o recorte e cada punho tem `aria-label`
  (nove strings novas em en e pt). Metade do item G resolvido sem código.
- Tema por variáveis (`--rc-*`), então vesti-lo com o `--accent` da casa é
  redefinir seis valores em `theme.css` — inclusive trocar o `#08f` de foco
  dele, que é anel de outra paleta, e apagar as "formigas marchando", que é
  animação infinita em cima do quadro que a pessoa olha pra decidir.

**O recorte passou a morar em porcentagem**, não em pixel de tela: a fração é a
mesma na caixa exibida e no arquivo, então a conversão pro ffmpeg é uma
multiplicação e redimensionar a janela não mexe no que foi pedido.

Chunk do editor: 89,4 kB → **78,7 kB** (+4,8 kB de CSS).

### Defeito 4, achado por acidente e consertado

**Um chunk que falha apagava a tela inteira.** Durante a troca, o Vite
re-otimizou as dependências no meio de um import dinâmico e o
`Failed to fetch dynamically imported module` subiu pelo React: **tela preta** —
some a leitura, a transcrição e o diálogo, porque um botão opcional não
carregou. Não é só dev: deploy que troca o arquivo debaixo de uma aba aberta faz
igual. Agora há uma cerca (`CercaDoEditor`, em `Recorder.tsx`) que contém a
falha no editor e oferece voltar a ler.

### O que continua sem ser visto

Os punhos. Na aba de automação o `<video>` não chega a `readyState 1` por
`src` através do proxy do Vite — `fetch` do mesmo arquivo volta em 10 ms e um
`<video>` novo com blob carrega em 3,9 s, mas o elemento que o React controla
não. O modo leitura, código antigo, faz o mesmo. Três abordagens, e parei.

**Pendente, e é a única coisa pendente:** abrir `npm run desktop` e conferir
que os cantos aparecem, que 9:16 mostra 4 e "livre" mostra 8.
