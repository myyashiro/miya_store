'use client';

import { Product, formatPrice } from '@/lib/sheets';

interface PlatformRow {
  name: string;
  price?: number;
  link?: string;
}

export default function PriceComparison({ product }: { product: Product }) {
  const platforms: PlatformRow[] = [
    { name: 'Amazon',        price: product.preco_amazon, link: product.link_amazon  },
    { name: 'Mercado Livre', price: product.preco_ml,     link: product.link_ml      },
    { name: 'Shopee',        price: product.preco_shopee, link: product.link_shopee  },
  ].filter((p) => p.price != null || p.link != null);

  if (platforms.length === 0) return null;

  return (
    <div className="price-comparison-wrap" style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)', width: 'fit-content' }}>
      <div style={{ padding: '12px 18px', backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Comparar preços
        </span>
      </div>

      {platforms.map((p, i) => {
        return (
          <div
            key={p.name}
            className="price-row"
            style={{
              padding: '14px 18px',
              borderBottom: i < platforms.length - 1 ? '1px solid var(--border)' : 'none',
              backgroundColor: 'var(--bg)',
            }}
          >
            {/* Barra lateral */}
            <div style={{ width: 3, height: 28, borderRadius: 2, backgroundColor: 'var(--border-strong)' }} />

            {/* Nome */}
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{p.name}</span>

            {/* Preço */}
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
              {p.price != null ? formatPrice(p.price) : ''}
            </span>

            {/* CTA */}
            {p.link ? (
              <a
                href={p.link}
                target="_blank"
                rel="noopener noreferrer"
                className="gradient-bg"
                style={{
                  padding: '8px 16px',
                  borderRadius: 980,
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#fff',
                  whiteSpace: 'nowrap',
                  transition: 'opacity 0.15s',
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                Ver oferta →
              </a>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Indisponível</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
