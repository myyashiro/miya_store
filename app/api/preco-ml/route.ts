import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function buscarPrecoML(itemId: string): Promise<number | null> {
  // Monta URL canônica do produto
  const url = `https://www.mercadolivre.com.br/_p/${itemId}`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
    redirect: 'follow',
    next: { revalidate: 0 },
  });

  if (!resp.ok) return null;

  const html = await resp.text();

  // Tenta extrair preço do JSON-LD (Product schema)
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  if (ldMatch) {
    for (const tag of ldMatch) {
      try {
        const json = JSON.parse(tag.replace(/<script[^>]*>/, '').replace('</script>', ''));
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          const price = item?.offers?.price ?? item?.offers?.lowPrice ?? null;
          if (price) return Number(price);
        }
      } catch {
        // continua tentando os outros blocos
      }
    }
  }

  // Fallback: extrai do __PRELOADED_STATE__ ou variável de preço inline
  const priceMatch = html.match(/"price"\s*:\s*([\d.]+)/);
  if (priceMatch) return Number(priceMatch[1]);

  return null;
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^MLB\d+$/.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  try {
    const price = await buscarPrecoML(id);

    if (!price) {
      return NextResponse.json({ error: 'Preço não encontrado na página' }, { status: 404 });
    }

    return NextResponse.json({ id, price });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
