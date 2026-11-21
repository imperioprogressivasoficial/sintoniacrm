# Auditoria da Sintonia — 20 e 21/11/2026

Feita só no computador de testes (nada foi feito no servidor de produção nem em sintonia.n8nimperio.tech).
Código auditado: branch `claude/paginas-vendas-login`, commit `105716d` (o que está no ar).

## Resumo executivo (10 linhas)

1. **As telas funcionam.** Percorremos 37 telas no computador (claro e escuro) e 37 no celular: nenhum erro de JavaScript e nenhuma resposta de erro do servidor. Testes automáticos: 862 de 862 passando; verificação de tipos sem erro.
2. **Receber mensagens aguenta muito:** o WhatsApp pode mandar até 200 mensagens por segundo e a Sintonia responde em menos de 32 ms (95% dos casos), sem perder nem duplicar nada.
3. **O gargalo é a IA:** cada processo atende 8 conversas ao mesmo tempo. Com a IA levando ~8 s para responder, a Sintonia dá conta de **~1 mensagem por segundo**. Acima disso forma fila, e a mensagem **só aparece na tela da atendente depois** (no teste, 41 s de espera com só 2 msg/s).
4. **Urgente 1:** se o banco de dados reiniciar ou derrubar a conexão, **o programa da Sintonia cai inteiro**. No teste, 213 de 286 mensagens recebidas durante a queda se perderam.
5. **Urgente 2:** a IA é chamada **mesmo sem a chave da IA cadastrada** (conversas nascem em "Copiloto"); sem chave, ela falha e tenta de novo a cada 2 minutos, para sempre, em cada conversa.
6. **Urgente 3:** o formulário da página de vendas aceita **só 5 cadastros por hora para o mundo todo** (o servidor enxerga todos os visitantes como um só); do 6º em diante o visitante lê "Recebemos seus dados", mas **nada é salvo**.
7. **Urgente 4:** a lista de Conversas, a busca, relatórios, painel, ligações e funil olham **só as 500 conversas mais recentes**. Com mais clientes que isso, a busca não acha cliente antiga e os números ficam errados.
8. Com 10.000 conversas e 204.000 mensagens, a lista leva 0,2 s; com **20 atendentes** com o app aberto chega a 0,8 s e com **40** a 3,3 s (a lista inteira é recalculada a cada 4 s por pessoa).
9. **Para outra empresa usar:** unidades fixas no código (Norte, Sumaré, Feira), e a IA, o copiloto, a Serena, os e-mails e os bots se apresentam como "Império Progressivas, salões de alisamento em Salvador". Hoje a Sintonia é feita para a Império.
10. Limite estimado no servidor atual (8 GB, ~1,7 GB livre): **folgado para as 2 unidades + Feira hoje**; o risco são picos (campanha, transmissão) por causa da IA, e a memória (o app chega a 0,9 GB em pico e não tem teto no compose).

---

## 1. Como foi feito

- App local na porta 3590, Postgres 16 local, logado como Bruno (Administração), com os **dados de demonstração** (142 conversas, 1.166 mensagens, 4 atendentes).
- **Playwright** percorreu o menu lateral do computador (1440×900, claro e escuro) e a barra + menu Configurações/Mais do celular (iPhone 13), registrando erros do navegador, respostas 4xx/5xx e textos fixos. Prints em
  `/tmp/claude-0/-home-user/34f05b1f-5d1a-5feb-acd5-93970bed4028/scratchpad/agentes/auditoria/telas/` (111 imagens) e relatórios `crawl-*.json` na pasta acima.
- **Teste de carga** em outro banco (`sintonia_carga_auditoria`), com um **WhatsApp falso** (imita a Evolution) e uma **IA falsa** (imita a Anthropic, com demora regulável). Nenhuma chamada saiu para a internet e nada foi gasto de API.
  Scripts em `.../agentes/auditoria/carga/` (`carga.mjs`, `atendentes.mjs`, `historico.mjs`, `falsos.mjs`, `monitor.sh`) e o gráfico em `.../agentes/auditoria/grafico-carga.png`.
- Leitura do código para segurança e robustez. O que já está em `docs/SEGURANCA-SERVIDOR.md` (firewall, SSH, MFA do n8n, Evolution Manager aberto, cópias fora do servidor) **não foi repetido**: continua valendo e continua pendente.
- A auditoria anterior (20/11, 103 funcionalidades, arquivo `AUDITORIA-Sintonia.md` na pasta de rascunho) foi conferida: os 4 itens quebrados dela (tela Empresa, chave da IA e Transcrição inalcançáveis, link "Conexões de anúncios") **foram consertados**, e o aviso do iPhone (push sempre mostrado) também.

