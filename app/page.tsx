import { getProducts, getCategories } from '@/lib/sheets';
import ProductCard from '@/components/ProductCard';
import Link from 'next/link';
import { AuroraBackground } from '@/components/ui/aurora-background';

export const revalidate = 3600;

export default async function Home() {
  const [products, categories] = await Promise.all([getProducts(), getCategories()]);

  const byCategory = categories.map((cat) => ({
    name: cat,
    slug: cat.toLowerCase(),
    products: products.filter((p) => p.categoria === cat && p.destaque),
  })).filter(({ products: catProducts }) => catProducts.length > 0);

  return (
    <div style={{ backgroundColor: 'var(--bg)' }}>
      {/* Hero */}
      <AuroraBackground className="min-h-[300px] items-center justify-center" showRadialGradient>
        <div className="hero-inner" style={{ padding: '64px 48px 56px', width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 58px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, color: 'var(--text)', fontFamily: "'Red Hat Display', sans-serif" }}>
            Economize tempo.<br />Economize dinheiro.
          </h1>
          <p style={{ marginTop: 16, fontSize: 17, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 520 }}>
            Pesquisamos, comparamos e selecionamos os melhores produtos da Amazon, Mercado Livre e Shopee, para que você só precise escolher onde comprar.
          </p>
        </div>
      </AuroraBackground>

      <div style={{ padding: '48px 0 80px', backgroundColor: '#F8F9FA' }}>

        {/* Por categoria — apenas destaques */}
        {byCategory.map(({ name, slug, products: catProducts }) => {
          return (
            <section key={name} style={{ marginBottom: 56 }}>
              <div className="section-title-row" style={{ marginBottom: 20, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>{name}</h2>
                <Link href={`/${slug}`} className="gradient-text" style={{ fontSize: 14, fontWeight: 500 }}>
                  Ver todos
                </Link>
              </div>
              <div className="shelf-scroll">
                {catProducts.map((p) => <ProductCard key={p.slug} product={p} />)}
              </div>
            </section>
          );
        })}

        {byCategory.length === 0 && (
          <div className="page-px" style={{ paddingTop: 80, paddingBottom: 80, textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: 'var(--text)' }}>Nenhum produto ainda</p>
            <p style={{ fontSize: 14 }}>Adicione produtos na planilha para começar.</p>
          </div>
        )}
      </div>
    </div>
  );
}
