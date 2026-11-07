# Canais de conversa: Messenger, Instagram Direct, TikTok e WhatsApp oficial

Pesquisa feita em novembro de 2026. As regras da Meta e do TikTok mudam com frequência: antes de cada
app review, confira as páginas oficiais listadas em **Fontes**.

## Como a Sintonia organiza os canais

Todo canal implementa a mesma interface (`CanalWhatsApp`, em `src/channels/tipos.ts`): `lerWebhook`,
`enviarTexto`, `enviarMidia`, `baixarMidia`, `buscarFoto` e, nas redes sociais, `perfil`.

| Canal | `tipo` | `canalId` (conta da loja) | "telefone" da conversa | Arquivo |
|---|---|---|---|---|
| WhatsApp não oficial | `evolution` | instância (`sintonia-norte`) | celular (`5571...`) | `src/channels/evolution.ts` |
| WhatsApp oficial | `meta` | Phone Number ID | celular | `src/channels/meta.ts` |
| Facebook Messenger | `messenger` | `fb-<Page ID>` | `fb:<PSID>` | `src/channels/meta-social.ts` |
| Instagram Direct | `instagram` | `ig-<IG Account ID>` | `ig:<IGSID>` | `src/channels/meta-social.ts` |
| TikTok (reservado) | `tiktok` | `tt-<id>` | `tt:<open_id>` | `src/channels/tiktok.ts` |

O identificador com prefixo fica na coluna `telefone`. A tabela de conversas continua única por
empresa + unidade + telefone, um PSID nunca colide com um celular e **não foi preciso migração**.
`lerIdentificadorSocial()` devolve a rede e o id, e `ehCanalSocial()` diz se um canalId é de rede social.

Cada rede tem, na tela de Conexões, uma **unidade que recebe as conversas** (padrão: Norte). Os canais
sociais entram na lista de números depois do WhatsApp de cada unidade, e transmissões e importação de
conversas continuam usando só o WhatsApp.

Origem do lead (`src/rastreio`): quando a mensagem vem de um anúncio "Enviar mensagem" (`referral` com
`source: ADS`), a origem é `anuncio_meta`, com a fonte `facebook` ou `instagram` e o `ad_id`. Sem anúncio,
a origem é `organico` com a fonte `facebook`, `instagram` ou `tiktok` (só no primeiro toque).

Webhooks:

| Rede | Verificação | Recebimento | Segurança |
|---|---|---|---|
| Messenger | `GET /webhook/messenger` | `POST /webhook/messenger` | `X-Hub-Signature-256` com o App Secret |
| Instagram | `GET /webhook/instagram` | `POST /webhook/instagram` | `X-Hub-Signature-256` com o App Secret |
| TikTok (leads) | — | `POST /webhook/tiktok?token=…` | token da URL ou `TikTok-Signature` (Client Secret) |
| WhatsApp oficial | `GET /webhook/meta` | `POST /webhook/meta` | `X-Hub-Signature-256` por unidade |

---

## 1. Facebook Messenger (Messenger Platform)

**API oficial.** Messenger Platform, Send API: `POST https://graph.facebook.com/v21.0/{PAGE_ID}/messages`
com o **Page Access Token**.

**Permissões e app review.**
- `pages_messaging` (enviar e receber), `pages_manage_metadata` (assinar o webhook da Página) e
  `pages_show_list`.
- Para nome e foto: o recurso **Business Asset User Profile Access**.
- Quem tem papel no app pode testar sem análise. Para atender clientes reais, o app precisa de
  **Advanced Access** via App Review e de **verificação da empresa** (Business Verification).
- Token recomendado: gerado por um **usuário do sistema** no Business Manager, sem validade.

**Webhook (entrada).** `object: "page"`. Em `entry[].messaging[]` vem um objeto com `sender.id` (PSID),
`recipient.id` (Page ID), `timestamp` (em ms) e um destes campos:
- `message`: `{ mid, text, attachments[{ type: image|video|audio|file|fallback, payload.url }], quick_reply, reply_to, is_echo }`;
- `postback`: `{ title, payload, mid }`;
- `referral`: `{ source: "ADS", ad_id, ads_context_data: { ad_title, photo_url, video_url } }`.

