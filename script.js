const CONFIG = {
  SUPABASE_URL: "https://oabfkwtpjkhlqpyhscwb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_VSpoG2aPN10R7dYTA2S1gw_w20uEdVJ",
  WHATSAPP_UMEC: "5583998465279",
  VALOR_UNITARIO: 10.0,
  TAXA_ENTREGA: 2.0,
  EVENTO_NOME: "Panqueca UMEC",
  EVENTO_DATA: "08/08/2026",
  EVENTO_LOCAL: "IEC Tancredo Neves",
  EVENTO_HORARIO: "A definir",
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const byId = (id) => document.getElementById(id);

const compraForm = byId("compra-form");
const consultaForm = byId("consulta-form");
const quantidadeInput = byId("quantidade");
const entregaInput = byId("entrega");
const entregaBox = byId("entrega-box");
const entregaRuaInput = byId("entrega-rua");
const entregaNumeroInput = byId("entrega-numero");
const entregaBairroInput = byId("entrega-bairro");
const entregaReferenciaInput = byId("entrega-referencia");
const entregaTelefonePreview = byId("entrega-telefone-preview");
const totalEl = byId("valor-total");
const subtotalPanquecasEl = byId("subtotal-panquecas");
const taxaEntregaEl = byId("taxa-entrega");
const taxaEntregaLinha = byId("taxa-entrega-linha");
const formaPagamentoInputs = Array.from(document.querySelectorAll('input[name="forma_pagamento"]'));
const dinheiroBox = byId("dinheiro-box");
const trocoParaInput = byId("troco-para");
const compraMsg = byId("compra-mensagem");
const consultaMsg = byId("consulta-mensagem");
const pixArea = byId("pix-area");
const consultaResultado = byId("consulta-resultado");
const baixarPdf = byId("baixar-pdf");
const pixTitulo = byId("pix-titulo");
const pixStatus = byId("pix-status");
const pixStatusTitle = byId("pix-status-title");
const pixStatusText = byId("pix-status-text");
const pixDownloadPdf = byId("pix-download-pdf");
const pixPaymentDetails = byId("pix-payment-details");
const pixPaymentActions = byId("pix-payment-actions");

let ultimaCompra = null;
let paymentPollTimer = null;
let paymentPollDeadline = 0;

const PAYMENT_POLL_INTERVAL_MS = 10000;
const PAYMENT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function setEventoInfo() {
  document.querySelectorAll("[data-evento-nome]").forEach((element) => {
    element.textContent = CONFIG.EVENTO_NOME;
  });
  document.querySelectorAll("[data-evento-data]").forEach((element) => {
    element.textContent = CONFIG.EVENTO_DATA;
  });
  document.querySelectorAll("[data-evento-local]").forEach((element) => {
    element.textContent = CONFIG.EVENTO_LOCAL;
  });
  document.querySelectorAll("[data-evento-horario]").forEach((element) => {
    element.textContent = CONFIG.EVENTO_HORARIO;
  });
  document.querySelectorAll("[data-valor-unitario]").forEach((element) => {
    element.textContent = money.format(CONFIG.VALOR_UNITARIO);
  });
  updateTotal();
}

function updateTotal() {
  const quantidade = Math.max(Number(quantidadeInput.value || 1), 1);
  const subtotal = quantidade * CONFIG.VALOR_UNITARIO;
  const taxaEntrega = entregaInput.checked ? CONFIG.TAXA_ENTREGA : 0;

  subtotalPanquecasEl.textContent = money.format(subtotal);
  taxaEntregaEl.textContent = money.format(CONFIG.TAXA_ENTREGA);
  taxaEntregaLinha.classList.toggle("hidden", !entregaInput.checked);
  totalEl.textContent = money.format(subtotal + taxaEntrega);
}

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

function setLoading(button, isLoading, loadingText) {
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
    return;
  }

  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
}

function setPixStatus(type, title, text) {
  pixStatus.className = `payment-status ${type}`.trim();
  pixStatusTitle.textContent = title;
  pixStatusText.textContent = text;
}

