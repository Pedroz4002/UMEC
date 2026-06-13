const CONFIG = {
  SUPABASE_URL: "https://oabfkwtpjkhlqpyhscwb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_VSpoG2aPN10R7dYTA2S1gw_w20uEdVJ",
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const byId = (id) => document.getElementById(id);

const adminLoginForm = byId("admin-login-form");
const adminContent = byId("admin-content");
const adminMsg = byId("admin-mensagem");
const adminPedidosBody = byId("admin-pedidos-body");
const adminResumo = byId("admin-resumo");
const adminFichasVendidas = byId("admin-fichas-vendidas");
const adminFichasDisponiveis = byId("admin-fichas-disponiveis");

let adminSession = null;

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

async function callAdmin(action, payload = {}) {
  if (!adminSession) {
    throw new Error("Faça login no Admin.");
  }

  const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/admin-pedidos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ ...adminSession, action, ...payload }),
  });

  if (action === "pdf" || action === "pdf_entregas") {
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
  adminFichasVendidas.textContent = String(data.total_fichas_vendidas ?? data.total_fichas_pagas ?? 0);
  adminFichasDisponiveis.textContent = String(data.total_fichas_disponiveis ?? "-");

  if (!pedidos.length) {
    adminPedidosBody.innerHTML = '<tr><td colspan="9">Nenhum pedido encontrado.</td></tr>';
    return;
  }

  adminPedidosBody.innerHTML = pedidos.map((pedido) => {
    const senhas = pedido.senhas?.length ? pedido.senhas.join(", ") : "-";
    const contato = `${escapeHtml(pedido.email)}<br>${escapeHtml(pedido.whatsapp)}`;
    const endereco = pedido.endereco_formatado || "-";
    const canCancel = pedido.status_pagamento !== "cancelado";
    const cancelButton = canCancel
      ? `<button class="danger-button compact-button" type="button" data-cancelar-pedido="${escapeHtml(pedido.codigo_compra)}">Cancelar</button>`
      : "-";

    return `
      <tr>
        <td>${escapeHtml(pedido.created_at_formatado)}</td>
        <td>${escapeHtml(pedido.codigo_compra)}</td>
        <td>${escapeHtml(pedido.nome)}</td>
        <td>${contato}</td>
        <td><span class="status-badge ${escapeHtml(pedido.status_pagamento)}">${escapeHtml(pedido.status_pagamento)}</span></td>
        <td>${pedido.entrega ? `Sim<br><small>${escapeHtml(endereco)}</small>` : "Não"}</td>
        <td>${escapeHtml(senhas)}</td>
        <td>${money.format(Number(pedido.valor_total || 0))}</td>
        <td>${cancelButton}</td>
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

byId("admin-pdf-entregas").addEventListener("click", async () => {
  const button = byId("admin-pdf-entregas");
  setLoading(button, true, "Gerando PDF...");

  try {
    const blob = await callAdmin("pdf_entregas");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "entregas-umec.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage(adminMsg, "PDF de entregas baixado.", "success");
  } catch (error) {
    setMessage(adminMsg, error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

adminPedidosBody.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-cancelar-pedido]");
  if (!button) return;

  const codigoCompra = button.dataset.cancelarPedido;
  const confirmed = window.confirm(
    `Cancelar o pedido ${codigoCompra}?\n\nIsso libera a ficha no sistema, mas não faz estorno automático do Pix.`,
  );
  if (!confirmed) return;

  setLoading(button, true, "Cancelando...");
  try {
    await callAdmin("cancel", { codigo_compra: codigoCompra });
    setMessage(adminMsg, "Pedido cancelado e fichas liberadas.", "success");
    await loadAdminPedidos();
  } catch (error) {
    setMessage(adminMsg, error.message, "error");
  } finally {
    setLoading(button, false);
  }
});
