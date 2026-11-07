# Integrações de agenda: Trinks, Avec e AppBarber

Pesquisa feita em 07/11/2026. O que está **confirmado** veio de documentação pública, com o link ao lado.
O que é **suposição** está marcado assim e não foi testado contra a API real.

## Resumo

| | Trinks | Avec | AppBarber |
|---|---|---|---|
| API pública documentada | **Sim** (OpenAPI) | **Só relatórios**, que são somente leitura | **Não** |
| Serviços e profissionais | Sim | Não documentado (há relatórios de serviço por profissional, sem preço nem duração) | Não |
| Horários livres | Sim | Não | Não |
| Buscar e criar cliente | Sim | Não (só relatórios de clientes) | Não |
| Criar e cancelar agendamento | Sim | Não | Não |
| Webhooks | Sim (listados na documentação) | Não documentado | Não documentado |
| Na Sintonia hoje | Funciona: lista, consulta horários, agenda e cancela | Testa a conexão e lê relatórios; o resto dá um erro claro | O adaptador está pronto, mas todos os métodos dão um erro claro |

## Trinks

- **Documentação:** https://trinks.readme.io/reference (OpenAPI público).
- **URL base:** `https://api.trinks.com`. Os caminhos começam em `/v1`. A URL base não aparece na página de
  autenticação: vem do OpenAPI e já está em uso no n8n da Império.