---

## 2. Funcional × não funcional

### Funciona

| Área | O que foi visto |
|---|---|
| Entrar, sair, sessão de 12 h, cookie protegido | login e redirecionamento ok; senha errada bloqueia após 5 tentativas |
| Todas as telas do menu lateral (37) | abrem sem erro, claro e escuro: Serena, Dashboard, Conversas (individuais, grupos, equipe), Agenda, Ligações, Respostas rápidas, Agendamento online, Rotina, Criar pipeline, Tags, Scripts, Clientes, Transmissões, E-mail, Links UTM, Criativos, Chatbot, Fluxos, Follow-up, Agente de IA, Pesquisa de satisfação, Relatórios (geral, origem, vendas, clientes, horários, IA × equipe, TV), Desempenho, Comercial, Acessos, Empresa, Plano, Notificações, Conexões |
| Menu Configurações do celular (32 itens) | todos abrem a tela certa, sem erro |
| Webhook do WhatsApp | protegido por senha própria (gerada sozinha) e comparada com segurança; mensagem repetida é ignorada; 0 perdidas e 0 duplicadas nas ~9.700 mensagens conferidas uma a uma no banco |
| Fila de entrada | grava antes de responder; mesma cliente sempre em ordem; se o processo cai no meio, a mensagem volta para a fila em 2 min |
| Fotos, áudios e documentos recebidos | baixados por trás, com novas tentativas (1.254 mídias de teste: todas prontas) |
| Webhook da API oficial (Meta) | confere a assinatura de cada unidade |
| Chaves salvas em Conexões | cifradas no banco (AES-GCM) |
| Quadro do funil | já paginado por coluna e com busca no servidor (teste interno com 4.000 cartões) |
| Consertos da auditoria anterior | tela Empresa, chave da IA ("Outras configurações"), transcrição, link de anúncios, push no iPhone |

### Funciona com ressalva

| Área | Ressalva | Onde |
|---|---|---|
| Lista de Conversas e busca | só as **500 conversas** mais recentes; a busca filtra só essas 500 no navegador. Cliente antiga não aparece nem na busca | `src/store/postgres.ts` (`listarConversas`, `limit 500`); `public/app.html:1700` |
| Relatórios, Dashboard, Desempenho, Comercial, Ligações, Análises, Serena, Notificações | todos partem da mesma lista de 500: com mais conversas, os números ficam **menores que a realidade** | 42 usos de `listarConversas()` em `src/` |
| Tempo de resposta da IA | a fila processa 8 clientes por vez **e a IA pensa dentro da fila**: enquanto a IA pensa, as outras mensagens nem aparecem na tela | `src/fila/trabalhador.ts`, `src/app/sintonia.ts` (`receber` chama `processar`) |
| Histórico ao conectar o WhatsApp | funciona, mas é importado em memória, uma mensagem por vez (≈240 por segundo): 40 MB = **~9 min** e 0,9 GB de memória. Se o programa reiniciar no meio, o resto se perde (a Evolution não manda de novo) | `src/server.ts` (`messages.set`), `Sintonia.importarHistorico` |
| Lista recarregada a cada 4 s | cada atendente com o app aberto pede a lista inteira (300 KB com 500 conversas) e a conversa aberta (200 mensagens) a cada 4 s, mesmo sem novidade e com a aba em segundo plano | `public/app.html:3392` |
| Permissão "Responder" | só bloqueia o envio de **texto**. Quem não pode responder ainda consegue mandar foto/áudio, disparar fluxo de mensagens, começar conversa nova e agendar com confirmação | `src/auth/permissoes.ts:193` (falta `enviar-midia`, `fluxos`, `nova`, `agendar`) |
| Limite de tentativas (login, esqueci a senha) | conta por "endereço do visitante", mas atrás do Traefik todos têm o mesmo endereço: "esqueci a senha" vale **5 pedidos por hora para a empresa toda** | `src/auth/rotas.ts` (falta `trustProxy` no Fastify) |
| Relógio de 30 s | as tarefas (lembretes, automações, follow-up, NPS, radar) rodam em sequência; se uma rodada passar de 30 s, a próxima começa por cima | `src/index.ts` (`setInterval(async…, 30_000)`) |
| "Pipelines" no celular | mostra "R$ 0 em aberto" mesmo com agendamentos de valor (valor só existe se alguém preencher no cartão) | print `cel-claro-mais-pipelines.png` |

