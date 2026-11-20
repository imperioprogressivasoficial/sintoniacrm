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
**Última atualização:** 19/11/2026, 23h10 (Bahia) — Claude da conta do Bruno (Max).

- **No ar:** `producao` = a4c6c8a (ver `deploy/no-ar.txt`), publicada 19/11 23h05. Inclui tela da Serena (estilo ChatGPT),
  barra Dashboard · Ligações · Serena · Conversas · Mais, Lista | Funil, filtro Radar com contador, tema "curto-circuito",
  anel/selo de presença e agenda no jeito do Google. Conferido no ar.
- **Branch de trabalho:** `claude/paginas-vendas-login` = `producao`.
- **Padrão de design aprovado:** cor "brilho" = `--brilho-1 #0ffcbe` + `--brilho-2 #3aa0ff` (fio fino, 0.5–1.5px). Usar em todo destaque com brilho.
- **Regra do dono:** toda mudança de design = 5 modelos para comparar antes de aplicar.
- **Fora daqui ainda dizendo "Assia":** agente de voz da ElevenLabs e servidor do Espaço Rainha (outro repositório).
- **Pendente com o dono:** chave do Claude em Mais › Conexões; QR Code do WhatsApp; ligar a Serena em Agentes de IA › Controle;
  imagem da Serena sem fundo (opcional). Agenda ainda sem remarcar/cancelar (precisa de rota nova + Trinks).
