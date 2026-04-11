import { getProducts, getProductBySlug, getProductsByCategory, formatPrice, getMinPrice } from '@/lib/sheets';
import PriceComparison from '@/components/PriceComparison';
import ProductCard from '@/components/ProductCard';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

export const revalidate = 3600;

export async function generateStaticParams() {
  const products = await getProducts();
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  return {
    title: `${product.nome} — Miya`,
    description: product.descricao || `Compare preços de ${product.nome} na Amazon, Mercado Livre e Shopee.`,
    openGraph: {
      title: product.nome,
      description: product.descricao,
      images: product.imagem ? [{ url: product.imagem }] : [],
    },
  };
}

export default async function ProdutoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const related = (await getProductsByCategory(product.categoria))
    .filter((p) => p.slug !== product.slug)
    .slice(0, 6);

  const minPrice = getMinPrice(product);

  return (
    <div style={{ backgroundColor: '#F8F9FA', minHeight: '100vh' }}>

      {/* Breadcrumb — sem borda */}
      <div style={{ backgroundColor: '#F8F9FA' }}>
        <div className="breadcrumb-padding" style={{ padding: '14px 48px' }}>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <Link href="/" style={{ color: 'var(--text-muted)' }}>Home</Link>
            <span>/</span>
            <Link href={`/${product.categoria.toLowerCase()}`} style={{ color: 'var(--text-muted)' }}>{product.categoria}</Link>
            <span>/</span>
            <span style={{ color: 'var(--text)' }}>{product.nome}</span>
          </nav>
        </div>
      </div>

      {/* Produto */}
      <div className="produto-padding" style={{ padding: '12px 48px 0' }}>
        <div className="produto-grid" style={{
          display: 'grid',
          gridTemplateColumns: '480px minmax(0, 1fr)',
          gap: 48,
          alignItems: 'start',
        }}>

          {/* Imagem — tamanho limitado */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: 20,
            aspectRatio: '1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 28,
            boxShadow: '0 4px 24px rgba(0,0,0,0.09)',
            maxWidth: 480,
          }}>
            {product.imagem ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imagem} alt={product.nome} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ color: '#d2d2d7' }}>
                <svg width="64" height="64" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
            )}
          </div>

          {/* Info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Categoria + subcategoria — fonte maior */}
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
              {product.categoria}{product.subcategoria ? ` · ${product.subcategoria}` : ''}
            </span>

            {/* Marca + nome + descrição */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {product.marca && (
                <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  {product.marca}
                </p>
              )}
              <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25, color: 'var(--text)' }}>
                {product.nome}
              </h1>
              {product.descricao && (
                <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)', marginTop: 4 }}>
                  {product.descricao}
                </p>
              )}
            </div>

            {/* Preço */}
            {minPrice != null && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>A partir de</p>
                <p style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>
                  {formatPrice(minPrice)}
                </p>
              </div>
            )}

            {/* Comparação */}
            <PriceComparison product={product} />
          </div>
        </div>
      </div>

      {/* Relacionados */}
      {related.length > 0 && (
        <section className="related-section" style={{ marginTop: 64, paddingBottom: 80 }}>
          <div className="related-title-padding" style={{ padding: '0 48px', marginBottom: 20, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
              Mais em {product.categoria}
            </h2>
            <Link href={`/${product.categoria.toLowerCase()}`} className="gradient-text" style={{ fontSize: 14, fontWeight: 500 }}>
              Ver todos
            </Link>
          </div>
          <div className="shelf-scroll">
            {related.map((p) => <ProductCard key={p.slug} product={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}
