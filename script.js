const CONFIG = {
  SUPABASE_URL: "https://oabfkwtpjkhlqpyhscwb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_VSpoG2aPN10R7dYTA2S1gw_w20uEdVJ",
  WHATSAPP_UMEC: "5599999999999",
  VALOR_UNITARIO: 10.0,
  EVENTO_NOME: "Refeição UMEC",
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

let ultimaCompra = null;

function setEventoInfo() {
  document.querySelector("[data-evento-nome]").textContent = CONFIG.EVENTO_NOME;
  document.querySelector("[data-evento-data]").textContent = CONFIG.EVENTO_DATA;
  document.querySelector("[data-evento-local]").textContent = CONFIG.EVENTO_LOCAL;
  document.querySelector("[data-evento-horario]").textContent = CONFIG.EVENTO_HORARIO;
  document.querySelector("[data-valor-unitario]").textContent = money.format(CONFIG.VALOR_UNITARIO);
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
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
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
  const message = [
    `Olá, realizei a compra de ${compra.quantidade} senha(s) para a refeição da UMEC.`,
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

  byId("codigo-compra").textContent = data.codigo_compra;
  byId("pix-copia-cola").value = data.qr_code;
  byId("pix-qrcode").src = `data:image/png;base64,${data.qr_code_base64}`;
  byId("whatsapp-comprovante").href = buildWhatsAppUrl(ultimaCompra);

  pixArea.classList.remove("hidden");
  pixArea.scrollIntoView({ behavior: "smooth", block: "start" });
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
    setMessage(compraMsg, "Pix gerado com sucesso. A confirmação será automática após o pagamento.", "success");
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
    const isPago = data.status_pagamento === "pago";

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
setEventoInfo();
