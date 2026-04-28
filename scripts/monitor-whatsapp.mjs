import { createSign, createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// Carrega .env.local automaticamente
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

const require = createRequire(import.meta.url);
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode                              = require('qrcode');
const puppeteerExtra                      = require('puppeteer-extra');
const StealthPlugin                       = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const SHEET_ID      = process.env.SHEET_ID ?? process.env.NEXT_PUBLIC_SHEET_ID;
const SHOPEE_APP_ID = process.env.SHOPEE_AFFILIATE_APP_ID;
const SHOPEE_SECRET = process.env.SHOPEE_AFFILIATE_SECRET;
const SHEET_NAME    = 'PRODUTOS';

// Mapeamento dinâmico: lê todas as vars WHATSAPP_GRUPO_* do .env.local
// Chave = sufixo em minúsculo com underscore → espaço (ex: MIYA_STORE → "miya store")
// Lookup é case-insensitive: "Miya Store", "miya store" e "MIYA STORE" funcionam igual
const GRUPO_MAP = Object.fromEntries(
  Object.entries(process.env)
    .filter(([k]) => k.startsWith('WHATSAPP_GRUPO_') && k !== 'WHATSAPP_GRUPO_ID')
    .map(([k, v]) => [k.replace('WHATSAPP_GRUPO_', '').toLowerCase().replace(/_/g, ' '), v])
);

// Fallback legado: WHATSAPP_GRUPO_ID ou número individual
const WHATSAPP_GRUPO_ID = process.env.WHATSAPP_GRUPO_ID;
const WHATSAPP_DESTINO  = process.env.WHATSAPP_DESTINO;
const CHAT_ID_FALLBACK  = WHATSAPP_GRUPO_ID ?? (WHATSAPP_DESTINO ? `${WHATSAPP_DESTINO}@c.us` : null);

const LISTAR_GRUPOS = process.argv.includes('--listar-grupos');

// --- Histórico SQLite (sql.js — puro JS, sem compilação nativa) ---
const initSqlJs = require('sql.js');
const SQL = await initSqlJs();
const dbPath = resolve(__dirname, '../historico.db');
const db = existsSync(dbPath)
  ? new SQL.Database(readFileSync(dbPath))
  : new SQL.Database();
db.run(`
  CREATE TABLE IF NOT EXISTS historico (
    timestamp    TEXT NOT NULL,
    nome         TEXT NOT NULL,
    preco_ml     REAL,
    preco_amazon REAL,
    preco_shopee REAL
  )
`);

function getMinimosHistorico(nome, diasAtras) {
  const cutoff = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000).toISOString();
  const stmt = db.prepare(
    `SELECT MIN(preco_ml) AS min_ml, MIN(preco_amazon) AS min_amazon, MIN(preco_shopee) AS min_shopee
     FROM historico WHERE nome = ? AND timestamp >= ?`
  );
  stmt.bind([nome, cutoff]);
  const found = stmt.step();
  const r = found ? stmt.getAsObject() : {};
  stmt.free();
  return {
    min_ml:     r.min_ml     ?? null,
    min_amazon: r.min_amazon ?? null,
    min_shopee: r.min_shopee ?? null,
  };
}

const getMinimoPrecosUltimas24h  = (nome) => getMinimosHistorico(nome, 1);
const getMinimoPrecosUltimos15d  = (nome) => getMinimosHistorico(nome, 15);

function salvarHistorico(registros) {
  const stmt = db.prepare(
    'INSERT INTO historico (timestamp, nome, preco_ml, preco_amazon, preco_shopee) VALUES (?, ?, ?, ?, ?)'
  );
  for (const r of registros) {
    stmt.run([r.timestamp, r.nome, r.preco_ml ?? null, r.preco_amazon ?? null, r.preco_shopee ?? null]);
  }
  stmt.free();
  writeFileSync(dbPath, db.export());
}

// Horários fixos de checagem (horas inteiras)
const HORARIOS_CHECAGEM = [8, 10, 12, 14, 16, 18, 20];

function proximoHorario() {
  const agora = new Date();
  const horaAtual = agora.getHours();
  const proximo = HORARIOS_CHECAGEM.find(h => h > horaAtual);
  const alvo = new Date(agora);
  if (proximo !== undefined) {
    alvo.setHours(proximo, 0, 0, 0);
  } else {
    alvo.setDate(alvo.getDate() + 1);
    alvo.setHours(HORARIOS_CHECAGEM[0], 0, 0, 0);
  }
  return alvo;
}

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

  const findCol = (name) => {
    const idx = cols.indexOf(name);
    return idx >= 0 ? colIndexToLetter(idx) : null;
  };

  const precoMlCol        = findCol('preco_ml')              ?? 'H';
  const precoMlAntCol     = findCol('preco_ml_anterior')     ?? 'O';
  const precoAmazonCol    = findCol('preco_amazon');
  const precoAmazonAntCol = findCol('preco_amazon_anterior');
  const precoShopeeCol    = findCol('preco_shopee');
  const precoShopeeAntCol = findCol('preco_shopee_anterior');
  const alertaEnviadoEmCol = findCol('alerta_enviado_em');
  const statusMlCol       = findCol('status_ml');
  const statusAmazonCol   = findCol('status_amazon');
  const statusShopeeCol   = findCol('status_shopee');
  const linkShopeeCol     = findCol('link_shopee');
  const rows = [];
  data.table.rows.forEach((row, gvizIndex) => {
    const cells = row.c || [];
    const get = (key) => {
      const i = cols.indexOf(key);
      return i >= 0 && cells[i] ? cells[i]?.v : undefined;
    };

    const link_ml_direto     = get('link_ml_direto')     ? String(get('link_ml_direto'))     : undefined;
    const link_amazon_check  = get('link_amazon')        ? String(get('link_amazon'))        : undefined;
    const link_shopee_direto = get('link_shopee_direto') ? String(get('link_shopee_direto')) : undefined;
    if (!link_ml_direto && !link_amazon_check && !link_shopee_direto) return;

    rows.push({
      rowNum: gvizIndex + 2,
      nome:   String(get('nome') ?? ''),
      link_ml_direto,
      link_ml:               get('link_ml')    ? String(get('link_ml'))    : undefined,
      imagem:                get('imagem')      ? String(get('imagem'))      : undefined,
      preco_ml:     get('preco_ml')     != null ? Number(get('preco_ml'))     : undefined,
      preco_amazon: get('preco_amazon') != null ? Number(get('preco_amazon')) : undefined,
      link_amazon:  get('link_amazon')  ? String(get('link_amazon'))          : undefined,
      link_shopee_direto,
      preco_shopee: get('preco_shopee') != null ? Number(get('preco_shopee')) : undefined,
      link_shopee:           get('link_shopee')           ? String(get('link_shopee'))  : undefined,
      alerta_enviado_em:     get('alerta_enviado_em')     ? String(get('alerta_enviado_em')) : undefined,
      miya_group:            get('miya_group')            ? String(get('miya_group')).toLowerCase().trim() : undefined,
    });
  });

  return {
    rows,
    precoMlCol, precoMlAntCol,
    precoAmazonCol, precoAmazonAntCol,
    precoShopeeCol, precoShopeeAntCol,
    alertaEnviadoEmCol,
    statusMlCol, statusAmazonCol, statusShopeeCol,
    linkShopeeCol,
  };
}

