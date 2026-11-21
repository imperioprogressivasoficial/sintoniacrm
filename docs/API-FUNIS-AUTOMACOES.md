# Funis por tags e automações: API

Servidor em `src/funis/funis.ts`, `src/automacoes/` e `src/rotas/funis.ts`. Todas as rotas exigem login, como o resto da API. Os erros saem no formato de sempre, `{ "erro": "mensagem" }`, com 400 (dados inválidos), 403 (sem permissão), 404 (não existe ou a pessoa não vê) ou 409 (conflito).

**Quem pode**
- **gestão** = gerente, direção e admin. Cria e edita funis, etapas e automações, e vê automações e execuções.
- **quem vê a conversa** (mesma regra da lista de conversas) pode mover o cartão.
- Contagens e quadro só contam e mostram as conversas que a pessoa vê.

## Ideia
- Um **funil** é um grupo de **tags exclusivas**: cada tag do funil é uma **etapa** (coluna). Dentro de um funil, a conversa tem no máximo uma etapa. Mover o cartão troca a tag, e trocar a tag move o cartão.
- Uma tag sem funil é uma **tag solta**, como antes. `GET /api/tags` continua devolvendo só as soltas.
- O funil do sistema **Atendimento** (`sistema: true`) existe sempre. Tem 7 etapas ligadas à etapa fixa da conversa (`chaveSistema`: `novo_lead`, `em_conversa`, `interessada`, `agendada`, `compareceu`, `manutencao`, `perdida`). A IA e o motor movem esse funil sozinhos. Quando alguém move um cartão nele, `conversa.etapa` muda junto. O funil do sistema não pode ser apagado e a conversa não pode sair dele. As etapas dele podem ser renomeadas e recoloridas, mas não apagadas.
- Uma conversa pode estar em vários funis, com uma etapa em cada um.
- Em `GET /api/conversas` e `GET /api/conversas/:id`, o campo `tags` traz as tags soltas e também as etapas dos funis da empresa. As etapas vêm com `funilId`. As etapas do funil do sistema não entram ali, porque já aparecem em `conversa.etapa`.

## Funis e etapas

### `GET /api/funis`: qualquer pessoa logada
```json
[
  { "id": "…", "empresaId": "imperio", "nome": "Atendimento", "ordem": 0, "sistema": true, "criadaPor": "sistema", "criadaEm": "…",
    "conversas": 42,
    "etapas": [
      { "id": "…", "nome": "Novo lead", "cor": "#0090FF", "ordem": 0, "funilId": "…", "chaveSistema": "novo_lead", "conversas": 5, "criadaPor": "sistema", "criadaEm": "…", "empresaId": "imperio" }
    ] },
  { "id": "…", "nome": "Pós-venda", "sistema": false, "ordem": 1, "conversas": 3, "etapas": [ { "…": "…", "chaveSistema": null } ] }
]
```
O funil do sistema vem primeiro e os outros seguem `ordem`. As etapas vêm em ordem. `conversas` conta só as conversas que a pessoa vê.

### `POST /api/funis`: gestão → 201
Corpo: `{ "nome": "Pós-venda", "etapas": [ { "nome": "Avaliar" }, { "nome": "Retorno", "cor": "#30A46C" } ] }`. O campo `etapas` é opcional.
Resposta: o funil com `etapas`. Regras: nome com até 40 letras e único na empresa (senão 409); etapa com até 30 letras e única dentro do funil; a cor tem que ser da paleta (`GET /api/tags/cores`). Limites: 30 funis e 30 etapas por funil.

### `PATCH /api/funis/:id`: gestão
Corpo: `{ "nome"?: "…", "ordem"?: 2 }`. Devolve o funil com `etapas`.

### `DELETE /api/funis/:id`: gestão → `{ "ok": true }`
Apaga o funil, as etapas, as marcações e as automações do funil. O funil do sistema dá 409.

### `POST /api/funis/:id/etapas`: gestão → 201
Corpo: `{ "nome": "Fiel", "cor"?: "#8E4EC6" }`. Devolve a etapa, que é uma tag com `funilId`. Ela entra no fim do funil.

### `PATCH /api/funis/:id/etapas/:etapaId`: gestão
Corpo: `{ "nome"?: "…", "cor"?: "…" }`. Também vale para as etapas do sistema.

