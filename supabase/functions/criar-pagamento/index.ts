import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CompraPayload = {
  nome?: string;
  whatsapp?: string;
  email?: string;
  quantidade?: number;
  forma_pagamento?: "pix" | "dinheiro";
  troco_para?: number | string;
  entrega?: boolean;
  endereco_entrega?: {
    rua?: string;
    numero?: string;
    bairro?: string;
    referencia?: string;
  };
};

const SOLD_OUT_MESSAGE =
  "Infelizmente todas as fichas foram vendidas, caso seja liberado mais fichas informamos nas redes sociais.";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string, fallback = "") {
  return Deno.env.get(name) ?? fallback;
}

function getSecretKey() {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
  if (legacy) return legacy;

  const rawKeys = env("SUPABASE_SECRET_KEYS");
  if (!rawKeys) return "";

  try {
    const keys = JSON.parse(rawKeys) as Record<string, string>;
    return keys.default ?? Object.values(keys).find(Boolean) ?? "";
  } catch {
    return "";
  }
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function parseMoneyValue(value: number | string | undefined) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null;
}

function getEstoqueTotal() {
  const raw = env("ESTOQUE_TOTAL", "75").trim();
  if (!raw) return null;

  const estoqueTotal = Number(raw);
  if (!Number.isInteger(estoqueTotal) || estoqueTotal <= 0) {
    throw new Error("ESTOQUE_TOTAL inválido.");
  }

  return estoqueTotal;
}

function getPixExpirationMinutes() {
  const raw = env("PIX_EXPIRATION_MINUTES", "10").trim();
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1) return 10;
  return Math.min(Math.floor(minutes), 60);
}

function normalizePayload(payload: CompraPayload, maxQuantidade: number) {
  const nome = String(payload.nome ?? "").trim();
  const whatsapp = onlyDigits(String(payload.whatsapp ?? ""));
  const email = String(payload.email ?? "").trim().toLowerCase();
  const quantidade = Number(payload.quantidade);
  const formaPagamento = payload.forma_pagamento === "dinheiro" ? "dinheiro" : "pix";
  const trocoPara = parseMoneyValue(payload.troco_para);
  const entrega = payload.entrega === true;
  const enderecoRua = String(payload.endereco_entrega?.rua ?? "").trim();
  const enderecoNumero = String(payload.endereco_entrega?.numero ?? "").trim();
  const enderecoBairro = String(payload.endereco_entrega?.bairro ?? "").trim();
  const enderecoReferencia = String(payload.endereco_entrega?.referencia ?? "").trim();

  if (nome.length < 3) throw new Error("Informe o nome completo.");
  if (!/^\d{10,14}$/.test(whatsapp)) throw new Error("Informe um WhatsApp válido.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Informe um e-mail válido ou deixe o campo em branco.");
  }
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > maxQuantidade) {
    throw new Error(`Informe uma quantidade entre 1 e ${maxQuantidade}.`);
  }
  if (!entrega) {
    throw new Error("No momento, as vendas estão disponíveis apenas por delivery.");
  }
  if (!enderecoRua || !enderecoNumero || !enderecoBairro) {
    throw new Error("Informe rua, número e bairro para entrega.");
  }

  return {
    nome,
    whatsapp,
    email,
    quantidade,
    formaPagamento,
    trocoPara,
    entrega,
    enderecoRua,
    enderecoNumero,
    enderecoBairro,
    enderecoReferencia,
  };
}

function createCodigoCompra() {
  const time = Date.now().toString(36).toUpperCase();
  const random = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `UMEC-${time}-${random}`;
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.shift() ?? fullName;
  const lastName = parts.join(" ") || "Cliente";
  return { firstName, lastName };
}

async function assertEstoqueDisponivel(
  supabase: ReturnType<typeof createClient>,
  quantidadeSolicitada: number,
  estoqueTotal: number | null,
) {
  if (!estoqueTotal) return;

  const { data, error } = await supabase
    .from("compras")
    .select("quantidade")
    .in("status_pagamento", ["pendente", "pago", "dinheiro"]);

  if (error) {
    console.error("Erro ao consultar estoque", error);
    throw new Error("Não foi possível consultar a disponibilidade.");
  }

  const quantidadeReservada = (data ?? []).reduce(
    (total, compra) => total + Number(compra.quantidade ?? 0),
    0,
  );
  const disponivel = estoqueTotal - quantidadeReservada;

  if (disponivel <= 0) {
    throw new Error(SOLD_OUT_MESSAGE);
  }

  if (quantidadeSolicitada > disponivel) {
    throw new Error(`Restam apenas ${disponivel} ficha(s) disponíveis.`);
  }
}