// --- Google Sheets API ---

async function getGoogleAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
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

async function batchUpdateSheet(accessToken, data) {
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

async function updateSheetPrices(accessToken, updates, colMap) {
  const data = [];
  const push = (col, rowNum, value) => {
    if (col) data.push({ range: `${SHEET_NAME}!${col}${rowNum}`, values: [[value]] });
  };
  for (const u of updates) {
    if (u.tipo === 'ml') {
      push(colMap.precoMlCol,    u.rowNum, u.precoNovo);
      push(colMap.precoMlAntCol, u.rowNum, u.precoAnterior ?? '');
    } else if (u.tipo === 'amazon') {
      push(colMap.precoAmazonCol,    u.rowNum, u.precoNovo);
      push(colMap.precoAmazonAntCol, u.rowNum, u.precoAnterior ?? '');
    } else if (u.tipo === 'shopee') {
      push(colMap.precoShopeeCol,    u.rowNum, u.precoNovo);
      push(colMap.precoShopeeAntCol, u.rowNum, u.precoAnterior ?? '');
    } else if (u.tipo === 'link_shopee') {
      push(colMap.linkShopeeCol, u.rowNum, u.valor);
    }
  }
  if (data.length > 0) await batchUpdateSheet(accessToken, data);
}

async function updateAlertaEnviadoEm(accessToken, rowNums, alertaEnviadoEmCol) {
  if (!alertaEnviadoEmCol) return;
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const data = rowNums.map((rowNum) => ({
    range: `${SHEET_NAME}!${alertaEnviadoEmCol}${rowNum}`,
    values: [[`'${agora}`]], // apóstrofo força texto puro no Sheets
  }));
  await batchUpdateSheet(accessToken, data);
}

// --- Scraper ---

function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

let _mlBrowser = null;
async function getMLBrowser() {
  if (!_mlBrowser) {
    _mlBrowser = await puppeteerExtra.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    _mlBrowser.on('disconnected', () => { _mlBrowser = null; });
  }
  return _mlBrowser;
}
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(sig, () => { _mlBrowser?.close(); });
}