### `DELETE /api/funis/:id/etapas/:etapaId[?moverPara=<etapaId>]`: gestão
- Etapa vazia: `{ "ok": true, "movidas": 0 }`.
- Etapa com conversas e sem `moverPara`: 409 `{ "erro": "Há 3 conversa(s)…", "codigo": "etapa_com_conversas", "conversas": 3 }`.
- Com `moverPara` (outra etapa do mesmo funil): `{ "ok": true, "movidas": 3 }`.
- Etapa do sistema: 409.

### `POST /api/funis/:id/etapas/ordem`: gestão
Corpo: `{ "ids": ["etapaC", "etapaA"] }`. As etapas que ficaram de fora vão para o fim. Devolve as etapas já na nova ordem.

### `GET /api/funis/:id/quadro`: qualquer pessoa logada (só o que ela vê)
Parâmetros: `unidade` (`norte`, `sumare` ou `feira`), `busca` (nome ou telefone; a busca por telefone só vale se o texto não tiver letras e tiver pelo menos 3 dígitos), `limite` (1 a 200, padrão 50), `offset` (padrão 0) e `etapaId` (só essa coluna, para o "carregar mais").
```json
{
  "funil": { "id": "…", "nome": "Vendas", "sistema": false, "…": "…" },
  "colunas": [
    {
      "etapa": { "id": "…", "nome": "Lead", "cor": "#E5484D", "ordem": 0, "chaveSistema": null },
      "total": 312, "offset": 0, "mais": true,
      "cartoes": [
        { "conversaId": "…", "nome": "Marina", "telefone": "5571…", "unidade": "norte", "modo": "copiloto", "etapa": "em_conversa",
          "dona": { "id": "…", "nome": "Carla Lima" },
          "tags": [ { "id": "…", "nome": "VIP", "cor": "#8E4EC6" } ],
          "ultima": { "autor": "cliente", "autorNome": null, "texto": "Oi, quanto custa?", "em": "…" },
          "desde": "2026-11-05T17:07:00.000Z", "atualizadaEm": "…" }
      ]
    }
  ]
}
```
Os cartões de cada coluna vêm do mais recente para o mais antigo, pela última atividade da conversa. `tags` traz só as tags soltas. `desde` é quando a conversa entrou na etapa, para mostrar "parada há X". `total` já aplica os filtros. Para carregar mais de uma coluna: `?etapaId=<id>&offset=50&limite=50`.

## Cartões (conversa ⇄ funil)

### `GET /api/conversas/:id/funis`: quem vê a conversa
```json
[ { "funilId": "…", "funilNome": "Atendimento", "sistema": true,
    "etapa": { "id": "…", "nome": "Em conversa", "cor": "#12A594", "chaveSistema": "em_conversa" }, "desde": "…" },
  { "funilId": "…", "funilNome": "Vendas", "sistema": false, "etapa": null, "desde": null } ]
```

### `POST /api/conversas/:id/funis/:funilId`: quem vê a conversa
Corpo: `{ "etapaId": "…" }`. Com `{ "etapaId": null }` a conversa sai do funil; no funil do sistema isso dá 400.
Resposta: `{ "ok": true, "mudou": true, "etapa": "agendada", "funis": [ …como acima… ] }`. Aqui `etapa` é a etapa fixa (`conversa.etapa`), já atualizada.

### Rotas de tags que já existiam
`POST /api/conversas/:id/tags {tagId}` e `DELETE /api/conversas/:id/tags/:tagId` também funcionam com etapas. Marcar uma etapa tira a etapa anterior do mesmo funil. Desmarcar uma etapa tira a conversa do funil; no funil do sistema isso dá 400. As etapas não podem ser apagadas por `DELETE /api/tags/:id` (dá 409); use a rota do funil.

### Evento
`etapa_movida` com `{ funilId, de, para, por, porId, automatico }`. `de` e `para` são ids de etapa, ou null quando a conversa estava ou ficou fora do funil. `por` pode ser o nome da pessoa, "IA", "Sintonia" (o motor) ou "Automação: <nome>". Quando o movimento acontece no funil do sistema, também é gravado `etapa_mudou` `{ de, para, motivo: "manual" | "automacao" }`.

## Automações

### Formato
```json
{
  "id": "…", "empresaId": "imperio",
  "funilId": "…",
  "nome": "Proposta enviada",
  "ligada": true,
  "gatilho": { "tipo": "entrou_na_etapa", "etapaId": "…" },
  "passos": [ … ],
  "opcoes": { "parar_se_equipe_responder": true },
  "criadaPor": "Gil Norte", "criadaEm": "…", "atualizadaEm": "…"
}
```
`funilId: null` indica uma automação geral.

