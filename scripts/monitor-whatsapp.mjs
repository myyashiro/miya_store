import { createSign } from 'crypto';
import { readFileSync, existsSync } from 'fs';
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
const QRCode = require('qrcode');

const SHEET_ID = process.env.SHEET_ID ?? process.env.NEXT_PUBLIC_SHEET_ID;
const SHEET_NAME = 'PRODUTOS';

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
const WHATSAPP_DESTINO = process.env.WHATSAPP_DESTINO;
const CHAT_ID_FALLBACK = WHATSAPP_GRUPO_ID ?? (WHATSAPP_DESTINO ? `${WHATSAPP_DESTINO}@c.us` : null);

const LISTAR_GRUPOS = process.argv.includes('--listar-grupos');

// Horários fixos de checagem (horas inteiras)
const HORARIOS_CHECAGEM = [8, 10, 12, 14, 16, 18, 20, 22];

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

// Máximo de reenvios (gatilho de 2 dias) por janela de checagem
const MAX_REENVIOS_POR_JANELA = Number(process.env.MONITOR_MAX_REENVIOS ?? 5);

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

  const precoMlCol         = findCol('preco_ml')              ?? 'H';
  const precoMlAntCol      = findCol('preco_ml_anterior')     ?? 'O';
  const precoAmazonCol     = findCol('preco_amazon');
  const precoAmazonAntCol  = findCol('preco_amazon_anterior');
  const precoShopeeCol     = findCol('preco_shopee');
  const precoShopeeAntCol  = findCol('preco_shopee_anterior');
  const alertaEnviadoEmCol = findCol('alerta_enviado_em');
  const statusMlCol        = findCol('status_ml');
  const statusAmazonCol    = findCol('status_amazon');

  const rows = [];
  data.table.rows.forEach((row, gvizIndex) => {
    const cells = row.c || [];
    const get = (key) => {
      const i = cols.indexOf(key);
      return i >= 0 && cells[i] ? cells[i]?.v : undefined;
    };

    const link_ml_direto = get('link_ml_direto') ? String(get('link_ml_direto')) : undefined;
    const link_amazon_check = get('link_amazon') ? String(get('link_amazon')) : undefined;
    const link_shopee_check = get('link_shopee') ? String(get('link_shopee')) : undefined;
    if (!link_ml_direto && !link_amazon_check && !link_shopee_check) return;

    rows.push({
      rowNum: gvizIndex + 2,
      nome: String(get('nome') ?? ''),
      link_ml_direto,
      link_ml: get('link_ml') ? String(get('link_ml')) : undefined,
      imagem: get('imagem') ? String(get('imagem')) : undefined,
      preco_ml: get('preco_ml') != null ? Number(get('preco_ml')) : undefined,
      preco_ml_anterior: get('preco_ml_anterior') != null ? Number(get('preco_ml_anterior')) : undefined,
      preco_amazon:          get('preco_amazon')          != null ? Number(get('preco_amazon'))          : undefined,
      preco_amazon_anterior: get('preco_amazon_anterior') != null ? Number(get('preco_amazon_anterior')) : undefined,
      link_amazon:           get('link_amazon')           ? String(get('link_amazon'))  : undefined,
      preco_shopee:          get('preco_shopee')          != null ? Number(get('preco_shopee'))          : undefined,
      preco_shopee_anterior: get('preco_shopee_anterior') != null ? Number(get('preco_shopee_anterior')) : undefined,
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
    statusMlCol, statusAmazonCol,
  };
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
          const price = node?.offers?.lowPrice ?? node?.offers?.price ?? null;
          if (price) return { price: Number(price), debug: 'json-ld' };
        }
      } catch { }
    }

    const metaMatch = html.match(/<meta property="product:price:amount" content="([\d.,]+)"/);
    if (metaMatch) {
      const price = Number(metaMatch[1].replace(',', '.'));
      if (price > 0) return { price, debug: 'meta-tag' };
    }

    // Busca "price" dentro de "offers" (preço promocional/correto)
    const offersPriceMatch = html.match(/"offers"\s*:\s*\{"price"\s*:\s*([\d]+(?:\.\d{1,2})?)/);
    if (offersPriceMatch) {
      const price = Number(offersPriceMatch[1]);
      if (price > 0) return { price, debug: 'inline-script-offers' };
    }
    // Fallback: primeiro "price" genérico
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

async function scrapeAmazonPrice(url) {
  try {
    const parsed = new URL(url);
    const isAmazon = parsed.hostname.includes('amazon.com') || parsed.hostname === 'amzn.to' || parsed.hostname === 'amzn.eu';
    if (!isAmazon) return { price: null, debug: 'hostname inválido' };

    // Extrai o ASIN e constrói URL limpa — evita poluir o dashboard de afiliados com cliques do scraper
    const asinMatch = parsed.pathname.match(/\/dp\/([A-Z0-9]{10})/);
    const fetchUrl = asinMatch
      ? `https://www.amazon.com.br/dp/${asinMatch[1]}`
      : url;

    const res = await fetch(fetchUrl, {
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

    if (!res.ok) return { price: null, debug: `http ${res.status}` };
    const html = await res.text();

    // Estratégia 1: JSON-LD
    const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    for (const tag of ldBlocks) {
      try {
        const json = JSON.parse(tag.replace(/<script[^>]*>/, '').replace('</script>', ''));
        const nodes = Array.isArray(json) ? json : [json];
        for (const node of nodes) {
          const price = node?.offers?.lowPrice ?? node?.offers?.price ?? null;
          if (price && Number(price) > 0) return { price: Number(price), debug: 'json-ld' };
        }
      } catch { }
    }

    // Estratégia 2: .a-offscreen dentro de blocos de preço conhecidos
    // Tenta vários IDs de contêiner — a Amazon muda isso com frequência
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
          const raw = m[1].replace(/\./g, '').replace(',', '.');
          const price = Number(raw);
          if (price > 0) return { price, debug: `a-offscreen (${containerId})` };
        }
      }
    }

    // Estratégia 3: priceblock_ourprice / priceblock_dealprice (legado)
    const priceBlockMatch = html.match(/id="priceblock_(?:ourprice|dealprice)"[^>]*>\s*R\$\s*([\d.,]+)/);
    if (priceBlockMatch) {
      const raw = priceBlockMatch[1].replace(/\./g, '').replace(',', '.');
      const price = Number(raw);
      if (price > 0) return { price, debug: 'priceblock' };
    }

    // Estratégia 4: "buyingPrice" no HTML (JSON inline)
    const buyingMatch = html.match(/"buyingPrice"\s*:\s*"?([\d.]+)"?/);
    if (buyingMatch) {
      const price = Number(buyingMatch[1]);
      if (price > 0) return { price, debug: 'buyingPrice' };
    }

    // Estratégia 5: "priceAmount" no HTML
    const priceAmountMatch = html.match(/"priceAmount"\s*:\s*([\d.]+)/);
    if (priceAmountMatch) {
      const price = Number(priceAmountMatch[1]);
      if (price > 0) return { price, debug: 'priceAmount' };
    }

    // Estratégia 6: "displayPrice":"R$ 799,99" em JSON embutido
    const displayPriceMatch = html.match(/"displayPrice"\s*:\s*"R\$\s*([\d.,]+)"/);
    if (displayPriceMatch) {
      const raw = displayPriceMatch[1].replace(/\./g, '').replace(',', '.');
      const price = Number(raw);
      if (price > 0) return { price, debug: 'displayPrice' };
    }

    // Estratégia 7: "price" em JSON de oferta (formato decimal americano, ex: "799.99")
    const jsonPriceMatch = html.match(/"price"\s*:\s*"([\d]+\.[\d]{2})"/);
    if (jsonPriceMatch) {
      const price = Number(jsonPriceMatch[1]);
      if (price > 0) return { price, debug: 'json-price-string' };
    }

    // Estratégia 8: a-price-whole + a-price-fraction (DOM text, sem JS)
    // Restringe ao container central (centerCol/ppd) para evitar pegar preço de carrosséis de similares
    const centerMatch = html.match(/id="(?:centerCol|ppd)"([\s\S]{0,15000})/);
    const centerHtml  = centerMatch ? centerMatch[1] : '';
    const wholeMatch = centerHtml.match(/class="a-price-whole">\s*([\d.,]+)/);
    const fracMatch  = centerHtml.match(/class="a-price-fraction">\s*(\d{2})/);
    if (wholeMatch) {
      const whole = wholeMatch[1].replace(/[.,]/g, '');
      const frac  = fracMatch ? fracMatch[1] : '00';
      const price = Number(`${whole}.${frac}`);
      if (price > 0) return { price, debug: 'a-price-whole/fraction' };
    }

    return { price: null, debug: `html ok mas preço não encontrado (${html.length} bytes)` };
  } catch (e) {
    return { price: null, debug: `exceção: ${e.message}` };
  }
}


