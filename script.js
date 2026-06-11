const CONFIG = {
  SUPABASE_URL: "https://oabfkwtpjkhlqpyhscwb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_VSpoG2aPN10R7dYTA2S1gw_w20uEdVJ",
  WHATSAPP_UMEC: "5583998465279",
  VALOR_UNITARIO: 12.0,
  EVENTO_NOME: "Panqueca UMEC",
  EVENTO_DATA: "A definir",
  EVENTO_LOCAL: "UMEC Tancredo Neves",
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
const totalEl = byId("valor-total");
const compraMsg = byId("compra-mensagem");
const consultaMsg = byId("consulta-mensagem");
const pixArea = byId("pix-area");
const consultaResultado = byId("consulta-resultado");
const baixarPdf = byId("baixar-pdf");
const pixStatus = byId("pix-status");
const pixStatusTitle = byId("pix-status-title");
const pixStatusText = byId("pix-status-text");
const pixDownloadPdf = byId("pix-download-pdf");
const pixPaymentDetails = byId("pix-payment-details");
const pixPaymentActions = byId("pix-payment-actions");
const adminPanel = byId("admin-panel");
const adminLoginForm = byId("admin-login-form");
const adminContent = byId("admin-content");
const adminMsg = byId("admin-mensagem");
const adminPedidosBody = byId("admin-pedidos-body");
const adminResumo = byId("admin-resumo");

let ultimaCompra = null;
let paymentPollTimer = null;
let paymentPollDeadline = 0;
let adminSession = null;

const PAYMENT_POLL_INTERVAL_MS = 10000;
const PAYMENT_POLL_TIMEOUT_MS = 15 * 60 * 1000;

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
  totalEl.textContent = money.format(quantidade * CONFIG.VALOR_UNITARIO);
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

async function callAdmin(action) {
  if (!adminSession) {
    throw new Error("Faça login no Admin.");
  }

  const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/admin-pedidos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ ...adminSession, action }),
  });

  if (action === "pdf") {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Não foi possível gerar o PDF geral.");
    }
    return await response.blob();
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Não foi possível carregar os pedidos.");
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAdminPedidos(data) {
  const pedidos = data.pedidos || [];
  adminResumo.textContent = `${pedidos.length} pedido(s) | ${data.total_fichas_pagas || 0} ficha(s) paga(s)`;

  if (!pedidos.length) {
    adminPedidosBody.innerHTML = '<tr><td colspan="7">Nenhum pedido encontrado.</td></tr>';
    return;
  }

  adminPedidosBody.innerHTML = pedidos.map((pedido) => {
    const senhas = pedido.senhas?.length ? pedido.senhas.join(", ") : "-";
    const contato = `${escapeHtml(pedido.email)}<br>${escapeHtml(pedido.whatsapp)}`;
    return `
      <tr>
        <td>${escapeHtml(pedido.created_at_formatado)}</td>
        <td>${escapeHtml(pedido.codigo_compra)}</td>
        <td>${escapeHtml(pedido.nome)}</td>
        <td>${contato}</td>
        <td><span class="status-badge ${escapeHtml(pedido.status_pagamento)}">${escapeHtml(pedido.status_pagamento)}</span></td>
        <td>${escapeHtml(senhas)}</td>
        <td>${money.format(Number(pedido.valor_total || 0))}</td>
      </tr>
    `;
  }).join("");
}

async function loadAdminPedidos() {
  setMessage(adminMsg, "Carregando pedidos...");
  const data = await callAdmin("list");
  renderAdminPedidos(data);
  adminContent.classList.remove("hidden");
  setMessage(adminMsg, "Pedidos carregados.", "success");
}

function buildWhatsAppUrl(compra) {
  const message = [
    `Olá, realizei a compra de ${compra.quantidade} panqueca(s) da UMEC.`,
    "",
    `Nome: ${compra.nome}`,
    `E-mail: ${compra.email}`,
    `WhatsApp: ${compra.whatsapp}`,
    `Código da compra: ${compra.codigo_compra}`,
    "",
    "Segue o comprovante do pagamento.",
  ].join("\n");

  return `https://wa.me/${onlyDigits(CONFIG.WHATSAPP_UMEC)}?text=${encodeURIComponent(message)}`;
}

