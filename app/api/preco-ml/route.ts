import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawUrl = request.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return NextResponse.json({ error: 'Parâmetro url obrigatório' }, { status: 400 });
  }

  // Limpa a URL — mantém só scheme + host + path
  let urlLimpa: string;
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.hostname.endsWith('mercadolivre.com.br')) {
      return NextResponse.json({ error: 'URL deve ser do mercadolivre.com.br' }, { status: 400 });
    }
    urlLimpa = `${parsed.origin}${parsed.pathname}`;
  } catch {
    return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
  }

  // Busca a página
  const resp = await fetch(urlLimpa, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    redirect: 'follow',
    next: { revalidate: 0 },
  });

  if (!resp.ok) {
    return NextResponse.json({ error: `Página retornou ${resp.status}` }, { status: resp.status });
  }

  const html = await resp.text();
  const debug = request.nextUrl.searchParams.get('debug') === '1';

  // --- Estratégia 1: JSON-LD ---
  const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
  for (const tag of ldBlocks) {
    try {
      const json = JSON.parse(tag.replace(/<script[^>]*>/, '').replace('</script>', ''));
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        const offers = node?.offers;
        if (!offers) continue;
        const price = offers.price ?? offers.lowPrice ?? null;
        if (price) return NextResponse.json({ price: Number(price), fonte: 'json-ld', url: urlLimpa });
      }
    } catch { /* segue */ }
  }

  // --- Estratégia 2: meta tag "product:price:amount" ---
  const metaMatch = html.match(/<meta property="product:price:amount" content="([\d.,]+)"/);
  if (metaMatch) {
    const price = Number(metaMatch[1].replace(',', '.'));
    if (price > 0) return NextResponse.json({ price, fonte: 'meta-tag', url: urlLimpa });
  }

  // --- Estratégia 3: "price" no __PRELOADED_STATE__ ou script inline ---
  const priceMatch = html.match(/"price"\s*:\s*([\d]+(?:\.\d{1,2})?)/);
  if (priceMatch) {
    const price = Number(priceMatch[1]);
    if (price > 0) return NextResponse.json({ price, fonte: 'inline-script', url: urlLimpa });
  }

  // Não encontrou — retorna debug se solicitado
  if (debug) {
    return NextResponse.json({
      error: 'Preço não encontrado',
      html_inicio: html.slice(0, 2000),
      ld_blocks_encontrados: ldBlocks.length,
    });
  }

  return NextResponse.json({ error: 'Preço não encontrado na página' }, { status: 404 });
}