function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatMoeda(valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Parseia data do alerta_enviado_em e verifica se passou mais de N dias.
// Suporta dois formatos:
//   "Date(2026,3,6,18,59,0)" — retorno da gviz API (mês 0-indexado)
//   "06/04/2026, 18:59"      — texto puro gravado pelo script
function alertaMaisDeNDias(alertaEnviadoEm, dias) {
  try {
    let data;
    const gviz = String(alertaEnviadoEm).match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+))?/);
    if (gviz) {
      const [, year, month, day, hours = 0, minutes = 0] = gviz;
      data = new Date(Number(year), Number(month), Number(day), Number(hours), Number(minutes));
    } else {
      const [datePart, timePart] = String(alertaEnviadoEm).split(', ');
      const [day, month, year] = datePart.split('/');
      const [hours, minutes] = (timePart ?? '00:00').split(':');
      data = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
    }
    const diffMs = Date.now() - data.getTime();
    return diffMs > dias * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
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
  if (p.url) linha += `\n${p.url}`;
  return linha;
}

function buildMsg(a) {
  let msg = `${a.nome}\n\n`;

  if (a.tipo === 'novo')   msg += `🆕 Novo produto!\n\n`;
  if (a.tipo === 'queda')  msg += `🔥 Queda de preço!\n\n`;

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
    statusMlCol, statusAmazonCol,
  } = await getSheetRows();
  console.log(`Produtos encontrados: ${rows.length}`);

  const colMap = { precoMlCol, precoMlAntCol, precoAmazonCol, precoAmazonAntCol, precoShopeeCol, precoShopeeAntCol };
  const sheetUpdates = [];
  const statusUpdates = [];
  const rowNumsAlertados = [];
  let reenviosNaJanela = 0;

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
    const { price: mlPrice, debug: mlDebug } = row.link_ml_direto
      ? await scrapePrice(row.link_ml_direto)
      : { price: null, debug: 'sem link' };
    if (row.link_ml_direto) await sleep(3000);

    const { price: amazonPrice, debug: amazonDebug } = row.link_amazon
      ? await scrapeAmazonPrice(row.link_amazon)
      : { price: null, debug: 'sem link' };
    if (row.link_amazon) await sleep(3000);

    // Shopee: sem scraper automático (site bloqueia bots). Usa valor manual da planilha.
    const shopeePrice = null;

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

    const temDadoUtil = mlPrice !== null || amazonPrice !== null || row.preco_shopee != null;
    if (!temDadoUtil) {
      console.log(`❌ ${row.nome} — ML: ${mlDebug} | Amazon: ${amazonDebug} | Shopee: sem preço manual`);
      continue;
    }

    // --- Atualizações de planilha ---
    if (mlPrice     !== null) sheetUpdates.push({ tipo: 'ml',     rowNum: row.rowNum, precoNovo: mlPrice,     precoAnterior: row.preco_ml });
    if (amazonPrice !== null) sheetUpdates.push({ tipo: 'amazon', rowNum: row.rowNum, precoNovo: amazonPrice, precoAnterior: row.preco_amazon });
    if (shopeePrice !== null) sheetUpdates.push({ tipo: 'shopee', rowNum: row.rowNum, precoNovo: shopeePrice, precoAnterior: row.preco_shopee });

    // --- Detecção de quedas ---
    // Se o scraper retornou um preço, compara contra o valor armazenado na planilha.
    // Se o scraper ainda não está implementado (null), compara o valor manual contra o anterior.
    const quedaMl     = mlPrice     !== null && row.preco_ml              && mlPrice     < row.preco_ml;
    const quedaAmazon = (amazonPrice !== null && row.preco_amazon && amazonPrice < row.preco_amazon)
                     || (amazonPrice === null && row.preco_amazon && row.preco_amazon_anterior && row.preco_amazon < row.preco_amazon_anterior);
    const quedaShopee = (shopeePrice !== null && row.preco_shopee && shopeePrice < row.preco_shopee)
                     || (shopeePrice === null && row.preco_shopee && row.preco_shopee_anterior && row.preco_shopee < row.preco_shopee_anterior);
    const temQueda = quedaMl || quedaAmazon || quedaShopee;

    const calcDesconto = (ant, novo) => Math.round(((ant - novo) / ant) * 100);

    const alertaBase = {
      rowNum:     row.rowNum,
      nome:       row.nome,
      imagem:     row.imagem,
      miya_group: row.miya_group,
      ml: mlPrice !== null ? {
        precoNovo:     mlPrice,
        precoAnterior: row.preco_ml,
        desconto:      quedaMl ? calcDesconto(row.preco_ml, mlPrice) : null,
        url:           row.link_ml ?? row.link_ml_direto,
        dropped:       quedaMl,
      } : null,
      amazon: (amazonPrice !== null || row.preco_amazon) ? {
        precoNovo:     amazonPrice ?? row.preco_amazon,
        precoAnterior: amazonPrice !== null ? row.preco_amazon : row.preco_amazon_anterior,
        desconto:      quedaAmazon ? calcDesconto(
                         amazonPrice !== null ? row.preco_amazon : row.preco_amazon_anterior,
                         amazonPrice ?? row.preco_amazon
                       ) : null,
        url:           row.link_amazon,
        dropped:       quedaAmazon,
      } : null,
      shopee: (shopeePrice !== null || row.preco_shopee) ? {
        precoNovo:     shopeePrice ?? row.preco_shopee,
        precoAnterior: shopeePrice !== null ? row.preco_shopee : row.preco_shopee_anterior,
        desconto:      quedaShopee ? calcDesconto(
                         shopeePrice !== null ? row.preco_shopee : row.preco_shopee_anterior,
                         shopeePrice ?? row.preco_shopee
                       ) : null,
        url:           row.link_shopee,
        dropped:       quedaShopee,
        manual:        shopeePrice === null,
      } : null,
    };

    // --- Gatilho + envio imediato ---
    if (!row.alerta_enviado_em) {
      console.log(`🆕 ${row.nome} — novo produto`);
      await enviarAlerta({ ...alertaBase, tipo: 'novo' });
    } else if (temQueda) {
      if (quedaMl)     console.log(`🔥 ${row.nome} — ML: R$ ${row.preco_ml} → R$ ${mlPrice} (-${calcDesconto(row.preco_ml, mlPrice)}%)`);
      if (quedaAmazon) console.log(`🔥 ${row.nome} — Amazon: R$ ${row.preco_amazon} → R$ ${amazonPrice} (-${calcDesconto(row.preco_amazon, amazonPrice)}%)`);
      if (quedaShopee) console.log(`🔥 ${row.nome} — Shopee: R$ ${row.preco_shopee} → R$ ${shopeePrice} (-${calcDesconto(row.preco_shopee, shopeePrice)}%)`);
      await enviarAlerta({ ...alertaBase, tipo: 'queda' });
    } else if (alertaMaisDeNDias(row.alerta_enviado_em, 2)) {
      if (reenviosNaJanela >= MAX_REENVIOS_POR_JANELA) {
        console.log(`⏭️  ${row.nome} — reenvio pulado (limite de ${MAX_REENVIOS_POR_JANELA} reenvios por janela atingido)`);
      } else {
        console.log(`🔁 ${row.nome} — reenvio (último alerta há mais de 2 dias)`);
        await enviarAlerta({ ...alertaBase, tipo: 'reenvio' });
        reenviosNaJanela++;
      }
    } else {
      console.log(`✅ ${row.nome} — R$ ${mlPrice ?? '?'} (sem queda)`);
    }
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