function stopPaymentWatcher() {
  if (paymentPollTimer) {
    clearInterval(paymentPollTimer);
    paymentPollTimer = null;
  }
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseMoneyInput(value) {
  const normalized = String(value || "").replace(",", ".").trim();
  if (!normalized) return "";
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "";
}

function getFormaPagamento() {
  return formaPagamentoInputs.find((input) => input.checked)?.value || "pix";
}

function formatPhonePreview(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits || "Informe o WhatsApp acima";
}

function getEnderecoEntrega() {
  return {
    rua: entregaRuaInput.value.trim(),
    numero: entregaNumeroInput.value.trim(),
    bairro: entregaBairroInput.value.trim(),
    referencia: entregaReferenciaInput.value.trim(),
  };
}

function formatEnderecoEntrega(data) {
  if (!data?.entrega) return "-";
  const rua = data.endereco_rua || data.entrega_rua || "";
  const numero = data.endereco_numero || data.entrega_numero || "";
  const bairro = data.endereco_bairro || data.entrega_bairro || "";
  const referencia = data.endereco_referencia || data.entrega_referencia || "";
  const endereco = [rua, numero ? `nº ${numero}` : "", bairro].filter(Boolean).join(", ");
  return [endereco, referencia ? `Referência: ${referencia}` : ""].filter(Boolean).join(" | ") || "-";
}

function updateEntregaState() {
  const entregaAtiva = entregaInput.checked;
  entregaBox.classList.toggle("hidden", !entregaAtiva);
  entregaRuaInput.required = entregaAtiva;
  entregaNumeroInput.required = entregaAtiva;
  entregaBairroInput.required = entregaAtiva;
  entregaReferenciaInput.required = false;
  entregaTelefonePreview.textContent = formatPhonePreview(byId("whatsapp").value);
  updateTotal();
}

function updatePaymentMethod() {
  const isDinheiro = getFormaPagamento() === "dinheiro";
  dinheiroBox.classList.toggle("hidden", !isDinheiro);
  trocoParaInput.disabled = !isDinheiro;
  byId("gerar-pix").textContent = isDinheiro ? "Confirmar pedido" : "Gerar Pix";
}

function validateFrontendConfig() {
  if (CONFIG.SUPABASE_URL.includes("SEU-PROJETO") || CONFIG.SUPABASE_ANON_KEY.includes("SUA_")) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_ANON_KEY no arquivo script.js antes de publicar.");
  }
}

async function callFunction(name, payload) {
  validateFrontendConfig();

  const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível concluir a solicitação.");
  }

  return data;
}

function buildWhatsAppUrl(compra) {
  const entregaTexto = compra.entrega ? `Entrega: Sim - ${formatEnderecoEntrega(compra)}` : "Entrega: Não";
  const message = [
    `Olá, realizei a compra de ${compra.quantidade} panqueca(s) da UMEC.`,
    "",
    `Nome: ${compra.nome}`,
    `E-mail: ${compra.email || "Não informado"}`,
    `WhatsApp: ${compra.whatsapp}`,
    entregaTexto,
    `Código da compra: ${compra.codigo_compra}`,
    "",
    "Segue o comprovante do pagamento.",
  ].join("\n");

  return `https://wa.me/${onlyDigits(CONFIG.WHATSAPP_UMEC)}?text=${encodeURIComponent(message)}`;
}

function buildContatoWhatsAppUrl() {
  const message = "Olá, quero falar sobre as fichas da Panqueca UMEC.";
  return `https://wa.me/${onlyDigits(CONFIG.WHATSAPP_UMEC)}?text=${encodeURIComponent(message)}`;
}

function setWhatsappContato() {
  const link = byId("whatsapp-contato");
  if (!link) return;
  link.href = buildContatoWhatsAppUrl();
}

function showPix(data, formData) {
  ultimaCompra = { ...data, ...formData };

  stopPaymentWatcher();
  pixTitulo.textContent = "Pix gerado";
  byId("codigo-compra").textContent = data.codigo_compra;
  byId("pix-copia-cola").value = data.qr_code;
  byId("pix-qrcode").src = `data:image/png;base64,${data.qr_code_base64}`;
  byId("whatsapp-comprovante").href = buildWhatsAppUrl(ultimaCompra);
  pixDownloadPdf.classList.add("hidden");
  pixDownloadPdf.removeAttribute("href");
  pixPaymentDetails.classList.remove("hidden");
  pixPaymentActions.classList.remove("hidden");
  setPixStatus("pending", "Aguardando pagamento", "Depois que o Pix for pago, a confirmação aparece aqui automaticamente por até 10 minutos.");

  pixArea.classList.remove("hidden");
  pixArea.scrollIntoView({ behavior: "smooth", block: "start" });
  startPaymentWatcher();
}

function showPaymentApproved(data) {
  stopPaymentWatcher();
  setPixStatus("success", "Pagamento Realizado", "Suas fichas foram geradas. O PDF já está disponível para download.");
  pixDownloadPdf.href = data.download_url;
  pixDownloadPdf.classList.remove("hidden");
  pixPaymentDetails.classList.add("hidden");
  pixPaymentActions.classList.add("hidden");
  setMessage(compraMsg, "Pagamento realizado. PDF disponível para download.", "success");
}

