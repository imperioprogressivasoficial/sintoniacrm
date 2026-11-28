# Regra do dono (28/11): tudo que for criado vira funcionalidade configurável
Cada automação nova (follow-up, movimento de funil, pós-venda etc.) nasce ligada e preenchida para a Império, mas sempre
com tela para desligar e mudar tempos e textos. O dono não deve precisar pedir a uma IA para mudar um tempo (ex.: 5 → 10 min).

## FEITO (28/11, no ar)
- Funil de atendimento: Novo lead, Em atendimento, Reagendar, Sem resposta, Agendado Sumaré, Agendado Norte, Finalizado, Perdido; a IA/sistema move sozinho (regras ligáveis); nenhum lead parado na entrada.
- Follow-up "não respondeu" em minutos (5 min, 15 min, 1 dia, 3 dias), editável na tela de Follow-up.
- Funil pós-venda (Conscientização, Retorno 30 dias, …) com automação até a cliente voltar; meta 4 visitas no ano.

# Pedidos do Bruno (dono) — lista viva

Anotado em 20/11/2026. Quem pegar um item, marca aqui e no PASSAGEM.md.

Ideias guardadas para depois (não são tarefas abertas): [IDEIAS.md](IDEIAS.md).

## NA FILA (depois do treinamento da IA de 28/11): configuração da Serena editável
O dono quer, na área da Serena, um lugar para preencher e editar tudo do jeito de atender, pensando em abrir a
ferramenta para outras empresas:
- o que configurar: modelo da IA, tom, estilo, nome, apresentação, o que fazer e o que evitar, emojis, tamanho das
  mensagens, roteiro de agendamento, mensagens modelo, horários padrão, tabelas;
- o que a Império já usa deve vir preenchido e organizado nesses campos.

## PRÓXIMO (lembrar o dono assim que as regras da Serena de 27/11 estiverem no ar): follow-up de clientes
O dono pediu para lembrá-lo de começar o processo de follow-up logo depois dos ajustes da Serena. O que ele quer:
- **Cutucar quem para de responder, ainda dentro da conversa:** por exemplo, quem passou a unidade e não agendou, ou
  viu os horários e não escolheu.
  - Primeiro, depois de 5 minutos.
  - Depois, depois de mais 15 minutos.
  - Depois, com intervalos cada vez maiores.
- **Mensagem curta e humana:** um 👀, um "?" ou "Oi, ainda está aí?". O objetivo é sempre fechar o agendamento.
- **Se a cliente disser "não fique me chamando, depois eu resolvo":**
  - perguntar "quando?" e tentar combinar um dia;
  - se ela não disser, criar sozinha um follow-up automático para mais tarde.


- Terminou e testou: **publica sem perguntar** e avisa o que entrou (pedido do dono em 20/11).
- Por enquanto o WhatsApp é só pela **API não oficial (Evolution)**. A oficial (Meta) fica para depois.
- Ir organizando o sistema sozinho: achar bugs, corrigir, conectar o que falta, melhorar.
- Mudança de design: mostrar modelos (o dono pediu 10 para o pipeline) no Claude Design antes de aplicar.

## Tarefas de servidor
- [ ] **Proteger o servidor da Hostinger** (n8nimperio.tech): plano em docs/SEGURANCA-SERVIDOR.md — firewall, SSH só por chave,
      MFA no n8n, Evolution Manager restrito, cópias fora do servidor. Aplicar com o ok do dono.

## Funcionalidades pedidas (referência: Kommo)
- [ ] **Pipeline comercial no celular** — 10 modelos de visual para escolher (em andamento).
- [ ] **Finalizar atendimento + pesquisa NPS**: ao encerrar, a cliente recebe a pesquisa (nota 0–10 + comentário);
      resultados no Dashboard/Relatórios.