Campos para assinar: `messages`, `messaging_postbacks`, `messaging_referrals` e `message_echoes`. O
eco (`is_echo`) é a resposta da própria Página, pelo Inbox ou pela Sintonia, e vira mensagem "da equipe".
A assinatura vem em `X-Hub-Signature-256: sha256=HMAC(app_secret, corpo bruto)`.

**Envio.**
- Texto: `{ recipient: { id: PSID }, messaging_type: "RESPONSE", message: { text } }`, com até 2000
  caracteres. A Sintonia divide textos maiores.
- Arquivo: multipart com `recipient`, `message={"attachment":{"type":"image|video|audio|file","payload":{"is_reusable":false}}}`
  e `filedata`. Limite de 25 MB. A legenda vai numa mensagem de texto logo depois.
- Perfil: `GET /{PSID}?fields=first_name,last_name,profile_pic`.

**Janela de 24 h e message tags.**
- Resposta livre só até 24 h depois da última mensagem da pessoa.
- Fora disso valia `messaging_type: MESSAGE_TAG`. As tags `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`
  e `ACCOUNT_UPDATE` foram **descontinuadas em 2026** e hoje respondem com erro 100. Elas foram
  substituídas pelas *Utility Messages* (modelos de utilidade).
- `HUMAN_AGENT` (até 7 dias, só resposta humana) continua, mas exige a permissão **Human Agent**, também
  com app review.
- A Sintonia trava o envio fora da janela (`FORA_DA_JANELA_SOCIAL`) e traduz o erro da Meta (subcódigo
  2018278). O uso de `HUMAN_AGENT` fica para depois da aprovação.

**Passo a passo para a empresa cliente conectar.**
1. Crie um app do tipo **Empresa** em developers.facebook.com e adicione o produto **Messenger**.
2. Ligue a Página da loja e copie o **Page ID**.
3. No Business Manager, vá em Usuários do sistema, atribua a Página e gere um token com `pages_messaging`,
   `pages_manage_metadata` e `pages_show_list`.
4. Em Configurações do app › Básico, copie o **App Secret**.
5. Na Sintonia, em Conexões › Facebook Messenger, preencha os campos e escolha a unidade e "Ligado".
6. Em Messenger › Webhooks, cole a **URL** e o **Verify Token** que a Sintonia mostra e assine os campos
   da lista acima para a Página.
7. Toque em **Testar** na Sintonia e mande uma mensagem para a Página.
8. Antes de abrir para clientes reais, peça o App Review de `pages_messaging` e faça a verificação da
   empresa.

## 2. Instagram Direct (Instagram Messaging)

**API oficial.** Há dois caminhos, e a Sintonia aceita os dois:
- **Instagram API com login do Instagram** (recomendado, não exige Página): host `graph.instagram.com`,
  token do usuário do Instagram (começa com `IG`), envio por `POST /{IG_ID}/messages`.
  - Permissões: `instagram_business_basic` e `instagram_business_manage_messages`.
- **Instagram com login do Facebook** (conta ligada a uma Página): host `graph.facebook.com`, Page Access
  Token, envio por `POST /{PAGE_ID}/messages`.
  - Permissões: `instagram_basic`, `instagram_manage_messages` e `pages_manage_metadata`.

A Sintonia escolhe o host pelo prefixo do token: com `IG`, usa graph.instagram.com.

**Permissões e app review.** Standard Access só funciona para contas com papel no app. Para clientes
reais é preciso **Advanced Access** via App Review da permissão de mensagens, mais a verificação da
empresa. Além disso:
- a conta precisa ser **profissional** (Empresa ou Criador);
- é preciso ligar **"Permitir acesso às mensagens"** nas configurações de mensagens do app do Instagram.

**Webhook.** `object: "instagram"`. `entry[].id` é o IG ID da loja, e `messaging[]` tem o mesmo formato
do Messenger. `message` pode trazer:
- `attachments[{ type: image|video|audio|file|share|story_mention|ig_reel, payload.url }]`;
- `reply_to.story`, `is_echo`, `is_deleted` e `is_unsupported`;
- `referral` (anúncio "Enviar mensagem" no Instagram).

