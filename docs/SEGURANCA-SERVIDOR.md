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
