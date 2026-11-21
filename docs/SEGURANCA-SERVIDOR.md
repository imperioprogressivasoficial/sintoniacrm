# Segurança do servidor (VPS Hostinger 1969277 · 2.25.217.86 · n8nimperio.tech)

Auditoria só de leitura em 20/11/2026. Nada foi alterado. Cada item abaixo precisa do ok do dono antes de aplicar,
porque no mesmo servidor rodam o n8n, o Espaço Rainha, a Evolution (WhatsApp) e a Sintonia.

## O que foi visto
- **Sem firewall na Hostinger** (`firewall_group_id: null`, nenhum firewall criado). Qualquer porta que algum
  container publique fica aberta para a internet.
- Proxy Traefik: painel desligado, só portas 80/443, HTTPS automático. OK.
- Projetos Docker: sintonia, evolution, rainha-saas, traefik. Nenhum publica porta de banco (5432) no compose.
- n8n em https://n8nimperio.tech (login por e-mail, sem MFA ligado, sem SSO).
- Gerenciador da Evolution aberto na internet em https://evolution.n8nimperio.tech (protegido só pela chave da API).
- 1 chave SSH de root cadastrada ("claude-cowork-imperio"). Não dá para saber pela API se o login por senha no SSH está ligado.
- Varredura de malware (Monarx) iniciada agora; resultado ainda sem arquivos verificados.
- Memória: 6,3 de 8 GB em uso.

## Plano (em ordem)
1. **Firewall da Hostinger**: criar grupo "imperio-padrao" liberando só TCP 80, TCP 443 e SSH 22 (de preferência só dos IPs
   do escritório/casa); bloquear o resto. Aplicar e conferir que Sintonia, n8n, Rainha e WhatsApp continuam no ar.
2. **SSH**: confirmar que o acesso é só por chave (desligar senha do root) e trocar a porta ou restringir por IP.
3. **n8n**: ligar a verificação em duas etapas (MFA) para todas as contas; confirmar que não há cadastro aberto; atualizar a versão.
4. **Evolution Manager**: restringir o /manager por IP (middleware ipallowlist do Traefik) ou tirar do ar o subdomínio público.
5. **Atualizações**: imagens com versão fixa (evitar `traefik:latest` sem controle); atualizar mensalmente.
6. **Cópias de segurança fora do servidor** (Google Drive ou outro): hoje a cópia diária do banco fica no mesmo servidor.
7. **Monitoramento**: o Uptime Kuma já vigia a Sintonia; incluir n8n, Rainha e Evolution e avisar no WhatsApp.
8. **Senhas**: trocar as senhas padrão já trocadas do Kuma/Umami para senhas do dono; revisar contas antigas do n8n.

## Chave do cofre das Conexões (robustez, 21/11/2026)

**Hoje:** as chaves salvas em Mais › Conexões (IA, Evolution, Trinks, e-mail, webhooks, push, agentes) são cifradas
(AES-256-GCM) com uma chave tirada de `SINTONIA_SEGREDO`, que no compose é o **endereço do banco com a senha**
(`postgres://sintonia:<senha>@db:5432/sintonia`). Quem tiver a receita do compose e uma cópia do banco (a cópia diária
fica no mesmo servidor) consegue abrir tudo. **Não trocar a chave de uma vez:** os valores já gravados deixariam de abrir
e a IA, o WhatsApp e o resto parariam.

**O que já está pronto no código (sem mudar nada no ar):** o cofre (`src/conexoes/cofre.ts`) aceita uma chave nova e
continua lendo com a antiga. Sem a chave nova configurada, funciona exatamente como hoje.
- Chave nova: `SINTONIA_COFRE_CHAVE` (variável) ou `SINTONIA_COFRE_CHAVE_ARQUIVO` (arquivo num volume, como a chave da
  Evolution). A antiga continua sendo `SINTONIA_SEGREDO` (ou o endereço do banco).
- Com as duas: tudo o que já existe abre com a antiga; tudo o que for salvo daqui em diante usa a nova;
  `cofre.precisaRegravar(valor)` diz se um valor ainda está na antiga e `cofre.recifrar(valor)` devolve o mesmo texto
  na nova (teste em `test/robustez.test.ts`, "Cofre").

**Plano de migração seguro (precisa do ok do dono, uma etapa por vez):**
1. Gerar a chave nova (32+ caracteres aleatórios, ex.: `openssl rand -hex 32`) e guardá-la **fora do servidor também**
   (gerenciador de senhas do dono). Perder esta chave = perder as chaves das Conexões.
2. Colocá-la num arquivo de um volume só da Sintonia (como `sintonia_chave_evolution`) e apontar
   `SINTONIA_COFRE_CHAVE_ARQUIVO` para ele em `scripts/gerar-deploy.mjs` (nunca no código nem na receita em texto).
   Manter `SINTONIA_SEGREDO` como está. Publicar. Conferir que Conexões continua mostrando tudo configurado.
3. Regravar com a chave nova: abrir e salvar de novo cada conexão (ou um comando que percorra `conexoes.valor`,
   `agentes_ia.chave_cifrada`, os segredos dos webhooks de saída, as senhas/chaves de e-mail e a chave privada do push,
   usando `recifrar` só onde `precisaRegravar` for verdadeiro, numa transação). Fazer uma cópia do banco antes.