async function cancelMercadoPagoPayment(paymentId: string, mercadoPagoToken: string) {
  if (!paymentId || !mercadoPagoToken) return false;

  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${mercadoPagoToken}`,
    },
  });
  const payment = await paymentResponse.json().catch(() => ({}));
  const status = String(payment?.status ?? "");

  if (["approved", "accredited", "refunded", "charged_back"].includes(status)) {
    return false;
  }
  if (["cancelled", "rejected"].includes(status)) {
    return true;
  }

  const cancelResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${mercadoPagoToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "cancelled" }),
  });

  if (!cancelResponse.ok) {
    const error = await cancelResponse.json().catch(() => ({}));
    console.error("Não foi possível cancelar Pix vencido no Mercado Pago", { paymentId, error });
    return false;
  }

  return true;
}

async function cancelExpiredPendingPix(
  supabase: ReturnType<typeof createClient>,
  mercadoPagoToken: string,
  pixExpirationMinutes: number,
) {
  const cutoff = new Date(Date.now() - (pixExpirationMinutes * 60 * 1000)).toISOString();
  const { data: compras, error } = await supabase
    .from("compras")
    .select("id,codigo_compra,mercado_pago_payment_id,status_pagamento")
    .in("status_pagamento", ["pendente", "cancelado"])
    .lte("created_at", cutoff)
    .limit(100);

  if (error) {
    console.error("Erro ao buscar Pix pendentes vencidos", error);
    return;
  }

  for (const compra of compras ?? []) {
    const paymentId = String(compra.mercado_pago_payment_id ?? "");
    if (compra.status_pagamento === "cancelado" && !paymentId) continue;

    const shouldCancel = paymentId ? await cancelMercadoPagoPayment(paymentId, mercadoPagoToken) : true;
    if (!shouldCancel) continue;

    if (compra.status_pagamento === "cancelado") continue;

    const { error: updateError } = await supabase
      .from("compras")
      .update({
        status_pagamento: "cancelado",
        email_enviado: false,
        email_enviado_at: null,
      })
      .eq("id", compra.id)
      .eq("status_pagamento", "pendente");

    if (updateError) {
      console.error("Erro ao cancelar Pix vencido no sistema", { codigo: compra.codigo_compra, updateError });
    }
  }
}

async function gerarPdf(compraId: string, supabaseUrl: string, serviceRoleKey: string) {
  const response = await fetch(`${supabaseUrl}/functions/v1/gerar-senhas-pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify({ compra_id: compraId }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Erro ao gerar PDF para dinheiro", data);
    throw new Error(data.error || "Não foi possível gerar o PDF.");
  }

  return data.pdf_path as string;
}

async function createDownloadUrl(supabase: ReturnType<typeof createClient>, pdfPath: string) {
  const { data: signed, error } = await supabase.storage
    .from("senhas-pdf")
    .createSignedUrl(pdfPath, 60 * 15, { download: true });

  if (error) {
    console.error("Erro ao gerar URL assinada", error);
    throw new Error("Não foi possível gerar o link de download.");
  }

  return signed.signedUrl;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function formatEndereco(compra: Record<string, unknown>) {
  if (!compra.entrega) return "Delivery sem endereço informado";
  const endereco = [
    compra.endereco_rua,
    compra.endereco_numero ? `nº ${compra.endereco_numero}` : "",
    compra.endereco_bairro,
  ].filter(Boolean).join(", ");
  const referencia = compra.endereco_referencia ? `Referência: ${compra.endereco_referencia}` : "";
  return [endereco, referencia].filter(Boolean).join(" | ") || "Endereço não informado";
}

async function sendResendEmail(resendApiKey: string, payload: Record<string, unknown>) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Erro Resend", result);
    throw new Error("Não foi possível enviar o e-mail.");
  }

  return result;
}

