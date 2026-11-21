# Fluidez no celular (sensação de app nativo)

Pedido do dono (iPhone 13 Pro Max, tela de 120 Hz): "não é clicou, foi direto; tudo tem a animação fluida,
transição leve". Este documento registra o que travava, o que mudou e os números de antes e depois.

## Como foi medido
- Playwright + Chromium emulando o **iPhone 13** (390×844, toque), com a **CPU 4× mais lenta**
  (`Emulation.setCPUThrottlingRate`), banco com a demonstração (142 conversas, 1.145 mensagens).
- Cada número é a média de 3 rodadas. Script: `scripts/medir-fluidez.cjs`.
- **Primeiro quadro**: do toque até o primeiro quadro com a tela nova (inclui ~80–100 ms do próprio toque
  simulado pelo Playwright). **Tarefas longas**: soma das tarefas do processador acima de 50 ms
  (PerformanceObserver `longtask`), nos 0,9 s depois do toque. **Quadros perdidos**: quadros de 16,7 ms que
  não saíram (requestAnimationFrame) nessa janela. **Pior quadro**: o maior intervalo entre dois quadros.
- O Chromium sem placa de vídeo desenha tudo no processador: o iPhone (com GPU) faz as animações de
  deslize/esmaecer bem mais leves que aqui. Os números servem para comparar antes × depois.

## Antes → depois

| Ação | Primeiro quadro (ms) | Tarefas longas (ms) | Quadros perdidos | Pior quadro (ms) |
|---|---|---|---|---|
| Aba Dashboard | 309.7 → 248.3 | 328 → 160 | 20.3 → 11.3 | 205.7 → 138.7 |
| Aba Ligações | 176 → 153.7 | 18 → 0 | 3.3 → 3.7 | 55.3 → 50 |
| Aba Serena | 154 → 177 | 98 → 0 | 7.7 → 1.3 | 83 → 33.3 |
| Aba Conversas | 173 → 129 | 211.7 → 16.7 | 12.7 → 2 | 205.3 → 44.3 |
| Aba Configurações | 113 → 161 | 55 → 0 | 4.3 → 1 | 83.3 → 33.3 |
| Abrir conversa (1ª vez) ¹ | 308.7 → 253.3 | 229 → 122.3 | 12 → 8 | 155.3 → 100 |
| Abrir conversa já vista | 224.7 → 208.7 | 159.3 → 70 | 7.7 → 4.3 | 116.7 → 89 |
| Voltar da conversa | 288.7 → 177.7 | 239.3 → 57 | 14.3 → 3.7 | 222 → 77.7 |
| Abrir painel "Atendimento e IA" | 133 → 126.7 | 38.7 → 23 | 1 → 1 | 33.3 → 33.3 |
| Abrir folha "Mover de etapa" | 134.3 → 82 | 173 → 0 | 14 → 1.3 | 161.3 → 38.7 |
| Rolar a lista (gesto de 2.500 px) | — | 89.3 → 0 | 8.7 → 1.3 | 161.3 → 39 |

| Outras medidas | Antes | Depois |
|---|---|---|
| Redesenhar a lista de conversas (roda a cada 4 s) | **158.7 ms** | **2.7 ms** |
| Abrir o app até a lista na tela | 1329 ms | 857 ms |

¹ "Primeiro quadro" de abrir conversa = a conversa começa a aparecer na tela. Na 1ª vez, ela entra deslizando
já com nome e foto; as mensagens chegam do servidor e são desenhadas **logo depois do deslize** (≈ 600 ms do
toque aqui), para o deslize não engasgar. Conversa já aberta antes aparece com as mensagens na hora.

As abas Serena e Configurações ficaram ~25–50 ms mais tarde no "primeiro quadro" porque agora entram
esmaecendo (o quadro novo existe, mas começa em 30% de opacidade); em troca, nenhuma tarefa longa e quase
nenhum quadro perdido.

## O que travava
1. **A lista de conversas era apagada e refeita inteira a cada 4 segundos** (140 linhas: ~80 ms de JavaScript
   + ~90 ms de layout no celular). Isso dava um tranco a cada atualização e às vezes "engolia" o toque
   (a linha tocada era trocada por outra entre encostar e soltar o dedo).
