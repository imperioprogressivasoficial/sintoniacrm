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

- **20/11 13:14 UTC — no ar o 2c191a9:** Dashboard do celular voltou ao modelo 3 escolhido (banco). Em `painel.js`, `blocoHeroi`
  usa `.pn-banco` quando `!s.largo && !s.editando`; `curva` com `sr.banco` tira eixos, média, legenda e o balão de vazio.
- **20/11 12:54 UTC — no ar o commit 44d749b** (branch `claude/paginas-vendas-login`, levado para `producao`).
  Configurações em sanfona (categorias estilo Kommo; Minha conta pela foto). WhatsApp: lista de canais em linhas e
  conexão em 3 etapas (autorizar › número › código, ou QR Code). Código de pareamento: a Evolution v2.3.7 ignora o número
  se a instância já está "connecting", por isso `conectar(..., numero)` apaga e recria a instância com `number` e espera o
  `pairingCode`; rota GET `/api/conexoes/whatsapp/canais/:id/codigo` devolve o código em vigor.
  Falta: menu lateral do computador nas mesmas categorias da sanfona.
3. Commit e push deste arquivo.

**Regra de ouro:** só uma IA trabalha por vez. Se as duas estiverem ligadas, uma espera.

## Como publicar (igual para as duas)
O jeito de publicar está descrito no topo de `scripts/gerar-deploy.mjs`: ele gera a receita (docker-compose)
com o código empacotado; a receita sobe no projeto Docker `sintonia` da VPS 1969277 (Hostinger).
- Senhas e chaves nunca vão para o GitHub. A senha do banco que já está em uso pode ser lida da receita
  que está no ar (Hostinger › projeto `sintonia`) — **reaproveite a mesma**, nunca gere outra.
- Depois de publicar, atualize `deploy/no-ar.txt`.

## Onde parei
**Última atualização:** 20/11/2026, 02h10 (Bahia) — Claude da conta do Bruno (Max).

- **No ar:** `producao` = d619be0 ("Configurações" na barra); antes 78d9777 (ver `deploy/no-ar.txt`): Dashboard novo, consertos da auditoria, transcrição grátis,
  cópia diária do banco, monitor (status.n8nimperio.tech) e estatísticas (estatisticas.n8nimperio.tech).
- **Auditoria completa (20/11):** 103 funcionalidades. Lotes 1 e 2 de consertos publicados. Agenda Trinks e cobrança Asaas
  publicadas (validar com chave real). Ligação pelo app: só pela API oficial do WhatsApp (decisão do dono pendente).
- **Aguardando o dono:** modelo do menu "Mais" em cascata (5 modelos enviados); tirar ou não os avisos de falha das
  Movimentações; chave nova do Claude (cadastrar em Conexões › Outras configurações); QR Code do WhatsApp; Trinks; e-mail.
- **Regras do dono:** 5 modelos antes de design; sem animação rodando o tempo todo; cor brilho #0ffcbe→#3aa0ff;
  ícones no padrão do menu; sem zoom no celular; beta interna com um acesso.
