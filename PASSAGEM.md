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
**Última atualização:** 19/11/2026, 19h35 (Bahia) — Claude da conta do Bruno (Max).

- **Branch de trabalho:** `claude/paginas-vendas-login` (igual à `producao`).
- **No ar:** commit `73997e9` (ver `deploy/no-ar.txt`).
- **Aguardando:** a IA da outra conta (Pro) refazer no GitHub, numa branch nova a partir da `producao`, o que ela
  tinha feito direto no servidor em 19/11 e que se perdeu: `app.html` com a barra e os ícones novos,
  o serviço `chave-evolution` e a ligação com a Evolution. Depois disso, juntar a versão dela + a animação de
  carregamento (anel com plugues) e publicar com o ok do Bruno. O visual que o Claude Max refez (commits `091499c`
  e `73997e9`) deve ser descartado em favor do original dela.
- **Pendente com o Bruno:** chave do Claude e do Evolution em Mais › Conexões; QR Code do WhatsApp de teste;
  ligar a Assia em Agentes de IA › Controle.
