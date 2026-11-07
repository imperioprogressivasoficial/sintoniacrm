# Guia de estilo: vidro com as cores da Sintonia

Referência de JEITO (não de cores): imagens em docs/referencias/. Pegamos a estrutura e a sensação
(vidro escuro, números grandes, pílulas, cartões cheios de cor, curvas com brilho) e pintamos com a marca.

## Cores
- Marca: azul #0593C6 (claro #23ABDD, escuro #04709A), menta #D83995 (destaque principal, no lugar do amarelo-limão da referência), azul-noite #04172B / #071D33 / #0B2A47, tinta #08243F.
- Acentos de apoio (só para etapas/gráficos, nunca para botões de marca): céu #7CC4FF, lavanda-azulada #9DB8FF, turquesa #19C3A6, âmbar #F5B800 (raio ⚡ e avisos), coral #FF7A59 (perdido/atraso).
- Botão principal: menta com texto azul-noite e brilho menta. Secundário: vidro com borda.
- Claro e escuro: o escuro é o "palco" (como a referência); o claro usa o mesmo desenho com vidro branco sobre a aurora clara. Tokens em public/ds.css (--vidro-fundo, --vidro-forte, --vidro-borda, --vidro-item, --vidro-ativo, --vidro-brilho, --aurora).

## Peças
1. Cabeçalho de página: título grande (34–40px, 800) à esquerda; ao lado, 3–4 "números" — círculo de vidro 40px com ícone + valor 20–24px 800 + rótulo 12px suave; selo de variação em pílula (menta se bom, coral se ruim: "−8% vs mês passado").
2. Abas/segmentos: trilho de vidro em pílula, item ativo com fundo de vidro mais claro + borda clara (ex.: 6M | 12M; Quadro | Ligar hoje).
3. Filtros de pessoas: pílulas com bolinha de iniciais.
4. Painéis: vidro (raio 22–26px, borda 1px clara, brilho interno no topo), título 15px 700, botões redondos de vidro (⋯ e ↗) no canto.
5. Quadro (CRM): coluna de vidro com cabeçalho (bolinha da cor, nome, contagem, total e +); cartões PREENCHIDOS com a cor da etapa (tom pastel/fosco da cor, texto escuro ou claro conforme contraste), raio 18px: linha pequena "Desde 3 dias"/data, nome em negrito, linha suave (unidade/serviço), valor ou última mensagem, bolinha da dona no canto inferior direito, ⋯ no canto superior direito.
6. Ficha em janela (modal de vidro): cartão-resumo no topo com a cor da etapa; trilha de etapas em SETAS (chevron) clicável, etapa atual em menta; campos em caixas de vidro; pessoas como pílulas; botões "Marcar ganho" (menta), "Marcar perdido" (vidro), "Excluir" (coral, contorno).
7. Gráficos (SVG puro): curva suave (bezier) com traço 2.5px menta (ou azul no claro) com brilho (drop-shadow) e área em degradê até transparente; linha de meta tracejada clara; eixos discretos; tooltip de vidro. Barras empilhadas arredondadas. Anel (donut) de meta em menta com número grande no centro, num painel de destaque com fundo menta translúcido.
8. Movimento: transições 150–250ms, hover levanta 1px; respeitar prefers-reduced-motion.
9. Celular primeiro: tudo empilha, números do topo viram faixa rolável, toque ≥ 44px.
