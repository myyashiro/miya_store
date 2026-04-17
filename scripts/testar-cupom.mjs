// Uso: node scripts/testar-cupom.mjs <URL_DO_PRODUTO>
// Exemplo: node scripts/testar-cupom.mjs "https://www.mercadolivre.com.br/..."

const url = process.argv[2];
if (!url) { console.error('Passe a URL como argumento'); process.exit(1); }

console.log(`Buscando: ${url}\n`);

const isAmazon = url.includes('amazon.com') || url.includes('amzn.to') || url.includes('amzn.eu');

const res = await fetch(new URL(url).href, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  },
  redirect: 'follow',
});

const html = await res.text();
console.log(`HTML recebido: ${html.length} bytes\n`);

const padroesMl = [
  { nome: '[ML] coupon_discount (JSON)',      regex: /"coupon_discount"\s*:\s*([\d.]+)/ },
  { nome: '[ML] poly-coupon + %',             regex: /poly-coupon[\s\S]{0,600}/ },
  { nome: '[ML] cupom de X%',                 regex: /cup[oô]m\s+de\s+(\d+)\s*%/i },
  { nome: '[ML] X% cupom',                    regex: /(\d+)\s*%\s+(?:de\s+)?cup[oô]m/i },
  { nome: '[ML] ui-vpp-coupons-awareness %',  regex: /ui-vpp-coupons-awareness[\s\S]{0,600}?(\d+)\s*%\s*OFF/ },
  { nome: '[ML] X% OFF será aplicado',        regex: /(\d+)\s*%\s*OFF\s*ser[aá]\s*aplicado/i },
  { nome: '[ML] Você economiza com cupom',    regex: /Voc[eê]\s+economiza\s+R\$[\s\S]{0,10}com\s+cup[oô]m/i },
  { nome: '[ML] cupom R$ fixo c/ mínimo',     regex: /coupon-awareness-row-label[\s\S]{0,800}?aria-label="([\d,]+)\s*reais"[\s\S]{0,400}?OFF\.\s*Compra m[ií]nima[\s\S]{0,200}?aria-label="([\d,]+)\s*reais"/ },
  { nome: '[ML] cupom R$ fixo s/ mínimo',     regex: /coupon-awareness-row-label[\s\S]{0,400}?aria-label="([\d,]+)\s*reais"/ },
  { nome: '[ML] cupom R$ valor fixo (texto)', regex: /cup[oô]m[^R\d]{0,40}R\$\s*([\d.,]+)/i },
];

const padroesAmazon = [
  { nome: '[AMZ] Aplique o cupom de X%',  regex: /Aplique o cup[oô]m de (\d+)%/i },
  { nome: '[AMZ] couponBadge + %',        regex: /id="couponBadge[^"]*"[\s\S]{0,300}/ },
  { nome: '[AMZ] promotionPercent (JSON)',regex: /"promotionPercent"\s*:\s*(\d+)/ },
  { nome: '[AMZ] cupom X% genérico',      regex: /cup[oô]m[^%\d]{0,60}(\d+)\s*%/i },
  { nome: '[AMZ] cupom R$ valor fixo',          regex: /cup[oô]m[^R\d]{0,40}R\$\s*([\d.,]+)/i },
  { nome: '[AMZ] código c/ valor (Economize)', regex: /[Ee]conomize\s+R\$\s*([\d.,]+)\s+com\s+o\s+cup[oô]m\s+([A-Z0-9]+)/ },
  { nome: '[AMZ] código (cupom X / cupom: X)', regex: /cup[oô]m:?\s+([A-Z0-9]{4,})\.?\s*Desconto oferecido pela Amazon/i },
  { nome: '[AMZ] código PSP (salvo na conta)', regex: /Cupom de desconto ([A-Z0-9]{4,}) salvo em sua conta[\s\S]{0,500}?navigate:psp/ },
];

const padroes = isAmazon ? padroesAmazon : padroesMl;

let algumMatch = false;
for (const p of padroes) {
  const m = html.match(p.regex);
  if (m) {
    algumMatch = true;
    const trecho = m[0].slice(0, 120).replace(/\s+/g, ' ');
    console.log(`✅ ${p.nome}`);
    console.log(`   Trecho: "${trecho}"`);
    if (m[1]) console.log(`   Valor capturado: ${m[1]}`);
    if (m[2]) console.log(`   Compra mínima: ${m[2]}`);
    console.log();
  } else {
    console.log(`❌ ${p.nome}`);
  }
}

if (!algumMatch) {
  console.log('\nNenhum padrão encontrou cupom. Trechos relevantes do HTML:');
  const trechos = [...html.matchAll(/cup[oô]m[\s\S]{0,200}/gi)].slice(0, 3);
  trechos.forEach((t, i) => console.log(`\n[${i+1}] ...${t[0].slice(0, 200).replace(/\s+/g, ' ')}...`));
}