2. Abrir uma conversa redesenhava a lista inteira de novo e mostrava a **conversa anterior** até a nova chegar
   do servidor; se duas respostas chegavam fora de ordem, podia aparecer a conversa errada.
3. Voltar para a lista e trocar para a aba Conversas montavam as 140 linhas de novo (layout de tudo).
4. O Dashboard era **redesenhado inteiro em cada atualização** (o gráfico piscava), mesmo com os números iguais
   (o servidor manda a hora atual junto, então os dados "mudavam" a cada segundo).
5. Desfoque (`backdrop-filter`) em cartões que rolam e na folha que sobe: no iPhone isso é refeito a cada quadro.
6. A abertura do app esperava 4 pedidos ao servidor, um depois do outro, antes de mostrar a lista.

## O que mudou
- **Trocar de aba**: a barra responde no toque e a tela nova entra esmaecendo (190 ms, de 30% a 100%, nunca
  tela vazia). Computador: 130 ms, sem deslocamento. (Testamos View Transitions: tirar o retrato da tela
  custou mais que esmaecer, por isso ficou de fora.)
- **Abrir conversa (celular)**: entra deslizando da direita (curva do iOS, 350 ms), a lista anda 30% para a
  esquerda e escurece; voltar faz o inverso. A barra de baixo sai junto com a lista.
- **Arrastar da borda esquerda para voltar** (começando a menos de 24 px da borda), acompanhando o dedo:
  na conversa e nas páginas do painel lateral (ficha, filtros, configurações...). Soltou depois de 40% ou com
  impulso: volta; senão, a tela volta para o lugar. Não conflita com os gestos das linhas da lista (só vale
  dentro de uma conversa ou painel) nem com a gaveta da Serena.
- **Folhas que sobem de baixo**: sobem com mola suave, fundo escurece aos poucos, ganham a "alça" e dá para
  **puxar para baixo para fechar** (se o conteúdo estiver no topo). Fechar pelo X também desce animado.
  No computador os diálogos só aparecem com um leve esmaecer.
- **Toque**: sem o atraso do toque duplo; botões encolhem levemente (96%) e linhas escurecem na hora em que o
  dedo encosta; sem "hover grudado" depois do toque.
- **Lista do cache**: a última lista conhecida fica guardada no aparelho (só para a mesma pessoa, apagada ao
  sair da conta ou quando a sessão acaba) e aparece na hora ao abrir o app; os 4 pedidos da abertura saem juntos.
- **Lista**: só a linha que mudou é refeita; linhas fora da tela não são desenhadas (`content-visibility`).
- **Conversa**: abre na hora com o que já se sabe (as 30 últimas mensagens da última vez, ou nome e foto da
  lista); o resto entra depois do deslize.
- **Dashboard**: números iguais = não redesenha (só atualiza o "atualizado às"); voltar para a aba não remonta
  nada; no celular, os blocos lá de baixo só são montados quando chegam perto da tela.
- **Peso visual**: no celular, sem desfoque nos cartões que rolam e nas folhas (folhas ficaram sólidas);
  continua no topo e na barra de baixo. Fotos com tamanho fixo e decodificação fora do quadro.
- **Reduzir movimento** (Ajustes do iPhone): nada desliza nem esmaece, tudo troca direto.

## Onde está
- `public/telas/fluidez.js` — transições, gestos, folhas, toque, CSS de peso.
- `public/app.html` (blocos `fluidez`) — gancho da troca de aba, lista que só refaz o que mudou, conversa na
  hora, lista guardada e abertura em paralelo.
- `public/telas/painel.js` (blocos `fluidez`) — Dashboard sem redesenho à toa.

## Ficou de fora / para decidir
- O brilho girando do chip **Radar** é uma animação em loop (contra a regra de "sem loop"). Agora ele pausa
  enquanto a tela rola ou anima, mas continua girando parado na tela. Decisão do dono: manter, girar só
  quando houver aviso novo, ou girar 2–3 voltas e parar.
- A primeira montagem do Dashboard ainda é pesada (~100–160 ms de tarefa longa no celular lento): são muitos
  blocos e gráficos. Dá para dividir a montagem em partes se ainda incomodar.
- O topo da folha (`.folha-topo`) mantém o desfoque por ser fixo.
