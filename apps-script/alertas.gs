// ============================================================
// ALERTAS NO WHATSAPP — miya-store
// Dois gatilhos:
//   A) Produto novo (ativo=true e alerta_enviado_em vazio)
//   B) Queda de preço >= PRECO_QUEDA_THRESHOLD em ML ou Amazon
// Anti-spam: respeita ALERTA_COOLDOWN_HORAS entre alertas do mesmo produto.
// Trigger: a cada 5 minutos (configurado em setup.gs)
// ============================================================

function verificarAlertas() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const dados = sheet.getDataRange().getValues();
  const headers = dados[0];

  const col = (nome) => headers.indexOf(nome);
  const agora = new Date();

  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];

    const ativo = String(row[col('ativo')]).toLowerCase();
    if (ativo !== 'true' && ativo !== 'sim') continue;

    const nome = row[col('nome')];
    if (!nome) continue;

    const alertaEnviadoEm = row[col('alerta_enviado_em')];
    const rowNum = i + 1;

    // Verifica cooldown — só alerta se passou o tempo mínimo desde o último
    if (alertaEnviadoEm) {
      const ultimoAlerta = new Date(alertaEnviadoEm);
      const horasDesde = (agora - ultimoAlerta) / (1000 * 60 * 60);
      if (horasDesde < ALERTA_COOLDOWN_HORAS) continue;
    }

    const imagem = row[col('imagem')] || null;

    // --- Gatilho A: Produto novo ---
    if (!alertaEnviadoEm) {
      const mensagem = _mensagemProdutoNovo(row, col);
      if (mensagem) {
        _enviarWhatsApp(mensagem, imagem);
        sheet.getRange(rowNum, col('alerta_enviado_em') + 1).setValue(agora);
        Logger.log(`Alerta NOVO: ${nome}`);
        continue; // não verifica queda no mesmo ciclo para produtos novos
      }
    }

    // --- Gatilho B: Queda de preço ---
    const alertaQueda = _verificarQueda(row, col, nome);
    if (alertaQueda) {
      _enviarWhatsApp(alertaQueda, imagem);
      sheet.getRange(rowNum, col('alerta_enviado_em') + 1).setValue(agora);
      Logger.log(`Alerta QUEDA: ${nome}`);
    }
  }
}

// Monta mensagem para produto novo
function _mensagemProdutoNovo(row, col) {
  const nome = row[col('nome')];
  const marca = row[col('marca')];

  const plataformas = [
    { emoji: '🛍️', label: 'Mercado Livre', preco: 'preco_ml', link: 'link_ml' },
    { emoji: '📦', label: 'Amazon',         preco: 'preco_amazon', link: 'link_amazon' },
    { emoji: '🏷️', label: 'Shopee',         preco: 'preco_shopee', link: 'link_shopee' },
  ];

  const linhas = plataformas
    .filter(p => row[col(p.link)])
    .map(p => {
      const preco = Number(row[col(p.preco)]);
      const precoStr = preco > 0 ? ` ${_formatarPreco(preco)}` : '';
      return `${p.emoji} ${p.label}:${precoStr} → ${row[col(p.link)]}`;
    });

  if (linhas.length === 0) return null;

  let msg = `🆕 *${nome}*`;
  if (marca) msg += `\n_${marca}_`;
  msg += `\n\n${linhas.join('\n')}`;
  return msg;
}

// Verifica se houve queda de preço em ML ou Amazon
function _verificarQueda(row, col, nome) {
  const marca = row[col('marca')];

  const checks = [
    { emoji: '🛍️', label: 'Mercado Livre', atual: 'preco_ml', anterior: 'preco_ml_anterior', link: 'link_ml' },
    { emoji: '📦', label: 'Amazon',         atual: 'preco_amazon', anterior: 'preco_amazon_anterior', link: 'link_amazon' },
  ];

  const outras = [
    { emoji: '🛍️', label: 'Mercado Livre', preco: 'preco_ml', link: 'link_ml' },
    { emoji: '📦', label: 'Amazon',         preco: 'preco_amazon', link: 'link_amazon' },
    { emoji: '🏷️', label: 'Shopee',         preco: 'preco_shopee', link: 'link_shopee' },
  ];

  for (const c of checks) {
    const atual = Number(row[col(c.atual)]);
    const anterior = Number(row[col(c.anterior)]);
    const link = row[col(c.link)];

    if (!atual || !anterior || atual <= 0 || anterior <= 0 || !link) continue;

    const queda = (anterior - atual) / anterior;
    if (queda < PRECO_QUEDA_THRESHOLD) continue;

    const pct = Math.round(queda * 100);

    let msg = `🔥 *${nome}* — Queda de preço!\n`;
    if (marca) msg += `_${marca}_\n`;
    msg += `\n${c.emoji} ${c.label}: ${_formatarPreco(anterior)} → ${_formatarPreco(atual)} (-${pct}%)\n`;
    msg += `${link}`;

    // Outras opções (plataformas que não caíram)
    const outrasLinhas = outras
      .filter(p => p.label !== c.label && row[col(p.link)])
      .map(p => {
        const preco = Number(row[col(p.preco)]);
        const precoStr = preco > 0 ? ` ${_formatarPreco(preco)}` : '';
        return `${p.emoji} ${p.label}:${precoStr} → ${row[col(p.link)]}`;
      });

    if (outrasLinhas.length > 0) {
      msg += `\n\n💰 Outras opções:\n${outrasLinhas.join('\n')}`;
    }

    return msg;
  }

  return null;
}

// Retorna o melhor link disponível na ordem de LINK_PRIORIDADE
function _melhorLink(row, col) {
  for (const plataforma of LINK_PRIORIDADE) {
    const link = row[col(`link_${plataforma}`)];
    if (link) return String(link);
  }
  return null;
}

// Retorna o menor preço disponível entre as plataformas
function _melhorPreco(row, col) {
  const plataformas = ['ml', 'amazon', 'shopee'];
  const precos = plataformas
    .map(p => Number(row[col(`preco_${p}`)]))
    .filter(p => p > 0);
  return precos.length > 0 ? Math.min(...precos) : null;
}

function _formatarPreco(valor) {
  return `R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Envia mensagem via Zapi — com imagem (como legenda) ou só texto
// Se o envio com imagem falhar, tenta enviar só o texto (fallback)
function _enviarWhatsApp(mensagem, imagemUrl) {
  if (imagemUrl) {
    const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-image`;
    const options = {
      method: 'post',
      headers: { 'client-token': ZAPI_CLIENT_TOKEN },
      contentType: 'application/json',
      payload: JSON.stringify({ phone: WHATSAPP_GROUP_ID, image: imagemUrl, caption: mensagem }),
      muteHttpExceptions: true,
    };
    const resp = UrlFetchApp.fetch(url, options);
    Logger.log(`Zapi image response: ${resp.getResponseCode()} — ${resp.getContentText()}`);

    // Se funcionou, encerra aqui
    if (resp.getResponseCode() === 200) return;

    // Senão, cai no fallback abaixo
    Logger.log('Imagem falhou, enviando só texto como fallback.');
  }

  // Envio só texto
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`;
  const options = {
    method: 'post',
    headers: { 'client-token': ZAPI_CLIENT_TOKEN },
    contentType: 'application/json',
    payload: JSON.stringify({ phone: WHATSAPP_GROUP_ID, message: mensagem }),
    muteHttpExceptions: true,
  };
  const resp = UrlFetchApp.fetch(url, options);
  Logger.log(`Zapi text response: ${resp.getResponseCode()} — ${resp.getContentText()}`);
}
