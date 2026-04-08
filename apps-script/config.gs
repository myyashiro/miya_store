// ============================================================
// CONFIGURAÇÕES GLOBAIS — miya-store
// Preencha antes de rodar qualquer script.
// ============================================================

// --- Zapi (fase de teste) ---
const ZAPI_INSTANCE_ID   = '3F1429FF7EB542B750724AC8C214C6FF';
const ZAPI_TOKEN         = '6BA3E205D5CCAFC98F26D4EC';
const ZAPI_CLIENT_TOKEN  = 'F9067b81d2c024e25b31b7915a46afa27S';

// ID do grupo WhatsApp no formato 'XXXXXXXXXXX@g.us'
// Para obter: envie uma mensagem no grupo via Zapi e leia o campo "phone" da resposta
const WHATSAPP_GROUP_ID  = '120363425172443221-group';

// --- Planilha ---
// Nome da aba da planilha (verificar em Extensions → Apps Script → planilha vinculada)
const SHEET_NAME = 'Página1';

// --- Regras de alerta ---
const PRECO_QUEDA_THRESHOLD = 0.10;  // 10% de queda para disparar alerta de preço
const ALERTA_COOLDOWN_HORAS = 24;    // horas mínimas entre alertas do mesmo produto

// Ordem de preferência de plataforma para montar o link no alerta
const LINK_PRIORIDADE = ['ml', 'amazon', 'shopee'];

// --- Site (Vercel) ---
// Usado como proxy para buscar preços do ML (evita bloqueio de IP do Apps Script)
// e para revalidar o cache após atualização de preços.
const SITE_URL          = 'https://miya-store.vercel.app';  // sem barra no final
const REVALIDATE_SECRET = 'miya2025';

// Atalhos (não editar)
const REVALIDATE_URL    = SITE_URL ? `${SITE_URL}/api/revalidate` : '';
const ML_PROXY_URL      = SITE_URL ? `${SITE_URL}/api/preco-ml`   : '';
