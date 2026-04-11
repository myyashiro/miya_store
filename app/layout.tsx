import type { Metadata } from 'next';
import './globals.css';
import { getCategories } from '@/lib/sheets';
import CategoryNav from '@/components/CategoryNav';

export const metadata: Metadata = {
  title: 'Miya — Compare e economize',
  description: 'Compare preços em Amazon, Mercado Livre e Shopee e encontre a melhor oferta.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const categories = await getCategories();

  return (
    <html lang="pt-BR">
      <body style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <header style={{
          backgroundColor: 'rgba(255,255,255,0.85)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          borderBottom: '1px solid rgba(0,0,0,0.1)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}>
          <div className="page-px" style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}>
            <a href="/" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/miyastore_logo.png" alt="Miya Store" className="header-logo" style={{ height: 52, width: 'auto' }} />
            </a>
            <CategoryNav categories={categories} />
          </div>
        </header>

        <main style={{ flex: 1 }}>{children}</main>

        <footer style={{
          backgroundColor: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          paddingTop: 32,
          paddingBottom: 32,
        }}>
          <div className="page-px">
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>
              © {new Date().getFullYear()} Miya
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.6, maxWidth: 560 }}>
              Este site contém links de afiliados. Ao comprar pelos nossos links, você apoia nossa curadoria sem pagar nada a mais por isso.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
