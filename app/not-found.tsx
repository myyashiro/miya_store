import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <h1 className="text-6xl font-light mb-4" style={{ fontFamily: 'Cormorant Garamond, serif', color: 'var(--warm-dark)' }}>404</h1>
      <p className="text-base mb-8" style={{ color: 'var(--muted)' }}>Página não encontrada.</p>
      <Link href="/" className="text-sm font-semibold uppercase tracking-widest px-6 py-3 rounded-lg" style={{ backgroundColor: 'var(--gold)', color: 'var(--cream)' }}>
        Voltar para o início
      </Link>
    </div>
  );
}
