/**
 * Teste da API de Afiliados Shopee (GraphQL).
 * Uso: node scripts/test-shopee-api.mjs <url_shopee>
 */
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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

const APP_ID = process.env.SHOPEE_AFFILIATE_APP_ID;
const SECRET  = process.env.SHOPEE_AFFILIATE_SECRET;
const rawUrl  = process.argv[2];

if (!APP_ID || !SECRET) {
  console.error('SHOPEE_AFFILIATE_APP_ID e SHOPEE_AFFILIATE_SECRET não configurados no .env.local');
  process.exit(1);
}
if (!rawUrl) {
  console.error('Uso: node scripts/test-shopee-api.mjs <url_shopee>');
  process.exit(1);
}

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

// Auth: SHA256(AppId + Timestamp + Payload + Secret)
function buildAuthHeader(body) {
  const ts  = Math.floor(Date.now() / 1000);
  const sig = createHash('sha256').update(`${APP_ID}${ts}${body}${SECRET}`).digest('hex');
  return {
    Authorization: `SHA256 Credential=${APP_ID}, Timestamp=${ts}, Signature=${sig}`,
    'Content-Type': 'application/json',
  };
}

async function gql(query) {
  const body = JSON.stringify({ query });
  const res  = await fetch(ENDPOINT, { method: 'POST', headers: buildAuthHeader(body), body });
  return res.json();
}

function extrairIds(url) {
  try {
    const p = new URL(url);
    const m1 = p.pathname.match(/\/product\/(\d+)\/(\d+)/);
    if (m1) return { shopid: m1[1], itemid: m1[2] };
    const m2 = p.pathname.match(/[.-]i\.(\d+)\.(\d+)/);
    if (m2) return { shopid: m2[1], itemid: m2[2] };
  } catch { }
  return null;
}

async function main() {
  console.log(`\nURL: ${rawUrl}`);
  const ids = extrairIds(rawUrl);
  if (!ids) { console.error('Não foi possível extrair shopid/itemid da URL.'); process.exit(1); }
  console.log(`IDs: shopid=${ids.shopid}, itemid=${ids.itemid}`);

  const json = await gql(`{
    productOfferV2(itemId: ${ids.itemid}, shopId: ${ids.shopid}, limit: 1) {
      nodes {
        itemId shopId productName
        price priceMin priceMax priceDiscountRate
        imageUrl productLink offerLink
      }
    }
  }`);

  const item = json?.data?.productOfferV2?.nodes?.[0];
  if (!item) {
    console.log('\n❌ Produto não encontrado na API.');
    console.log('Resposta completa:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const price = Number(item.price);
  console.log('\n========================================');
  console.log(`✅ ${item.productName}`);
  console.log(`   Preço:    R$ ${price.toFixed(2)}`);
  if (item.priceMin !== item.priceMax)
    console.log(`   Faixa:    R$ ${Number(item.priceMin).toFixed(2)} – R$ ${Number(item.priceMax).toFixed(2)}`);
  if (item.priceDiscountRate)
    console.log(`   Desconto: ${item.priceDiscountRate}% OFF`);
  console.log(`   Link afiliado: ${item.offerLink}`);
  console.log(`   Imagem:   ${item.imageUrl}`);
  console.log('========================================\n');
}

main().catch(e => { console.error('Erro:', e); process.exit(1); });
