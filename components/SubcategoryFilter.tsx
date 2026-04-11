'use client';

import { useState } from 'react';
import ProductCard from '@/components/ProductCard';
import { Product } from '@/lib/sheets';

export default function SubcategoryFilter({
  products,
  subcategories,
}: {
  products: Product[];
  subcategories: string[];
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = selected
    ? products.filter((p) => p.subcategoria === selected)
    : products;

  return (
    <>
      {/* Filtros */}
      {subcategories.length > 0 && (
        <div className="page-px" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            onClick={() => setSelected(null)}
            style={{
              padding: '6px 16px',
              borderRadius: 980,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
              background: selected === null ? 'linear-gradient(90deg, #004aad, #cb6ce6)' : '#fff',
              color: selected === null ? '#fff' : '#6e6e73',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              transition: 'all 0.15s',
            }}
          >
            Todos
          </button>
          {subcategories.map((sub) => (
            <button
              key={sub}
              onClick={() => setSelected(sub)}
              style={{
                padding: '6px 16px',
                borderRadius: 980,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                border: 'none',
                background: selected === sub ? 'linear-gradient(90deg, #004aad, #cb6ce6)' : '#fff',
                color: selected === sub ? '#fff' : '#6e6e73',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                transition: 'all 0.15s',
              }}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      {/* Produtos — grid com quebra de linha */}
      <div className="product-grid page-px">
        {filtered.map((p) => (
          <ProductCard key={p.slug} product={p} />
        ))}
      </div>
    </>
  );
}
