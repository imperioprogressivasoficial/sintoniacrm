# Sintonia CRM — o sistema vivo (Império, beta de 5 meses)

Mapa de como a Sintonia se move sozinha e o que foi configurado em 19/11/2026.

## Os 3 atores
| Ator | O que faz | Onde está |
|---|---|---|
| **Agente de IA (Assia)** | Conversa com a cliente sozinho, tira dúvidas, agenda na Trinks, move o funil, marca etiquetas, guarda memória da cliente, cria lembrete de ligação e passa para humano. | Sintonia › Agentes de IA › "Assia" (Claude Sonnet 5.5) |
| **Atendente (pessoa)** | Atende, negocia e resolve o caso difícil. | Caixa de entrada da Sintonia |
| **Copiloto** | Sugere a resposta pronta para a atendente. Se ninguém responder em 15 min, a IA assume. Organiza etiquetas sozinho. | Modo padrão "copiloto" de cada conversa |

## O circuito (como o CRM se move sozinho)
```
Nova conversa → Novo lead
  └ IA/copiloto conversa → move para Em conversa / Interessada (a própria IA move)
      ├ sem resposta da cliente → follow-up 3h, 24h, 72h
      ├ pediu preço e não agendou → follow-up 2h, 24h, 72h
      ├ Interessada parada 2 dias → lembrete de ligação para a equipe
      └ agendou (Trinks) → Agendada
          ├ confirmação 24h e 2h antes (1 confirma / 2 remarca)
          ├ faltou → follow-up 2h, 48h
          └ compareceu → Compareceu
              ├ pós-atendimento 24h depois
              ├ 25 dias depois → etapa Manutenção
              └ cerca de 29-30 dias → lembrete de retoque e convite para voltar
Perdida parada 30 dias → Assia tenta reativar
Aniversário → parabéns e lembrete do cashback de 10%
Ligação (Twilio + Assia Voz) → cria ou acha o lead, preenche o nome, move a etapa e registra a ligação
```

## Proteções que já existem
- Máximo de 3 mensagens automáticas por dia e 4 de follow-up por semana por cliente.
- Só manda no horário da loja.
- Para quando a equipe assume a conversa.
- Filas com reserva e retomada: nada é enviado em dobro, e se o servidor cair volta de onde parou.
- O CRM foi feito para dezenas de milhares de leads por mês (quadro paginado e busca indexada).

## Configurado em 19/11
- [x] Dados de demonstração apagados (com backup).
- [x] Sintonia ligada à Evolution (WhatsApp não oficial). Perdido na publicação de 19/11 18h30; refeito no GitHub em `scripts/gerar-deploy.mjs` (aguarda publicação).
- [x] Agente Assia criado (modelo Império, Sonnet 5.5, 7 ferramentas), apontado nas duas unidades e **desligado**.
- [x] IA organiza etiquetas sozinha.
- [x] As 5 sequências de follow-up ligadas.
- [x] 4 automações ligadas: Interessada 2 dias, Manutenção em 25 dias, reativar Perdida em 30 dias, aniversário.
- [x] Usuário de serviço "Assia (integração)" (admin) para o n8n e a ligação.
- [x] Ligação: agente "Assia Voz" (ElevenLabs) + workflow "Assia | Voz (ligações)" registrando no CRM.

## Falta (dono)
- [ ] Chaves de Claude, Trinks e OpenAI em Mais › Conexões. Sem a do Claude, nada de IA roda.
- [ ] QR Code do WhatsApp de cada unidade.
- [ ] Preencher os [PREENCHER] da base de conhecimento: endereços, horários, serviços, regras de sinal/pagamento/atraso/cancelamento e as 20 perguntas mais comuns.
- [ ] Revisar e ligar a Assia em Agentes de IA › Controle.
- [ ] Publicar os workflows do n8n.
- [ ] Twilio e plano pago da ElevenLabs para as ligações.

## Só com o código-fonte da Sintonia
- Limite de 3 áudios por cliente e resposta em áudio.
- Qualquer comportamento novo que não exista nas configurações.

## Padrão visual dos ícones (aprovado em 19/11)
- **Barra do celular:** barra escura flutuante; só a aba ativa mostra o nome, dentro de uma cápsula (clara no modo escuro, azul-escura no claro). A IA fica na cor menta e, quando ativa, em cápsula azul.
- **Regra "preenche quando ativo":** ícone só com contorno (traço 1,8) no estado normal e cheio quando a aba ou o item está selecionado. Vale para a barra do celular e para o menu lateral do computador.
- **Como marcar no código:** a parte do ícone que enche leva `class="ic-cheio"`. O detalhe que deve aparecer recortado por cima do ícone cheio, como as linhas da agenda, leva `class="ic-det"`. O CSS enche só quando o item tem `aria-current="page"`.
- **Ícones:**
  - Conversas: balão quadrado.
  - CRM: funil.
  - Cada pipeline: quadro de colunas.
  - Dashboard: painel de blocos.
  - IA: estrelas.
  - Mais: três linhas.
  - Agenda: calendário.
  - Clientes: pessoas.
- **Cores:** um só tom para os ícones, sem uma cor diferente por item.
- **Contorno das fotos:** 2px na cor de destaque (menta no escuro, azul no claro); vermelho quando a pessoa está fora do ar.
- **Avatar:** iniciais sem parênteses nem símbolos ("Assia (integração)" vira AI). Contas de IA, como a Assia, ganham um selo azul-claro (#9fd4ff) com estrelas no canto do avatar; as pessoas ficam só com as iniciais ou a foto.
- **Onde fica:** tudo isso está em `public/app.html` (branch `claude/visual-original-evolution`). Nada é editado direto no servidor (ver `CLAUDE.md`).
