import { getCategories, getProductsByCategory } from '@/lib/sheets';
import SubcategoryFilter from '@/components/SubcategoryFilter';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { slugify } from '@/lib/utils';

export const revalidate = 3600;

export async function generateStaticParams() {
  const categories = await getCategories();
  return categories.map((cat) => ({ categoria: slugify(cat) }));
}

export async function generateMetadata({ params }: { params: Promise<{ categoria: string }> }): Promise<Metadata> {
  const { categoria } = await params;
  const categories = await getCategories();
  const matchedCat = categories.find((c) => slugify(c) === categoria) ?? categoria;
  const name = typeof matchedCat === 'string' ? matchedCat : categoria;
  return {
    title: `${name} — Miya`,
    description: `Melhores ofertas de ${name} comparadas entre Amazon, Mercado Livre e Shopee.`,
  };
}

export default async function CategoriaPage({ params }: { params: Promise<{ categoria: string }> }) {
  const { categoria } = await params;
  const categories = await getCategories();
  const matchedCat = categories.find((c) => slugify(c) === categoria);

  if (!matchedCat) notFound();

  const products = await getProductsByCategory(matchedCat);

  const subcategories = [...new Set(
    products.map((p) => p.subcategoria).filter((s): s is string => Boolean(s))
  )];

  return (
    <div style={{ backgroundColor: '#F8F9FA', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '20px 48px 12px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 4 }}>
          {matchedCat}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {products.length} {products.length === 1 ? 'produto encontrado' : 'produtos encontrados'}
        </p>
      </div>

      {/* Filtro + Produtos */}
      <div style={{ paddingBottom: 80 }}>
        {products.length > 0 ? (
          <SubcategoryFilter products={products} subcategories={subcategories} />
        ) : (
          <div style={{ textAlign: 'center', padding: '80px 48px', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>Nenhum produto nesta categoria</p>
            <p style={{ fontSize: 14 }}>Em breve novidades por aqui.</p>
          </div>
        )}
      </div>
    </div>
  );
}
