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
