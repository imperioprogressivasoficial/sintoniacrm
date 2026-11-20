# Passagem de turno da Sintonia

Duas IAs (contas diferentes) trabalham aqui em revezamento: quando acaba o crédito de uma, a outra continua.
Este arquivo é o caderno de passagem. **Quem chega lê primeiro; quem sai escreve por último.**

## Como trocar de turno
**Ao começar:**
1. Leia `CLAUDE.md` (regras) e este arquivo inteiro.
2. `git fetch` e parta da branch indicada em "Onde parei" (ou da `producao`).
3. Confira o servidor antes de publicar qualquer coisa (passo 3 do `CLAUDE.md`).

**Ao parar (crédito acabando, fim do dia, troca de IA):**
1. Faça commit e push de **tudo** (nada só no seu computador nem só no servidor).
2. Atualize a seção "Onde parei" abaixo: branch, o que ficou pronto, o que falta, o que está no ar.
3. Commit e push deste arquivo.

**Regra de ouro:** só uma IA trabalha por vez. Se as duas estiverem ligadas, uma espera.

## Como publicar (igual para as duas)
O jeito de publicar está descrito no topo de `scripts/gerar-deploy.mjs`: ele gera a receita (docker-compose)
com o código empacotado; a receita sobe no projeto Docker `sintonia` da VPS 1969277 (Hostinger).
- Senhas e chaves nunca vão para o GitHub. A senha do banco que já está em uso pode ser lida da receita
  que está no ar (Hostinger › projeto `sintonia`) — **reaproveite a mesma**, nunca gere outra.
- Depois de publicar, atualize `deploy/no-ar.txt`.

## Onde parei
**Última atualização:** 20/11/2026, madrugada (Bahia) — Claude da conta do Bruno (Max).

- **Feito na branch `claude/paginas-vendas-login` (NÃO publicado):**
  - Tela **Serena** (botão do meio): estilo ChatGPT, `public/telas/serena.js`. Abrir NÃO chama a IA: só `GET /api/serena/resumo`
    (novo, `src/serena/resumo.ts`, guardado 60 s). A IA só roda ao mandar mensagem (`POST /api/ia/chat`, agora aceita 1 imagem na última pergunta
    e devolve `clientes` citadas `[[c1]]`). Menu lateral (empurra a tela), seletor do título, folhas Precisa de você/Resumo/Agendado,
    histórico no aparelho (fixar/apagar segurando), ditado por voz (Web Speech; sem suporte avisa), anexo de print/foto.
  - Barra do celular: Dashboard · Ligações · Serena · Conversas · Mais. CRM: Conversas › Lista | Funil e Mais › CRM.
    Configuração da IA: Mais › Inteligência Artificial e Configurações › Inteligência Artificial (gestão). Lateral do PC: "Serena".
  - Chip **Radar** (esperando resposta, contador vermelho), troca de tema "curto-circuito", presença forte (anel + selo Online/Offline).
  - Testes: 622 passando; `tsc` ok.
- **Falta:** vídeo de demonstração; versão sem fundo da foto da Serena.

- **No ar:** `producao` (ver `deploy/no-ar.txt`), publicada em 19/11 às 22h21 pela conta Max, em cima do trabalho da conta Pro
  (visual original, Evolution, presença). Conferido: /saude ok, presença ok, Evolution configurada, foto /serena.jpg.
- **Branch de trabalho:** `claude/paginas-vendas-login` = `producao`.
- **Renomeação Assia → Serena (pedido do dono em 20/11; passou por "Sincronia" antes do nome final):**
  - No ar, pelo app (banco): agente "Assia" → "Serena" (e "quem é" da persona); automação "Perdida há 30 dias: Serena tenta reativar".
  - n8n: os 5 fluxos renomeados (nomes, textos, prompt da supervisora). Endereços técnicos mantidos: webhooks `assia-*`,
    cabeçalho `x-assia-voz`, login `assia-integracao@…`, chave de memória `assia-supervisora-v2-…`. Os 3 ativos seguem ativos.
  - Código (publicado): gestão pode renomear pessoa (`PATCH /api/acessos/usuarios/:id {nome}`), selo de IA reconhece "Serena".
    Usuário de serviço já renomeado para "Serena (integração)" (login continua `assia-integracao@…`). Foto da Serena (recorte C) na agente e no usuário.
  - Fora daqui: agente de voz da ElevenLabs (não está na conta conectada) e textos do servidor do Espaço Rainha (outro repositório).
- **Personagem:** a Serena é uma moça de fone de atendente (imagem do dono, feita no ChatGPT); falta a versão sem texto/fundo transparente para o avatar.
- **Em desenho (aguardando escolha do dono):** tela do botão do meio "Serena" no estilo ChatGPT — 5 modelos em
  `scratchpad` da sessão (sugestão: menu lateral + faixa de aviso); barra na ordem Dashboard, Ligações, Serena, Conversas, Mais
  (falta o dono dizer para onde vai o CRM).
- **Pendente com o dono:** chave do Claude em Mais › Conexões; QR Code do WhatsApp; ligar a Serena em Agentes de IA › Controle.