Campos para assinar: `messages`, `messaging_postbacks`, `messaging_referral` (e, se quiser,
`messaging_seen` e `message_reactions`). A assinatura é a mesma: `X-Hub-Signature-256`. No login do
Instagram ela é feita com o App Secret do Instagram.

**Envio.**
- Texto: `{ recipient: { id: IGSID }, message: { text } }`, com **até 1000 bytes**. A Sintonia divide
  textos maiores.
- Arquivo: **só por URL pública** (`attachment.payload.url`). Tipos aceitos: imagem, vídeo, áudio e PDF.
  O envio de arquivo depende de a instalação oferecer uma URL temporária (`publicarMidia`). Sem isso, a
  Sintonia recusa com uma explicação.
- Perfil: `GET /{IGSID}?fields=name,username,profile_pic`.
- Limite de chamadas da Send API: cerca de 100 por segundo por conta, nas mensagens de texto.

**Janela.** São 24 h para resposta livre. A tag `HUMAN_AGENT` estende para 7 dias, com a permissão Human
Agent aprovada. A Sintonia trava fora da janela (subcódigo 2534022).

**Passo a passo para a empresa cliente conectar.**
1. Converta a conta do Instagram em profissional e ligue "Permitir acesso às mensagens".
2. No app da Meta, adicione o produto Instagram › **API com login do Instagram**, conecte a conta e gere
   o token. Copie o **ID da conta**.
3. Copie o App Secret do Instagram.
4. Na Sintonia, em Conexões › Instagram Direct, preencha o Instagram Business Account ID, o token e o App
   Secret. O Page ID só é necessário no caminho pelo login do Facebook. Escolha a unidade e "Ligado".
5. Em Webhooks do produto Instagram, cole a URL e o Verify Token e assine `messages`,
   `messaging_postbacks` e `messaging_referral`.
6. Toque em **Testar** e mande uma DM de outra conta.
7. Peça o App Review de `instagram_business_manage_messages` (ou `instagram_manage_messages`) para
   clientes reais.

## 3. TikTok: o que dá e o que não dá (Brasil, nov/2026)

**Mensagens diretas (Business Messaging API).** A API existe dentro do "TikTok API for Business":
- envia e recebe DMs em tempo real, com respostas automáticas e mensagens de boas-vindas;
- **não é autosserviço**: o acesso é concedido pelo TikTok a parceiros aprovados (Infobip, respond.io e
  outros);
- desde **abril de 2026** exige **Acesso Avançado**, com a conta ligada ao TikTok for Business ou ao
  Business Center. Mudar para "Conta Comercial" no app não basta, e contas pessoais não conectam.

Regras informadas pelos parceiros:
- a conversa **sempre começa pela pessoa**;
- **janela de 48 h**;
- **até 10 mensagens por conversa** dentro da janela;
- texto, imagem e compartilhamento de post (há regiões que bloqueiam imagem);
- indisponível para contas registradas nos EUA, no EEE, na Suíça e no Reino Unido.

O **Brasil não aparece na lista de exclusões**, mas também não há confirmação pública de
disponibilidade.

**Conclusão: não há DM pública para o Brasil hoje.** A Sintonia tem o tipo `tiktok` e o
`CanalTikTok`, que recusa o envio com uma explicação (`DM_TIKTOK_INDISPONIVEL`). Se a empresa for
aprovada como parceira, é só implementar `lerWebhook` e `enviarTexto` nesse arquivo.

**O que funciona: leads (Lead Generation / formulário instantâneo).** O Gerenciador de Anúncios do TikTok
oferece a integração de CRM **"Custom API with Webhooks"**: cada lead do formulário instantâneo é enviado
em tempo real para uma URL. Na Sintonia:
- a URL é `POST /webhook/tiktok?token=<token gerado>`. Se o Client Secret estiver preenchido, também
  vale a assinatura `TikTok-Signature: t=…,s=HMAC(client_secret, "t.corpo")`;
- `lerLeadsTikTok()` é tolerante, porque o formato varia por integração. Ela aceita `field_data`,
  `answers`, `leads[]` e `data[]` e tira nome, telefone (normalizado), e-mail, `ad_id`, `campaign_id` e
  `form_id`;
