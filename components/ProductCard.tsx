'use client';

import Link from 'next/link';
import { Product, getMinPrice, formatPrice } from '@/lib/sheets';

const PLATFORM: Record<string, string> = {
  amazon: 'Amazon',
  ml:     'Mercado Livre',
  shopee: 'Shopee',
};

function getBestPlatform(product: Product): string | null {
  const prices: { platform: string; price: number }[] = [];
  if (product.preco_amazon) prices.push({ platform: 'amazon', price: product.preco_amazon });
  if (product.preco_ml)     prices.push({ platform: 'ml',     price: product.preco_ml });
  if (product.preco_shopee) prices.push({ platform: 'shopee', price: product.preco_shopee });
  if (prices.length === 0) return null;
  return prices.sort((a, b) => a.price - b.price)[0].platform;
}

export default function ProductCard({ product }: { product: Product }) {
  const minPrice = getMinPrice(product);
  const bestPlatform = getBestPlatform(product);
  const platLabel = bestPlatform ? PLATFORM[bestPlatform] : null;

  return (
    <Link
      href={`/produto/${product.slug}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#ffffff',
        borderRadius: 18,
        overflow: 'hidden',
        textDecoration: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        transition: 'box-shadow 0.2s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.14)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)';
      }}
    >
      {/* Imagem */}
      <div style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden', backgroundColor: '#fff', padding: 24 }}>
        {product.imagem ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imagem}
            alt={product.nome}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d2d2d7' }}>
            <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}

        {product.destaque && (
          <span style={{
            position: 'absolute',
            top: 12,
            left: 12,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '3px 8px',
            borderRadius: 4,
            backgroundColor: 'var(--badge-new)',
            color: '#fff',
          }}>
            Destaque
          </span>
        )}
      </div>

      {/* Corpo */}
      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1, backgroundColor: '#ffffff', fontFamily: "'Red Hat Display', sans-serif" }}>
        {product.marca && (
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#696E71' }}>
            {product.marca}
          </p>
        )}

        <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3, color: '#1d1d1f', letterSpacing: '-0.01em' }}>
          {product.nome}
        </p>

        {minPrice != null ? (
          <div>
            <p style={{ fontSize: 11, color: '#696E71', marginBottom: 2 }}>A partir de</p>
            <p style={{ fontSize: 19, fontWeight: 700, color: '#1d1d1f', letterSpacing: '-0.02em' }}>
              {formatPrice(minPrice)}
            </p>
            {platLabel && (
              <p style={{ fontSize: 11, color: '#696E71', marginTop: 2 }}>em {platLabel}</p>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 14, color: '#696E71' }}>Ver preço</p>
        )}

        <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="gradient-bg" style={{
            display: 'inline-block',
            padding: '8px 18px',
            borderRadius: 980,
            fontSize: 13,
            fontWeight: 500,
            color: '#fff',
          }}>
            Comprar
          </span>
          <span className="gradient-text" style={{ fontSize: 13, fontWeight: 500 }}>
            Ver detalhes →
          </span>
        </div>
      </div>
    </Link>
  );
}
