# Pedidos do Bruno (dono) — lista viva

Anotado em 20/11/2026. Quem pegar um item, marca aqui e no PASSAGEM.md.

## Regras de trabalho
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