#### Gatilhos
| tipo | campos | quando dispara |
|---|---|---|
| `entrou_na_etapa` | `etapaId` | Quando a conversa entra na etapa, por qualquer caminho: pessoa, IA, motor ou outra automação. Se a automação tem `funilId`, a etapa tem que ser desse funil. |
| `parada_na_etapa` | `etapaId`, `horas` (1 a 1440) | Quando a conversa fica na etapa por `horas`. Dispara uma vez por estadia: se sair e voltar, conta de novo. O relógio confere a cada 30 s. |
| `nova_conversa` | `unidade?` | Na primeira mensagem da cliente. Uma vez por conversa. |
| `palavra_chave` | `palavras` (1 a 30), `modo`: `contem` (padrão) ou `exata` | O **bot**. Só vale para mensagem da cliente, nunca para mensagem da loja. A comparação ignora acentos, maiúsculas e pontuação. Com `contem`, a palavra ou expressão tem que aparecer inteira ("preço" não casa com "preços"). Com `exata`, a mensagem tem que ser só aquilo. Cada mensagem dispara no máximo uma vez. |
| `tag_marcada` | `tagId` | Quando a tag é marcada, seja solta ou etapa. Remarcar uma tag que já estava não dispara. |

#### Passos
| tipo | campos | o que faz |
|---|---|---|
| `enviar_mensagem` | `texto` (1 a 1000), `so_no_horario` (padrão `true`) | Envia pelo WhatsApp da conversa. Variáveis: `{primeiro_nome}`, `{nome}`, `{unidade}` (nome da unidade) e `{atendente}` (a dona da conversa, ou "nossa equipe"). Fora do horário da loja, espera a próxima abertura. A mensagem fica gravada como da IA, com `autorNome: "Automação: <nome>"`, e conta como resposta (a IA não responde por cima). Conta no limite diário. |
| `esperar` | `minutos` (1 a 43200) | Agenda a continuação. Sobrevive a reinício do servidor. |
| `mudar_modo` | `modo`: `ia`, `copiloto` ou `humano` | Muda o modo e, se não for `humano`, a IA reavalia a conversa. |
| `fluxo_ia` | `objetivo` (3 a 1000), `dias` (1 a 30, padrão 7) | Põe a conversa com a IA (modo `ia`) e grava o objetivo. Enquanto a conversa estiver em modo `ia` e o prazo não vencer, o objetivo vai para a IA como `<objetivo_da_loja>`. |
| `mover_etapa` | `funilId`, `etapaId` | Move o cartão. Pode disparar outras automações. |
| `marcar_tag` / `desmarcar_tag` | `tagId` | Marca ou desmarca a tag. Se a tag for etapa, move o cartão. Não é possível desmarcar uma etapa do sistema. |
| `atribuir` | `usuarioId` (ou `null` para deixar sem dona), `unidade?` | Define a dona. Com `unidade`, o passo só vale para conversas daquela unidade e é pulado nas outras. Também é pulado se a pessoa estiver inativa ou não atender a unidade. |
| `lembrete_ligacao` | `em_minutos` (0 a 8640, ou seja, até 6 dias), `texto?` (aceita as variáveis) | Cria um item em **Ligar hoje** (`GET /api/ligacoes`, `motivo: "lembrete"`, com "(às HH:mm)" se ainda for mais tarde). Aparece no dia em que vence e sai quando alguém registra uma ligação. |
| `condicao` | `se`: `cliente_respondeu`, `tem_tag`, `modo` ou `horario_loja`; `valor?`; `entao: Passo[]`; `senao: Passo[]` | `cliente_respondeu`: a cliente escreveu depois que a execução começou. `tem_tag`: `valor` é o id da tag. `modo`: `valor` é `ia`, `copiloto` ou `humano`. `horario_loja`: a loja está aberta agora. Pode haver condição dentro de condição até 3 níveis. Não há laços. |

Limite de 40 passos no total, contando os que ficam dentro das condições. Os ids são conferidos ao criar, ao editar e ao ligar. Um erro de validação dá 400 e diz qual passo está errado, por exemplo "Passo 3 (mover_etapa): etapa não encontrada neste funil.".

