# Miya Store

Site de comparação de preços com curadoria de produtos entre Amazon, Mercado Livre e Shopee. Os dados são gerenciados via Google Sheets — sem painel de administração, sem banco de dados.

## Stack

- **Framework:** Next.js 15 (App Router) com TypeScript
- **Estilização:** Tailwind CSS v4 + estilos inline
- **Animações:** Framer Motion
- **Dados:** Google Sheets (API pública via `gviz/tq`)
- **Deploy:** Vercel

## Estrutura do Projeto

```
app/
  page.tsx                  # Home — destaques + prateleiras por categoria
  [categoria]/page.tsx      # Listagem de produtos por categoria
  produto/[slug]/page.tsx   # Página de detalhe do produto
  layout.tsx                # Header (logo + nav de categorias) + footer
  globals.css               # Design tokens e estilos globais

components/
  ProductCard.tsx           # Card de produto usado nas prateleiras
  CategoryNav.tsx           # Navegação de categorias no header
  SubcategoryFilter.tsx     # Filtro de subcategoria na página de categoria
  PriceComparison.tsx       # Comparação de preços por marketplace
  ui/
    aurora-background.tsx   # Efeito aurora animado do hero

lib/
  sheets.ts                 # Integração com Google Sheets e funções de dados
  utils.ts                  # Utilitários (cn para classnames)

public/
  miyastore_logo.png        # Logo do site
```

## Google Sheets

A planilha é a fonte de dados do site. Cada linha é um produto.

**Colunas esperadas:**

| Coluna | Tipo | Descrição |
|---|---|---|
| `nome` | texto | Nome do produto |
| `slug` | texto | URL do produto (ex: `shampoo-kerastase`) — deve ser único |
| `categoria` | texto | Categoria (ex: `Cabelos`) |
| `subcategoria` | texto | Subcategoria opcional (ex: `Shampoo`) |
| `marca` | texto | Marca do produto |
| `imagem` | URL | Link direto para a imagem do produto |
| `descricao` | texto | Descrição curta |
| `preco_ml` | número | Preço no Mercado Livre |
| `link_ml` | URL | Link de afiliado do Mercado Livre |
| `preco_amazon` | número | Preço na Amazon |
| `link_amazon` | URL | Link de afiliado da Amazon |
| `preco_shopee` | número | Preço na Shopee |
| `link_shopee` | URL | Link de afiliado da Shopee |
| `destaque` | sim/não | Aparece na seção de Destaques da home |
| `ativo` | sim/não | Se `não`, o produto é ocultado do site |

A planilha precisa estar com acesso público: **Compartilhar → Qualquer pessoa com o link pode visualizar**.

## Variáveis de Ambiente

| Variável | Descrição |
|---|---|
| `NEXT_PUBLIC_SHEET_ID` | ID da planilha Google Sheets (trecho da URL entre `/d/` e `/edit`) |

## Cache e Revalidação

O site usa ISR (Incremental Static Regeneration) do Next.js. Os dados do Google Sheets são revalidados automaticamente a cada **1 hora** — sem necessidade de novo deploy quando a planilha é alterada.

O intervalo está definido em:
- `app/page.tsx` → `export const revalidate = 3600`
- `lib/sheets.ts` → `fetch(url, { next: { revalidate: 3600 } })`

Para atualizar mais rápido, basta diminuir o valor (em segundos).

## Repositório e Deploy

- **GitHub:** https://github.com/myyashiro/miya_store
- **Deploy:** Vercel — conectado ao repositório. Qualquer push na branch `master` dispara um novo deploy automaticamente.
