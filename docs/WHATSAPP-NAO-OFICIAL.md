# WhatsApp pela API não oficial (Evolution v2.3.7 + Baileys): erros e o que a Sintonia faz

Cada canal de WhatsApp por QR Code é uma instância `sintonia-…` na Evolution. Este documento lista o que pode dar
errado e o que o sistema faz em cada caso. Código: `src/channels/evolution.ts` (webhook e envio),
`src/channels/evolution-admin.ts` (instâncias), `src/channels/whatsapp-saude.ts` (saúde, avisos e reconexão),
`src/conexoes/rotas.ts` (tela Conexões), `src/server.ts` (`/webhooks/evolution` e `/api/whatsapp/saude`).
Testes: `test/whatsapp-estavel.test.ts` e `test/conexoes.test.ts`.

## Como a Sintonia fica sabendo

| Fonte | Quando | O que traz |
|---|---|---|
| Webhook `CONNECTION_UPDATE` | na hora | `open`, `connecting`, `close` (com `statusReason`), `refused` (QR Code venceu) |
| Verificação periódica | a cada 2 min (primeira 20 s depois de subir) | estado de todas as instâncias (`GET /instance/fetchInstances`), com `disconnectionReasonCode` |
| Mensagens recebidas | a cada mensagem | prova de que o canal está conectado e a hora da "última mensagem recebida" |

Os relógios usam `unref()`: não seguram o processo aberto. O estado de cada canal fica gravado
(tabela `sintonia.whatsapp_saude`, migração 330), para não repetir aviso de uma queda já avisada depois de reiniciar.

Instâncias criadas antes desta versão não assinavam `CONNECTION_UPDATE`: na primeira verificação em que o canal está
conectado, a Sintonia acrescenta o evento ao webhook, mantendo endereço e token (`atualizarEventos`). O mesmo
acontece ao tocar em "Reconectar".

## Quedas de conexão

| Situação | Como aparece | O que a Sintonia faz |
|---|---|---|
| Aparelho removido no celular (Aparelhos conectados › Sair) ou sessão vencida | `close` com 401 | Marca **Desconectado**, avisa a gestão na hora (sino + push: "O WhatsApp *nome* desconectou. Toque para reconectar.", abre `/conexoes#nao-oficial`), mostra a faixa em Conversas. Não tenta reconectar: só um novo QR Code/código resolve. |
| Número bloqueado / sessão encerrada pelo WhatsApp | `close` com 403, 402 ou 406 | Igual ao 401, com o motivo em palavras simples. |
| Queda comum (internet, reinício do WhatsApp, 408, 428, 440, 500, 515) | A Evolution religa sozinha (não manda `close`) | Nada a fazer. Se a verificação encontrar a instância fechada **sem** código de "sem volta", a Sintonia tenta reconectar sozinha. |
| Instância fechada sem webhook (Evolution reiniciou, webhook perdido) | Verificação: `close` | Tenta reconectar com `GET /instance/connect` **sem número**. Até 5 tentativas, esperando 1, 2, 4 e 8 min entre elas. Se a primeira não resolver, avisa a gestão (uma vez) dizendo que está tentando. Se voltar, avisa "O WhatsApp *nome* voltou". |
| Ao reconectar, o WhatsApp devolve QR Code | resposta do `connect` com `base64`/`code` | Para de tentar (a sessão acabou) e avisa: precisa ler o QR Code de novo. |
| "Conectando" por mais de 5 min num canal que já funcionava | Verificação | Vira queda que precisa de QR Code (o WhatsApp está esperando leitura). |
| QR Code venceu sem ser lido | `refused` / `qrcode.updated` com limite | Se a pessoa está na tela de conectar, nada (ela vê). Se não, vale como queda. |
| Instância apagada na Evolution | Verificação: não existe; ou `logout.instance`/`instance.delete` | Queda que precisa conectar de novo. |
| A pessoa tocou em **Desconectar** ou apagou o canal | Rotas de Conexões | Estado "desligado": nenhum aviso, nenhuma reconexão. |
| Canal criado que nunca conectou | — | Nenhum aviso (falhas do pareamento aparecem na própria tela de conectar). |
| Chegou mensagem por um canal marcado como desconectado | Webhook `messages.upsert` | Marca **Conectado** de novo (se havia aviso, avisa que voltou). |

Os avisos são do tipo "Problemas que impedem o trabalho" (pode ser desligado nas preferências do sino) e vão para
administração, direção e gerência. Cada queda tem uma chave própria: o mesmo aviso nunca sai duas vezes.

## Servidor da Evolution fora do ar

