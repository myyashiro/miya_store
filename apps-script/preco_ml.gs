// ============================================================
// BUSCA DE PREÇOS — Mercado Livre
// Proxy no Vercel faz scraping da página do produto.
// Trigger: a cada 6 horas (configurado em setup.gs)
// ============================================================

function atualizarPrecosMl() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const dados = sheet.getDataRange().getValues();
  const headers = dados[0];

  const col = (nome) => headers.indexOf(nome);

  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];

    const ativo = String(row[col('ativo')]).toLowerCase();
    if (ativo !== 'true' && ativo !== 'sim') continue;

    // Usa link_ml_direto se disponível, senão link_ml
    const urlDireto = row[col('link_ml_direto')];
    const urlFallback = row[col('link_ml')];
    const urlProduto = urlDireto ? String(urlDireto) : (urlFallback ? String(urlFallback) : null);
    if (!urlProduto) continue;

    try {
      // Envia a URL completa para o proxy no Vercel
      const proxyUrl = `${ML_PROXY_URL}?secret=${REVALIDATE_SECRET}&url=${encodeURIComponent(urlProduto)}`;
      const resp = UrlFetchApp.fetch(proxyUrl, { muteHttpExceptions: true });

      if (resp.getResponseCode() !== 200) {
        Logger.log(`ML proxy erro ${resp.getResponseCode()} (${urlProduto}): ${resp.getContentText()}`);
        continue;
      }

      const data = JSON.parse(resp.getContentText());
      const novoPreco = data.price ?? null;

      if (!novoPreco) {
        Logger.log(`ML sem preço: ${urlProduto}`);
        continue;
      }

      const nome = row[col('nome')] || urlProduto;
      const precoAtual = row[col('preco_ml')];
      const rowNum = i + 1;

      if (precoAtual && Number(precoAtual) > 0) {
        sheet.getRange(rowNum, col('preco_ml_anterior') + 1).setValue(precoAtual);
      }

      sheet.getRange(rowNum, col('preco_ml') + 1).setValue(novoPreco);
      Logger.log(`ML OK: ${nome} → R$ ${novoPreco}`);

    } catch (e) {
      Logger.log(`Erro ML (${urlProduto}): ${e.message}`);
    }
  }

  _revalidarSite();
}

function _revalidarSite() {
  if (!REVALIDATE_URL) return;
  try {
    UrlFetchApp.fetch(`${REVALIDATE_URL}?secret=${REVALIDATE_SECRET}`);
    Logger.log('Cache do site revalidado.');
  } catch (e) {
    Logger.log(`Erro ao revalidar site: ${e.message}`);
  }
}
