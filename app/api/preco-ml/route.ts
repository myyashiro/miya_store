import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^MLB\d+$/.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  const resp = await fetch(`https://api.mercadolibre.com/items/${id}`, {
    next: { revalidate: 0 },
  });

  if (!resp.ok) {
    return NextResponse.json({ error: `ML retornou ${resp.status}` }, { status: resp.status });
  }

  const data = await resp.json();
  return NextResponse.json({ id, price: data.price ?? null });
}