function showPix(data, formData) {
  ultimaCompra = { ...data, ...formData };

  stopPaymentWatcher();
  byId("codigo-compra").textContent = data.codigo_compra;
  byId("pix-copia-cola").value = data.qr_code;
  byId("pix-qrcode").src = `data:image/png;base64,${data.qr_code_base64}`;
  byId("whatsapp-comprovante").href = buildWhatsAppUrl(ultimaCompra);
  pixDownloadPdf.classList.add("hidden");
  pixDownloadPdf.removeAttribute("href");
  pixPaymentDetails.classList.remove("hidden");
  pixPaymentActions.classList.remove("hidden");
  setPixStatus("pending", "Aguardando pagamento", "Depois que o Pix for pago, a confirmação aparece aqui automaticamente por até 15 minutos.");

  pixArea.classList.remove("hidden");
  pixArea.scrollIntoView({ behavior: "smooth", block: "start" });
  startPaymentWatcher();
}

function showPaymentApproved(data) {
  stopPaymentWatcher();
  setPixStatus("success", "Pagamento Realizado", "Suas senhas foram geradas. O PDF já está disponível para download.");
  pixDownloadPdf.href = data.download_url;
  pixDownloadPdf.classList.remove("hidden");
  pixPaymentDetails.classList.add("hidden");
  pixPaymentActions.classList.add("hidden");
  setMessage(compraMsg, "Pagamento realizado. PDF disponível para download.", "success");
}

async function checkPaymentStatus({ showPending = false } = {}) {
  if (!ultimaCompra?.codigo_compra) return false;

  const data = await callFunction("consultar-compra", {
    codigo_compra: ultimaCompra.codigo_compra,
  });

  if (data.status_pagamento === "pago" && data.download_url) {
    showPaymentApproved(data);
    return true;
  }

  if (data.status_pagamento === "pago") {
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
  const formData = {
    nome: byId("nome").value.trim(),
    whatsapp: onlyDigits(byId("whatsapp").value),
    email: byId("email").value.trim().toLowerCase(),
    quantidade: Number(quantidadeInput.value),
  };

  if (!formData.nome || !formData.whatsapp || !formData.email || formData.quantidade < 1) {
    setMessage(compraMsg, "Preencha todos os campos corretamente.", "error");
    return;
  }

  setLoading(button, true, "Gerando Pix...");
  setMessage(compraMsg, "");

  try {
    const data = await callFunction("criar-pagamento", formData);
    showPix(data, formData);
    setMessage(compraMsg, "Pix gerado com sucesso. A confirmação será acompanhada por até 15 minutos.", "success");
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

    const isPago = data.status_pagamento === "pago";

    byId("resultado-status-label").textContent = "Status";
    byId("resultado-quantidade-label").textContent = "Quantidade";
    byId("resultado-total-label").textContent = "Valor total";
    byId("resultado-data-label").textContent = "Criada em";

    byId("resultado-status").textContent = isPago ? "Pagamento confirmado" : "Pagamento ainda não confirmado";
    byId("resultado-quantidade").textContent = data.quantidade || "-";
    byId("resultado-total").textContent = data.valor_total ? money.format(Number(data.valor_total)) : "-";
    byId("resultado-data").textContent = data.created_at
      ? new Date(data.created_at).toLocaleString("pt-BR")
      : "-";

    if (isPago && data.download_url) {
      baixarPdf.href = data.download_url;
      baixarPdf.classList.remove("hidden");
    }

    consultaResultado.classList.remove("hidden");
    setMessage(consultaMsg, isPago ? "Pagamento confirmado." : "Pagamento ainda não confirmado.", isPago ? "success" : "");
  } catch (error) {
    setMessage(consultaMsg, error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

quantidadeInput.addEventListener("input", updateTotal);

byId("admin-open").addEventListener("click", () => {
  adminPanel.classList.remove("hidden");
  adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

byId("admin-close").addEventListener("click", () => {
  adminPanel.classList.add("hidden");
});

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminSession = {
    usuario: byId("admin-usuario").value.trim(),
    senha: byId("admin-senha").value,
  };

  try {
    await loadAdminPedidos();
  } catch (error) {
    adminSession = null;
    adminContent.classList.add("hidden");
    setMessage(adminMsg, error.message, "error");
  }
});

byId("admin-refresh").addEventListener("click", async () => {
  try {
    await loadAdminPedidos();
  } catch (error) {
    setMessage(adminMsg, error.message, "error");
  }
});

byId("admin-pdf").addEventListener("click", async () => {
  const button = byId("admin-pdf");
  setLoading(button, true, "Gerando PDF...");
  try {
    const blob = await callAdmin("pdf");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pedidos-umec.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage(adminMsg, "PDF geral baixado.", "success");
  } catch (error) {
    setMessage(adminMsg, error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

setEventoInfo();
