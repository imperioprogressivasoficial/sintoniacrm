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
**Última atualização:** 20/11/2026, 21h20 (Bahia) — Claude da outra conta (Pro).

- **Branch de trabalho:** `claude/visual-original-evolution` (criada a partir da `producao` em `dc2f93d`). **Não publicada.**
- **No ar:** continua o commit `73997e9` (ver `deploy/no-ar.txt`).

### O que esta branch refaz (o que se perdeu em 19/11, 18h30)
1. **`public/app.html` com o visual original** (aprovado pelo dono em 19/11). Parte do `app.html` de `b0eb07f`
   (antes dos commits `091499c` e `73997e9`, que foram descartados no `app.html`) e reaplica, na ordem original:
   - ícones do menu Mais numa cor só (sem cor por item);
   - barra do celular escura e flutuante: só a aba ativa mostra o nome, em cápsula (clara no escuro, azul-escura no claro);
     IA em menta e, ativa, em cápsula azul; "Mais" em três linhas;
   - ícones que enchem quando ativos (`ic-cheio` / `ic-det`) na barra e no menu lateral: Conversas balão quadrado,
     CRM funil, pipeline quadro de colunas, Dashboard blocos, IA estrelas, Agenda calendário, Clientes pessoas;
   - iniciais sem parênteses ("Assia (integração)" vira AI) e selo azul-claro (#9fd4ff) com estrelas nas contas de IA;
   - contorno de 2px na cor de destaque em toda foto de perfil.
   A animação de carregamento (anel com os dois plugues, `b0eb07f`) ficou como estava.
   Os ajustes de iniciais do `091499c` em `public/telas/*.js` e `public/tv.html` foram mantidos (não conflitam).
2. **Ligação com a Evolution (WhatsApp)** em `scripts/gerar-deploy.mjs`, ligada por padrão:
   - serviço `chave-evolution` copia a chave do volume do Espaço Rainha (`rainha-saas_app`, arquivo `evolution/api.key`)
     para o volume `sintonia_chave_evolution`; o app lê com `EVOLUTION_API_KEY_ARQUIVO` (novo em `src/config.ts`).
     **Nenhuma chave no código nem na receita.**
   - o app entra também na rede `rainha-saas_default` e usa `EVOLUTION_URL=http://evolution:8080`.
   - o banco ganha o nome `sintonia-db` (o Espaço Rainha também tem um `db` nessa rede) e `SINTONIA_SEGREDO` fica
     com o endereço original (`...@db:5432/sintonia`), para as conexões já salvas continuarem legíveis.
   - Mais › Conexões continua valendo por cima (endereço e chave da Evolution salvos na tela).
   - `EVOLUTION_REDE=` (vazio) desliga tudo isso na geração.
3. **Presença da equipe (novo, pedido do dono em 19/11):** cada pessoa liga/desliga "Disponível" (menu lateral e Mais);
   fora do ar, a foto ganha borda vermelha. Serviço pequeno em `deploy/presenca/presenca.mjs`, entra na receita
   pelo `gerar-deploy.mjs` (`PRESENCA=0` desliga) na rota `/api/presenca`; confere quem pede pela própria Sintonia.
4. `docs/sistema-vivo.md`: anotações da Sintonia que estavam no repositório do Espaço Rainha (agora só aqui).

Testes: `npx tsc --noEmit` ok; `npx vitest run` com o Postgres de teste: 615 de 615. Telas conferidas rodando o app
localmente (celular e computador, claro e escuro).

### Antes de publicar esta branch (atenção)
- No servidor existe um projeto Docker **avulso** `sintonia-presenca` (criado direto no servidor em 19/11, antes destas
  regras). Ele usa a mesma rota `/api/presenca`: **apague esse projeto** antes de publicar esta branch, para não haver duas.
- Seguir o passo 3 do `CLAUDE.md` (conferir o sha256 do que está no ar) e publicar só com o ok do dono.

### O que falta
- Publicar (com o ok do dono).
- Dono: chave do Claude em Mais › Conexões; QR Code do WhatsApp; ligar a Assia em Agentes de IA › Controle.
- Telas de carregamento: o dono escolheu "Digitando sem a logo + barra no topo"; a versão no ar (anel com plugues) foi mantida
  como pedido. Confirmar com ele se fica assim.
