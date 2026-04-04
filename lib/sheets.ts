export interface Product {
  nome: string;
  slug: string;
  categoria: string;
  subcategoria?: string;
  marca?: string;
  imagem: string;
  descricao: string;
  preco_ml?: number;
  link_ml?: string;
  preco_amazon?: number;
  link_amazon?: string;
  preco_shopee?: number;
  link_shopee?: string;
  destaque: boolean;
}

const SHEET_ID = process.env.NEXT_PUBLIC_SHEET_ID;

function parseProducts(data: { table: { cols: { label: string }[]; rows: { c: ({ v: unknown } | null)[] }[] } }): Product[] {
  const cols = data.table.cols.map((c) => c.label.trim().toLowerCase());
  const rows = data.table.rows;

  return rows
    .map((row) => {
      const cells = row.c || [];
      const get = (key: string) => {
        const i = cols.indexOf(key);
        return i >= 0 && cells[i] ? cells[i]?.v : undefined;
      };

      const ativo = get('ativo');
      if (ativo === false || ativo === 'false' || ativo === 'nao' || ativo === 'não') return null;

      const destaque = get('destaque');

      return {
        nome: String(get('nome') ?? ''),
        slug: String(get('slug') ?? ''),
        categoria: String(get('categoria') ?? ''),
        subcategoria: get('subcategoria') ? String(get('subcategoria')) : undefined,
        marca: get('marca') ? String(get('marca')) : undefined,
        imagem: String(get('imagem') ?? ''),
        descricao: String(get('descricao') ?? ''),
        preco_ml: get('preco_ml') != null ? Number(get('preco_ml')) : undefined,
        link_ml: get('link_ml') ? String(get('link_ml')) : undefined,
        preco_amazon: get('preco_amazon') != null ? Number(get('preco_amazon')) : undefined,
        link_amazon: get('link_amazon') ? String(get('link_amazon')) : undefined,
        preco_shopee: get('preco_shopee') != null ? Number(get('preco_shopee')) : undefined,
        link_shopee: get('link_shopee') ? String(get('link_shopee')) : undefined,
        destaque: destaque === true || destaque === 'true' || destaque === 'sim',
      } as Product;
    })
    .filter((p): p is Product => p !== null && p.slug !== '');
}

export async function getProducts(): Promise<Product[]> {
  if (!SHEET_ID) return [];

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

  try {
    const text = await fetch(url, { next: { revalidate: 3600 } }).then((r) => r.text());
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    return parseProducts(data);
  } catch {
    return [];
  }
}

export async function getCategories(): Promise<string[]> {
  const products = await getProducts();
  return [...new Set(products.map((p) => p.categoria).filter(Boolean))];
}

export async function getProductBySlug(slug: string): Promise<Product | undefined> {
  const products = await getProducts();
  return products.find((p) => p.slug === slug);
}

export async function getProductsByCategory(categoria: string): Promise<Product[]> {
  const products = await getProducts();
  return products.filter((p) => p.categoria.toLowerCase() === categoria.toLowerCase());
}

export function getMinPrice(product: Product): number | undefined {
  const prices = [product.preco_ml, product.preco_amazon, product.preco_shopee].filter(
    (p): p is number => p != null && p > 0
  );
  return prices.length > 0 ? Math.min(...prices) : undefined;
}

export function formatPrice(price: number): string {
  return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
