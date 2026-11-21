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
