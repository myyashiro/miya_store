// ============================================================
// BUSCA DE PREÇOS — Amazon
// Requer acesso à PA-API (Amazon Product Advertising API).
// Pré-requisito: conta aprovada no Amazon Associates (pode levar dias).
// Implementar só após aprovação. O restante da automação funciona sem isso.
// ============================================================

// Preencha após obter credenciais da PA-API
const AMAZON_ACCESS_KEY = 'SEU_ACCESS_KEY';
const AMAZON_SECRET_KEY = 'SEU_SECRET_KEY';
const AMAZON_PARTNER_TAG = 'SEU_ASSOCIATE_TAG';
const AMAZON_REGION = 'us-east-1'; // PA-API usa us-east-1 mesmo para Brasil (amazon.com.br)
const AMAZON_HOST = 'webservices.amazon.com.br';

function atualizarPrecosAmazon() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const dados = sheet.getDataRange().getValues();
  const headers = dados[0];

  const col = (nome) => headers.indexOf(nome);

  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];

    const ativo = String(row[col('ativo')]).toLowerCase();
    if (ativo !== 'true' && ativo !== 'sim') continue;

    const url = row[col('link_amazon')];
    if (!url) continue;

    // Extrai o ASIN da URL (ex: /dp/B08N5LNQCX)
    const match = String(url).match(/\/dp\/([A-Z0-9]{10})/);
    if (!match) continue;

    const asin = match[1];

    try {
      const novoPreco = _buscarPrecoAmazon(asin);
      if (!novoPreco) continue;

      const precoAtual = row[col('preco_amazon')];
      const rowNum = i + 1;

      if (precoAtual && Number(precoAtual) > 0) {
        sheet.getRange(rowNum, col('preco_amazon_anterior') + 1).setValue(precoAtual);
      }

      sheet.getRange(rowNum, col('preco_amazon') + 1).setValue(novoPreco);
      Logger.log(`Amazon OK: ${asin} → R$ ${novoPreco}`);

    } catch (e) {
      Logger.log(`Erro Amazon (${asin}): ${e.message}`);
    }
  }
}

// Chama a PA-API para obter o preço de um ASIN
// Documentação: https://webservices.amazon.com.br/paapi5/documentation/get-items.html
function _buscarPrecoAmazon(asin) {
  const payload = JSON.stringify({
    ItemIds: [asin],
    Resources: ['Offers.Listings.Price'],
    PartnerTag: AMAZON_PARTNER_TAG,
    PartnerType: 'Associates',
    Marketplace: 'www.amazon.com.br',
  });

  const amzDate = _amzDate();
  const dateStamp = amzDate.substring(0, 8);
  const target = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
  const contentType = 'application/json; charset=utf-8';

  const canonicalHeaders =
    `content-encoding:amz-1.0\n` +
    `content-type:${contentType}\n` +
    `host:${AMAZON_HOST}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;

  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';
  const payloadHash = _sha256Hex(payload);

  const canonicalRequest =
    `POST\n/paapi5/getitems\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${AMAZON_REGION}/ProductAdvertisingAPI/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${_sha256Hex(canonicalRequest)}`;

  const signingKey = _getSignatureKey(AMAZON_SECRET_KEY, dateStamp, AMAZON_REGION, 'ProductAdvertisingAPI');
  const signature = _hmacHex(signingKey, stringToSign);

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${AMAZON_ACCESS_KEY}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const options = {
    method: 'post',
    headers: {
      'content-encoding': 'amz-1.0',
      'content-type': contentType,
      'host': AMAZON_HOST,
      'x-amz-date': amzDate,
      'x-amz-target': target,
      'Authorization': authHeader,
    },
    payload: payload,
    muteHttpExceptions: true,
  };

  const resp = UrlFetchApp.fetch(`https://${AMAZON_HOST}/paapi5/getitems`, options);
  const data = JSON.parse(resp.getContentText());

  const item = data?.ItemsResult?.Items?.[0];
  const listing = item?.Offers?.Listings?.[0];
  const price = listing?.Price?.Amount;

  return price ? Number(price) : null;
}

// --- Helpers de assinatura AWS4 ---

function _amzDate() {
  const now = new Date();
  return Utilities.formatDate(now, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

function _sha256Hex(message) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    message,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function _hmacBytes(key, message) {
  return Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    message,
    key,
    Utilities.Charset.UTF_8
  );
}

function _hmacHex(key, message) {
  const bytes = _hmacBytes(key, message);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function _getSignatureKey(key, dateStamp, region, service) {
  const kDate    = _hmacBytes('AWS4' + key, dateStamp);
  const kRegion  = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, region, kDate);
  const kService = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, service, kRegion);
  const kSigning = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, 'aws4_request', kService);
  return kSigning;
}