### Não funciona

| Área | O que acontece | Evidência |
|---|---|---|
| **Queda do banco** | o programa inteiro cai (erro sem tratamento quando o Postgres derruba as conexões). No Docker ele volta sozinho, mas leva até ~1 min; o que chegar nesse tempo é recusado | teste: derrubamos as conexões por 20 s → processo encerrado; 224 de 300 envios do WhatsApp recusados e **213 mensagens perdidas**; falta `pool.on('error')` em `src/index.ts:131` e `:138` |
| **IA "desligada" continua sendo chamada** | toda conversa nova nasce em Copiloto, mesmo sem chave. No horário a IA tenta sugerir a cada mensagem; fora do horário tenta responder. Sem chave, falha e reagenda a cada 2 min, para sempre | teste: com "IA desligada" no log, a IA falsa recebeu 524 pedidos e o WhatsApp falso 517 respostas; `src/app/sintonia.ts` não consulta `iaLigada` (só follow-up e radar consultam) |
| **Formulário da página de vendas** | depois de 5 cadastros na hora (de qualquer pessoa), responde "Recebemos seus dados. Já já falamos com você." e **não grava** | teste: 7 visitantes diferentes → 5 gravados, 2 recusados com a mensagem acima; `src/auth/rotas.ts:333` (o formulário de contato, linha 272, tem o mesmo problema) |
| **Nova unidade (Feira de Santana)** | as unidades são fixas no código. Feira existe, mas o Agendar, a Nova conversa, o simulador e várias telas só aceitam Norte e Sumaré; não há como cadastrar uma 4ª unidade | `src/domain.ts:6`, `src/unidades.ts`, `src/server.ts` (`z.enum(['norte','sumare'])`), `public/app.html:1411` e `:1422` |
| **Outra empresa usar** | a IA de atendimento, o copiloto, o assistente, a Serena, os e-mails (rodapé e descadastro) e os modelos de bot dizem "Império Progressivas (salões de alisamento em Salvador)"; o horário padrão é o de shopping | `src/ai/prompt.ts:17`, `src/ai/copiloto.ts:27`, `src/agentes-ia/prompt.ts:43`, `src/conversa/assistente.ts:40`, `src/conversa/chat-ia.ts:67`, `src/email/rotas.ts:38,252`, `src/email/blocos.ts`, `src/bot/modelos.ts`, `src/followup/followup.ts:489` |

### Falta (pedido e ainda não existe, ou depende de algo de fora)

| Item | Situação |
|---|---|
| Proteção do servidor (`docs/SEGURANCA-SERVIDOR.md`) | plano pronto, aguardando o ok do dono |
| Chave da IA, WhatsApp real conectado, Trinks, conta de e-mail | dependem de cadastro em Conexões (a tela avisa) |
| Gatilhos pedidos: "sem resposta há X tempo", "agendou", "mensagem recebida (qualquer)" | hoje há: entrou/parada na etapa, nova conversa, palavra-chave, tag, aniversário, dias após comparecer, atendimento finalizado, nota NPS. "Sem resposta" existe só no Follow-up, não como gatilho de automação |
| Distribuição automática de leads (rodízio entre quem está disponível) | não existe; a presença "Disponível para atender" já existe e poderia alimentar isso |
| Cantos no computador (5 variações) | aguardando escolha do dono |
| Cobrança real do plano | Asaas pronto, falta validar com chave real |

---

## 3. Aguenta a pancada? (números do teste de carga)

Computador de testes: 4 núcleos, 16 GB, Postgres 16 com a configuração padrão (como no servidor). Gráfico: `grafico-carga.png`.

### 3.1 Receber mensagens (webhook da Evolution, `messages.upsert`, 2.000–3.000 clientes diferentes, 10% fotos e 2% áudios, 5% repetidas de propósito)

| Ritmo | Mensagens | Resposta do webhook p50 / p95 / p99 | Recusadas | Perdidas | Duplicadas |
|---|---|---|---|---|---|
| 5 por segundo | 225 | 3,8 / 10 / 39 ms | 0 | 0 | 0 |
| 20 por segundo | 900 | 3,2 / 7 / 13 ms | 0 | 0 | 0 |
| 50 por segundo | 2.250 | 2,6 / 14 / 44 ms | 0 | 0 | 0 |
| 100 por segundo | 4.500 | 4,2 / 32 / 67 ms | 0 | 0 | 0 |
| 200 por segundo | 9.000 | 2,5 / 12 / 29 ms | 0 | 0 | 0 |