async function scrapePrice(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('mercadolivre.com.br')) return { price: null, debug: 'hostname inválido', cupom: null };

    // Preserva item_id de pdp_filters para URLs de família de produto (/p/)
    const pdpFilters = parsed.searchParams.get('pdp_filters') ?? '';
    const itemIdMatch = pdpFilters.match(/item_id%3A([A-Z0-9]+)/i) ?? pdpFilters.match(/item_id:([A-Z0-9]+)/i);
    const cleanUrl = itemIdMatch
      ? `${parsed.origin}${parsed.pathname}?pdp_filters=item_id%3A${itemIdMatch[1]}`
      : `${parsed.origin}${parsed.pathname}`;

    const browser = await getMLBrowser();
    const page = await browser.newPage();
    let html;
    let ldJsonTexts = [];
    let domPrice = null;
    let isUnavailableDom = false;
    try {
      await page.goto(cleanUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      // Extrai ld+json e preço do DOM antes de serializar (evita problema com nonce="" no regex)
      ({ ldJsonTexts, domPrice, isUnavailableDom } = await page.evaluate(() => {
        const ldJsonTexts = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent);
        const frac = document.querySelector('.andes-money-amount__fraction');
        const cents = document.querySelector('.andes-money-amount__cents');
        let domPrice = null;
        if (frac) {
          const fracVal = parseInt(frac.textContent.replace(/\D/g, ''), 10);
          const centsVal = cents ? parseInt(cents.textContent.replace(/\D/g, ''), 10) : 0;
          domPrice = fracVal + centsVal / 100;
        }
        const buyboxText = (document.querySelector('.ui-pdp-buybox, [data-testid="buybox"]')?.innerText ?? '').toLowerCase();
        const isUnavailableDom =
          !!document.querySelector('[data-testid="buybox-unavailable"]') ||
          !!document.querySelector('.ui-pdp-buybox__quantity--unavailable') ||
          !!document.querySelector('.ui-pdp-error') ||
          buyboxText.includes('indisponível') ||
          buyboxText.includes('não disponível');
        return { ldJsonTexts, domPrice, isUnavailableDom };
      }));
      html = await page.content();
    } finally {
      await page.close();
    }

    // --- Disponibilidade ---
    const isUnavailableJsonLd = ldJsonTexts.some(text => {
      try {
        const json = JSON.parse(text);
        const nodes = Array.isArray(json) ? json : [json];
        return nodes.some(n => {
          const avail = String(n?.offers?.availability ?? '');
          return avail.includes('OutOfStock') || avail.includes('Discontinued') || avail.includes('SoldOut');
        });
      } catch { return false; }
    });
    if (isUnavailableJsonLd || isUnavailableDom) {
      return { price: null, debug: 'produto indisponível', cupom: null };
    }

    // --- Preço ---
    let price = null;
    let debug = `html ok mas preço não encontrado (${html.length} bytes)`;

    // ld+json via DOM (mais confiável que regex no HTML serializado)
    outer: for (const text of ldJsonTexts) {
      try {
        const json = JSON.parse(text);
        const nodes = Array.isArray(json) ? json : [json];
        for (const node of nodes) {
          const p = node?.offers?.lowPrice ?? node?.offers?.price ?? null;
          if (p) { price = Number(p); debug = 'json-ld'; break outer; }
        }
      } catch { }
    }

    if (!price) {
      const metaMatch = html.match(/<meta property="product:price:amount" content="([\d.,]+)"/);
      if (metaMatch) { const p = Number(metaMatch[1].replace(',', '.')); if (p > 0) { price = p; debug = 'meta-tag'; } }
    }
    if (!price) {
      const m = html.match(/"offers"\s*:\s*\{"price"\s*:\s*([\d]+(?:\.\d{1,2})?)/);
      if (m) { const p = Number(m[1]); if (p > 0) { price = p; debug = 'inline-script-offers'; } }
    }
    if (!price) {
      const m = html.match(/"price"\s*:\s*([\d]+(?:\.\d{1,2})?)/);
      if (m) { const p = Number(m[1]); if (p > 0) { price = p; debug = 'inline-script'; } }
    }
    if (!price) {
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          const p = nextData?.props?.pageProps?.initialState?.pdp?.product?.price ?? nextData?.props?.pageProps?.price ?? null;
          if (p) { price = Number(p); debug = 'next-data'; }
        } catch { }
      }
    }

    // Tenta "Melhor preço" (BEST_PRICE / CHEAPER) — substitui se for mais barato
    {
      const m = html.match(/"buying_option_id"\s*:\s*"BEST_PRICE"[^}]{0,200}"price"\s*:\s*(\d+)/)
             ?? html.match(/"g_option_id"\s*:\s*"CHEAPER"[^}]{0,200}"price"\s*:\s*(\d+)/);
      if (m) {
        const p = Number(m[1]);
        if (p > 0 && (!price || p < price)) { price = p; debug = 'melhor-preco'; }
      }
    }

    // Fallback: preço visível no DOM (quando todos os patterns de script falham)
    if (!price && domPrice && domPrice > 0) { price = domPrice; debug = 'dom'; }

    // --- Cupom ML ---
    let cupom = null;
    const mlCouponPctJson = html.match(/"coupon_discount"\s*:\s*([\d.]+)/);
    if (mlCouponPctJson) { const pct = Number(mlCouponPctJson[1]); if (pct > 0) cupom = { pct, tipo: 'pct' }; }

    if (!cupom) {
      const polySection = html.match(/poly-coupon[\s\S]{0,600}/i);
      if (polySection) { const m = polySection[0].match(/(\d+)\s*%/); if (m) cupom = { pct: Number(m[1]), tipo: 'pct' }; }
    }
    if (!cupom) {
      const mPct = html.match(/ui-vpp-coupons-awareness[\s\S]{0,600}?(\d+)\s*%\s*OFF/)
                ?? html.match(/cup[oô]m\s+de\s+(\d+)\s*%/i)
                ?? html.match(/(\d+)\s*%\s+(?:de\s+)?cup[oô]m/i)
                ?? html.match(/(\d+)\s*%\s*OFF\s*ser[aá]\s*aplicado/i)
                ?? html.match(/Voc[eê]\s+economiza\s+R\$[\s\S]{0,10}com\s+cup[oô]m/i);
      if (mPct?.[1]) cupom = { pct: Number(mPct[1]), tipo: 'pct' };
    }
    if (!cupom) {
      const mFixo = html.match(/coupon-awareness-row-label[\s\S]{0,800}?aria-label="([\d,]+)\s*reais"[\s\S]{0,400}?OFF\.\s*Compra m[ií]nima[\s\S]{0,200}?aria-label="([\d,]+)\s*reais"/);
      if (mFixo?.[1]) {
        const valor = Number(mFixo[1].replace(',', '.'));
        const minimo = mFixo[2] ? Number(mFixo[2].replace(',', '.')) : 0;
        if (valor > 0 && (!minimo || (price && price >= minimo))) cupom = { valor, tipo: 'fixo' };
      } else {
        const mFixoSimples = html.match(/coupon-awareness-row-label[\s\S]{0,400}?aria-label="([\d,]+)\s*reais"/);
        if (mFixoSimples?.[1]) { const valor = Number(mFixoSimples[1].replace(',', '.')); if (valor > 0) cupom = { valor, tipo: 'fixo' }; }
      }
    }
    if (!cupom) {
      const m = html.match(/cup[oô]m[^R\d]{0,40}R\$\s*([\d.,]+)/i);
      if (m) { const valor = Number(m[1].replace(/\./g, '').replace(',', '.')); if (valor > 0) cupom = { valor, tipo: 'fixo' }; }
    }

    return { price, debug, cupom };
  } catch (e) {
    return { price: null, debug: `exceção: ${e.message}`, cupom: null };
  }
}

