# Planos da IA: o modelo de negócio

> **Todos os valores aqui são SUGESTÃO** para o dono ajustar em `src/planos/catalogo.ts` (`CONFIG_SUGERIDA`).
> O custo do atendente (salário, encargos, benefícios) também pode ser ajustado por empresa na tela.

## O modelo

- **O CRM é grátis.** Plano **Grátis**: tudo do CRM, sem IA (a equipe atende).
- **IA Expediente** (assinatura): a IA trabalha na carga de um atendente CLT (44 h/semana: seg–sex 8h–16h, sáb 8h–12h)
  e custa **metade** do que a empresa gastaria com esse CLT. Tem cota mensal de tokens.
- **Adicional "Fora do horário"**: noite, madrugada, domingo e feriado (IA 24 h). Soma 50% ao preço e 50% à cota.
- **Recarga**: pacotes de tokens para quando a cota do mês acabar. Valem no mês em que forem pagos.
- **Fundador**: a conta original (Império Progressivas, `SINTONIA_EMPRESA_ID=imperio`) fica, sem assinatura gravada,
  em um plano sem cota, 24 h e sem cobrança, para nada mudar em produção. A lista vem de `SINTONIA_PLANO_FUNDADOR`
  (padrão `imperio`, várias separadas por vírgula). As outras empresas começam no Grátis.

## Fórmulas

| Item | Fórmula | Sugestão |
|---|---|---|
| Custo CLT mensal | salário × (1 + encargos%) + benefícios | 1.800 × 1,70 + 600 = **R$ 3.660** |
| IA Expediente | custo CLT × 50% | **R$ 1.830/mês**, cota 40 mi tokens (~1.500 conversas) |
| Adicional fora do horário | IA Expediente × 50% | **+R$ 915/mês**, cota +50% |
| Recargas | pacote fixo | 5 mi = R$ 99 · 20 mi = R$ 349 · 50 mi = R$ 790 |
| Tokens da cota | entrada + saída + cache (leitura e escrita) | tudo o que a API cobra |
| Custo por chamada (US$) | Σ tokens × preço por milhão | Opus 5.5: entrada 4, saída 20, cache leitura 0,20, cache escrita 5 |
| Custo em R$ | US$ × câmbio | câmbio 5,50 |
| Dentro do horário | instante na janela do plano e não feriado (fuso America/Bahia) | feriados nacionais fixos |

Margem de referência: uma conversa típica (prompt de sistema em cache, 2–4 passos) gasta ~25–30 mil tokens, a maior
parte leitura de cache. Com a cota cheia o custo de API fica em torno de 15–30% do preço do plano.

### Comparativo IA × atendente humano

Dados do Desempenho (`src/desempenho`) no período (7, 30 ou 90 dias):

- **Custo no período** = custo mensal × dias / 30. Equipe = custo CLT × atendentes ativas no período (mínimo 1).
- **Conversas atendidas** = conversas com ao menos uma mensagem da IA / da equipe.
- **Agendamentos** e **1ª resposta** = `iaEquipe` do Desempenho.
- **Custo por agendamento** = custo do período ÷ agendamentos (idem por conversa).
- **Horas cobertas por semana**: IA = janela do plano (168 h com adicional ou Fundador); equipe = 44 h × atendentes.
- **CLTs equivalentes** = horas da IA ÷ 44. **Economia estimada/mês** = CLTs equivalentes × custo CLT − preço da IA.
- Fundador não paga: o comparativo usa como referência IA Expediente + adicional.

## Como funciona no código

- `src/planos/medidor.ts`: `medirCliente` embrulha o cliente da Anthropic (inclusive o de chave própria de agente) e
  registra o `usage` de cada `messages.create`/`parse` em `sintonia.ia_uso` (empresa, conversa, origem, modelo,
  tokens, custo estimado, dentro/fora). `comPorteiro` embrulha o agente da Sintonia.
- `src/planos/porteiro.ts` (`Planos.decidir`): antes de a IA agir confere plano com IA e ativo → dentro da janela ou
  com adicional → cota do mês + recargas. Sem permissão: a IA não responde; a conversa vai para a equipe
  (`passar_para_humano` com o motivo, etiqueta "precisa da equipe") e o bloqueio fica em `sintonia.ia_bloqueios`.
  A mensagem da cliente já foi salva antes: nada se perde. Em sugestão (copiloto) e envios ativos (follow-up,
  lembrete), a IA só não age. Se o porteiro falhar (banco fora), a IA segue (não cala quem paga) e o erro vai pro log.
- Tabelas: `db/migrations/250_planos.sql` (`ia_uso`, `ia_assinaturas`, `ia_pedidos`, `ia_bloqueios`).
- API (admin e direção): `GET /api/planos`, `POST /api/planos/pedidos`, `PUT /api/planos/custo-clt`, `GET /api/planos/comparativo`.
- Tela: `public/telas/planos.js` → `window.SintoniaPlanos.abrir()` (item "Plano e uso da IA" no menu Mais) ou
  `window.SintoniaTelas.planos.desenhar(caixa)` para montar numa vista.

## O que falta para cobrar de verdade

1. **Provedor de pagamento**: implementar `PagamentoProvider` (`src/planos/pagamento.ts`). Hoje o `PagamentoManual`
   só registra o pedido e responde "em breve: pagamento".
   - **Stripe**: Checkout Session (`mode: subscription` para plano/adicional, `payment` para recarga) + webhook
     `checkout.session.completed` / `invoice.paid`. Pix no Brasil via Stripe tem restrições: conferir.
   - **Mercado Pago**: Preapproval (assinatura) + Checkout Pro para recarga; webhook `payment`/`preapproval`.
   - **Asaas**: `/subscriptions` (boleto, Pix, cartão) e `/payments` para recarga; webhook `PAYMENT_CONFIRMED`.
2. **Webhook** autenticado que chama `Planos.confirmarPedido(empresaId, pedidoId, agora)`: marca pago e aplica
   (recarga credita tokens no mês; mudar_plano troca o plano; adicional_fora liga/desliga).
3. **Renovação e inadimplência**: assinatura vencida → `status: 'suspensa'` (o porteiro já bloqueia).
4. **Avisos de cota** (80% e 100%) por e-mail/WhatsApp para a direção; hoje só a tela mostra.
5. **Multiempresa**: o app atende uma empresa por processo (`SINTONIA_EMPRESA_ID`); as tabelas já têm `empresa_id`.
6. **Nota fiscal** e termos de uso do plano.
7. Medir também os agentes do estúdio que usam OpenAI (o adaptador não passa pelo `medirCliente`) e as chamadas
   dos bots (`executarAgente`), que são medidas mas não passam pelo porteiro.