- [ ] **Automações**: construtor de fluxos com opção de **chatbot** (perguntas/botões) ou **robô simples** (regras).
- [ ] **Gatilhos**: entrou no funil/etapa, tag aplicada, mensagem recebida, sem resposta há X tempo, agendou, compareceu, finalizou.
- [ ] **Pós-venda**: mensagens depois do serviço (cuidados, retoque, avaliação Google).
- [ ] **Follow-ups**: lembretes automáticos para quem parou de responder, em sequência (ex.: 1 dia, 3 dias, 7 dias).
- [ ] Leads: tudo que o CRM atual (Kommo) faz no atendimento e nos leads.
- [ ] **Fluxos de mensagens nas Respostas rápidas** (como o "fluxo" do WhatsApp Voice): além da resposta rápida (uma mensagem),
      criar um fluxo = sequência de mensagens de texto, áudio e arquivos, com tempo entre elas (timer). Na conversa,
      o atendente escolhe o fluxo e ele vai sendo enviado sozinho.
- [ ] **Chat da equipe**: no computador, Conversas vira cascata (Conversas das clientes · Equipe). Equipe = conversa
      interna entre atendentes + os grupos do WhatsApp. No celular, achar um lugar para o botão do chat da equipe.
- [x] WhatsApp: animação "Sincronizando" depois de conectar, com as conversas chegando (20/11).
- [x] Botão ativo = cor invertida (Radar no escuro) e, no pipeline, fundo com o degradê azul (20/11).
- [x] Agendamento online (como o Cal.com, dentro da Sintonia): links /r/<slug>, página pública, reuniões marcadas (20/11).
- [x] Vendas › Scripts (roteiros por etapa) e Clientes logo abaixo de Vendas (20/11).
- [ ] Rotina e tarefas do vendedor (Atendimento › Rotina) — em construção (agente).
- [ ] Radar = IA monitorando o que a atendente pediu (só entra quem for colocado no radar) — em construção (agente).
- [ ] Serena cria fluxos, scripts e links pelo chat, com prévia (artefato) e confirmação — em construção (agente).
- [ ] Tela "Estamos atualizando melhorias" durante publicação + página 404 — em construção (agente).
- [ ] WhatsApp não oficial à prova de quedas (avisos, reconexão, erros de envio) — em construção (agente).
- [ ] Pipeline: botão do meio escolhido por pipeline (Agendar, Marcar como ganho, Fechar venda…), não fixo.
- [ ] Cantos no computador: 5 variações enviadas, aguardando escolha.
- [ ] Clientes, leads e o cartão do lead (o cartão fica dentro do lead).
- [x] Menu: Clientes com aba própria; Vendas (CRM) = Criar novo pipeline › pipelines › Tags › Importar;
      Automações = Chatbot, Fluxos, Agente de IA, Follow-up (20/11).
- [ ] Pipeline no celular: modelo "Junção" aprovado (Foco/Lista/Colunas com ícones de contorno verde→azul,
      métrica principal escolhida pela pessoa). Canvas: https://claude.ai/artifact/4yhSyAvGmsEMWvw4yvW6jo

## Revisão de 21/11 (00h40 Bahia) — o que ficou para trás e onde está
Em andamento (agentes):
- Papel de parede da conversa (cores, por pessoa, claro/escuro); foto da Serena no lugar de "IA" em todo lugar (Pipeline, ficha, painéis); silenciar conversa; arquivar conversas individuais — agente `conversa-extra`.
- Produtos e serviços ligados ao lead (ficha e cartão, valor = soma), filtro por produto e por empresa vinculada no Pipeline — agente `produtos-lead`.
- Unidades vindas do cadastro em todo o sistema (sem Norte/Sumaré fixos; qualquer empresa) — agente `unidades`.
- Resgate/histórico trazendo fotos e áudios; avisos e lembretes do Agendamento online + reservas na Agenda; organizar o menu Automações — agente `atendimento-extra`.
- Auditoria completa + teste de carga — agente `auditoria` (só relatório).
Esperando o dono:
- Barra de baixo do celular encolhendo ao rolar (escolher modelo).
- Fluidez: folhas do celular sem vidro (ok?); lista guardada no aparelho (ok?).
- Firewall e backup fora do servidor (docs/SEGURANCA-SERVIDOR.md) — precisa do ok.
- Chave nova do Claude, Trinks e Asaas em Conexões; conta/token da Meta Ads para o gasto na Central de criativos.
- Testar no real: áudio no iPhone, grupos do WhatsApp, resgatar mensagens.
