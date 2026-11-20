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
**Última atualização:** 20/11/2026 (Bahia) — Claude da conta do Bruno (Max).

- **No ar:** `producao` em `f20efdd` (publicada pela outra conta em 19/11, 21h47). Conferido no ar: carregamento com anel,
  visual original, Evolution respondendo (Norte e Sumaré prontas para QR), presença.
- **Branch de trabalho:** `claude/paginas-vendas-login` = `producao` + commit "Sincronia" abaixo. **Não publicado.**
- **Renomeação Assia → Sincronia (pedido do dono em 20/11):**
  - No ar, pelo app (banco): agente "Assia" → "Sincronia" (e "quem é" da persona); automação "Perdida há 30 dias: Sincronia tenta reativar".
  - n8n: os 5 fluxos renomeados (nomes, textos, prompt da supervisora). Endereços técnicos mantidos: webhooks `assia-*`,
    cabeçalho `x-assia-voz`, login `assia-integracao@…`, chave de memória `assia-supervisora-v2-…`. Os 3 ativos seguem ativos.
  - Código (nesta branch, falta publicar): gestão pode renomear pessoa (`PATCH /api/acessos/usuarios/:id {nome}`), selo de IA
    reconhece "Sincronia", textos de Conexões. Depois de publicar: renomear o usuário "Assia (integração)" para "Sincronia (integração)".
  - Fora daqui: agente de voz da ElevenLabs (não está na conta conectada) e textos do servidor do Espaço Rainha (outro repositório).
- **Em desenho (aguardando escolha do dono):** tela do botão do meio "Sincronia" no estilo ChatGPT — 5 modelos em
  `scratchpad` da sessão (sugestão: menu lateral + faixa de aviso); barra na ordem Dashboard, Ligações, Sincronia, Conversas, Mais
  (falta o dono dizer para onde vai o CRM).
- **Pendente com o dono:** chave do Claude em Mais › Conexões; QR Code do WhatsApp; ligar a Sincronia em Agentes de IA › Controle.
