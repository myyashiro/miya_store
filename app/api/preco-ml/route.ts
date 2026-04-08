import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Busca um app token via client_credentials (não precisa de login do usuário)
async function getAppToken(): Promise<string> {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('ML_CLIENT_ID ou ML_CLIENT_SECRET não configurados no Vercel');
  }

  const resp = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Falha ao obter token ML: ${text}`);
  }

  const data = await resp.json();
  return data.access_token as string;
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
    const token = await getAppToken();

    const resp = await fetch(`https://api.mercadolibre.com/items/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 0 },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: `ML retornou ${resp.status}`, detail: text }, { status: resp.status });
    }

    const data = await resp.json();
    return NextResponse.json({ id, price: data.price ?? null });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
