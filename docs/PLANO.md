# Plano da Sintonia

## A ideia
Um WhatsApp multiatendente (computador e celular) com uma IA que acompanha todas as conversas. Ela entra sozinha quando ninguém responde, agenda direto no Trinks, move o funil sem ninguém arrastar card e manda relatórios para a direção.

## Como a IA decide quando entrar
Cada conversa fica em um de três modos:

| Modo | O que a IA faz |
|---|---|
| IA atende | Responde sozinha. |
| Copiloto (padrão) | Lê cada mensagem, mostra a sugestão, revisa o rascunho. Não envia. Se ninguém responder em 15 min em horário de loja, assume. |
| Só eu | Não sugere nem responde. Continua registrando e movendo o funil. |

Regras (em `src/engine/atendimento.ts`):
- Fora do horário da unidade, a IA responde na hora.
- Atendente escreveu ou está digitando: a IA vira copiloto e fica 10 min em silêncio.
- Reclamação, pedido de pessoa, reação alérgica, desconto fora da regra: a IA passa para a equipe, para de responder e avisa a gerência.

## Agendar sem abrir o Trinks
A IA e a atendente usam o mesmo caminho (`src/agenda/agendar.ts`):
- cliente achada pelo celular no Trinks, ou cadastrada na hora;
- preço e duração vêm do Trinks (com a promoção do dia);
- a agenda é reconsultada antes de gravar, porque o Trinks não bloqueia horário duplicado;
- funil vai para Agendada, os lembretes são programados e o agendamento conta para quem agendou (IA ou atendente).

Rotas para a tela: `GET /api/agenda/servicos`, `GET /api/agenda/profissionais`, `GET /api/agenda/horarios` e `POST /api/conversas/:id/agendar`.

## Ligação com o Espaço Rainha
A Sintonia é uma empresa e um produto à parte, com servidor, banco e login próprios. A Império é a primeira cliente. O plano completo está no documento "Plano Sintonia + Espaço Rainha".

- **Acesso:** a aba WhatsApp do Espaço Rainha abre a Sintonia com login único (token assinado pelo Rainha). Ninguém ganha uma senha nova.
- **Dados separados:** cada sistema tem o seu banco; nenhum lê o banco do outro. Eles conversam por API.
- **Ficha da cliente:** a Sintonia busca no Rainha, pela API, histórico, cashback e termos, e mostra na conversa.

Dois cuidados antes de ligar:
1. **Cota do Trinks compartilhada por três sistemas** (n8n do cashback, Espaço Rainha e Sintonia). O ideal é a Sintonia ter uma chave própria do Trinks.
2. **Assia:** hoje o fluxo "Assia" do n8n recebe as mensagens da Evolution e responde. Dois robôs não podem responder o mesmo número; é preciso definir quais números ficam com a Sintonia.

## Fases

| Fase | Entrega | Situação |
|---|---|---|
| 0. Resultado rápido | Agente atendendo e agendando em um número, com relatório diário | Motor pronto. Falta a base de conhecimento, o número de teste e o deploy no VPS |
| 1. O CRM | Tela igual ao WhatsApp, multiatendente, banco Postgres, login | Banco Postgres e fila persistente prontos e testados. Login e tela a construir |
| 2. Automações | Lembretes, follow-ups, faltas, manutenção, painel | Regras prontas e testadas. Falta ligar o "compareceu/faltou" ao Trinks |
| 3. API oficial e disparos | Conexão Meta, modelos aprovados, campanhas, saída do Kommo | Conector pronto. Falta Business Manager e modelos |
| 4. Produto para outras empresas | Cadastro de empresas, outras agendas, cobrança | Estrutura multiempresa já no banco |

## Próximos passos técnicos
1. ~~Trocar o repositório em memória pelo Postgres~~ (feito: `db/migrations/`, `src/store/postgres.ts`).
2. ~~Fila persistente de entrada, trabalhadores e trava por conversa~~ (feito: `src/fila/`).
3. Ligar o webhook de fechamento do Trinks (o mesmo do cashback) ao funil: `Compareceu` e o programa de 90 dias.
4. Teste de queda e de volume (1.000 leads/hora, reinício no meio).
5. Login único com o Espaço Rainha, perfis e regras de quem vê o quê.
6. Tela da Sintonia (web/PWA), a partir do protótipo.
7. Deploy no VPS (Docker) com domínio próprio e HTTPS.