**Conclusão:** a porta de entrada aguenta folgado. Uso do processo: 5–50% de um núcleo, memória 210–355 MB, até 29 conexões no banco.

### 3.2 Processar (gravar na conversa, funil, automações e IA) — tempo até a mensagem aparecer no CRM

| Cenário | Mediana | 95% | Observação |
|---|---|---|---|
| IA instantânea, 20 msg/s | 0,3 s | 0,4 s | sem fila |
| IA instantânea, 50 msg/s | 8,7 s | 16 s | fila começa |
| IA instantânea, 100 msg/s | 29 s | 57 s | capacidade máxima ≈ **45 msg/s** sem IA |
| IA com 1,5 s, 5 msg/s | 2,4 s | 3,1 s | ok |
| IA com 1,5 s, 20 msg/s | **64 s** | 122 s | 12 mil mensagens ficaram na fila; drenava a ~5 por segundo |
| IA com 8 s (parecido com o real), **2 msg/s** | **41 s** | 67 s | capacidade ≈ 8 ÷ 8 s = **1 msg/s** |

O processo ficava quase parado (5% de processador, banco ocioso): o tempo é a espera pela IA, com só 8 conversas por vez (`SINTONIA_PARALELO=8`).

### 3.3 Volume no banco (10.000 conversas, 204.025 mensagens, 119 MB)

| Pedido | Tempo |
|---|---|
| `/api/conversas` (lista) | 0,22–0,33 s, 298 KB, **só 500 conversas** |
| `/api/painel/completo` | 0,04 s |
| `/api/desempenho` | 0,23 s |
| `/api/ligacoes` | 0,25 s |
| `/api/atualizacoes` | 0,17 s |

`EXPLAIN ANALYZE` da consulta quente (`ultimasMensagens`, chamada em toda lista): **lê e ordena as 204 mil mensagens** em toda chamada (ordenação em disco de 28 MB, 250–280 ms). Cresce junto com o histórico: com 1 milhão de mensagens (≈1 ano de 2 unidades movimentadas) passa de 1 s. Só olhando as 500 conversas da lista, a mesma resposta sai em 6 ms.

### 3.4 Atendentes com o app aberto (lista a cada 4 s + conversa aberta), com o volume acima

| Atendentes | Pedidos/s | p50 | p95 | Processador do app | Memória |
|---|---|---|---|---|---|
| 5 | 2,5 | 40 ms | 0,3 s | 11% | 328 MB |
| 10 | 5 | 0,18 s | 0,5 s | 18% | 394 MB |
| 20 | 10 | 0,26 s | 0,8 s | 38% (pico 70%) | 574 MB |
| 40 | 16 (saturou) | **2,3 s** | 3,3 s | 81% (pico 149%) | 804 MB |

### 3.5 Histórico ao conectar (`messages.set`)

| Tamanho | Mensagens | Resposta | Servidor travado | Importação | Memória |
|---|---|---|---|---|---|
| 10 MB | 31.563 | 0,36 s | até 0,18 s | ~2 min 15 s | — |
| 39 MB | 122.764 | 1,2 s | até 0,85 s | ~9 min | pico 883 MB |

### 3.6 Quedas

| O que caiu | O que acontece hoje |
|---|---|
| **Banco (Postgres) reinicia** | o app **cai** (ver "Não funciona"). O Docker religa, mas mensagens que chegam nesse intervalo são recusadas; só voltam se a Evolution estiver configurada para reenviar (confirmar no servidor). O que estava na fila não se perde |
| **WhatsApp (Evolution) cai** | bem tratado: faixa "WhatsApp desconectado", tentativa de reconectar, mensagem de erro clara para a atendente ("não enviada", "pode ter saído") e nada é reenviado sozinho quando é incerto |
| **IA cai ou demora** | a mensagem fica gravada, a falha é registrada e a IA tenta de novo em 2 min; a cliente não recebe nada nesse tempo e a fila fica mais lenta (ver 3.2) |
| **O app reinicia no meio** | mensagens da fila voltam em 2 min (prazo de reserva); histórico em importação se perde; travas e "digitando" são refeitos |

