import { NextRequest, NextResponse } from 'next/server';
import { createSign } from 'crypto';
import { sendTextToGroup, sendImageToGroup } from '@/lib/zapi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SHEET_ID = process.env.NEXT_PUBLIC_SHEET_ID!;
const GROUP_ID = process.env.ZAPI_GROUP_ID!;
const MONITOR_SECRET = process.env.MONITOR_SECRET!;
const SHEET_NAME = 'PRODUTOS';

interface SheetRow {
  rowNum: number;
  nome: string;
  link_ml?: string;
  link_ml_direto?: string;
  imagem?: string;
  preco_ml?: number;
  preco_ml_anterior?: number;
}

function colIndexToLetter(index: number): string {
  let letter = '';
  let i = index + 1;
  while (i > 0) {
    const rem = (i - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    i = Math.floor((i - 1) / 26);
  }
  return letter;
}

async function getSheetRows(): Promise<{
  rows: SheetRow[];
  precoMlCol: string;
  precoMlAntCol: string;
}> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const text = await fetch(url, { cache: 'no-store' }).then((r) => r.text());
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/);
  if (!match) return { rows: [], precoMlCol: 'H', precoMlAntCol: 'O' };

  const data = JSON.parse(match[1]);
  const cols: string[] = data.table.cols.map((c: { label: string }) => c.label.trim().toLowerCase());

  const precoMlColIdx = cols.indexOf('preco_ml');
  const precoMlAntColIdx = cols.indexOf('preco_ml_anterior');
  const precoMlCol = precoMlColIdx >= 0 ? colIndexToLetter(precoMlColIdx) : 'H';
  const precoMlAntCol = precoMlAntColIdx >= 0 ? colIndexToLetter(precoMlAntColIdx) : 'O';

  const rawRows = data.table.rows;
  const rows: SheetRow[] = [];

  rawRows.forEach((row: { c: ({ v: unknown } | null)[] }, gvizIndex: number) => {
    const cells = row.c || [];
    const get = (key: string) => {
      const i = cols.indexOf(key);
      return i >= 0 && cells[i] ? cells[i]?.v : undefined;
    };

    const link_ml_direto = get('link_ml_direto') ? String(get('link_ml_direto')) : undefined;
    if (!link_ml_direto) return;

    rows.push({
      rowNum: gvizIndex + 2, // +1 para header, +1 para 1-indexed
      nome: String(get('nome') ?? ''),
      link_ml: get('link_ml') ? String(get('link_ml')) : undefined,
      link_ml_direto,
      imagem: get('imagem') ? String(get('imagem')) : undefined,
      preco_ml: get('preco_ml') != null ? Number(get('preco_ml')) : undefined,
      preco_ml_anterior: get('preco_ml_anterior') != null ? Number(get('preco_ml_anterior')) : undefined,
    });
  });

  return { rows, precoMlCol, precoMlAntCol };
}

