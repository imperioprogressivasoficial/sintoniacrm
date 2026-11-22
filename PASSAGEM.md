# Passagem de turno da Sintonia

Duas IAs (contas diferentes) trabalham aqui em revezamento: quando acaba o crédito de uma, a outra continua.
Este arquivo é o caderno de passagem. **Quem chega lê primeiro; quem sai escreve por último.**

## Como trocar de turno
**Ao começar:**
1. Leia `CLAUDE.md` (regras) e este arquivo inteiro.
2. `git fetch` e parta da branch indicada em "Onde parei" (ou da `producao`).
3. Confira o servidor antes de publicar qualquer coisa (passo 3 do `CLAUDE.md`).

**Ao parar (crédito acabando, fim do dia, troca de IA):**
1. Faça commit e push de **tudo** (nada só no seu computador nem só no servidor).
2. Atualize a seção "Onde parei" abaixo: branch, o que ficou pronto, o que falta, o que está no ar.

- **21/11 22:32 UTC — no ar o e9227f7:** botão ao lado da câmera abre "Respostas e fluxos" (abas; Fluxos mostra "Criar fluxo" mesmo sem nenhum).
- **21/11 22:24 UTC — no ar o eea23f8:** menu lateral mostra "Modo claro" com sol quando está escuro (e "Modo noturno" com lua no claro).
- **21/11 22:12 UTC — no ar o cdea070:** Sair (public/telas/sair.js, window.SintoniaSair e window.SintoniaPresencaEu) e foto de quem atende no modelo 2. Barra do topo: aguardando o dono escolher em https://claude.ai/artifact/R7Q9rzVpwDj6HxmHx1huxU
- **21/11 21:57 UTC — no ar o f5a4bb5:** sugestão da IA como balão fantasma (public/telas/balao-fantasma.js). Falta: página de vendas (cena Copiloto) ainda fala da faixa antiga. Em andamento: claude/foto-atende.
- **21/11 21:52 UTC — no ar o 12ac647:** Serena super (src/serena/ler.ts, mudar.ts, internet.ts; Pensar mais) e nome da Serena no meio do topo. Conferir com a chave real: uma pesquisa na internet e um Pensar mais.
- **21/11 21:40 UTC — no ar o ea13631:** etapa fixa "Entrada de leads" (migração 720) e caixa de automações por etapa (public/telas/etapa-acoes.js). Em andamento: claude/foto-atende (foto 18px modelo 2), claude/balao-fantasma (sugestão da IA como balão tracejado), serena-super. Modelos da barra do topo só com ícones aguardando escolha: https://claude.ai/artifact/R7Q9rzVpwDj6HxmHx1huxU
- **21/11 21:26 UTC — no ar o 112adc2:** topo da conversa como o WhatsApp Web (public/telas/topo-conversa.js: Vídeo, Ligar, Agendar, Pesquisar em todas as mensagens via /api/conversas/:id/busca, ⋯ com ficha, radar, IA, atribuir, etapa, tarefa, favorito, silenciar, arquivar, papel de parede, exportar .txt via /api/conversas/:id/exportar, finalizar, fechar). Ocultar dados só em Conta › Privacidade. Juntada claude/brilho-cortado. Ainda rodando: etapa-entrada (720) e serena-super.
- **21/11 20:55 UTC — no ar o 0c1929c:** olho (ocultar dados) no topo da conversa. Modelos da estética dos 4 botões aguardando escolha do dono: https://claude.ai/artifact/K2i22HwLQdqQKJj1YwHSiW
- **20/11 20:25 UTC — no ar o ff41414:** gestos nas Conversas (arrastar/segurar, como o WhatsApp iOS). Antes disso: Foco do pipeline em baralho e pipeline mais sóbrio.
- **20/11 16:40 UTC — no ar o ab191f6:** juntadas pipeline-celular, respostas-fluxos, whatsapp-estavel e nps-posvenda. Falta: chat da equipe + grupos, tirar Norte/Sumaré fixos, segurança do servidor (aguarda ok), barra de baixo encolher.
- **20/11 16:10 UTC — no ar o 1d19ca6:** juntadas as branches claude/atualizando, claude/serena-acoes, claude/radar e claude/rotina. Em andamento (pararam no limite de uso, retomar): wt-whatsapp-estavel, wt-pipeline-celular, wt-respostas-fluxos, wt-nps-posvenda.
- **20/11 15:40 UTC — no ar o 1a5d78f:** Agendamento online nativo (src/reunioes/reunioes.ts; o Cal.com não foi instalado: VPS já usa 6,3 de 8 GB) e Scripts de venda.
- **20/11 15:25 UTC — no ar o 690711b:** WhatsApp: LID (remoteJidAlt), histórico ao conectar via webhook MESSAGES_SET (a Evolution do Rainha não guarda histórico: SAVE_DATA.HISTORIC desligado), `Sintonia.importarHistorico` sem IA/avisos. Grupos ainda são ignorados (pedido: aba Equipe com chat interno + grupos).
- **20/11 14:56 UTC — no ar o 032a359:** menu reorganizado pelo dono e Dashboard do computador no modelo 3. Próximo: fluxos nas Respostas rápidas e o pipeline "Junção" no app (ver docs/PEDIDOS.md).
- **20/11 13:45 UTC — no ar o 805f6df:** menu lateral do computador nas categorias da cascata. Lista de pedidos do dono em `docs/PEDIDOS.md`.
- **20/11 13:22 UTC — no ar o 17840f5:** `window.SintoniaBotaoTema()` e `window.SintoniaTopoGrupo()` (app.html) põem lua/sol
  (e o sino) no topo de todas as telas do celular. Curva do Dashboard no celular suavizada só no desenho (`sr.banco`).