async function scrapeAmazonPrice(url) {
  try {
    const parsed = new URL(url);
    const isAmazon = parsed.hostname.includes('amazon.com') || parsed.hostname === 'amzn.to' || parsed.hostname === 'amzn.eu';
    if (!isAmazon) return { price: null, debug: 'hostname inválido', cupom: null };

    // Extrai o ASIN e constrói URL limpa — evita poluir o dashboard de afiliados com cliques do scraper
    const asinMatch = parsed.pathname.match(/\/dp\/([A-Z0-9]{10})/);
    const fetchUrl = asinMatch ? `https://www.amazon.com.br/dp/${asinMatch[1]}` : url;

    const res = await fetchWithTimeout(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    if (!res.ok) return { price: null, debug: `http ${res.status}`, cupom: null };
    const html = await res.text();

    // --- Preço ---
    let price = null;
    let debug = `html ok mas preço não encontrado (${html.length} bytes)`;

    const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    outer: for (const tag of ldBlocks) {
      try {
        const json = JSON.parse(tag.replace(/<script[^>]*>/, '').replace('</script>', ''));
        const nodes = Array.isArray(json) ? json : [json];
        for (const node of nodes) {
          const p = node?.offers?.lowPrice ?? node?.offers?.price ?? null;
          if (p && Number(p) > 0) { price = Number(p); debug = 'json-ld'; break outer; }
        }
      } catch { }
    }

    if (!price) {
      const priceContainerIds = [
        'corePriceDisplay_desktop_feature_div',
        'apex_offerDisplay_desktop_feature_div',
        'corePrice_desktop_feature_div',
        'corePrice_feature_div',
      ];
      for (const containerId of priceContainerIds) {
        const sectionMatch = html.match(new RegExp(`id="${containerId}"([\\s\\S]{0,3000})`));
        if (sectionMatch) {
          const offscreenMatches = [...sectionMatch[1].matchAll(/class="a-offscreen">R\$\s*([\d.,]+)/g)];
          for (const m of offscreenMatches) {
            const p = Number(m[1].replace(/\./g, '').replace(',', '.'));
            if (p > 0) { price = p; debug = `a-offscreen (${containerId})`; break; }
          }
        }
        if (price) break;
      }
    }

    if (!price) {
      const m = html.match(/id="priceblock_(?:ourprice|dealprice)"[^>]*>\s*R\$\s*([\d.,]+)/);
      if (m) { const p = Number(m[1].replace(/\./g, '').replace(',', '.')); if (p > 0) { price = p; debug = 'priceblock'; } }
    }
    if (!price) {
      const m = html.match(/"buyingPrice"\s*:\s*"?([\d.]+)"?/);
      if (m) { const p = Number(m[1]); if (p > 0) { price = p; debug = 'buyingPrice'; } }
    }
    if (!price) {
      const m = html.match(/"priceAmount"\s*:\s*([\d.]+)/);
      if (m) { const p = Number(m[1]); if (p > 0) { price = p; debug = 'priceAmount'; } }
    }
    if (!price) {
      const m = html.match(/"displayPrice"\s*:\s*"R\$\s*([\d.,]+)"/);
      if (m) { const p = Number(m[1].replace(/\./g, '').replace(',', '.')); if (p > 0) { price = p; debug = 'displayPrice'; } }
    }
    if (!price) {
      const m = html.match(/"price"\s*:\s*"([\d]+\.[\d]{2})"/);
      if (m) { const p = Number(m[1]); if (p > 0) { price = p; debug = 'json-price-string'; } }
    }
    if (!price) {
      const centerMatch = html.match(/id="(?:centerCol|ppd)"([\s\S]{0,15000})/);
      const centerHtml  = centerMatch ? centerMatch[1] : '';
      const wholeMatch  = centerHtml.match(/class="a-price-whole">\s*([\d.,]+)/);
      const fracMatch   = centerHtml.match(/class="a-price-fraction">\s*(\d{2})/);
      if (wholeMatch) {
        const p = Number(`${wholeMatch[1].replace(/[.,]/g, '')}.${fracMatch ? fracMatch[1] : '00'}`);
        if (p > 0) { price = p; debug = 'a-price-whole/fraction'; }
      }
    }

    // --- Cupom Amazon ---
    let cupom = null;
    const apliqueMatch = html.match(/Aplique o cup[oô]m de (\d+)%/i);
    if (apliqueMatch) cupom = { pct: Number(apliqueMatch[1]), tipo: 'pct', source: 'aplique-pct' };

    if (!cupom) {
      const badgeSection = html.match(/id="couponBadge[^"]*"[\s\S]{0,300}/);
      if (badgeSection) { const m = badgeSection[0].match(/(\d+)%/); if (m) cupom = { pct: Number(m[1]), tipo: 'pct', source: 'couponBadge' }; }
    }
    if (!cupom) {
      const m = html.match(/"promotionPercent"\s*:\s*(\d+)/);
      if (m) cupom = { pct: Number(m[1]), tipo: 'pct', source: 'promotionPercent' };
    }
    if (!cupom) {
      const m = html.match(/cup[oô]m[^%\d]{0,60}(\d+)\s*%/i);
      if (m) cupom = { pct: Number(m[1]), tipo: 'pct', source: 'generic-pct' };
    }
    if (!cupom) {
      const m = html.match(/cup[oô]m[^R\d]{0,40}R\$\s*([\d.,]+)/i);
      if (m) { const valor = Number(m[1].replace(/\./g, '').replace(',', '.')); if (valor > 0) cupom = { valor, tipo: 'fixo', source: 'generic-fixo' }; }
    }
    if (!cupom) {
      const RESTRICOES = /primeira\s+compra|somente\s+no\s+app|v[aá]lido\s+somente\s+no\s+app|exclusivo\s+prime/i;
      const mCod = html.match(/[Ee]conomize\s+R\$\s*([\d.,]+)\s+com\s+o\s+cup[oô]m\s+([A-Z0-9]+)/);
      if (mCod) {
        const idx = html.indexOf(mCod[0]);
        const contexto = html.slice(Math.max(0, idx - 50), idx + 300);
        if (!RESTRICOES.test(contexto)) {
          const valor = Number(mCod[1].replace(/\./g, '').replace(',', '.'));
          cupom = { valor, codigo: mCod[2], tipo: 'codigo', source: 'economize-codigo' };
        }
      }
    }
    if (!cupom) {
      const codigoRestrito = (cod) => /APP|PRIME|NEW/i.test(cod);
      const candidatos = [
        ...[...html.matchAll(/cup[oô]m:?\s+([A-Z0-9]{4,})\.?\s*Desconto oferecido pela Amazon/gi)].map(m => m[1]),
        ...[...html.matchAll(/Cupom de desconto ([A-Z0-9]{4,}) salvo em sua conta[\s\S]{0,500}?navigate:psp/g)].map(m => m[1]),
      ];
      const codigo = candidatos.find(cod => !codigoRestrito(cod));
      if (codigo) cupom = { codigo, tipo: 'codigo', source: 'codigo-conta' };
    }

    return { price, debug, cupom };
  } catch (e) {
    return { price: null, debug: `exceção: ${e.message}`, cupom: null };
  }
}

async function scrapeShopeePrice(url) {
  try {
    if (!SHOPEE_APP_ID || !SHOPEE_SECRET) return { price: null, debug: 'credenciais Shopee não configuradas', offerLink: null };

    const parsed = new URL(url);
    const m = parsed.pathname.match(/\/product\/(\d+)\/(\d+)/) ?? parsed.pathname.match(/[.-]i\.(\d+)\.(\d+)/);
    if (!m) return { price: null, debug: 'IDs não extraídos da URL', offerLink: null };

    const [, shopid, itemid] = m;
    const query = `{ productOfferV2(itemId: ${itemid}, shopId: ${shopid}, limit: 1) { nodes { priceMin priceMax offerLink } } }`;
    const body  = JSON.stringify({ query });
    const ts    = Math.floor(Date.now() / 1000);
    const sig   = createHash('sha256').update(`${SHOPEE_APP_ID}${ts}${body}${SHOPEE_SECRET}`).digest('hex');

    const res = await fetchWithTimeout('https://open-api.affiliate.shopee.com.br/graphql', {
      method: 'POST',
      headers: {
        Authorization: `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${ts}, Signature=${sig}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!res.ok) return { price: null, debug: `http ${res.status}`, offerLink: null };

    const json = await res.json();
    const item = json?.data?.productOfferV2?.nodes?.[0];
    if (!item) return { price: null, debug: 'produto não encontrado na API', offerLink: null };

    const price = Number(item.priceMin ?? item.priceMax);
    if (!price) return { price: null, debug: 'preço ausente na resposta', offerLink: null };

    return { price, offerLink: item.offerLink ?? null, debug: 'shopee-affiliate-api' };
  } catch (e) {
    return { price: null, debug: `exceção: ${e.message}`, offerLink: null };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}


function parseAlertaEnviadoEm(str) {
  if (!str) return null;
  const s = str.replace(/^'/, '').trim();
  const [datePart, timePart] = s.split(' ');
  if (!datePart) return null;
  const [d, m, y] = datePart.split('/');
  if (!d || !m || !y) return null;
  return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart ?? '00:00'}:00`);
}

// --- Monitor ---

function buildPlataformaMsg(label, p) {
  if (!p) return '';
  let linha = `🛍️ ${label}:`;
  if (p.dropped && p.precoAnterior) {
    linha += `\nDe ~${formatMoeda(p.precoAnterior)}~ por *${formatMoeda(p.precoNovo)}* (-${p.desconto}%)`;
  } else {
    linha += ` ${formatMoeda(p.precoNovo)}`;
    if (p.manual) linha += ` _(checar)_`;
  }
  if (p.pixPct) {
    const pix = p.precoNovo * (1 - p.pixPct / 100);
    linha += `\n💳 No Pix: *${formatMoeda(pix)}* (-${p.pixPct}%)`;
  }
  if (p.cupom) {
    if (p.cupom.tipo === 'pct') {
      const efetivo = p.precoNovo * (1 - p.cupom.pct / 100);
      linha += `\n🏷️ Cupom: -${p.cupom.pct}% (${formatMoeda(efetivo)})`;
    } else if (p.cupom.tipo === 'fixo') {
      const efetivo = p.precoNovo - p.cupom.valor;
      linha += `\n🏷️ Cupom: -${formatMoeda(p.cupom.valor)} (${formatMoeda(efetivo > 0 ? efetivo : 0)})`;
    } else if (p.cupom.tipo === 'codigo') {
      linha += `\n🏷️ Cupom`;
      if (p.cupom.valor) linha += ` -${formatMoeda(p.cupom.valor)}`;
      linha += `: *${p.cupom.codigo}* _(inserir no checkout)_`;
    }
  }
  if (p.url) linha += `\n${p.url}`;
  return linha;
}

function buildMsg(a) {
  let msg = `${a.nome}\n\n`;

  if (a.tipo === 'novo')      msg += `🆕 Novo produto!\n\n`;
  if (a.tipo === 'queda')    msg += `🔥 Queda de preço!\n\n`;
  if (a.tipo === 'minimo15d') msg += `📉 Menor preço dos últimos 15 dias!\n\n`;
  if (a.tipo === 'lembrete') msg += `📌 Oferta do dia\n\n`;
  if (a.tipo === 'cupom')    msg += `🏷️ Cupom disponível!\n\n`;

  const partes = [
    buildPlataformaMsg('Mercado Livre', a.ml),
    buildPlataformaMsg('Amazon',        a.amazon),
    buildPlataformaMsg('Shopee',        a.shopee),
  ].filter(Boolean);

  msg += partes.join('\n\n');
  return msg;
}

async function rodarChecagem(whatsappClient) {
  const agora = new Date().toLocaleString('pt-BR');
  console.log(`\n[${agora}] Iniciando checagem de preços...`);

  const {
    rows,
    precoMlCol, precoMlAntCol,
    precoAmazonCol, precoAmazonAntCol,
    precoShopeeCol, precoShopeeAntCol,
    alertaEnviadoEmCol,
    statusMlCol, statusAmazonCol, statusShopeeCol,
    linkShopeeCol,
  } = await getSheetRows();
  console.log(`Produtos encontrados: ${rows.length}`);

  const colMap = {
    precoMlCol, precoMlAntCol,
    precoAmazonCol, precoAmazonAntCol,
    precoShopeeCol, precoShopeeAntCol,
    linkShopeeCol,
  };
  const sheetUpdates = [];
  const statusUpdates = [];
  const rowNumsAlertados = [];
  const historicoRegistros = [];
  const lembretes = [];
  const QUEDA_MIN_PCT = 5;
  const DIAS_LEMBRETE  = 7;
  const calcDesconto  = (ant, novo) => Math.round(((ant - novo) / ant) * 100);

  const enviarAlerta = async (alerta) => {
    if (!whatsappClient) return;

    const chatId = GRUPO_MAP[(alerta.miya_group ?? '').toLowerCase()] ?? CHAT_ID_FALLBACK;
    if (!chatId) {
      console.warn(`⚠️  ${alerta.nome} — grupo "${alerta.miya_group}" sem ID configurado, alerta ignorado.`);
      return;
    }

    const msg = buildMsg(alerta);
    let enviado = false;
    for (let tentativa = 1; tentativa <= 3 && !enviado; tentativa++) {
      try {
        if (alerta.imagem) {
          const media = await MessageMedia.fromUrl(alerta.imagem, { unsafeMime: true });
          await whatsappClient.sendMessage(chatId, media, { caption: msg });
        } else {
          await whatsappClient.sendMessage(chatId, msg);
        }
        console.log(`📲 Alerta enviado: ${alerta.nome} → ${alerta.miya_group ?? 'grupo padrão'}`);
        rowNumsAlertados.push(alerta.rowNum);
        enviado = true;
      } catch (e) {
        console.error(`Erro ao enviar WhatsApp (tentativa ${tentativa}/3): ${e.message}`);
        if (tentativa < 3) await sleep(5000);
      }
    }
  };

  for (const row of rows) {
    // --- Scraping ---
    const { price: mlPrice, debug: mlDebug, cupom: mlCupom } = row.link_ml_direto
      ? await scrapePrice(row.link_ml_direto)
      : { price: null, debug: 'sem link', cupom: null };
    if (row.link_ml_direto) await sleep(3000);

    const { price: amazonPrice, debug: amazonDebug, cupom: amazonCupom } = row.link_amazon
      ? await scrapeAmazonPrice(row.link_amazon)
      : { price: null, debug: 'sem link', cupom: null };
    if (row.link_amazon) await sleep(3000);

    const { price: shopeePrice, debug: shopeeDebug, offerLink: shopeeOfferLink } = row.link_shopee_direto
      ? await scrapeShopeePrice(row.link_shopee_direto)
      : { price: null, debug: 'sem link', offerLink: null };
    if (row.link_shopee_direto) await sleep(2000);

    // --- Status por marketplace ---
    const agoraStatus = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    if (statusMlCol && row.link_ml_direto) {
      const valor = mlPrice !== null ? `OK ${agoraStatus}` : `erro: ${mlDebug} (${agoraStatus})`;
      statusUpdates.push({ range: `${SHEET_NAME}!${statusMlCol}${row.rowNum}`, values: [[valor]] });
    }
    if (statusAmazonCol && row.link_amazon) {
      const valor = amazonPrice !== null ? `OK ${agoraStatus}` : `erro: ${amazonDebug} (${agoraStatus})`;
      statusUpdates.push({ range: `${SHEET_NAME}!${statusAmazonCol}${row.rowNum}`, values: [[valor]] });
    }
    if (statusShopeeCol && row.link_shopee_direto) {
      const valor = shopeePrice !== null ? `OK ${agoraStatus}` : `erro: ${shopeeDebug} (${agoraStatus})`;
      statusUpdates.push({ range: `${SHEET_NAME}!${statusShopeeCol}${row.rowNum}`, values: [[valor]] });
    }

    const temDadoUtil = mlPrice !== null || amazonPrice !== null || shopeePrice !== null || row.preco_shopee != null;
    if (!temDadoUtil) {
      console.log(`❌ ${row.nome} — ML: ${mlDebug} | Amazon: ${amazonDebug} | Shopee: ${shopeeDebug}`);
      continue;
    }

    // --- Atualizações de planilha ---
    const min24h = getMinimoPrecosUltimas24h(row.nome);
    const min15d = getMinimoPrecosUltimos15d(row.nome);

    if (mlPrice     !== null) sheetUpdates.push({ tipo: 'ml',     rowNum: row.rowNum, precoNovo: mlPrice,     precoAnterior: min24h.min_ml     ?? row.preco_ml });
    if (amazonPrice !== null) sheetUpdates.push({ tipo: 'amazon', rowNum: row.rowNum, precoNovo: amazonPrice, precoAnterior: min24h.min_amazon ?? row.preco_amazon });
    if (shopeePrice !== null) sheetUpdates.push({ tipo: 'shopee', rowNum: row.rowNum, precoNovo: shopeePrice, precoAnterior: min24h.min_shopee ?? row.preco_shopee });
    if (shopeeOfferLink)      sheetUpdates.push({ tipo: 'link_shopee', rowNum: row.rowNum, valor: shopeeOfferLink });
    // --- Detecção de quedas ---
    const baselineMl     = min24h.min_ml     ?? row.preco_ml;
    const baselineAmazon = min24h.min_amazon ?? row.preco_amazon;
    const baselineShopee = min24h.min_shopee ?? row.preco_shopee;

    const quedaMl     = mlPrice     !== null && baselineMl     && mlPrice     < baselineMl     && calcDesconto(baselineMl,     mlPrice)     >= QUEDA_MIN_PCT;
    const quedaAmazon = amazonPrice !== null && baselineAmazon && amazonPrice < baselineAmazon && calcDesconto(baselineAmazon, amazonPrice) >= QUEDA_MIN_PCT;
    const quedaShopee = shopeePrice !== null && baselineShopee && shopeePrice < baselineShopee && calcDesconto(baselineShopee, shopeePrice) >= QUEDA_MIN_PCT;
    const temQueda = quedaMl || quedaAmazon || quedaShopee;

    const minimo15dMl     = mlPrice     !== null && min15d.min_ml     !== null && mlPrice     < min15d.min_ml     && calcDesconto(min15d.min_ml,     mlPrice)     >= QUEDA_MIN_PCT;
    const minimo15dAmazon = amazonPrice !== null && min15d.min_amazon !== null && amazonPrice < min15d.min_amazon && calcDesconto(min15d.min_amazon, amazonPrice) >= QUEDA_MIN_PCT;
    const minimo15dShopee = shopeePrice !== null && min15d.min_shopee !== null && shopeePrice < min15d.min_shopee && calcDesconto(min15d.min_shopee, shopeePrice) >= QUEDA_MIN_PCT;
    const temMinimo15d = minimo15dMl || minimo15dAmazon || minimo15dShopee;

    const alertaBase = {
      rowNum:     row.rowNum,
      nome:       row.nome,
      imagem:     row.imagem,
      miya_group: row.miya_group,
      ml: mlPrice !== null ? {
        precoNovo:     mlPrice,
        precoAnterior: baselineMl,
        desconto:      quedaMl ? calcDesconto(baselineMl, mlPrice) : null,
        url:           row.link_ml ?? row.link_ml_direto,
        dropped:       quedaMl,
        cupom:         mlCupom,
      } : null,
      amazon: (amazonPrice !== null || row.preco_amazon) ? {
        precoNovo:     amazonPrice ?? row.preco_amazon,
        precoAnterior: baselineAmazon,
        desconto:      quedaAmazon ? calcDesconto(baselineAmazon, amazonPrice) : null,
        url:           row.link_amazon,
        dropped:       quedaAmazon,
        cupom:         amazonCupom,
      } : null,
      shopee: (shopeePrice !== null || row.preco_shopee) ? {
        precoNovo:     shopeePrice ?? row.preco_shopee,
        precoAnterior: baselineShopee,
        desconto:      quedaShopee ? calcDesconto(baselineShopee, shopeePrice) : null,
        url:           shopeeOfferLink ?? row.link_shopee,
        dropped:       quedaShopee,
        manual:        shopeePrice === null,
        pixPct:        shopeePrice !== null ? 5 : null,
      } : null,
    };

    // --- Histórico ---
    if (mlPrice !== null || amazonPrice !== null || shopeePrice !== null) {
      historicoRegistros.push({
        timestamp:    new Date().toISOString(),
        nome:         row.nome,
        preco_ml:     mlPrice     ?? null,
        preco_amazon: amazonPrice ?? null,
        preco_shopee: shopeePrice ?? null,
      });
    }

    // --- Gatilho + envio imediato ---
    if (!row.alerta_enviado_em) {
      console.log(`🆕 ${row.nome} — novo produto`);
      await enviarAlerta({ ...alertaBase, tipo: 'novo' });
    } else if (temMinimo15d) {
      if (minimo15dMl)     console.log(`📉 ${row.nome} — ML: mínimo 15d R$ ${min15d.min_ml} → R$ ${mlPrice} (-${calcDesconto(min15d.min_ml, mlPrice)}%)`);
      if (minimo15dAmazon) console.log(`📉 ${row.nome} — Amazon: mínimo 15d R$ ${min15d.min_amazon} → R$ ${amazonPrice} (-${calcDesconto(min15d.min_amazon, amazonPrice)}%)`);
      if (minimo15dShopee) console.log(`📉 ${row.nome} — Shopee: mínimo 15d R$ ${min15d.min_shopee} → R$ ${shopeePrice} (-${calcDesconto(min15d.min_shopee, shopeePrice)}%)`);
      const alertaMinimo15d = {
        ...alertaBase,
        ml:     alertaBase.ml     ? { ...alertaBase.ml,     precoAnterior: min15d.min_ml     ?? baselineMl,     desconto: minimo15dMl     ? calcDesconto(min15d.min_ml,     mlPrice)     : alertaBase.ml.desconto,     dropped: minimo15dMl     } : null,
        amazon: alertaBase.amazon ? { ...alertaBase.amazon, precoAnterior: min15d.min_amazon ?? baselineAmazon, desconto: minimo15dAmazon ? calcDesconto(min15d.min_amazon, amazonPrice) : alertaBase.amazon.desconto, dropped: minimo15dAmazon } : null,
        shopee: alertaBase.shopee ? { ...alertaBase.shopee, precoAnterior: min15d.min_shopee ?? baselineShopee, desconto: minimo15dShopee ? calcDesconto(min15d.min_shopee, shopeePrice) : alertaBase.shopee.desconto, dropped: minimo15dShopee } : null,
      };
      await enviarAlerta({ ...alertaMinimo15d, tipo: 'minimo15d' });
    } else if (temQueda) {
      if (quedaMl)     console.log(`🔥 ${row.nome} — ML: R$ ${baselineMl} → R$ ${mlPrice} (-${calcDesconto(baselineMl, mlPrice)}%)`);
      if (quedaAmazon) console.log(`🔥 ${row.nome} — Amazon: R$ ${baselineAmazon} → R$ ${amazonPrice} (-${calcDesconto(baselineAmazon, amazonPrice)}%)`);
      if (quedaShopee) console.log(`🔥 ${row.nome} — Shopee: R$ ${baselineShopee} → R$ ${shopeePrice} (-${calcDesconto(baselineShopee, shopeePrice)}%)`);
      await enviarAlerta({ ...alertaBase, tipo: 'queda' });
    } else {
      const partes = [
        mlPrice     !== null ? `ML: R$ ${mlPrice} (ant R$ ${baselineMl})`         : null,
        amazonPrice !== null ? `Amazon: R$ ${amazonPrice} (ant R$ ${baselineAmazon})` : null,
        shopeePrice !== null ? `Shopee: R$ ${shopeePrice} (ant R$ ${baselineShopee})` : null,
      ].filter(Boolean).join(' | ') || 'sem scraping';
      console.log(`✅ ${row.nome} — ${partes}, sem queda`);

      // Candidato a lembrete se não recebeu alerta há DIAS_LEMBRETE dias ou mais
      const dtEnviado = parseAlertaEnviadoEm(row.alerta_enviado_em);
      if (dtEnviado && (Date.now() - dtEnviado.getTime()) / 86400000 >= DIAS_LEMBRETE) {
        lembretes.push({ ...alertaBase, dtEnviado });
      }
    }
  }

  // --- Lembretes: 1 por grupo por checagem (o produto com alerta mais antigo) ---
  const lembretesFiltrados = lembretes.filter(l => !rowNumsAlertados.includes(l.rowNum));
  const lembretePorGrupo = new Map();
  for (const l of lembretesFiltrados) {
    const grupo = (l.miya_group ?? '').toLowerCase();
    const atual = lembretePorGrupo.get(grupo);
    if (!atual || l.dtEnviado < atual.dtEnviado) lembretePorGrupo.set(grupo, l);
  }
  for (const lembrete of lembretePorGrupo.values()) {
    console.log(`🔔 Lembrete: ${lembrete.nome} (grupo: ${lembrete.miya_group ?? 'padrão'})`);
    await enviarAlerta({ ...lembrete, tipo: 'lembrete' });
  }

  if (historicoRegistros.length > 0) {
    salvarHistorico(historicoRegistros);
    console.log(`📦 Histórico: ${historicoRegistros.length} registro(s) gravados no SQLite.`);
  }

  if (sheetUpdates.length > 0 || statusUpdates.length > 0 || (rowNumsAlertados.length > 0 && alertaEnviadoEmCol)) {
    const accessToken = await getGoogleAccessToken();

    if (sheetUpdates.length > 0 || statusUpdates.length > 0) {
      if (sheetUpdates.length > 0) console.log(`\nAtualizando ${sheetUpdates.length} preços na planilha...`);
      if (statusUpdates.length > 0) console.log(`Gravando status de ${statusUpdates.length} scrapers...`);
      if (sheetUpdates.length > 0) await updateSheetPrices(accessToken, sheetUpdates, colMap);
      if (statusUpdates.length > 0) await batchUpdateSheet(accessToken, statusUpdates);
      console.log('Planilha atualizada.');

      const revalidateSecret = process.env.REVALIDATE_SECRET ?? 'miya2025';
      const rv = await fetch(`https://miya-store.vercel.app/api/revalidate?secret=${revalidateSecret}`);
      if (rv.ok) console.log('Site revalidado.');
      else console.log(`Revalidate falhou: ${rv.status}`);
    }

    if (rowNumsAlertados.length > 0 && alertaEnviadoEmCol) {
      await updateAlertaEnviadoEm(accessToken, rowNumsAlertados, alertaEnviadoEmCol);
      console.log(`alerta_enviado_em atualizado para ${rowNumsAlertados.length} produto(s).`);
    }
  }

  const prox = proximoHorario();
  console.log(`\nPróxima checagem: ${prox.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', weekday: 'short' })}.`);
}

// --- Inicialização ---

if (!WHATSAPP_DESTINO && !WHATSAPP_GRUPO_ID) {
  console.warn('⚠️  Nenhum destino WhatsApp configurado. Defina WHATSAPP_GRUPO_ID (recomendado) ou WHATSAPP_DESTINO no .env.local');
}

console.log('Inicializando WhatsApp...');
console.log('(Na primeira vez, um QR code aparecerá abaixo — escaneie com o WhatsApp do celular)\n');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: resolve(__dirname, '../.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox'] },
});

client.on('qr', async (qr) => {
  const qrPath = resolve(__dirname, '../qrcode.png');
  await QRCode.toFile(qrPath, qr, { width: 400 });
  console.log(`\nQR code salvo em: ${qrPath}`);
  console.log('Abra o arquivo qrcode.png e escaneie com o WhatsApp do celular.');
});

client.on('authenticated', () => {
  console.log('WhatsApp autenticado. Sessão salva.');
});

client.on('ready', async () => {
  console.log('WhatsApp conectado!\n');

  if (LISTAR_GRUPOS) {
    const chats = await client.getChats();
    const grupos = chats.filter((c) => c.isGroup);
    console.log(`\nGrupos encontrados (${grupos.length}):\n`);
    for (const g of grupos) {
      console.log(`  ${g.name}`);
      console.log(`  ID: ${g.id._serialized}\n`);
    }
    console.log('Copie o ID do grupo desejado e adicione no .env.local:');
    console.log('WHATSAPP_GRUPO_ID=<id copiado>');
    process.exit(0);
  }

  // Primeira checagem imediata ao iniciar
  await rodarChecagem(client);

  // Loop agendado nos horários fixos
  while (true) {
    const prox = proximoHorario();
    const msAte = prox - new Date();
    await sleep(msAte);
    await rodarChecagem(client);
  }
});

client.on('disconnected', (reason) => {
  console.warn(`WhatsApp desconectado: ${reason}`);
  console.warn('Reinicie o script para reconectar.');
  process.exit(1);
});

client.initialize();
