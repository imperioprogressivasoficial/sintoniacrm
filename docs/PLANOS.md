# Planos da IA: o modelo de negócio

> **Todos os valores aqui são SUGESTÃO** para o dono ajustar em `src/planos/catalogo.ts` (`CONFIG_SUGERIDA`).
> O custo do atendente pode ser ajustado por empresa na tela; os limites do Empresarial vão na assinatura.

## Os planos

| Plano (id) | Preço | O que entrega |
|---|---|---|
| **Essencial** (`essencial`; o id antigo `gratis` é lido como Essencial) | grátis no 1º ano, depois **R$ 497/mês** | CRM completo SEM IA: usuários, pipelines, leads e clientes ilimitados; chatbot de fluxo. A IA não conversa, não responde, não sugere, não faz relatório nem age no CRM |
| **Colaborador de IA** (`expediente`) | **R$ 1.997/mês** | Tudo do Essencial + agente de IA **24 h**, copiloto (sugestões), relatórios automáticos de IA e IA organizando o CRM, com limites de uso |
| **Empresarial** (`empresarial`) | sob medida (`preco: null`, "fale com a gente") | Vários agentes; limites personalizados por empresa (`config.limites` na assinatura) |
| **Fundador** (`fundador`) | sem cobrança | A conta original (`SINTONIA_PLANO_FUNDADOR`, padrão `imperio`): sem limite, nada muda em produção |

Tudo funciona pelo navegador (não há aplicativo de celular). O antigo "adicional fora do horário" e a janela de
expediente acabaram: a coluna `ia_assinaturas.adicional_fora` e `ia_uso.dentro_horario` ficam no banco e são ignoradas.

## Limites de uso (estilo Claude)

| Limite | Como conta | Sugestão | Quando volta |
|---|---|---|---|
| 5 horas | janela **móvel**: tokens das últimas 5 h | 2,5 mi | quando sai da janela o uso que a deixa abaixo do limite ("volta às 15h20") |
| Semana | segunda 0h a domingo 23h59 (America/Bahia) | 12 mi | "renova segunda" |
| Mês | mês do calendário | 40 mi | "renova dia 1º/12" |

- Tokens = entrada + saída + cache (leitura e escrita): tudo o que a API cobra.
- Estourou **qualquer** limite, a IA só continua com **créditos** (recargas pagas: 5 mi = R$ 99 · 20 mi = R$ 349 ·
  50 mi = R$ 790). Os créditos só são gastos depois de estourar; não vencem (SUGESTÃO). Tokens pagos com crédito
  (`ia_uso.tokens_credito`, migração 270) não contam nos limites. O saldo nunca fica negativo.
- Sem crédito: a IA para, a conversa vai para a equipe com o motivo (e quando o limite volta) em `ia_bloqueios`
  (`sem_credito`), e nada se perde.
- Empresarial: `ia_assinaturas.config.limites = { cincoHoras, semana, mes }` (número ou `null` = sem limite);
  o que faltar usa a sugestão. Vale também para ajustar um Colaborador de IA específico.

## Onde a IA é bloqueada

- `comPorteiro` (agente da Sintonia, inclusive o bloco "Agente de IA" do bot, sugestões do copiloto e envios ativos):
  sem permissão, a IA não roda; resposta à cliente vira `passar_para_humano` com o motivo. Se o limite estoura no
  meio da resposta, o mesmo acontece.
- `medirCliente(cliente, anotar, porteiro)`: o cliente da Anthropic (chave geral e chave própria) e o da OpenAI dos
  agentes do estúdio perguntam ao porteiro **antes de cada chamada**. Bloqueada, a chamada nem sai e lança
  `IaBloqueada` (HTTP 402 nas rotas): copiloto, revisão de rascunho, "Peça para a IA", relatórios e agentes param.
- O chatbot de fluxo (`src/bot`) não usa IA e continua funcionando em todos os planos.
- Porteiro fora do ar (banco): a IA segue (não cala quem paga) e o erro vai para o log.

## Calculadora "Quanto custa ter a IA no seu negócio"

Mesma fórmula de `calcularCalculadora` (`src/planos/catalogo.ts`), da tela (`window.SintoniaPlanos.calcular`) e da
página de vendas:

- Funcionários = atendentes (1–10) × (salário × (1 + encargos%) + benefícios); anual = × 12.
  Padrão: R$ 1.800, 70%, R$ 600 → **R$ 3.660** por atendente.
- Créditos estimados = ⌈(conversas/mês − 1.500) ÷ 190⌉ × R$ 99 (o plano cobre ~1.500 conversas; cada recarga de
  R$ 99, ~190). Colaborador de IA = R$ 1.997 + créditos estimados. Economia = funcionários − IA (mês e ano).
- Horas cobertas: IA 168 h/semana × equipe 44 h por atendente.
- Conversas/mês padrão: uso real dos últimos 30 dias (conversas do Desempenho e do medidor); sem dado, 1.500.
- Calibração: com 20+ conversas com IA e média plausível (5 mil a 200 mil tokens), conversas do plano = 40 mi ÷
  média e por recarga = 5 mi ÷ média. Sempre mostrado como estimativa.

### Comparativo IA × atendente humano

Dados do Desempenho (`src/desempenho`) no período (7, 30 ou 90 dias):

- **Custo no período** = custo mensal × dias / 30. Equipe = custo CLT × atendentes ativas no período (mínimo 1).
- **Custo por agendamento/conversa** = custo do período ÷ agendamentos/conversas. **1ª resposta**: `iaEquipe`.
- **Horas cobertas por semana**: IA = 168 h; equipe = 44 h × atendentes.
- **CLTs equivalentes** = 168 ÷ 44. **Economia/mês** = CLTs equivalentes × custo CLT − preço da IA.
- Fundador, Empresarial e Essencial usam como referência o preço do Colaborador de IA.

## Como funciona no código

- `src/planos/catalogo.ts`: planos, limites, recargas, custo por token, calculadora (funções puras).
- `src/planos/porteiro.ts` (`Planos`): `situacao` (limites, quando renovam, créditos), `decidir`, `registrarUso`
  (marca `tokens_credito` quando algum limite está estourado), `confirmarPedido`.
- `src/planos/medidor.ts`: `medirCliente` (medição + porteiro por chamada), `comPorteiro`, `IaBloqueada`.
- Tabelas: `db/migrations/250_planos.sql` e `270_planos_creditos.sql` (`tokens_credito`; `gratis` → `essencial`).
- API (admin e direção): `GET /api/planos` (plano, limites, créditos, uso, padrões da calculadora),
  `POST /api/planos/pedidos` (`mudar_plano` | `recarga`; só registra), `PUT /api/planos/custo-clt`,
  `GET /api/planos/comparativo`.
- Tela: `public/telas/planos.js` → `window.SintoniaPlanos.abrir()` (item "Plano e uso da IA" no menu Mais).

## O que falta para cobrar de verdade

1. **Provedor de pagamento**: implementar `PagamentoProvider` (`src/planos/pagamento.ts`). Hoje o `PagamentoManual`
   só registra o pedido e responde "em breve: pagamento".
   - **Stripe**: Checkout Session (`mode: subscription` para plano, `payment` para recarga) + webhook
     `checkout.session.completed` / `invoice.paid`. Pix no Brasil via Stripe tem restrições: conferir.
   - **Mercado Pago**: Preapproval (assinatura) + Checkout Pro para recarga; webhook `payment`/`preapproval`.
   - **Asaas**: `/subscriptions` (boleto, Pix, cartão) e `/payments` para recarga; webhook `PAYMENT_CONFIRMED`.
2. **Webhook** autenticado que chama `Planos.confirmarPedido(empresaId, pedidoId, agora)`: marca pago e aplica
   (recarga soma créditos; mudar_plano troca o plano).
3. **Renovação e inadimplência**: assinatura vencida → `status: 'suspensa'` (o porteiro já bloqueia).
4. **Avisos de limite** (80% e 100% de cada janela) por e-mail/WhatsApp para a direção; hoje só a tela mostra.
5. **Multiempresa**: o app atende uma empresa por processo (`SINTONIA_EMPRESA_ID`); as tabelas já têm `empresa_id`.
6. **Nota fiscal** e termos de uso do plano.
7. Restringir a quantidade de agentes do estúdio por plano (hoje o Empresarial "pode ter vários" só na comunicação).
8. A transcrição de áudio (OpenAI Whisper) não passa pelo porteiro: não é IA conversando, mas é custo de API.