- **20/11 13:14 UTC — no ar o 2c191a9:** Dashboard do celular voltou ao modelo 3 escolhido (banco). Em `painel.js`, `blocoHeroi`
  usa `.pn-banco` quando `!s.largo && !s.editando`; `curva` com `sr.banco` tira eixos, média, legenda e o balão de vazio.
- **20/11 12:54 UTC — no ar o commit 44d749b** (branch `claude/paginas-vendas-login`, levado para `producao`).
  Configurações em sanfona (categorias estilo Kommo; Minha conta pela foto). WhatsApp: lista de canais em linhas e
  conexão em 3 etapas (autorizar › número › código, ou QR Code). Código de pareamento: a Evolution v2.3.7 ignora o número
  se a instância já está "connecting", por isso `conectar(..., numero)` apaga e recria a instância com `number` e espera o
  `pairingCode`; rota GET `/api/conexoes/whatsapp/canais/:id/codigo` devolve o código em vigor.
  Falta: menu lateral do computador nas mesmas categorias da sanfona.
3. Commit e push deste arquivo.

**Regra de ouro:** só uma IA trabalha por vez. Se as duas estiverem ligadas, uma espera.

## Como publicar (igual para as duas)
O jeito de publicar está descrito no topo de `scripts/gerar-deploy.mjs`: ele gera a receita (docker-compose)
com o código empacotado; a receita sobe no projeto Docker `sintonia` da VPS 1969277 (Hostinger).
- Senhas e chaves nunca vão para o GitHub. A senha do banco que já está em uso pode ser lida da receita
  que está no ar (Hostinger › projeto `sintonia`) — **reaproveite a mesma**, nunca gere outra.
- Depois de publicar, atualize `deploy/no-ar.txt`.
- Antes de cada publicação grande, rode o teste de carga: `node scripts/carga.mjs` (Postgres local; ~1 min; sai com erro se perder mensagem ou ficar lento — opções e limites no topo do arquivo).

