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
**Última atualização:** 19/11/2026, 23h40 (Bahia) — Claude da conta do Bruno (Max).

- **No ar:** `producao` = a82575b (ver `deploy/no-ar.txt`). Inclui Serena estilo ChatGPT, Radar, curto-circuito, agenda Google,
  puxar para atualizar, Ligações modelo 5, sino/lua novos. "Lista | Funil" foi removido a pedido do dono (CRM fica em Mais › CRM).
- **Branch de trabalho:** `claude/paginas-vendas-login` = `producao`.
- **Fazendo agora:** barra de baixo do celular mais fluida ao trocar de aba e sem cortar o texto "Ligações".
- **Aguardando o dono:** qual dos 5 jeitos da barra encolher (ou nenhum); animações contínuas (Radar, foto da Serena):
  rodar só quando importa ou rodar 2–3 vezes e parar.
- **Regras de design do dono:** 5 modelos antes de aplicar; cor "brilho" `#0ffcbe`→`#3aa0ff` em fio fino; ícones sempre no padrão
  do menu lateral (traço 1,8, cantos arredondados, `ic-cheio` enche quando ativo); evitar mini animações rodando o tempo todo (peso).
- **Pendente com o dono:** chave do Claude em Mais › Conexões; QR Code do WhatsApp; ligar a Serena em Agentes de IA › Controle.