| Situação | O que a Sintonia faz |
|---|---|
| Uma verificação sem resposta | Nada (pode ser um tropeço). |
| Duas verificações seguidas sem resposta (~4 min) | Aviso único "Servidor do WhatsApp sem resposta" e faixa amarela em Conversas. Os canais **não** mudam de estado (não dá para saber). |
| Continua fora | Nenhum aviso a mais. |
| Voltou a responder | Aviso "O servidor do WhatsApp voltou"; a faixa some. Uma nova queda depois gera um novo aviso. |
| Resposta que não é JSON (página de erro do proxy) | Vale como "sem resposta". |

## Envio de mensagem (conversa, IA, follow-ups, transmissões)

Toda mensagem sai por `CanalEvolution` com tempo limite (texto 30 s, mídia 120 s). O erro vira uma mensagem simples
que aparece na conversa, acima da caixa de texto (e o texto digitado continua lá):

| Situação | Resposta da Evolution | Mensagem | Tenta de novo? |
|---|---|---|---|
| Número sem WhatsApp | 400 com `"exists": false` | "Não enviada: este número não tem WhatsApp." (não gera aviso de falha) | Não |
| WhatsApp desconectado | `Connection Closed` / `not connected` | "Não enviada: o WhatsApp deste canal está desconectado. Reconecte em Conexões › WhatsApp." | 1 vez, 4 s depois (o Baileys recusa antes de mandar: não duplica) |
| Conexão apagada no servidor | 404 / `instance does not exist` | "Não enviada: a conexão deste WhatsApp foi apagada do servidor…" | Não |
| Chave da Evolution recusada | 401/403 | "Não enviada: o servidor do WhatsApp recusou a chave de acesso…" | Não |
| Servidor fora antes de receber (conexão recusada, DNS, 502, 503, 429) | — | "Não enviada: o servidor do WhatsApp não respondeu. Tente de novo em instantes." | Até 2 vezes (1 s e 3 s): nada chegou a sair |
| Tempo esgotado, conexão caiu no meio, 504 | — | "O servidor do WhatsApp não confirmou o envio: a mensagem pode ter saído. Confira no celular antes de mandar de novo." | **Nunca** (pode ter saído). Se o eco da mensagem chegar nos 5 min seguintes, ela entra na conversa sozinha. |
| Outro 4xx | — | "Não enviada: o WhatsApp recusou a mensagem." | Não |
| Erro 500 genérico | — | "Não enviada: o servidor do WhatsApp deu erro. Tente de novo." | Não (não dá para saber se saiu) |

Falhas das respostas automáticas da IA continuam virando o aviso "O WhatsApp parou de enviar" (no máximo um por hora).

## Webhook `/webhooks/evolution`

- Token `x-sintonia-token` conferido em tempo constante; errado: 401.
- Responde rápido: mensagens vão para a fila (se a fila falhar, responde erro e a Evolution reenvia; repetidas são
  ignoradas pelo id); histórico (`MESSAGES_SET`) e eventos de conexão são tratados por trás.
- Evento desconhecido, corpo vazio, lista, texto ou mensagem fora do formato: 200 e ignora (não fica reenviando).
- JSON quebrado: 400. Corpo até 40 MB (o histórico pode ser grande).
- Instâncias que não são da Sintonia (nome sem `sintonia-`) não mexem na saúde.

## Sem loop (mensagens que a própria Sintonia mandou)

A Evolution devolve cada envio como `fromMe`. A Sintonia ignora o eco quando: o id está em `enviados`
(gravado logo depois do envio), ou o texto bate com um envio em andamento (o eco pode chegar antes da resposta do envio).
Os avisos para a equipe e o relatório do dia (`enviarAvulso`) também ficam marcados, para não virarem
"a equipe respondeu pelo celular". Um envio que falhou de vez é esquecido na hora: se a pessoa mandar a mesma frase
pelo celular, ela aparece normalmente.

## Onde a pessoa vê

- **Conversas:** faixa vermelha "WhatsApp *nome* desconectado" (com o motivo; a administração vê "Reconectar") e
  faixa amarela "Servidor do WhatsApp sem resposta". Atualiza a cada minuto (`public/telas/whatsapp-saude.js`).
- **Conexões › WhatsApp:** selo por canal — Conectado / Desconectado (com motivo, "tentando religar sozinho" e o botão
  **Reconectar**) / Servidor sem resposta — e "última mensagem recebida há X". "Reconectar" tenta sem QR Code; se o
  WhatsApp pedir, abre o passo a passo (código ou QR Code).
- **Sino e push:** os avisos acima, que abrem `/conexoes#nao-oficial`.