### 3.7 Limite estimado no servidor atual (8 GB, ~6,3 GB em uso, dividido com n8n, Evolution, Traefik e Espaço Rainha)

- **Memória livre ≈ 1,7 GB.** O app usa ~150 MB parado, 350–600 MB com uso normal e até ~900 MB em pico (muitos atendentes ou histórico grande). O Postgres ordena em disco (memória de trabalho padrão de 4 MB). O compose **não tem teto de memória** para `app` e `db` (o Whisper tem 2 GB): um pico pode levar o servidor a matar processos de outros sistemas.
- **Mensagens recebidas:** sem problema até centenas por segundo.
- **Mensagens com IA:** ≈ **1 por segundo** (≈3.600/hora) contínuo. Um volume normal de 2–3 unidades (1–3 mil mensagens por dia) cabe; uma campanha ou transmissão que traga 500 respostas em 5 minutos deixa clientes esperando vários minutos para aparecer na tela.
- **Atendentes simultâneos:** até ~15–20 com folga hoje; o número cai conforme o histórico cresce (a lista fica mais pesada).

---

## 4. Segurança e robustez (o que não está em `docs/SEGURANCA-SERVIDOR.md`)

| Item | Situação | Risco |
|---|---|---|
| Login, cookie e sessão | cookie HttpOnly, SameSite=Lax, Secure em produção; 12 h; senha com scrypt; mesma demora para e-mail que não existe | ok |
| Webhooks | Evolution com senha própria gerada sozinha; Meta com assinatura por unidade; corpo de até 40 MB só para quem tem a senha | ok |
| Quem vê o quê | conversa de outra pessoa dá 404; falhas da fila só para direção/admin | ok |
| Endereço do visitante | o servidor não confia no Traefik (`trustProxy` desligado): todos os visitantes parecem a mesma pessoa. Quebra os limites do formulário de vendas, do "esqueci a senha", do contato e do agendamento de demonstração, e o registro de IP das sessões | **alto** (perde leads) |
| Limite de login | 5 erros por e-mail em 15 min; quem tenta muitos e-mails diferentes não é barrado | médio |
| Permissão "Responder" | só texto (ver acima) | médio |
| Chave do cofre | as chaves de Conexões são cifradas com uma chave tirada do endereço do banco (com a senha do banco). Quem tiver a receita do compose e uma cópia do banco lê tudo. A cópia diária fica no mesmo servidor | médio — usar um segredo próprio (`SINTONIA_SEGREDO` separado) |
| Validação | entradas validadas com zod; limites de tamanho por rota | ok |
| Falta de teto de memória | `app` e `db` sem `mem_limit` | médio |
| Saúde | `/saude` consulta a fila no banco; o Docker marca "unhealthy", mas não reinicia sozinho por isso | baixo |

---

## 5. Correções priorizadas

Esforço: **P** = até meio dia · **M** = 1 a 3 dias · **G** = 1 a 2 semanas.

### Urgente (esta semana)

| # | Correção | Esforço |
|---|---|---|
| 1 | Tratar erro de conexão do banco (`pool.on('error')` nos dois pools) para o app **não cair** quando o Postgres reinicia; teste derrubando conexões | P |
| 2 | Não chamar a IA quando não há chave (conferir `iaLigada` em `Sintonia.processar` e nascer em "Só eu" sem chave, como já faz o simulador) | P |
| 3 | Ligar `trustProxy` (só para o Traefik) e mudar a resposta do formulário de vendas: nunca dizer "recebemos" sem gravar | P |
| 4 | Tirar o limite de 500: consultas por período/escopo direto no banco para relatórios, painel e ligações; lista de Conversas paginada com busca no servidor (reaproveitar a busca por trigramas do funil) | M |
| 5 | Teto de memória no compose para `app` e `db` e `work_mem` do Postgres ajustado (via `scripts/gerar-deploy.mjs`) | P |

### Importante (próximas 2 semanas)

