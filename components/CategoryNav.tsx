'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function CategoryNav({ categories }: { categories: string[] }) {
  const pathname = usePathname();
  if (categories.length === 0) return null;

  return (
    <nav style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
      {categories.map((cat) => {
        const slug = cat.toLowerCase();
        const isActive = pathname === `/${slug}`;
        return (
          <Link
            key={cat}
            href={`/${slug}`}
            style={{
              padding: '4px 14px',
              fontFamily: "'Red Hat Display', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              whiteSpace: 'nowrap',
              color: isActive ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: isActive ? '2px solid var(--text)' : '2px solid transparent',
              transition: 'color 0.15s',
            }}
          >
            {cat}
          </Link>
        );
      })}
    </nav>
  );
}
