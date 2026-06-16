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
const adminPedidosView = byId("admin-pedidos-view");
const adminRealtimeView = byId("admin-realtime-view");
const adminRealtimeStatus = byId("admin-realtime-status");
const adminFichasBody = byId("admin-fichas-body");

let adminSession = null;
let realtimeRefreshTimer = null;
const REALTIME_REFRESH_MS = 30 * 1000;

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

function getPagamentoLabel(pedido) {
  if (pedido.status_pagamento === "cancelado") return "Cancelado";
  if (pedido.forma_pagamento === "dinheiro") return "Dinheiro";
  if (pedido.status_pagamento === "pago") return "Pix pago";
  if (pedido.status_pagamento === "pendente") return "Pix pendente";
  return pedido.status_pagamento;
}

function renderFichasTempoReal(data) {
  const fichas = data.fichas || [];
  const updatedAt = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  adminRealtimeStatus.textContent = `${fichas.length} ficha(s) confirmada(s). Última atualização: ${updatedAt}`;

  if (!fichas.length) {
    adminFichasBody.innerHTML = '<tr><td colspan="8">Nenhuma ficha paga ou em dinheiro encontrada.</td></tr>';
    return;
  }

  adminFichasBody.innerHTML = fichas.map((ficha) => {
    const tipo = ficha.entrega ? "Entrega" : "Retirada";
    const endereco = ficha.entrega ? ficha.endereco_formatado : "-";
    const pagamento = ficha.forma_pagamento === "dinheiro" ? "Dinheiro" : "Pix pago";
    const checked = ficha.entregue ? "checked" : "";
    const status = ficha.entregue ? "Entregue" : "Pendente";

    return `
      <tr>
        <td><strong>${escapeHtml(ficha.numero_senha_formatado)}</strong></td>
        <td>${escapeHtml(ficha.nome)}</td>
        <td>${escapeHtml(ficha.whatsapp_formatado || ficha.whatsapp)}</td>
        <td><span class="status-badge ${ficha.entrega ? "dinheiro" : "pago"}">${tipo}</span></td>
        <td>${escapeHtml(endereco)}</td>
        <td>${escapeHtml(pagamento)}</td>
        <td>${escapeHtml(ficha.codigo_compra)}</td>
        <td>
          <label class="realtime-check">
            <input type="checkbox" data-marcar-entregue="${escapeHtml(ficha.id)}" ${checked} />
            <span>${status}</span>
          </label>
        </td>
      </tr>
    `;
  }).join("");
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
    const contato = `${escapeHtml(pedido.email || "E-mail não informado")}<br>${escapeHtml(pedido.whatsapp)}`;
    const endereco = pedido.endereco_formatado || "-";
    const pagamentoLabel = getPagamentoLabel(pedido);
    const troco = pedido.troco_para ? `<br><small>Troco para ${money.format(Number(pedido.troco_para))}</small>` : "";
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
        <td><span class="status-badge ${escapeHtml(pedido.status_pagamento)}">${escapeHtml(pagamentoLabel)}</span>${troco}</td>
        <td>${pedido.entrega ? `Sim<br><small>${escapeHtml(endereco)}</small>` : "Não"}</td>
        <td>${escapeHtml(senhas)}</td>
        <td>${money.format(Number(pedido.valor_total || 0))}</td>
        <td>${cancelButton}</td>
      </tr>
    `;
  }).join("");
}

async function loadFichasTempoReal() {
  setMessage(adminMsg, "Carregando fichas em tempo real...");
  const data = await callAdmin("fichas");
  renderFichasTempoReal(data);
  setMessage(adminMsg, "Fichas em tempo real carregadas.", "success");
}

async function openRealtimeView() {
  adminPedidosView.classList.add("hidden");
  adminRealtimeView.classList.remove("hidden");
  await loadFichasTempoReal();
  clearInterval(realtimeRefreshTimer);
  realtimeRefreshTimer = setInterval(() => {
    loadFichasTempoReal().catch((error) => setMessage(adminMsg, error.message, "error"));
  }, REALTIME_REFRESH_MS);
}

function closeRealtimeView() {
  clearInterval(realtimeRefreshTimer);
  realtimeRefreshTimer = null;
  adminRealtimeView.classList.add("hidden");
  adminPedidosView.classList.remove("hidden");
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

byId("admin-fichas-tempo-real").addEventListener("click", async () => {
  try {
    await openRealtimeView();
  } catch (error) {
    setMessage(adminMsg, error.message, "error");
  }
});

byId("admin-realtime-refresh").addEventListener("click", async () => {
  const button = byId("admin-realtime-refresh");
  setLoading(button, true, "Atualizando...");
  try {
    await loadFichasTempoReal();
  } catch (error) {
    setMessage(adminMsg, error.message, "error");
  } finally {
    setLoading(button, false);
  }
});

byId("admin-realtime-back").addEventListener("click", async () => {
  closeRealtimeView();
  try {
    await loadAdminPedidos();
  } catch (error) {
    setMessage(adminMsg, error.message, "error");
  }
});

byId("admin-backup-email").addEventListener("click", async () => {
  const button = byId("admin-backup-email");
  const confirmed = window.confirm("Enviar um backup ZIP com dados e PDFs para o e-mail configurado?");
  if (!confirmed) return;

  setLoading(button, true, "Enviando...");
  try {
    const data = await callAdmin("backup");
    setMessage(
      adminMsg,
      `Backup enviado para ${data.email}. ${data.compras} pedido(s), ${data.senhas} ficha(s) e ${data.arquivos_storage} arquivo(s) do storage.`,
      "success",
    );
  } catch (error) {
    setMessage(adminMsg, error.message, "error");
  } finally {
    setLoading(button, false);
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

adminFichasBody.addEventListener("change", async (event) => {
  const checkbox = event.target.closest("[data-marcar-entregue]");
  if (!checkbox) return;

  checkbox.disabled = true;
  const senhaId = checkbox.dataset.marcarEntregue;
  const entregue = checkbox.checked;
  try {
    await callAdmin("marcar_entregue", { senha_id: senhaId, entregue });
    setMessage(adminMsg, entregue ? "Ficha marcada como entregue." : "Ficha marcada como pendente.", "success");
    await loadFichasTempoReal();
  } catch (error) {
    checkbox.checked = !entregue;
    setMessage(adminMsg, error.message, "error");
  } finally {
    checkbox.disabled = false;
  }
});