async function enviarEmailComPdf(
  supabase: ReturnType<typeof createClient>,
  compra: Record<string, unknown>,
  pdfPath: string,
) {
  const resendApiKey = env("RESEND_API_KEY");
  const fromEmail = env("RESEND_FROM_EMAIL");
  const adminEmail = env("UMEC_ADMIN_EMAIL").trim();
  if (!resendApiKey || !fromEmail || !adminEmail) return;

  const { data: pdfFile, error: downloadError } = await supabase.storage
    .from("senhas-pdf")
    .download(pdfPath);

  if (downloadError || !pdfFile) {
    console.error("Erro ao baixar PDF para e-mail", downloadError);
    return;
  }

  const content = arrayBufferToBase64(await pdfFile.arrayBuffer());
  const valorTotal = Number(compra.valor_total).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const trocoPara = compra.troco_para
    ? Number(compra.troco_para).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "Não informado";

  const adminText = [
    "Novo pedido em dinheiro na Panqueca UMEC.",
    "",
    `Nome: ${compra.nome}`,
    `E-mail: ${compra.email || "Não informado"}`,
    `WhatsApp: ${compra.whatsapp}`,
    `Código da compra: ${compra.codigo_compra}`,
    `Quantidade de fichas: ${compra.quantidade}`,
    `Entrega: ${compra.entrega ? "Sim" : "Não"}`,
    `Endereço: ${formatEndereco(compra)}`,
    `Valor total: ${valorTotal}`,
    `Troco para: ${trocoPara}`,
    "",
    "O PDF da ficha está em anexo para conferência.",
  ].join("\n");

  await sendResendEmail(resendApiKey, {
    from: fromEmail,
    to: [adminEmail],
    subject: `Pedido em dinheiro UMEC - ${compra.codigo_compra}`,
    text: adminText,
    attachments: [{ filename: `fichas-${compra.codigo_compra}.pdf`, content }],
  });

  await supabase
    .from("compras")
    .update({ email_enviado: true, email_enviado_at: new Date().toISOString() })
    .eq("id", compra.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = getSecretKey();
    const mercadoPagoToken = env("MERCADO_PAGO_ACCESS_TOKEN");
    const valorUnitario = Number(env("VALOR_UNITARIO", "10.00"));
    const taxaEntregaPadrao = Number(env("TAXA_ENTREGA", "2.00"));
    const estoqueTotal = getEstoqueTotal();
    const pixExpirationMinutes = getPixExpirationMinutes();
    const payerEmailFallback = env("UMEC_ADMIN_EMAIL", "ph493591@gmail.com").trim();
    const eventoNome = env("EVENTO_NOME", "Refeição UMEC");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Variáveis de ambiente do servidor não configuradas." }, 500);
    }

    if (!Number.isFinite(valorUnitario) || valorUnitario <= 0) {
      return json({ error: "VALOR_UNITARIO inválido." }, 500);
    }

    if (!Number.isFinite(taxaEntregaPadrao) || taxaEntregaPadrao < 0) {
      return json({ error: "TAXA_ENTREGA inválida." }, 500);
    }

    const payload = normalizePayload(await req.json(), estoqueTotal ?? 75);
    if (payload.formaPagamento === "pix" && !mercadoPagoToken) {
      return json({ error: "Token do Mercado Pago não configurado." }, 500);
    }

    const payerEmail = payload.email || payerEmailFallback;
    const taxaEntrega = payload.entrega ? taxaEntregaPadrao : 0;
    const valorTotal = Number(((payload.quantidade * valorUnitario) + taxaEntrega).toFixed(2));
    if (payload.formaPagamento === "dinheiro" && payload.trocoPara && payload.trocoPara <= valorTotal) {
      return json({ error: "O valor para troco deve ser maior que o total do pedido." }, 400);
    }

    const codigoCompra = createCodigoCompra();
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const statusPagamento = payload.formaPagamento === "dinheiro" ? "dinheiro" : "pendente";

    await cancelExpiredPendingPix(supabase, mercadoPagoToken, pixExpirationMinutes);
    await assertEstoqueDisponivel(supabase, payload.quantidade, estoqueTotal);

    const { data: compra, error: insertError } = await supabase
      .from("compras")
      .insert({
        nome: payload.nome,
        whatsapp: payload.whatsapp,
        email: payload.email,
        quantidade: payload.quantidade,
        valor_unitario: valorUnitario,
        valor_total: valorTotal,
        forma_pagamento: payload.formaPagamento,
        troco_para: payload.formaPagamento === "dinheiro" ? payload.trocoPara : null,
        entrega: payload.entrega,
        taxa_entrega: taxaEntrega,
        endereco_rua: payload.entrega ? payload.enderecoRua : null,
        endereco_numero: payload.entrega ? payload.enderecoNumero : null,
        endereco_bairro: payload.entrega ? payload.enderecoBairro : null,
        endereco_referencia: payload.entrega ? payload.enderecoReferencia : null,
        status_pagamento: statusPagamento,
        codigo_compra: codigoCompra,
      })
      .select()
      .single();

    if (insertError || !compra) {
      console.error("Erro ao criar compra", insertError);
      return json({ error: "Não foi possível registrar a compra." }, 500);
    }

    if (payload.formaPagamento === "dinheiro") {
      const pdfPath = await gerarPdf(compra.id, supabaseUrl, serviceRoleKey);
      const downloadUrl = await createDownloadUrl(supabase, pdfPath);

      try {
        await enviarEmailComPdf(supabase, { ...compra, pdf_path: pdfPath }, pdfPath);
      } catch (emailError) {
        console.error("Pedido em dinheiro confirmado, mas o e-mail não foi enviado", emailError);
      }

      return json({
        codigo_compra: codigoCompra,
        valor_total: valorTotal,
        forma_pagamento: "dinheiro",
        troco_para: payload.trocoPara,
        entrega: payload.entrega,
        taxa_entrega: taxaEntrega,
        endereco_rua: payload.entrega ? payload.enderecoRua : null,
        endereco_numero: payload.entrega ? payload.enderecoNumero : null,
        endereco_bairro: payload.entrega ? payload.enderecoBairro : null,
        endereco_referencia: payload.entrega ? payload.enderecoReferencia : null,
        status_pagamento: "dinheiro",
        download_url: downloadUrl,
      });
    }

    const { firstName, lastName } = splitName(payload.nome);
    const paymentBody = {
      transaction_amount: valorTotal,
      description: `${eventoNome} - ${payload.quantidade} ficha(s)${payload.entrega ? " com entrega" : ""}`,
      payment_method_id: "pix",
      external_reference: codigoCompra,
      date_of_expiration: new Date(Date.now() + (pixExpirationMinutes * 60 * 1000)).toISOString(),
      notification_url: env("MERCADO_PAGO_WEBHOOK_URL") || undefined,
      payer: {
        email: payerEmail,
        first_name: firstName,
        last_name: lastName,
      },
      metadata: {
        compra_id: compra.id,
        codigo_compra: codigoCompra,
        entrega: payload.entrega,
      },
    };

    const mercadoPagoResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mercadoPagoToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(paymentBody),
    });

    const payment = await mercadoPagoResponse.json();

    if (!mercadoPagoResponse.ok) {
      console.error("Erro Mercado Pago", payment);
      await supabase.from("compras").update({ status_pagamento: "erro" }).eq("id", compra.id);
      return json({ error: "Não foi possível gerar o Pix no Mercado Pago." }, 502);
    }

    const transactionData = payment?.point_of_interaction?.transaction_data ?? {};
    const qrCode = transactionData.qr_code;
    const qrCodeBase64 = transactionData.qr_code_base64;

    if (!payment?.id || !qrCode || !qrCodeBase64) {
      console.error("Resposta Pix incompleta", payment);
      await supabase.from("compras").update({ status_pagamento: "erro" }).eq("id", compra.id);
      return json({ error: "Mercado Pago não retornou os dados do Pix." }, 502);
    }

    const { error: updateError } = await supabase
      .from("compras")
      .update({
        mercado_pago_payment_id: String(payment.id),
        pix_qr_code: qrCode,
        pix_qr_code_base64: qrCodeBase64,
      })
      .eq("id", compra.id);

    if (updateError) {
      console.error("Erro ao salvar Pix", updateError);
      return json({ error: "Pix gerado, mas não foi possível salvar a compra." }, 500);
    }

    return json({
      codigo_compra: codigoCompra,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      valor_total: valorTotal,
      forma_pagamento: "pix",
      entrega: payload.entrega,
      taxa_entrega: taxaEntrega,
      endereco_rua: payload.entrega ? payload.enderecoRua : null,
      endereco_numero: payload.entrega ? payload.enderecoNumero : null,
      endereco_bairro: payload.entrega ? payload.enderecoBairro : null,
      endereco_referencia: payload.entrega ? payload.enderecoReferencia : null,
      status_pagamento: "pendente",
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Erro inesperado.";
    return json({ error: message }, 400);
  }
});