4. Conferir que nada mais precisa ser regravado (todos `precisaRegravar = false`).
5. Só então tirar o endereço do banco de `SINTONIA_SEGREDO` (deixar só a chave nova) e publicar.
6. Levar a cópia diária do banco para fora do servidor (item 6 do plano acima): com a chave fora do compose, uma cópia
   do banco sozinha não abre as chaves.

## Banco organizado e proteção do sistema (banco-seguranca, 21/11/2026)

**Feito no código (vale na próxima publicação, sem mexer no servidor à mão):**
- Migrações seguras com o banco cheio (`src/store/migrar.ts`): espera de trava curta (10 s) com nova tentativa;
  arquivo com `-- sintonia: sem-transacao` roda comando por comando (permite `create index concurrently`) e refaz
  índice que ficou pela metade.
- `630_banco_organizado.sql`: telefone normalizado (`telefone_chave`, mesma regra de `chaveTelefone`) em conversas e
  contatos, preenchido por gatilho; vista `sintonia.possiveis_duplicatas` (só mostra, não junta); datas de criação e
  alteração onde faltavam; 12 ligações (chaves estrangeiras) com a conversa, `not valid` (sem trava longa); vista
  `sintonia.orfaos`; tabela `sintonia.auditoria` (só acrescenta).
- `631_banco_indices.sql`: preenche o telefone normalizado em lotes de 2.000, 20 índices `concurrently` (lista por
  unidade, telefone normalizado, nome da ficha e as colunas que ligam tabelas à conversa) e confere as ligações.
  Medido numa cópia de carga (12 mil conversas, 605 mil mensagens): 2 s no total; lista por unidade de 2,8 ms → 0,3 ms.
- Cabeçalhos em toda resposta: HSTS (produção), nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options
  (SAMEORIGIN; DENY onde já era). CSP **só relatório** (não bloqueia; avisos chegam ao log em `/seguranca/csp`).
  Navegando pelo app (computador e celular) não apareceu nenhum aviso. Para ligar de verdade: `SINTONIA_CSP=bloquear`
  em `scripts/gerar-deploy.mjs`, depois de alguns dias sem aviso no log.
- Pedido que muda dados vindo de outro site (Origin diferente) é recusado (403).
- Limites por pessoa: 20 exportações a cada 10 min; 10 pedidos de apagar dados de cliente por hora; 60 mudanças em
  Conexões/Acessos/chaves de API a cada 10 min. (Login já tinha: por endereço, por e-mail e por conta, com espera crescente.)
- Auditoria (`GET /api/seguranca/auditoria`, só administração e direção): entrar, senha errada, bloqueio, trocar senha,
  acessos e permissões, equipe, conexões e chaves (só o nome dos campos, nunca o valor), chaves de API e webhooks,
  exportar, importar e mesclar leads, apagar conversa, LGPD.
- LGPD (só administração e direção): `GET /api/lgpd/cliente?telefone=` (confere quem é), `GET /api/lgpd/cliente/exportar?telefone=`
  (JSON com tudo) e `POST /api/lgpd/cliente/anonimizar` `{ telefone | conversaId, confirmar: "APAGAR" }`.
  Ainda sem botão na tela.
- Downloads de endereços de terceiros (imagem do bot, webhook do bot, "importar link" da base da IA) só vão para
  endereço público, conferindo o DNS e cada redirecionamento (antes dava para apontar para `sintonia-db`, `evolution`...).
- Chave de conexão gravada sem cifra (formato antigo ou posta à mão) é lida e regravada cifrada ao subir.
- Cópia diária do banco: só substitui a anterior se o arquivo abrir (`pg_restore -l`); guarda também uma por semana
  do mês (domingos, `semana-0` a `semana-4`). A receita não é gerada se tiver `ports:` ou rede do servidor.

**Recomendações (precisam do ok do dono; nada disso foi feito):**
1. Firewall da Hostinger (item 1 do plano acima) — continua sendo o mais importante.
2. Cópia do banco **fora do servidor** e **cifrada** (hoje fica no volume `sintonia_copias`, no mesmo VPS, sem cifra).
   Teste de restauração de verdade uma vez por mês (restaurar numa base temporária e contar conversas e mensagens).
3. O Umami (estatísticas do site) usa o mesmo usuário dono do banco da Sintonia (`sintonia`). Se o Umami for invadido,
   o invasor lê o CRM. Criar um usuário só para o banco `umami` e trocar o `DATABASE_URL` dele (com janela de manutenção).
4. Usuário do banco com o mínimo para o app: hoje o app usa o dono do banco (cria tabelas nas migrações). Dá para ter um
   usuário "migrador" (só na subida) e um "app" sem permissão de apagar tabela; precisa mudar a receita e testar com calma.
5. Chave do cofre separada do endereço do banco (seção acima): ainda pendente.
6. Ligar a CSP de verdade (`SINTONIA_CSP=bloquear`) depois de uma semana sem avisos no log.
7. O repositório guarda os pacotes publicados (`pacote-*.b64`) no histórico: são só código, sem senha, mas se o
   repositório for público, o código todo está público. A varredura não achou senha nem chave real no código nem no
   histórico; a senha de teste local usada nos testes não deve ser usada no ar.
