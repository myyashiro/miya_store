import { createSign } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Carrega .env.local automaticamente quando rodando localmente
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const SHEET_ID = process.env.SHEET_ID ?? process.env.NEXT_PUBLIC_SHEET_ID;
const SHEET_NAME = 'PRODUTOS';

// --- Planilha ---

function colIndexToLetter(index) {
  let letter = '';
  let i = index + 1;
  while (i > 0) {
    const rem = (i - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    i = Math.floor((i - 1) / 26);
  }
  return letter;
}

async function getSheetRows() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const text = await fetch(url).then((r) => r.text());
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/);
  if (!match) return { rows: [], precoMlCol: 'H', precoMlAntCol: 'O' };

  const data = JSON.parse(match[1]);
  const cols = data.table.cols.map((c) => c.label.trim().toLowerCase());

  const precoMlColIdx = cols.indexOf('preco_ml');
  const precoMlAntColIdx = cols.indexOf('preco_ml_anterior');
  const precoMlCol = precoMlColIdx >= 0 ? colIndexToLetter(precoMlColIdx) : 'H';
  const precoMlAntCol = precoMlAntColIdx >= 0 ? colIndexToLetter(precoMlAntColIdx) : 'O';

  const rows = [];
  data.table.rows.forEach((row, gvizIndex) => {
    const cells = row.c || [];
    const get = (key) => {
      const i = cols.indexOf(key);
      return i >= 0 && cells[i] ? cells[i]?.v : undefined;
    };

    const link_ml_direto = get('link_ml_direto') ? String(get('link_ml_direto')) : undefined;
    if (!link_ml_direto) return;

    rows.push({
      rowNum: gvizIndex + 2,
      nome: String(get('nome') ?? ''),
      link_ml_direto,
      preco_ml: get('preco_ml') != null ? Number(get('preco_ml')) : undefined,
      preco_ml_anterior: get('preco_ml_anterior') != null ? Number(get('preco_ml_anterior')) : undefined,
    });
  });

  return { rows, precoMlCol, precoMlAntCol };
}

// --- Google Sheets API ---

async function getGoogleAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
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

  const json = await res.json();
  if (!json.access_token) throw new Error(`Token Google falhou: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function updateSheetPrices(accessToken, updates, precoMlCol, precoMlAntCol) {
  const data = [];
  for (const u of updates) {
    data.push({ range: `${SHEET_NAME}!${precoMlCol}${u.rowNum}`, values: [[u.precoNovo]] });
    data.push({ range: `${SHEET_NAME}!${precoMlAntCol}${u.rowNum}`, values: [[u.precoAnterior ?? '']] });
  }

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    }
  );

  if (!res.ok) throw new Error(`Sheets API error: ${await res.text()}`);
}

// --- Scraper ---

async function scrapePrice(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('mercadolivre.com.br')) return { price: null, debug: 'hostname inválido' };

    const cleanUrl = `${parsed.origin}${parsed.pathname}`;
    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      redirect: 'follow',
    });

    if (!res.ok) return { price: null, debug: `http ${res.status}` };
    const html = await res.text();

    const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    for (const tag of ldBlocks) {
      try {
        const json = JSON.parse(tag.replace(/<script[^>]*>/, '').replace('</script>', ''));
        const nodes = Array.isArray(json) ? json : [json];
        for (const node of nodes) {
          const price = node?.offers?.price ?? node?.offers?.lowPrice ?? null;
          if (price) return { price: Number(price), debug: 'json-ld' };
        }
      } catch { }
    }

    const metaMatch = html.match(/<meta property="product:price:amount" content="([\d.,]+)"/);
    if (metaMatch) {
      const price = Number(metaMatch[1].replace(',', '.'));
      if (price > 0) return { price, debug: 'meta-tag' };
    }

    const priceMatch = html.match(/"price"\s*:\s*([\d]+(?:\.\d{1,2})?)/);
    if (priceMatch) {
      const price = Number(priceMatch[1]);
      if (price > 0) return { price, debug: 'inline-script' };
    }

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const priceFromNext =
          nextData?.props?.pageProps?.initialState?.pdp?.product?.price ??
          nextData?.props?.pageProps?.price ??
          null;
        if (priceFromNext) return { price: Number(priceFromNext), debug: 'next-data' };
      } catch { }
    }

    return { price: null, debug: `html ok mas preço não encontrado (${html.length} bytes)` };
  } catch (e) {
    return { price: null, debug: `exceção: ${e.message}` };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Main ---

const { rows, precoMlCol, precoMlAntCol } = await getSheetRows();
console.log(`Produtos encontrados: ${rows.length}`);

const sheetUpdates = [];

for (const row of rows) {
  const { price, debug } = await scrapePrice(row.link_ml_direto);
  await sleep(1500);

  if (price === null) {
    console.log(`❌ ${row.nome} — ${debug}`);
    continue;
  }

  sheetUpdates.push({ rowNum: row.rowNum, precoNovo: price, precoAnterior: row.preco_ml });

  const precoAnterior = row.preco_ml;
  if (precoAnterior && price < precoAnterior) {
    const desconto = Math.round(((precoAnterior - price) / precoAnterior) * 100);
    console.log(`🔥 ${row.nome} — R$ ${precoAnterior} → R$ ${price} (-${desconto}%) [${debug}]`);
  } else {
    console.log(`✅ ${row.nome} — R$ ${price} (sem queda) [${debug}]`);
  }
}

if (sheetUpdates.length > 0) {
  console.log(`\nAtualizando ${sheetUpdates.length} produtos na planilha...`);
  const accessToken = await getGoogleAccessToken();
  await updateSheetPrices(accessToken, sheetUpdates, precoMlCol, precoMlAntCol);
  console.log('Planilha atualizada.');

  console.log('Revalidando site...');
  const revalidateSecret = process.env.REVALIDATE_SECRET ?? 'miya2025';
  const rv = await fetch(`https://miya-store.vercel.app/api/revalidate?secret=${revalidateSecret}`);
  if (rv.ok) {
    console.log('Site atualizado.');
  } else {
    console.log(`Revalidate falhou: ${rv.status}`);
  }
} else {
  console.log('\nNenhum preço obtido — planilha não foi atualizada.');
}