function showCashConfirmed(data, formData) {
  ultimaCompra = { ...data, ...formData };
  stopPaymentWatcher();
  pixTitulo.textContent = "Pedido confirmado";
  byId("codigo-compra").textContent = data.codigo_compra;
  pixPaymentDetails.classList.add("hidden");
  pixPaymentActions.classList.add("hidden");
  pixDownloadPdf.href = data.download_url;
  pixDownloadPdf.classList.toggle("hidden", !data.download_url);
  setPixStatus(
    "success",
    "Pedido em dinheiro confirmado",
    "Suas fichas foram registradas. Separe o pagamento em dinheiro no dia ou na entrega.",
  );
  pixArea.classList.remove("hidden");
  pixArea.scrollIntoView({ behavior: "smooth", block: "start" });
  setMessage(compraMsg, "Pedido em dinheiro confirmado. PDF disponível para download.", "success");
}

async function checkPaymentStatus({ showPending = false } = {}) {
  if (!ultimaCompra?.codigo_compra) return false;

  const data = await callFunction("consultar-compra", {
    codigo_compra: ultimaCompra.codigo_compra,
  });

  const isConfirmado = ["pago", "dinheiro"].includes(data.status_pagamento);

  if (isConfirmado && data.download_url) {
    showPaymentApproved(data);
    return true;
  }

  if (isConfirmado) {
    setPixStatus("preparing", "Pagamento Realizado", "Estamos preparando o PDF. O botão de download aparece em instantes.");
    pixPaymentDetails.classList.add("hidden");
    pixPaymentActions.classList.add("hidden");
    return false;
  }

  if (showPending) {
    setPixStatus("pending", "Aguardando pagamento", "Pagamento ainda não confirmado. A verificação automática continua ativa.");
  }

  return false;
}

function startPaymentWatcher() {
  paymentPollDeadline = Date.now() + PAYMENT_POLL_TIMEOUT_MS;

  paymentPollTimer = setInterval(async () => {
    if (Date.now() > paymentPollDeadline) {
      stopPaymentWatcher();
      setPixStatus("pending", "Aguardando pagamento", "O acompanhamento automático terminou. Use Consultar Compra para verificar depois.");
      return;
    }

    try {
      await checkPaymentStatus();
    } catch (error) {
      console.warn("Falha ao consultar pagamento", error);
    }
  }, PAYMENT_POLL_INTERVAL_MS);
}

compraForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = byId("gerar-pix");
  const formaPagamento = getFormaPagamento();
  const formData = {
    nome: byId("nome").value.trim(),
    whatsapp: onlyDigits(byId("whatsapp").value),
    email: byId("email").value.trim().toLowerCase(),
    quantidade: Number(quantidadeInput.value),
    forma_pagamento: formaPagamento,
    troco_para: formaPagamento === "dinheiro" ? parseMoneyInput(trocoParaInput.value) : "",
    entrega: entregaInput.checked,
    endereco_entrega: getEnderecoEntrega(),
  };

  if (!formData.nome || !formData.whatsapp || formData.quantidade < 1) {
    setMessage(compraMsg, "Preencha nome, WhatsApp e quantidade corretamente.", "error");
    return;
  }

  if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    setMessage(compraMsg, "Informe um e-mail válido ou deixe o campo em branco.", "error");
    return;
  }

  if (formData.entrega && (!formData.endereco_entrega.rua || !formData.endereco_entrega.numero || !formData.endereco_entrega.bairro)) {
    setMessage(compraMsg, "Informe rua, número e bairro para entrega.", "error");
    return;
  }

  const totalPedido = (formData.quantidade * CONFIG.VALOR_UNITARIO) + (formData.entrega ? CONFIG.TAXA_ENTREGA : 0);
  if (formData.forma_pagamento === "dinheiro" && formData.troco_para && Number(formData.troco_para) <= totalPedido) {
    setMessage(compraMsg, "O valor para troco deve ser maior que o total do pedido.", "error");
    return;
  }

  setLoading(button, true, formaPagamento === "dinheiro" ? "Confirmando..." : "Gerando Pix...");
  setMessage(compraMsg, "");

  try {
    const data = await callFunction("criar-pagamento", formData);
    if (data.forma_pagamento === "dinheiro") {
      showCashConfirmed(data, formData);
    } else {
      showPix(data, formData);
      setMessage(compraMsg, "Pix gerado com sucesso. A confirmação será acompanhada por até 10 minutos.", "success");
    }
  } catch (error) {
    setMessage(compraMsg, error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

byId("copiar-pix").addEventListener("click", async () => {
  const code = byId("pix-copia-cola").value;

  try {
    await navigator.clipboard.writeText(code);
    setMessage(compraMsg, "Código Pix copiado.", "success");
  } catch {
    byId("pix-copia-cola").select();
    document.execCommand("copy");
    setMessage(compraMsg, "Código Pix copiado.", "success");
  }
});

byId("verificar-pagamento").addEventListener("click", async () => {
  const button = byId("verificar-pagamento");

  setLoading(button, true, "Verificando...");
  try {
    const approved = await checkPaymentStatus({ showPending: true });
    if (!approved) {
      setMessage(compraMsg, "Pagamento ainda não confirmado.", "");
    }
  } catch (error) {
    setMessage(compraMsg, error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

byId("fechar-pix").addEventListener("click", () => {
  pixPaymentDetails.classList.add("hidden");
  setPixStatus("pending", "Acompanhando pagamento", "Quando o pagamento for confirmado, o botão do PDF aparece aqui.");
  pixArea.scrollIntoView({ behavior: "smooth", block: "start" });
});

consultaForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = byId("consultar-compra");
  const payload = {
    codigo_compra: byId("consulta-codigo").value.trim(),
    email: byId("consulta-email").value.trim().toLowerCase(),
    whatsapp: onlyDigits(byId("consulta-whatsapp").value),
  };

  if (!payload.codigo_compra && !payload.email && !payload.whatsapp) {
    setMessage(consultaMsg, "Informe o código da compra, e-mail ou WhatsApp.", "error");
    return;
  }

  setLoading(button, true, "Consultando...");
  setMessage(consultaMsg, "");
  consultaResultado.classList.add("hidden");
  baixarPdf.classList.add("hidden");

  try {
    const data = await callFunction("consultar-compra", payload);

    if (data.tipo_consulta === "resumo_cliente") {
      byId("resultado-status-label").textContent = "Resultado";
      byId("resultado-quantidade-label").textContent = "Fichas pagas";
      byId("resultado-total-label").textContent = "Total pago";
      byId("resultado-data-label").textContent = "Compras pagas";

      byId("resultado-status").textContent = data.quantidade_total_paga > 0
        ? "Pagamentos confirmados"
        : "Nenhuma ficha paga";
      byId("resultado-quantidade").textContent = `${data.quantidade_total_paga || 0} ficha(s)`;
      byId("resultado-total").textContent = money.format(Number(data.valor_total_pago || 0));
      byId("resultado-data").textContent = `${data.compras_pagas || 0} compra(s)`;

      byId("resultado-entrega-row").classList.add("hidden");
      byId("resultado-endereco-row").classList.add("hidden");

      consultaResultado.classList.remove("hidden");
      setMessage(
        consultaMsg,
        data.quantidade_total_paga > 0
          ? "Total de fichas pagas encontrado. Para baixar um PDF, consulte pelo código da compra."
          : "Nenhuma compra paga encontrada para esse contato.",
        data.quantidade_total_paga > 0 ? "success" : "",
      );
      return;
    }

    const isPago = ["pago", "dinheiro"].includes(data.status_pagamento);

    byId("resultado-status-label").textContent = "Status";
    byId("resultado-quantidade-label").textContent = "Quantidade";
    byId("resultado-total-label").textContent = "Valor total";
    byId("resultado-data-label").textContent = "Criada em";

    byId("resultado-status").textContent = isPago
      ? (data.status_pagamento === "dinheiro" ? "Pedido em dinheiro confirmado" : "Pagamento confirmado")
      : "Pagamento ainda não confirmado";
    byId("resultado-quantidade").textContent = data.quantidade || "-";
    byId("resultado-total").textContent = data.valor_total ? money.format(Number(data.valor_total)) : "-";
    byId("resultado-entrega").textContent = data.entrega ? "Sim" : "Não";
    byId("resultado-endereco").textContent = formatEnderecoEntrega(data);
    byId("resultado-entrega-row").classList.remove("hidden");
    byId("resultado-endereco-row").classList.toggle("hidden", !data.entrega);
    byId("resultado-data").textContent = data.created_at
      ? new Date(data.created_at).toLocaleString("pt-BR")
      : "-";

    if (isPago && data.download_url) {
      baixarPdf.href = data.download_url;
      baixarPdf.classList.remove("hidden");
    }

    consultaResultado.classList.remove("hidden");
    setMessage(consultaMsg, isPago ? "Pedido confirmado." : "Pagamento ainda não confirmado.", isPago ? "success" : "");
  } catch (error) {
    setMessage(consultaMsg, error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

quantidadeInput.addEventListener("input", updateTotal);
entregaInput.addEventListener("change", updateEntregaState);
byId("whatsapp").addEventListener("input", updateEntregaState);
formaPagamentoInputs.forEach((input) => input.addEventListener("change", updatePaymentMethod));
setEventoInfo();
updateEntregaState();
updatePaymentMethod();
setWhatsappContato();
