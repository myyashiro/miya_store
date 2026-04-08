// ============================================================
// SETUP DE TRIGGERS — rodar UMA VEZ manualmente
// Extensions → Apps Script → selecionar "setupTriggers" → ▶ Executar
// ============================================================

function setupTriggers() {
  // Remove todos os triggers existentes para evitar duplicatas
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Atualiza preços do Mercado Livre a cada 6 horas
  ScriptApp.newTrigger('atualizarPrecosMl')
    .timeBased()
    .everyHours(6)
    .create();

  // Verifica alertas (produto novo ou queda de preço) a cada 5 minutos
  ScriptApp.newTrigger('verificarAlertas')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Triggers configurados com sucesso.');
}

// ============================================================
// TESTE MANUAL — valida o envio de WhatsApp sem trigger
// Útil para testar antes de ativar a automação.
// ============================================================

function testarWhatsApp() {
  const mensagem =
    '✅ *Teste miya-store*\n' +
    'Se você recebeu esta mensagem, a integração Zapi está funcionando!';
  _enviarWhatsApp(mensagem);
  Logger.log('Mensagem de teste enviada.');
}

// ============================================================
// EXECUÇÃO MANUAL ÚNICA — força atualização agora (sem esperar trigger)
// ============================================================

function rodarAgora() {
  atualizarPrecosMl();
  verificarAlertas();
  Logger.log('Execução manual concluída.');
}
