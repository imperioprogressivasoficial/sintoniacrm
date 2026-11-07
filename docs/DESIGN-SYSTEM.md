# Design system da Sintonia

Os tokens ficam no topo de `public/ds.css`; os componentes, no fim do mesmo arquivo.
Paleta: azul `#106EBE` (ação), menta `#0FFCBE` (IA e novidade) e vidro (`--vidro-*`). Claro e escuro usam as mesmas variáveis.

## Tokens

| Token | Valor | Uso |
|---|---|---|
| `--ds-icone` | 20px | ícone padrão: lateral, cabeçalho, botões |
| `--ds-icone-p` | 18px | ícone de subitem e de pílula |
| `--ds-icone-seta` | 14px | setas e indicadores |
| `--ds-item` / `--ds-item-p` | 40px / 36px | item de menu / subitem |
| `--ds-controle` | 40px | botão, campo, seletor, sininho |
| `--ds-cabecalho` | 48px | barra do topo da área principal |
| `--ds-esp-1…6` | 4, 8, 12, 16, 24, 32px | todo espaçamento |
| `--ds-raio-p` / `--ds-raio` / `--ds-raio-g` | 10 / 14 / 22px | item e campo / botão / card |
| `--ds-raio-pilula` | 999px | pílulas e botões redondos |
| `--ds-linha` | 1px | toda borda e divisória (`--vidro-linha`) |
| `--ds-peso-*` | 400, 500, 600, 700 | texto, item, ativo, título |
| `--ds-fs-p` / `--ds-fs` / `--ds-fs-titulo` | 12 / 14 / 26px | legenda / texto / título de tela |

Fontes: **Sintony 700** nos títulos (`--fonte-titulo`), **Poppins** no resto (`--fonte`).

## Componentes

- **Item de menu** (`.lt-item`, `.lt-cab`): altura `--ds-item`, ícone `--ds-icone`, peso 500. Subitem (`.lt-filhos-in .lt-item`): altura `--ds-item-p`, ícone `--ds-icone-p`, texto `--sub`, peso 400. O item ativo ganha vidro, borda azul (menta no escuro) e peso 600.
- **Botão** (`.botao`, `.botao.leve`, `.ds-primario`): altura `--ds-controle`, raio pílula. Um botão principal por tela.
- **Pílula** (`.ds-pilula`): 24px de altura, texto 12px. Neutra por padrão; `.ia` (menta) só quando a informação é "foi a IA".
- **Card** (`.ds-card`): vidro, raio `--ds-raio-g`, padding `--ds-esp-4`. `.sem-padding` para tabelas.
- **Tabela** (`.ds-tabela` dentro de `.ds-card.sem-padding`): cabeçalho 12px maiúsculo em `--sub`, linhas de 1px, a linha inteira é clicável. Paginação em `.ds-paginas`.
- **Cabeçalho de tela** (`.ds-cab-tela`): título Sintony 26px + uma linha de apoio à esquerda (`.ds-cab-txt`), ações à direita (`.ds-cab-acoes`). Filtros logo abaixo em `.ds-filtros`.
- **Topo da área** (`.topo-pc`, só no computador): trilha "Grupo › Tela" à esquerda e o sininho de notificações à direita.

## Regras

1. **Cor só onde informa**: azul = ação ou item ativo; menta = IA/novidade; amarelo/vermelho = alerta. O resto é neutro.
2. **Um tamanho de ícone por lugar** (os tokens acima). Nada de ícone gigante.
3. **Linhas finas e alinhadas**: 1px, sempre `--vidro-linha` ou `--vidro-borda`.
4. **Espaço em passos de 4px**: só `--ds-esp-*`.
5. **Pouca informação por tela**: um título, uma linha de apoio, filtros e o conteúdo. Detalhe vai para a tela seguinte.

## Navegação (barra lateral)

Inteligência Artificial · Dashboard · Conversas · Agenda · **CRM** (criar pipeline + um item por funil) · Clientes · **Marketing** (Transmissões, E-mail, Rastreamento e UTM, Conexões de anúncios) · **Automações** (Fluxos, Bots) · **Relatórios** (geral, Atendimento, Origem e marketing, Comercial, IA × equipe) · **Configurações** (Atendentes e acessos, Tags, Respostas rápidas, Importar e exportar, Conexões, Notificações, Empresa) · rodapé com Modo noturno e Conta.

Um grupo aberto por vez; o grupo da tela ativa abre sozinho; o último grupo aberto fica guardado (`sintonia.menu.grupo`). Permissões pelas classes `so-gestao`, `so-relatorios` e `so-admin`; grupo sem item visível some. Recolhido (e tablet): só ícones, um ícone por tela, sem a lista de funis.