#### Proteções
- No máximo **1 execução ativa** da mesma automação por conversa. Enquanto houver uma, novos disparos dela naquela conversa são ignorados.
- O mesmo evento nunca dispara duas vezes: mesma mensagem, mesma estadia na etapa, ou `nova_conversa` mais de uma vez por conversa. Isso vale também para o WhatsApp de teste.
- **Limite diário** de mensagens automáticas por conversa. O padrão é 3, e o dia é contado pelo horário da Bahia. Quando o limite é atingido, a execução para com status `cancelada`.
- `opcoes.parar_se_equipe_responder` (padrão true): se alguém da equipe responder pelo CRM ou pelo celular da loja, as execuções daquela conversa que ainda têm envio pendente são canceladas.
- **Encadeamento**: uma automação disparada por outra soma 1 na profundidade. Acima de 3 ela não dispara, e fica um evento `falha` com "limite de encadeamento de automações".
- Desligar a automação cancela a continuação das execuções pendentes dela.
- WhatsApp oficial (Meta): mensagem fora da janela de 24 h dá erro na execução, porque precisaria de um modelo aprovado.

### Rotas
| Método e rota | Quem | Corpo | Resposta |
|---|---|---|---|
| `GET /api/automacoes[?funilId=<id>\|geral]` | gestão | | lista |
| `POST /api/automacoes` | gestão | `{ nome, funilId?, ligada? (padrão false), gatilho, passos, opcoes? }` | 201 com a automação |
| `GET /api/automacoes/:id` | gestão | | automação |
| `PATCH /api/automacoes/:id` | gestão | qualquer campo acima; `opcoes` é mesclado | automação |
| `DELETE /api/automacoes/:id` | gestão | | `{ "ok": true }` |
| `POST /api/automacoes/:id/ligar` · `/desligar` | gestão | | automação |
| `GET /api/automacoes/:id/execucoes[?limite=50]` | gestão | | execuções, das mais novas para as mais antigas |
| `POST /api/automacoes/:id/testar` | gestão | `{ conversaId, permitirReal?: false }` | execução já terminada |
| `GET /api/automacoes/config` | gestão | | `{ "limiteDiario": 3 }` |
| `PATCH /api/automacoes/config` | gestão | `{ "limiteDiario": 0 a 20 }` | config |

**Execução**
```json
{ "id": "…", "automacaoId": "…", "conversaId": "…", "chave": "etapa:<etapaId>:<uuid>",
  "status": "pendente", "fila": [ { "tipo": "enviar_mensagem", "texto": "Segunda", "so_no_horario": true } ],
  "feitos": 2, "profundidade": 0, "teste": false,
  "proximaEm": "2026-11-05T18:00:00.000Z", "reservadaAte": null, "erro": null,
  "log": [
    { "em": "…", "passo": "inicio", "ok": true, "detalhe": "Disparada (entrou_na_etapa)." },
    { "em": "…", "passo": "enviar_mensagem", "ok": true, "detalhe": "Enviou: \"Primeira\"" },
    { "em": "…", "passo": "esperar", "ok": true, "detalhe": "Esperando 60 min (até 2026-11-05 15:00)." }
  ],
  "criadaEm": "…", "atualizadaEm": "…" }
```
Valores de `status`:
- `pendente`: se `proximaEm` está no futuro, a execução está **esperando** (por um `esperar` ou pela abertura da loja); senão vai rodar já.
- `rodando`
- `concluida`
- `cancelada` (com o motivo em `erro`)
- `erro`

`fila` mostra os passos que ainda faltam.

**Testar**
- Roda a automação agora, mesmo desligada e sem olhar o gatilho.
- Só funciona em conversa do **WhatsApp de teste** (`teste-norte` / `teste-sumare`). Numa conversa real devolve 400 `{ "codigo": "conversa_real" }`, a não ser que o corpo traga `permitirReal: true`.
- No teste, `esperar` não espera, o horário da loja e o limite diário são só anotados no log, e outras automações não disparam.
- A resposta mostra tudo o que aconteceu no `log`.

### Eventos novos
- `automacao` `{ automacaoId, execucaoId, acao: "enviou" | "mudou_modo" | "fluxo_ia", teste, … }`
- `lembrete_ligacao` `{ quando, texto, automacaoId, automacaoNome }`
- `tag_marcada` / `tag_desmarcada` com `por: "Automação: <nome>"`
- `transferencia` com `motivo: "automacao"`