## Onde parei
- **21/11, 23h48 (Bahia), Claude Max — no ar o 90c2bc3:** "Sincronizando" em todas as conexões (public/telas/sincronizando.js). Próximo possível: trazer conversas antigas do Instagram/Facebook pela Meta (não existe ainda). Sem agentes rodando.
- **21/11, 23h40 (Bahia), Claude Max — no ar o 1e34bc4:** prints novos da página de vendas (?v=2211), cena Copiloto com balão fantasma, dica da ficha por cima dos balões. Auditoria dos pedidos do dono feita (≈110 de 130 no ar); pendentes com o dono: calculadora na página?, selo Meta Business Partner, bolinha menor?, "API oficial" no Essencial, número de vendas, CNPJ, Trinks, senha n8n, Evolution MESSAGES_UPDATE, segurança/Cloudflare. Rodando: sincronizando (todas as redes).
- **21/11, 23h04 (Bahia), Claude Max — no ar o 779109e:** menu de segurar a mensagem (public/telas/menu-mensagem.js, src/conversa/acoes-mensagem.ts, migração 730). Formatos da Evolution (sendReaction, quoted, updateMessage, deleteMessageForEveryone) testados só com servidor falso: conferir num número real. Pendente do dono: Central de ajuda (depois), trocar "API oficial" no plano Essencial?, Cloudflare (R2 para backup) só com OK.
- **21/11, 22h52 (Bahia), Claude Max — no ar o 1f8a043:** balão de áudio mostra a foto de quem mandou (atendente pelo nome: você, a responsável ou a equipe carregada; IA = foto da Serena).
- **21/11, 22h48 (Bahia), Claude Max — no ar o b465e49:** vistos iguais ao WhatsApp (public/telas/vistos.js; migração 740 aceita entrega "ouvida"; lerStatusEvolution; webhook pede MESSAGES_UPDATE — instâncias que não começam com "sintonia-" precisam ligar o evento à mão) e planos de volta na página de vendas (contratação só pelo WhatsApp). Rodando: menu-mensagem (segurar mensagem, migração 730).
- **21/11, 22h35 (Bahia), Claude Max — no ar o 003b9d5:** barra do topo da conversa só com ícones (Radar com pontinho quando ligado, Agendar com ícone novo, Ligar, Pesquisar, ⋯; vídeo no ⋯); Pensar mais dentro do + da Serena; saída com a logo branca; categoria "Agenda" no menu (Agenda, Rotina, Agendamento online). Rodando: menu-mensagem (segurar mensagem, migração 730), vistos (✓ do WhatsApp e áudio ouvido, migração 740), vendas-planos (planos de volta na página antiga, sem botão flutuante, lançamento 3/3/2027).
- **21/11 21h10 (Bahia), Claude Pro: DESFEITO** o ajuste das 20h55 (foi engano: o dono falava da Assia do Espaço Rainha, não da Serena). Controle da Norte voltou a desligado e as 5 conversas voltaram ao modo de antes. A Sintonia ficou como estava.
- **21/11 20h55 (Bahia), Claude Pro, só configuração (sem código, sem publicar):** a Serena não respondia porque "IA atende primeiro" estava desligado e as conversas ficavam em "Só eu" depois que ela passava para a equipe. Liguei Agentes de IA › Controle na **Norte** (sempre, volta para a IA após 30 min sem resposta da equipe) e passei para a IA 5 conversas paradas desde 20/11. Ela respondeu na hora. Atenção: o WhatsApp da Norte é o número pessoal do Vinícius (ela responde contatos pessoais também); falta a chave do Trinks (não agenda).
- **21/11 17h42 (Bahia):** no ar d7c603c — bolinhas menores. Rodando: etapa-entrada (720: etapa fixa Entrada de leads + grade de automações por etapa).
- **21/11 17h37 (Bahia):** no ar 6c0f40a — notificações modelo C (710), fluidez2 (compressão, prioridade.js, privacidade.js), ajustes de telas no celular. Sem agentes rodando. Propostas pendentes: carregar telas sob demanda; miniatura do WhatsApp desfocada nas fotos.
- **21/11 17h12 (Bahia):** no ar 6eb1a6c — rotas-celular (public/telas/voltar-celular.js; window.SintoniaConfigArea). Rodando: fluidez2 (parte 2: privacidade), notificacoes2 (C por categoria), rotas-celular (2º commit: telas).
- **21/11 16h59 (Bahia):** no ar db3e3bb — capa com foto e atalhos por pessoa (700). Rodando: rotas-celular, fluidez2, notificacoes2 (esperando o dono escolher A/B/C; fazendo a limpeza do servidor).
- **21/11 16h25 (Bahia):** no ar b6309ce — mensagem mandada pelo celular leva o nome da dona / última atendente / "Equipe" (690).
- **21/11 16h18 (Bahia):** no ar 9faf68c — Configurações no celular = modelos 6 + 10 do dono (capa azul-marinho, busca, atalhos, áreas). Computador sem mudança.
- **21/11 15h44 (Bahia):** no ar ed46144 — assinatura da IA (Agente de IA › Comportamento: liga/desliga, nome, começo/fim).
- **21/11 15h34 (Bahia):** no ar f82f122 — chave geral da Serena (src/serena/pausa.ts, iaAtiva = chave && !pausa). Sem agentes rodando.
- **21/11 14h40 (Bahia):** no ar 59870a1 — página de vendas antiga com prints novos (mac-conversas, iphone-conversa, tv-sala). O dono NÃO quer a página nova (branch claude/pagina-vendas-nova fica sem uso).
- **21/11 12h41 (Bahia):** no ar afc2b56 — serena-faz e sem-exemplos (670). Página de vendas nova pronta na branch claude/pagina-vendas-nova (591edbc), ESPERANDO o ok do dono pelos prints antes de juntar/publicar.
- **PENDENTE (dono 21/11, depois):** seção "Ajuda" com tutorial de cada função (fluxos, chatbot, follow-up…): um exemplo só + o passo a passo. Os exemplos prontos saem agora (agente sem-exemplos).
- **21/11 10h35 (Bahia):** no ar e87c484 — sem-pagamento, ligacoes-modos (660), banco-seguranca (630/631), relatorio-dia (650). ATENÇÃO: a Hostinger recusa receita > 8192 letras (gerar-deploy agora tira comentários e falha se passar). Falta do dono: número do WhatsApp de vendas (SINTONIA_WHATSAPP_VENDAS no gerar-deploy), razão social/CNPJ/e-mail LGPD para /privacidade. Recomendações de segurança pendentes do ok dele em docs/SEGURANCA-SERVIDOR.md (firewall, cópia fora do VPS, usuário próprio do Umami). Sem agentes rodando.
- **FEITO 21/11 (só os prints; o dono quis manter a página antiga):** atualizar toda a página de vendas (prints das telas novas e a copy) com o que foi criado: Serena gerente, relatório Dia a dia, ligações, topo igual, gestos, contadores etc. Sem preços (App Store); contato só pelo WhatsApp.
- **21/11 09h58 (Bahia; os horários "Bahia" das 4 linhas de baixo estão 3 h adiantados por engano):** no ar 8f874e9 — + contato-nome (src/contatos/nome.ts, nomes-whatsapp.ts, public/telas/fone.js). Rodando: sem-pagamento, banco-seguranca, relatorio-dia (650), ligacoes-modos (660). n8n-sintonia terminou: fluxos refeitos e DESLIGADOS (falta credenciais; trocar senha do usuário assia-integracao, que vazou no histórico do n8n).
- **21/11 13h05 (Bahia):** no ar ce257bb. Rodando: contato-nome, sem-pagamento (App Store: tira pagamentos, cadastro só por convite, privacidade/termos/excluir conta; falta o WhatsApp do dono), banco-seguranca (migrações 630+), pesquisa Evolution, n8n-sintonia.
- **21/11 12h48 (Bahia):** no ar 38cbd6f — Grupos/Equipe com o topo de Conversas (topo-lista.js). Rodando: agente contato-nome (nome do WhatsApp + número +55 (71) 9xxxx-xxxx; worktree /home/user/wt-contato-nome) e n8n-sintonia.
- **21/11 12h22 (Bahia):** no ar 5eb7335 — + arrastar de lado troca de aba (celular) e ia-completa (migração 610: IA cobre quem desliga o Disponível; ferramentas remarcar/cancelar/mover em qualquer pipeline/produtos/tarefa/retorno/arquivo; ouve áudio e vê foto). Rodando: n8n-sintonia. Aguardando o dono: modelo de Configurações no celular (1–5) e dos contadores sem brilho (1–4).
- **21/11 11h50 (Bahia):** no ar 0a846e8 — chave Disponível pequena ao lado do nome (Configurações no celular). Rodando: agentes ia-completa (600) e n8n-sintonia. Próximo: IA assume as conversas de quem está Indisponível e sabe quantos estão atendendo.
- **21/11 08h20 (Bahia):** no ar 659e1f4 — + mídias direto do WhatsApp (whatsapp-cdn.ts), barra do celular some ao rolar, folha Atendimento e IA modelo 2, rodízio/prazos (570, rodízio desligado por padrão), perdas/saúde/login (580). Sem agentes rodando. Antes de publicação grande: node scripts/carga.mjs.
- **21/11 03h25 (Bahia):** no ar 1f47263 — robustez (550) juntada; pipeline 3 modos e correção de mídia (base64 no webhook) também. Sem agentes rodando. Pendências do dono em docs/PEDIDOS.md (revisão 21/11).
- **21/11 01h45 (Bahia):** no ar 93110f7 — + atendimento-extra (540) e unidades (530). ATENÇÃO: UnidadeId agora é string; use unidadeDe(id)/zUnidade() (src/unidades.ts), nunca listas fixas. Rodando: robustez (550, correções da auditoria).
- **21/11 01h10 (Bahia):** no ar f4e93ae — + conversa-extra (510) e produtos-lead (520). Rodando: unidades (530), atendimento-extra (540), robustez (550, correções da auditoria).
- **21/11 00h20 (Bahia):** no ar 3437a6b — juntados: resgate, rotas-fontes, msg-agendada (470), conversa-ux (ffmpeg p/ áudio no iPhone), crm-topo (480), empresa-conta (490), integracoes (500). Falta só o agente `auditoria` (só docs). Rotas: /app/<tela> (public/telas/rotas.js — tela nova precisa entrar no mapa CAMINHO). O publicar.sh precisa de URL pública para conferir (o /app agora redireciona sem login).
- **20/11 21h35 (Bahia):** no ar 5608cf2 — TODOS os agentes do dia juntados (fluidez, grupos 410, equipe 420, clientes-tags 430, analises, layout-telas, marketing 450). Vistas: `chat-equipe` = chat interno; `acessos` = Atendentes e acessos (a antiga `equipe` ainda existe). Agentes rodando: conversa-ux, msg-agendada (470), auditoria (só docs), grupos v2 (arquivados), crm-topo (480), empresa-conta (490), integracoes (500), rotas-fontes.
- **20/11 19h25 (Bahia):** no ar a8ae1c1 — largura total, sem barra de rolagem, Conversas em cascata. Agentes `grupos` (migração 410) e `equipe` (migração 420) construindo as telas que aparecem na cascata.
- **20/11 19h10 (Bahia):** no ar d058a19 — tempo sem contorno, foto da Serena quando a IA atende. Antes: 963e38f — cronômetro de espera na lista (espera-selo.js) e foto da Serena embutida. Agente `fluidez` (branch claude/fluidez) ainda trabalhando: juntar, testar e publicar.
**Última atualização:** 20/11/2026, 02h10 (Bahia) — Claude da conta do Bruno (Max).

- **No ar:** `producao` = d619be0 ("Configurações" na barra); antes 78d9777 (ver `deploy/no-ar.txt`): Dashboard novo, consertos da auditoria, transcrição grátis,
  cópia diária do banco, monitor (status.n8nimperio.tech) e estatísticas (estatisticas.n8nimperio.tech).
- **Auditoria completa (20/11):** 103 funcionalidades. Lotes 1 e 2 de consertos publicados. Agenda Trinks e cobrança Asaas
  publicadas (validar com chave real). Ligação pelo app: só pela API oficial do WhatsApp (decisão do dono pendente).
- **Aguardando o dono:** modelo do menu "Mais" em cascata (5 modelos enviados); tirar ou não os avisos de falha das
  Movimentações; chave nova do Claude (cadastrar em Conexões › Outras configurações); QR Code do WhatsApp; Trinks; e-mail.
- **Regras do dono:** 5 modelos antes de design; sem animação rodando o tempo todo; cor brilho #0ffcbe→#3aa0ff;
  ícones no padrão do menu; sem zoom no celular; beta interna com um acesso.