| # | Correção | Esforço |
|---|---|---|
| 6 | Separar "gravar a mensagem" de "IA pensar": a mensagem aparece na hora e a IA roda numa segunda fila, com mais conversas em paralelo (ex.: 24–32) e prioridade para quem espera há mais tempo | M |
| 7 | Guardar a última mensagem na própria conversa (ou buscar só das conversas da página): a lista deixa de ler o histórico inteiro | P |
| 8 | Lista só com novidades (`?desde=`) ou aviso em tempo real (SSE); parar de pedir quando a aba está escondida | M |
| 9 | Histórico do WhatsApp em lotes e pela fila (sobrevive a reinício, menos memória) | M |
| 10 | Permissão "Responder" valendo para mídia, fluxos, nova conversa e agendar | P |
| 11 | Unidades cadastráveis (tabela no banco, horário por unidade na tela) — destrava Feira de Santana | G |
| 12 | Nome, ramo e cidade da empresa vindos da tela Empresa em todos os textos da IA, e-mails e modelos | M |
| 13 | Segredo do cofre separado do endereço do banco e cópia do banco fora do servidor (já no plano de segurança) | P |
| 14 | Relógio de 30 s sem sobreposição (só começa a próxima rodada quando a anterior termina) | P |

### Depois

| # | Correção | Esforço |
|---|---|---|
| 15 | Limite de login também por endereço e conta (contra quem tenta muitos e-mails) | P |
| 16 | Painel de saúde para a gestão: fila, tempo até aparecer, falhas da IA, uso de memória | M |
| 17 | Gatilhos que faltam: "sem resposta há X tempo", "agendou", "qualquer mensagem recebida" | M |
| 18 | Teste de carga automático (estes scripts) antes de cada publicação grande | P |

---

## 6. O que daria para colocar (maior retorno para o negócio)

Comparação com CRMs de WhatsApp do mercado (Kommo, RD Station Conversas, Chatwoot, Leadster). Ordenado por impacto ÷ esforço.

| # | Ideia | Por que dá retorno | Já existe na Sintonia? | Impacto | Esforço |
|---|---|---|---|---|---|
| 1 | **Rodízio automático de leads** entre quem está "Disponível para atender", por unidade | lead respondido em minutos vende mais; Kommo e RD têm | presença existe, falta distribuir | alto | M |
| 2 | **Alerta de "cliente esperando"** com prazo (SLA) por etapa e escalada para a gerente | corta lead perdido por demora | cronômetro na lista existe; falta prazo e escalada | alto | P |
| 3 | **Link de pagamento/Pix na conversa** (sinal do agendamento) | reduz falta e garante receita; Kommo tem integrações de pagamento | Asaas pronto para o plano; falta para a cliente | alto | M |
| 4 | **Motivo de perda obrigatório** e relatório de perdas por motivo/atendente | mostra onde a venda escapa | finalizar tem motivos; falta no funil | alto | P |
| 5 | **Reengajar fora das 24 h** com modelos aprovados (API oficial) | campanhas sem risco de bloqueio do número | conector pronto, aguarda decisão | alto | M |
| 6 | **Vários negócios por cliente** (ex.: progressiva + manutenção) com valor e etapa próprios | funil e receita reais | 1 cartão por conversa | médio | G |
| 7 | **Comentário do Instagram vira conversa** (resposta automática no Direct) | anúncio orgânico vira lead | Direct existe; comentário não | médio | M |
| 8 | **Nota do lead pela IA** (quente/morno/frio) e "próximo passo" no cartão | atendente foca em quem vai fechar | IA sugere; falta nota no cartão | médio | M |
| 9 | **Webhooks de saída / API pública** (n8n, Zapier) | liga com qualquer sistema do cliente, essencial para vender a outras empresas | não | médio | M |
| 10 | **Cadastro de empresa em autoatendimento** (multiempresa de verdade: unidades, nome, ramo, horário, logo) | requisito para vender a Sintonia | base no banco já tem `empresa_id` | alto (produto) | G |

---

## 7. Arquivos e evidências

- Prints das telas: `/tmp/claude-0/-home-user/34f05b1f-5d1a-5feb-acd5-93970bed4028/scratchpad/agentes/auditoria/telas/` (`pc-claro-*`, `pc-escuro-*`, `cel-claro-*`).
- Gráfico do teste de carga: `/tmp/claude-0/-home-user/34f05b1f-5d1a-5feb-acd5-93970bed4028/scratchpad/agentes/auditoria/grafico-carga.png`.
- Resultados brutos: `.../agentes/auditoria/carga/res-*.json*`, `mon-*.csv` (processador, memória, conexões, fila a cada segundo), `app2.log` (queda do app quando o banco derrubou as conexões).
- Testes: `.../agentes/auditoria/vitest.txt` (65 arquivos, 862 testes passando) e `tsc.txt` (sem erros).