- **Autenticação:** a chave vai no header `X-Api-Key` e o ID do estabelecimento no header `estabelecimentoId`.
  A chave vale para **todos** os estabelecimentos da conta (https://trinks.readme.io/reference/autenticacao).
- **Como obter a chave:** no portal do Trinks, abra "Meu Cadastro", vá em "Token de API Pessoal" e clique em
  "Gerar token". Para consultar a chave depois, use "Visualizar token" no mesmo lugar.
- **Endpoints usados** (os caminhos vêm dos slugs da referência):
  - `GET /v1/servicos` e `GET /v1/profissionais`: catálogo paginado (`page`, `pageSize`);
  - `GET /v1/agendamentos/profissionais/{data}?servicoId&profissionalId&intervalos`: horários vagos por profissional;
  - `GET /v1/clientes?Telefone=`: busca por trecho, por isso a Sintonia confere o número exato. `POST /v1/clientes` cadastra;
  - `GET /v1/agendamentos?clienteId&dataInicio&dataFim` e `POST /v1/agendamentos`;
  - `PATCH /v1/agendamentos/{id}/status/cancelado`: cancelar. Há também `confirmado`, `finalizado`, `clientefaltou` e `ematendimento`.
    **Suposição:** a chamada vai sem corpo. A referência não deixa claro se aceita um motivo.
- **Webhooks:** a referência lista eventos de agendamento (cadastro, alteração e exclusão), de cliente, de
  profissional, de estabelecimento e de fechamento e estorno de conta. A Sintonia ainda não usa nenhum.
- **Limitações:**
  - a API **não confere conflito** ao criar agendamento. A Sintonia reconsulta os horários vagos sem cache antes de gravar;
  - o limite de requisições existe, mas o valor não aparece na página. Há `GET /v1/consumo` para acompanhar o uso;
  - não existe listagem da agenda inteira do salão por dia, só por cliente.

## Avec (avec.app / Avec Salão)

- **Documentação pública:** https://doc.api.avec.beauty, a "AVEC – API de Relatórios", hospedada no Apidog.
  O artigo de ajuda que a explica é https://ajuda.avecbrasil.com.br/support/solutions/articles/17000109199
  (o domínio estava bloqueado neste ambiente; o resumo veio da busca).
- **O que está confirmado:**
  - `GET {base}/reports/{código}`, com `page`, `limit` (no máximo 250), `inicio` e `fim` (dd/mm/aaaa) e
    outros parâmetros que dependem do relatório, como `profissional_id`;
  - header `Authorization: {token}`, sem o prefixo "Bearer";
  - quando não se sabe os parâmetros de um relatório, a ajuda manda chamar sem eles e ler a lista que a resposta devolve;
  - relatórios citados: 0001 (aniversariantes), 0024 (serviços por profissional), 0051 (clientes com
    agendamentos), 0058 (agendamentos com filtro por serviço) e 0286 (dados fiscais do profissional parceiro).
- **O que NÃO está documentado:**
  - a URL base real: a documentação mostra `https://prod.your-api-server.com`, que é um exemplo;
  - o formato do corpo da resposta: o schema vem vazio;
  - catálogo com preço e duração, horários livres, cadastro de cliente e criar ou cancelar agendamento;
  - webhooks.
- **Como pedir acesso:** o token dos relatórios é gerado no painel da Avec. Escrita na agenda (criar e
  cancelar) e horários livres precisam ser pedidos ao suporte ou comercial da Avec, como "API de parceiro"
  ou "integração de agendamento". Não há portal de desenvolvedor público.
- **Na Sintonia:** `src/agenda/avec.ts`.
  - `relatorio(código, parâmetros)` funciona com a fila, o cache, o 429 e a paginação. **Suposição:** a resposta
    é uma lista ou `{ data: [...] }`;
  - `testar()` lê o relatório 0001 do dia;
  - os outros métodos dão "Integração aguardando credenciais/documentação da Avec (…)".

## AppBarber

- **Documentação pública:** não existe. O site (https://appbarber.com.br, https://www.appbarber.com.br/funcionalidades/)
  não cita API, webhooks, parceiros nem desenvolvedores. Fala só de agendamento online pelo site ou pelo Facebook
  e de lembretes por push ou e-mail. Os repositórios "AppBarber" no GitHub são projetos de terceiros, sem relação com o produto.
- **Como pedir acesso:** pelo contato comercial do site.
  - e-mail contato@appbarber.com.br (o rodapé mostra contato@starapp.com.br);
  - telefone +55 11 93346-5397;
  - WhatsApp wa.me/5549991330847;
  - há também uma página de revenda: appbarber.com.br/revenda.

  Peça documentação da API, credenciais de teste (sandbox) e se existem webhooks.
- **Na Sintonia:** `src/agenda/appbarber.ts`. Fila, cache, token, URL e ID da loja já estão no lugar. Todos os
  métodos dão "Integração aguardando credenciais/documentação da AppBarber (…)".

## Como está montado na Sintonia

- `src/agenda/sistema.ts`: a interface `SistemaAgenda`. Ela tem listar serviços e profissionais, horários
  livres, buscar e criar cliente, criar e cancelar agendamento, agendamentos da cliente e testar. Também ficam
  aí os erros `ErroAgenda` (409 = horário ocupado) e `ErroIntegracaoPendente` (501).
- `src/agenda/fila-http.ts`: a fila única com pausa, a nova tentativa no 429 e o cache. Os três clientes usam essa base.
- `src/agenda/unidades-agenda.ts`: a escolha **por unidade**, feita em Conexões › Agenda (`agendaSistemaNorte` e
  `agendaSistemaSumare`: trinks, avec, appbarber ou nenhum; vazio = Trinks). Aí também ficam o que falta preencher
  e o roteador `AgendasDasUnidades`, usado pelo Agendar, pelas ferramentas da IA, pelo revisor e pelo estúdio de agentes.
- Campos novos em Conexões:
  - Avec: `avecUrl`, `avecToken{Norte,Sumare}` (cifrado) e `avecUnidade{Norte,Sumare}`;
  - AppBarber: `appbarberUrl`, `appbarberToken{Norte,Sumare}` (cifrado) e `appbarberLoja{Norte,Sumare}`.

  Não precisou de migração: tudo fica na tabela `conexoes`.
- Rotas: `GET /api/conexoes/agenda` (status por unidade) e `POST /api/conexoes/agenda/:unidade/testar`.

### Para ligar a Avec ou o AppBarber quando a documentação chegar

1. Preencha os métodos do adaptador com `this.enfileirar(...)` e `this.emCache(...)`, como no `ClienteTrinks`.
   O `criarAgendamento` deve reconsultar os horários antes de gravar e recusar com `ErroAgenda(409)`.
2. Em `unidades-agenda.ts`, mude `AGENDA_COMPLETA[sistema]` para `true`.
3. Troque os testes de "pendente" em `test/agendas.test.ts` por testes com o fetch falso no formato real.
4. Pontos de atenção:
   - os IDs da interface são numéricos. Se o fornecedor usar texto, mantenha um mapa no adaptador;
   - `conversa.trinksClienteId` só é usado quando a unidade está no Trinks. Nos outros sistemas, a cliente é
     procurada pelo telefone. O id gravado no agendamento continua no campo `trinksId`.
