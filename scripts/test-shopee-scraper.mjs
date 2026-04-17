/**
 * Script de teste do scraper Shopee.
 * Uso: node scripts/test-shopee-scraper.mjs <url_shopee>
 * Ex:  node scripts/test-shopee-scraper.mjs "https://shopee.com.br/product/123456/789012"
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const url = process.argv[2];

if (!url) {
  console.error('Uso: node scripts/test-shopee-scraper.mjs <url_shopee>');
  process.exit(1);
}

// ---- Extrair IDs da URL ----
// Formato padrão: ...produto-i.SHOPID.ITEMID  (no pathname ou após redirect)
function extrairIds(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    // Formato 1: /product/SHOPID/ITEMID
    const product = parsed.pathname.match(/\/product\/(\d+)\/(\d+)/);
    if (product) return { shopid: product[1], itemid: product[2] };
    // Formato 2: nome-produto-i.SHOPID.ITEMID
    const slug = parsed.pathname.match(/[.-]i\.(\d+)\.(\d+)/);
    if (slug) return { shopid: slug[1], itemid: slug[2] };
  } catch { }
  return null;
}

// ---- Headers que imitam browser ----
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Referer': 'https://shopee.com.br/',
  'x-api-source': 'pc',
  'x-requested-with': 'XMLHttpRequest',
};

// ---- Estratégia 1: API interna Shopee (/api/v4/item/get) ----
async function estrategia_api_v4(shopid, itemid) {
  const apiUrl = `https://shopee.com.br/api/v4/item/get?itemid=${itemid}&shopid=${shopid}`;
  console.log(`\n[Estratégia 1] API v4: ${apiUrl}`);

  const res = await fetch(apiUrl, { headers: HEADERS });
  console.log(`  Status HTTP: ${res.status}`);
  if (!res.ok) return { price: null, debug: `http ${res.status}` };

  const json = await res.json();
  const item = json?.data?.item ?? json?.item;
  if (!item) {
    console.log(`  Resposta sem item. Chaves: ${Object.keys(json ?? {}).join(', ')}`);
    return { price: null, debug: 'sem item na resposta' };
  }

  // Preço vem em centavos (ou preço * 100000 dependendo da versão)
  const raw = item.price_min ?? item.price ?? item.min_price;
  if (raw == null) {
    console.log(`  Sem campo de preço. Chaves item: ${Object.keys(item).join(', ')}`);
    return { price: null, debug: 'campo de preço ausente' };
  }

  // Shopee armazena preço como inteiro onde 100000 = R$ 1,00
  const price = raw / 100000;
  return { price, debug: 'api-v4' };
}

// ---- Estratégia 2: API interna v2 (/api/v2/item/get) ----
async function estrategia_api_v2(shopid, itemid) {
  const apiUrl = `https://shopee.com.br/api/v2/item/get?itemid=${itemid}&shopid=${shopid}`;
  console.log(`\n[Estratégia 2] API v2: ${apiUrl}`);

  const res = await fetch(apiUrl, { headers: HEADERS });
  console.log(`  Status HTTP: ${res.status}`);
  if (!res.ok) return { price: null, debug: `http ${res.status}` };

  const json = await res.json();
  const item = json?.item;
  if (!item) return { price: null, debug: 'sem item' };

  const raw = item.price_min ?? item.price;
  if (raw == null) return { price: null, debug: 'sem preço' };

  const price = raw / 100000;
  return { price, debug: 'api-v2' };
}

// ---- Estratégia 3: HTML com JSON embutido ----
async function estrategia_html(rawUrl) {
  console.log(`\n[Estratégia 3] HTML direto: ${rawUrl}`);

  const res = await fetch(rawUrl, {
    headers: {
      ...HEADERS,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  console.log(`  Status HTTP: ${res.status} | URL final: ${res.url}`);
  if (!res.ok) return { price: null, debug: `http ${res.status}` };

  const html = await res.text();
  console.log(`  HTML recebido: ${html.length} bytes`);

  // Tenta JSON-LD
  const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
  for (const tag of ldBlocks) {
    try {
      const json = JSON.parse(tag.replace(/<script[^>]*>/, '').replace('</script>', ''));
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        const p = node?.offers?.lowPrice ?? node?.offers?.price ?? null;
        if (p && Number(p) > 0) return { price: Number(p), debug: 'json-ld' };
      }
    } catch { }
  }

  // Tenta __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const p = data?.props?.pageProps?.initialState?.pdp?.product?.price ?? null;
      if (p) return { price: Number(p), debug: 'next-data' };
    } catch { }
  }

  // Tenta "price" genérico no HTML
  const priceMatch = html.match(/"price"\s*:\s*([\d]+(?:\.\d{1,2})?)/);
  if (priceMatch) {
    const p = Number(priceMatch[1]);
    if (p > 0) return { price: p, debug: 'inline-script' };
  }

  // Trecho do HTML para debug (primeiros 2000 chars)
  console.log(`\n  --- Trecho do HTML (primeiros 2000 chars) ---`);
  console.log(html.slice(0, 2000));
  console.log(`  ---`);

  return { price: null, debug: 'html ok mas preço não encontrado' };
}

// ---- Estratégia 4: Puppeteer Stealth (evade bot detection) ----
async function estrategia_puppeteer(rawUrl, ids) {
  console.log(`\n[Estratégia 4] Puppeteer Stealth`);
  const puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteerExtra.use(StealthPlugin());

  const browser = await puppeteerExtra.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    let interceptedPrice = null;

    // Intercepta a resposta da API item/get que o próprio frontend dispara
    page.on('response', async (res) => {
      const u = res.url();
      if (u.includes('/api/v4/item/get') || u.includes('/api/v2/item/get')) {
        console.log(`  Interceptou API: ${u} (${res.status()})`);
        try {
          const json = await res.json();
          const item = json?.data?.item ?? json?.item;
          const raw = item?.price_min ?? item?.price ?? item?.min_price;
          if (raw != null) interceptedPrice = raw / 100000;
        } catch { }
      }
    });

    // Visita a home primeiro para obter cookies de sessão
    console.log(`  Visitando home para obter cookies...`);
    await page.goto('https://shopee.com.br', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 3000));

    console.log(`  Abrindo página do produto...`);
    await page.goto(rawUrl, { waitUntil: 'networkidle2', timeout: 40000 });
    await new Promise(r => setTimeout(r, 5000)); // aguarda JS carregar preço

    // Se interceptou pela API, usa esse valor
    if (interceptedPrice) {
      return { price: interceptedPrice, debug: 'puppeteer-api-intercept' };
    }

    // Tenta extrair do DOM renderizado
    const price = await page.evaluate(() => {
      // Tenta seletor do preço principal
      const selectors = [
        '[class*="price"] [class*="current"]',
        '[class*="pdp-price"]',
        '[class*="product-price"]',
        '[data-testid*="price"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent.replace(/[^\d,]/g, '').replace(',', '.');
          const p = Number(text);
          if (p > 0) return p;
        }
      }
      // Tenta qualquer texto "R$ X" na página
      const match = document.body.innerText.match(/R\$\s*([\d.]+,\d{2})/);
      if (match) {
        const p = Number(match[1].replace(/\./g, '').replace(',', '.'));
        if (p > 0) return p;
      }
      return null;
    });

    if (price) return { price, debug: 'puppeteer-dom' };

    // Dump parcial do HTML renderizado para debug
    const html = await page.content();
    console.log(`  HTML renderizado: ${html.length} bytes`);

    // Debug: mostra título da página e trecho do body
    const title = await page.title();
    console.log(`  Título: ${title}`);
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? '');
    console.log(`  Body text (500 chars):\n${bodyText}`);

    const priceMatch = html.match(/R\$\s*([\d.]+,\d{2})/);
    if (priceMatch) {
      const p = Number(priceMatch[1].replace(/\./g, '').replace(',', '.'));
      if (p > 0) return { price: p, debug: 'puppeteer-html-regex' };
    }

    return { price: null, debug: 'puppeteer: sem preço no DOM' };
  } finally {
    await browser.close();
  }
}

// ---- Main ----
async function main() {
  console.log(`\nURL fornecida: ${url}`);

  const ids = extrairIds(url);
  console.log(ids
    ? `IDs extraídos → shopid: ${ids.shopid}, itemid: ${ids.itemid}`
    : 'Não foi possível extrair shopid/itemid da URL.'
  );

  let resultado = { price: null, debug: 'nenhuma estratégia funcionou' };

  if (ids) {
    resultado = await estrategia_api_v4(ids.shopid, ids.itemid);
    if (!resultado.price) resultado = await estrategia_api_v2(ids.shopid, ids.itemid);
  }

  if (!resultado.price) resultado = await estrategia_html(url);
  if (!resultado.price) resultado = await estrategia_puppeteer(url, ids);

  console.log(`\n========================================`);
  if (resultado.price) {
    console.log(`✅ Preço encontrado: R$ ${resultado.price.toFixed(2)} (via ${resultado.debug})`);
  } else {
    console.log(`❌ Preço NÃO encontrado. Debug: ${resultado.debug}`);
  }
  console.log(`========================================\n`);
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
