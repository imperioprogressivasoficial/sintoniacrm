# Sintonia

CRM automático com IA para o WhatsApp da Império Progressivas.

A atendente e a IA trabalham juntas na mesma conversa. A IA lê cada mensagem, sugere a resposta, revisa o rascunho antes do envio, entra sozinha quando ninguém responde, agenda no Trinks, move o funil e manda o relatório do dia.

- Protótipo visual: [`prototipo/index.html`](prototipo/index.html)
- Plano e fases: [`docs/PLANO.md`](docs/PLANO.md)
- O que falta da Império: [`docs/CHECKLIST.md`](docs/CHECKLIST.md)
- Base de conhecimento da IA: [`knowledge/imperio.md`](knowledge/imperio.md)

## O que já está pronto (base da Fase 0 e da Fase 1)

| Parte | Arquivo | Situação |
|---|---|---|
| Quem responde (IA, copiloto ou só a equipe) | `src/engine/atendimento.ts` | Pronto e testado |
| Funil automático | `src/engine/etapas.ts` | Pronto e testado |
| Lembretes, follow-ups, manutenção de 90 dias | `src/engine/followups.ts` | Pronto e testado |
| WhatsApp não oficial (Evolution) | `src/channels/evolution.ts` | Pronto e testado |
| WhatsApp oficial (Meta Cloud API) | `src/channels/meta.ts` | Pronto e testado (falta modelo aprovado para envio ativo) |
| Trinks: serviços, horários livres, cliente, agendamento | `src/agenda/trinks.ts` | Pronto e testado com respostas simuladas |
| Agente de IA com ferramentas | `src/ai/agente.ts`, `src/ai/ferramentas.ts` | Pronto e testado com IA simulada |
| Copiloto: revisão do rascunho | `src/ai/copiloto.ts` | Pronto |
| Botão "Agendar" no CRM (sem abrir o Trinks) | `src/agenda/agendar.ts`, rotas em `src/server.ts` | Pronto e testado |
| Painel por atendente (respostas, tempo de resposta, agendamentos) | `src/app/relatorio.ts`, `GET /api/painel` | Pronto e testado |
| Relatório diário | `src/app/relatorio.ts` | Pronto e testado |
| Servidor (webhooks e API da tela) | `src/server.ts` | Pronto |
| Banco Postgres | `db/migrations/`, `src/store/postgres.ts` | Pronto e testado contra Postgres 16; aplicado sozinho ao subir |
| Fila persistente e trabalhadores | `src/fila/` | Pronto e testado: nada se perde, cada cliente em ordem, nova tentativa e lista de falhas |
| Tela do CRM | — | Próximo passo (o protótipo mostra o desenho) |

## Rodar

```bash
cp .env.example .env   # preencha as chaves
npm install
npm test               # testes em memória
npm run test:pg        # os mesmos testes também contra um Postgres de teste (SINTONIA_TESTE_PG)
npm run dev            # sobe em http://localhost:3333
```

Na Evolution, aponte o webhook da instância para `https://SEU_DOMINIO/webhooks/evolution`, com o evento `MESSAGES_UPSERT` e o cabeçalho `x-sintonia-token` igual a `EVOLUTION_WEBHOOK_TOKEN`.

## Decisões importantes

- **A IA nunca inventa preço ou horário.** Preço, duração e horários livres vêm do Trinks na hora.
- **Cota do Trinks protegida.** Uma fila única, com pausa entre chamadas, nova tentativa em 429 e cache (serviços por 6h, horários por 5 min). A mesma chave já é usada pelo cashback.
- **O Trinks não confere conflito de horário.** Antes de gravar, a Sintonia reconsulta a agenda sem cache e recusa o horário que deixou de estar livre.
- **Agendada e Compareceu só mudam por fato do Trinks**, nunca pela opinião da IA.
- **Mensagem ativa só entre 8h e 20h30.**
- **Modelo de IA:** `claude-opus-5-5` com esforço baixo para conversa, configurável em `SINTONIA_MODELO` e `SINTONIA_ESFORCO`. Se o modelo recusar, a API tenta o modelo reserva automaticamente (`fallbacks: "default"`); se ainda assim recusar, a conversa passa para a equipe.
