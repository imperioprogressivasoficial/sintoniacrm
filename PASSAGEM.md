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
**Última atualização:** 20/11/2026, 01h20 (Bahia) — Claude da conta do Bruno (Max).

- **No ar:** `producao` = 698dfa3 (ver `deploy/no-ar.txt`): Dashboard escuro (celular), WhatsApp em canais, Conexões em lista.
- **Em obra (pedidos do dono em 20/11):**
  - Dashboard no computador = modelo C "duas colunas" + modo claro E escuro (segue o tema) + personalizar (arrastar,
    lápis para trocar métrica, "i" explicando) + botão cinza "+ Criar" no fim que abre a biblioteca de relatórios
    (comercial, marketing…). Branch `claude/dashboard-colunas` (worktree /home/user/wt-dash).
  - Transcrição de áudio grátis no próprio servidor (Whisper local), botão para transcrever sem ouvir.
- **Decisões do dono:** canais de WhatsApp sem loja fixa; oficial bloqueado; Claude fora da lista de Conexões;
  beta interna com um acesso só; evitar animações rodando o tempo todo; cor "brilho" #0ffcbe→#3aa0ff; 5 modelos antes de design.
- **Pendente com o dono:** QR Code do WhatsApp; chave do Claude; ligar a Serena.
