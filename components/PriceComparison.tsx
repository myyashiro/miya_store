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

  const prices = platforms.filter((p) => p.price != null).map((p) => p.price!);
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;

  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <div style={{ padding: '12px 18px', backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Comparar preços
        </span>
      </div>

      {platforms.map((p, i) => {
        const isBest = p.price != null && p.price === minPrice;
        return (
          <div
            key={p.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '16px 18px',
              borderBottom: i < platforms.length - 1 ? '1px solid var(--border)' : 'none',
              backgroundColor: 'var(--bg)',
              gap: 12,
            }}
          >
            {/* Barra lateral */}
            <div style={{ width: 3, height: 32, borderRadius: 2, backgroundColor: 'var(--border-strong)', flexShrink: 0 }} />

            {/* Nome */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{p.name}</span>
              {isBest && (
                <span style={{
                  alignSelf: 'flex-start',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: '#fff',
                  background: 'linear-gradient(90deg, #004aad, #cb6ce6)',
                  padding: '4px 10px',
                  borderRadius: 4,
                }}>
                  Menor preço
                </span>
              )}
            </div>

            {/* Preço */}
            {p.price != null && (
              <span style={{
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--text)',
              }}>
                {formatPrice(p.price)}
              </span>
            )}

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
                  flexShrink: 0,
                  transition: 'opacity 0.15s',
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
