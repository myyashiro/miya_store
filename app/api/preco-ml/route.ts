import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ML_DOMAIN = 'mercadolivre.com.br';

async function buscarPrecoML(url: string): Promise<number | null> {
  // Remove parâmetros de tracking, mantém só o path
  const urlLimpa = new URL(url);
  const urlFetch = `${urlLimpa.origin}${urlLimpa.pathname}`;

  const resp = await fetch(urlFetch, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    redirect: 'follow',
    next: { revalidate: 0 },
  });

  if (!resp.ok) return null;

  const html = await resp.text();

  // Tenta extrair preço dos blocos JSON-LD (Product schema)
  const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
  for (const tag of ldBlocks) {
    try {
      const json = JSON.parse(tag.replace(/<script[^>]*>/, '').replace('</script>', ''));
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        const offers = node?.offers;
        if (!offers) continue;
        const price = offers.price ?? offers.lowPrice ?? null;
        if (price) return Number(price);
      }
    } catch {
      // segue tentando outros blocos
    }
  }

  // Fallback: __PRELOADED_STATE__ ou qualquer "price": número no HTML
  const match = html.match(/"price"\s*:\s*([\d]+(?:\.\d+)?)/);
  if (match) return Number(match[1]);

  return null;
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawUrl = request.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return NextResponse.json({ error: 'Parâmetro url obrigatório' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
  }

  if (!parsed.hostname.endsWith(ML_DOMAIN)) {
    return NextResponse.json({ error: 'URL deve ser do mercadolivre.com.br' }, { status: 400 });
  }

  try {
    const price = await buscarPrecoML(rawUrl);

    if (!price) {
      return NextResponse.json({ error: 'Preço não encontrado na página' }, { status: 404 });
    }

    return NextResponse.json({ price });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