- hoje o lead vai para o log, sem dados pessoais. O próximo passo é criar a conversa ou o lead no CRM
  (origem `tiktok`) e chamar no WhatsApp com um modelo aprovado.

A busca de histórico (Marketing API, escopo `lead.read`) fica para quando a empresa tiver o app do TikTok
for Business aprovado.

## 4. Revisão do WhatsApp oficial (Cloud API)

O que já está certo em `src/channels/meta.ts`:
- webhook com verificação `hub.challenge` e assinatura por unidade (cada App Secret só vale para o
  Phone Number ID da própria unidade);
- texto, mídia via `/media`, modelos aprovados, marcar como lida e avisos de entrega e leitura;
- erro 131047 (fora da janela) com mensagem clara e janela de 24 h conferida antes do envio.

Pontos de atenção:
- `VERSAO_GRAPH = v21.0`. A Meta mantém cada versão por cerca de 2 anos, e a v21 (out/2024) vence perto
  do fim de 2026. Vale subir para a versão atual (a CAPI já usa `capiVersao`, ex.: v27.0) e testar a
  troca. A constante é usada também pelo Messenger e pelo Instagram.
- Desde jul/2025 a cobrança é **por mensagem de modelo entregue**, não mais por conversa. As respostas
  de serviço dentro da janela são gratuitas, assim como os modelos de utilidade dentro da janela.
- Os limites de envio passaram a valer **por portfólio empresarial** (Business Portfolio), não por
  número.
- A permissão `whatsapp_business_messaging` também passa por App Review quando o app atende outras
  empresas (modelo de provedor de tecnologia / Tech Provider).

---

## O que depende de app review da Meta

| Item | Precisa de |
|---|---|
| Messenger com clientes reais | `pages_messaging` (Advanced) + verificação da empresa |
| Nome e foto no Messenger | Business Asset User Profile Access |
| Instagram com clientes reais | `instagram_business_manage_messages` ou `instagram_manage_messages` (Advanced) + verificação |
| Resposta até 7 dias (Messenger/Instagram) | Human Agent |
| WhatsApp oficial para várias empresas | `whatsapp_business_messaging` / `whatsapp_business_management` (Tech Provider) |

Sem review, tudo funciona com as contas que têm papel no app (administrador, desenvolvedor, testador). É
assim que dá para testar antes de pedir a análise.

## Fontes

- Messenger Platform, Send API e webhooks: https://developers.facebook.com/docs/messenger-platform/reference/send-api/ · https://developers.facebook.com/docs/messenger-platform/webhooks
- Messenger, políticas e janela de 24 h / message tags: https://developers.facebook.com/docs/messenger-platform/policy/policy-overview · https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags
- Descontinuação das message tags (2026): https://community.manychat.com/product-updates/meta-s-deprecation-of-the-message-tags-feature-on-messenger-9010 · https://singhamandeep.com/message-tags-deprecated/ · https://uchat.feedbear.com/updates/feature-add-facebook-utility-messages
- Instagram Platform (visão geral, login do Instagram, permissões, Standard/Advanced Access): https://developers.facebook.com/docs/instagram-platform/overview
- Instagram Messaging API: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
- Guia prático de envio no Instagram (endpoint graph.instagram.com, janela, Human Agent): https://flowgent.ai/blog/instagram-messaging-api
- Assinatura dos webhooks da Meta: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- TikTok API for Business / Business Messaging API: https://ads.tiktok.com/help/article/marketing-api
- TikTok Business Messaging via parceiros (regiões, requisitos): https://www.infobip.com/docs/tiktok · https://respond.io/pt/help/tiktok/tiktok-quick-start
- TikTok Lead Generation, integrações de CRM (Custom API with Webhooks): https://ads.tiktok.com/help/article?aid=10001703 · https://ads.tiktok.com/resources/help/article/available-crm-integrations-tiktok-lead-generation?lang=pt
- Leads do TikTok em tempo real (exemplos de integração): https://www.egrow.com/en/blog/tiktok-leads-to-whatsapp-real-time-2026 · https://site.tinycommand.com/integrations/tiktok-lead-gen
- Assinatura dos webhooks do TikTok for Developers: https://developers.tiktok.com/doc/webhooks-verification
- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api · preços por mensagem: https://developers.facebook.com/docs/whatsapp/pricing
