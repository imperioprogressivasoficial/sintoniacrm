# Fontes da Sintonia

Regra do dono (20/11/2026): **no máximo 3 famílias de fonte no sistema todo**, com pesos padronizados
e itálico só onde precisa. Este é o padrão. Quem criar tela nova usa só as variáveis abaixo.

## As 3 famílias

| Variável CSS      | Família                                   | Onde usar                                              | Pesos carregados |
|-------------------|-------------------------------------------|--------------------------------------------------------|------------------|
| `--fonte`         | **Poppins**                               | todo texto e interface (botões, listas, campos, menus) | 400 · 500 · 600 · 700 |
| `--fonte-titulo`  | **Sintony**                               | títulos de tela, nomes de seção, números de destaque  | 700              |
| `--fonte-mono`    | monoespaçada do próprio aparelho (SF Mono, Menlo, Consolas…) | códigos, chaves, links para copiar, variáveis `{nome}` | do aparelho (não baixa nada) |

Definidas em `public/ds.css` (app e Conexões) e `public/estilo.css` (página de vendas, entrar, convite,
esqueci/nova senha). Páginas que vivem sozinhas repetem as variáveis no próprio arquivo:
`public/tv.html`, `public/reuniao.html` (/r/<slug>), `public/404.html` e `public/telas/atualizando.js`
(esta usa `--atz-fonte` e `--atz-mono`, porque precisa funcionar sem o servidor).

Carregamento (o mesmo link em todas as páginas, então o navegador reaproveita o que já baixou):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Sintony:wght@700&display=swap">
```

- `display=swap`: o texto aparece na hora com a fonte do aparelho e troca quando a Poppins chega (nada de tela em branco).
- A página pública de agendamento (/r/<slug>) só usa Poppins (`family=Poppins:wght@400;500;600;700`).
- E-mails (src/email) usam Poppins/Sintony com Arial de reserva: muitos programas de e-mail não baixam fontes.

## Pesos

| Peso | Nome     | Uso                                                    | Token |
|------|----------|--------------------------------------------------------|-------|
| 400  | normal   | texto corrido, mensagens                               | `--ds-peso-texto` |
| 500  | médio    | legendas, pílulas, item de menu                        | `--ds-peso-medio` |
| 600  | forte    | rótulos, cabeçalho de tabela, botões secundários      | `--ds-peso-forte` |
| 700  | negrito  | títulos (Sintony), números grandes, botões principais  | `--ds-peso-titulo` |

Valores fora da lista que ainda aparecem no código antigo (800, 750, 650, 550) **não baixam arquivo novo**:
o navegador usa o peso carregado mais próximo (800/750/650 → 700, 550 → 600). Tela nova: use só 400/500/600/700.

**Itálico:** nenhum arquivo de itálico é baixado. Onde precisa (avisos "sem mensagem", rascunho da Serena,
_texto_ do WhatsApp) o navegador inclina a Poppins sozinho. Não usar itálico para enfeite.

## Tamanhos

| Papel                     | Computador | Celular | Família / peso |
|---------------------------|-----------:|--------:|----------------|
| Título de tela            | 26 px (`--ds-fs-titulo`) | 34 px (título grande do iOS) | Sintony 700 |
| Título de cartão/seção    | 15–18 px   | 15–17 px | Poppins 600 ou Sintony 700 |
| Texto                     | 14 px (`--ds-fs`) | 15–16 px | Poppins 400 |
| Texto de destaque/lista   | 15 px (`--ds-fs-m`) | 16 px | Poppins 500 |
| Legenda, pílula           | 12 px (`--ds-fs-p`) | 12–13 px | Poppins 500 |
| Rótulo de seção (MAIÚSCULAS) | 11 px (`--ds-fs-secao`) | 11 px | Poppins 600, espaçado |
| Código / chave            | 12,5–13 px | 13 px | `--fonte-mono` 400–500 |

No celular, campos de texto ficam com 16 px ou mais (o iPhone dá zoom em campo menor).

## Antes e depois (20/11/2026)

| | Antes | Depois |
|---|---|---|
| Famílias | Poppins, Sintony, monoespaçadas escritas de 5 jeitos diferentes, e a fonte do sistema (`-apple-system`) na prévia de Transmissões | Poppins, Sintony e uma monoespaçada (`--fonte-mono`) |
| Poppins no app, Conexões e TV | 400, 500, 600, 700, **800** | 400, 500, 600, 700 |
| Sintony | **400** e 700 | 700 |
| Link do Google Fonts | 2 versões diferentes (app ≠ páginas públicas) | 1 só, igual em todas as páginas |
| Fontes baixadas para abrir o app (medido, celular e computador) | 7 arquivos, 55 KB | 5 arquivos, 39 KB (−29%) |
| Nomes de fonte escritos à mão | 20 lugares (`Poppins, system-ui…`, `Sintony, Poppins…`, `ui-monospace, Menlo…`) | variáveis `--fonte`, `--fonte-titulo`, `--fonte-mono` |

O que muda na tela: textos que pediam peso 800 (alguns números grandes, títulos de Acessos e da TV) ficam em 700,
um pouco mais leves. O resto fica igual. Prints de comparação ficam com quem fez a mudança (agente `rotas-fontes`).
