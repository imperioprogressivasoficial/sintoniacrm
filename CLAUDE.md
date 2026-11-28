# Sintonia — regras para quem trabalha neste projeto (pessoas e IAs)

Mais de uma IA (de contas diferentes) mexe na Sintonia. Em 19/11/2026 uma publicação apagou o trabalho
de outra, porque uma editou arquivos direto no servidor e a outra publicou a partir do GitHub.
Estas regras existem para isso nunca mais acontecer. Siga todas, sempre.

**Revezamento:** as duas IAs se revezam (quando acaba o crédito de uma, a outra continua). Leia também
`PASSAGEM.md` ao começar e atualize-o ao parar.

## 1. O GitHub é a única fonte da verdade
- Todo código, tela, configuração e receita de publicação fica neste repositório
  (`imperioprogressivasoficial/sintoniacrm`). O que não está aqui não existe.
- **Nunca edite arquivos direto no servidor** (VPS Hostinger 1969277, projeto Docker `sintonia`):
  nem `app.html`, nem CSS, nem o docker-compose à mão. A próxima publicação apaga o que não estiver no GitHub.
- Mudança de configuração do servidor (serviço novo no compose, rede, volume, variável de ambiente)
  entra em `scripts/gerar-deploy.mjs`, que gera o compose. Segredos nunca no código: use variáveis de ambiente.
- Configurações do próprio sistema (chaves, WhatsApp/Evolution, agentes, automações) ficam no banco,
  pela tela **Mais › Conexões** e telas do app — essas sobrevivem a qualquer publicação.

## 2. Branch de produção
- O que está no ar é sempre o último commit da branch **`producao`** (registrado em `deploy/no-ar.txt`).
- Cada IA trabalha numa branch própria, partindo da `producao` atualizada.
- Para publicar: traga a `producao` para a sua branch (merge), resolva conflitos **mantendo o trabalho
  dos outros**, teste, e só então leve para `producao` e publique.

## 3. Antes de publicar (obrigatório)
1. Leia o compose que está no ar (Hostinger: `vps_docker_get` do projeto `sintonia`). A 1ª linha traz
   `pacote sha256 <hash>`.
2. Compare com o `sha256` registrado em `deploy/no-ar.txt`.
   - **Iguais:** ninguém publicou por fora; pode seguir.
   - **Diferentes ou compose com serviço que não está no gerador:** alguém publicou sem passar pelo GitHub.
     **PARE.** Não publique. Avise o dono (Bruno) e descubra o que mudou antes.
3. Rode os testes (`npx vitest run`, com o Postgres de teste) e `npx tsc --noEmit`.
4. Mostre ao dono o que vai mudar e publique só com o ok dele.

## 4. Depois de publicar (obrigatório)
- Atualize `deploy/no-ar.txt` com: data/hora, commit, sha256 do pacote e quem publicou. Faça commit e push na `producao`.

## 5. Estilo
- Respostas e textos do produto em português do Brasil, simples, sem jargão.
- Para mudança de design, o dono quer ver modelos para comparar antes de aplicar.
