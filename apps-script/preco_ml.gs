// ============================================================
// BUSCA DE PREÇOS — Mercado Livre
// API pública, sem autenticação necessária.
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

    const url = row[col('link_ml')];
    if (!url) continue;

    // Usa link_ml_direto para extrair o ID (link limpo sem redirecionamento)
    const urlDireto = row[col('link_ml_direto')];
    const urlParaId = urlDireto ? String(urlDireto) : String(url);
    // Prioriza wid=MLB... (item real), senão pega primeiro MLB no path
    const matchWid = urlParaId.match(/[?&]wid=(MLB\d+)/);
    const matchPath = urlParaId.match(/MLB\d+/);
    const itemId = matchWid ? matchWid[1] : (matchPath ? matchPath[0] : null);
    if (!itemId) continue;

    try {
      // Chama o proxy no Vercel (ML bloqueia IPs do Apps Script diretamente)
      const proxyUrl = `${ML_PROXY_URL}?secret=${REVALIDATE_SECRET}&id=${itemId}`;
      const resp = UrlFetchApp.fetch(proxyUrl, { muteHttpExceptions: true });

      if (resp.getResponseCode() !== 200) {
        Logger.log(`ML proxy erro ${resp.getResponseCode()} (${itemId}): ${resp.getContentText()}`);
        continue;
      }

      const data = JSON.parse(resp.getContentText());
      const novoPreco = data.price ?? null;

      if (!novoPreco) {
        Logger.log(`ML sem preço (${itemId})`);
        continue;
      }

      const precoAtual = row[col('preco_ml')];
      const rowNum = i + 1;

      if (precoAtual && Number(precoAtual) > 0) {
        sheet.getRange(rowNum, col('preco_ml_anterior') + 1).setValue(precoAtual);
      }

      sheet.getRange(rowNum, col('preco_ml') + 1).setValue(novoPreco);
      Logger.log(`ML OK: ${itemId} → R$ ${novoPreco}`);

    } catch (e) {
      Logger.log(`Erro ML (${itemId}): ${e.message}`);
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