async function getGoogleAccessToken(): Promise<string> {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(creds.private_key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${payload}.${sig}`,
    }),
  });

  const json = await res.json() as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`Falha ao obter token Google: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function updateSheetPrices(
  accessToken: string,
  updates: Array<{ rowNum: number; precoNovo: number; precoAnterior: number | undefined }>,
  precoMlCol: string,
  precoMlAntCol: string,
) {
  const data: { range: string; values: unknown[][] }[] = [];

  for (const u of updates) {
    data.push({
      range: `${SHEET_NAME}!${precoMlCol}${u.rowNum}`,
      values: [[u.precoNovo]],
    });
    data.push({
      range: `${SHEET_NAME}!${precoMlAntCol}${u.rowNum}`,
      values: [[u.precoAnterior ?? '']],
    });
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API error: ${err}`);
  }
}

function extractMlbId(url: string): string | null {
  const match = url.match(/MLB-?(\d+)/i);
  return match ? `MLB${match[1]}` : null;
}

async function scrapePrice(url: string): Promise<number | null> {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('mercadolivre.com.br')) return null;

    // Estratégia 1: API oficial do ML (não bloqueia IP de data center)
    const mlbId = extractMlbId(parsed.pathname);
    if (mlbId) {
      const apiRes = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, {
        cache: 'no-store',
      });
      if (apiRes.ok) {
        const data = await apiRes.json() as { price?: number };
        if (data.price && data.price > 0) return data.price;
      }
    }

    // Estratégia 2: scraping HTML (fallback)
    const cleanUrl = `${parsed.origin}${parsed.pathname}`;
    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const html = await res.text();

    const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    for (const tag of ldBlocks) {
      try {
        const json = JSON.parse(tag.replace(/<script[^>]*>/, '').replace('</script>', ''));
        const nodes = Array.isArray(json) ? json : [json];
        for (const node of nodes) {
          const price = node?.offers?.price ?? node?.offers?.lowPrice ?? null;
          if (price) return Number(price);
        }
      } catch { /* continua */ }
    }

    const metaMatch = html.match(/<meta property="product:price:amount" content="([\d.,]+)"/);
    if (metaMatch) {
      const price = Number(metaMatch[1].replace(',', '.'));
      if (price > 0) return price;
    }

    const priceMatch = html.match(/"price"\s*:\s*([\d]+(?:\.\d{1,2})?)/);
    if (priceMatch) {
      const price = Number(priceMatch[1]);
      if (price > 0) return price;
    }

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const priceFromNext =
          nextData?.props?.pageProps?.initialState?.pdp?.product?.price ??
          nextData?.props?.pageProps?.price ??
          null;
        if (priceFromNext) return Number(priceFromNext);
      } catch { /* continua */ }
    }

    return null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPrice(price: number): string {
  return price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== MONITOR_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { rows, precoMlCol, precoMlAntCol } = await getSheetRows();

  const results: { nome: string; status: string; preco?: number }[] = [];
  const sheetUpdates: Array<{ rowNum: number; precoNovo: number; precoAnterior: number | undefined }> = [];
  let totalAlertas = 0;

  for (const row of rows) {
    const preco = await scrapePrice(row.link_ml_direto!);
    await sleep(1500);

    if (preco === null) {
      results.push({ nome: row.nome, status: 'erro ao buscar preço' });
      continue;
    }

    // Registra para atualizar a planilha
    sheetUpdates.push({
      rowNum: row.rowNum,
      precoNovo: preco,
      precoAnterior: row.preco_ml, // preco atual vira o anterior
    });

    const precoAnterior = row.preco_ml_anterior ?? row.preco_ml;

    if (precoAnterior && preco < precoAnterior) {
      const desconto = Math.round(((precoAnterior - preco) / precoAnterior) * 100);
      const linkAlerta = row.link_ml ?? row.link_ml_direto ?? '';
      const caption =
        `🔥 *${row.nome}* — Queda de preço!\n\n` +
        `🛍️ Mercado Livre: ${formatPrice(precoAnterior)} → ${formatPrice(preco)} (-${desconto}%)\n\n` +
        `${linkAlerta}`;

      if (row.imagem) {
        await sendImageToGroup(GROUP_ID, row.imagem, caption);
      } else {
        await sendTextToGroup(GROUP_ID, caption);
      }

      totalAlertas++;
      results.push({ nome: row.nome, status: 'alerta enviado', preco });
    } else {
      results.push({ nome: row.nome, status: 'sem queda', preco });
    }
  }

  // Atualiza planilha com os preços novos
  let sheetStatus = 'ok';
  if (sheetUpdates.length > 0) {
    try {
      const accessToken = await getGoogleAccessToken();
      await updateSheetPrices(accessToken, sheetUpdates, precoMlCol, precoMlAntCol);
    } catch (err) {
      sheetStatus = `erro ao atualizar planilha: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({
    total: rows.length,
    alertas: totalAlertas,
    sheetUpdates: sheetUpdates.length,
    sheetStatus,
    results,
  });
}
