import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Compra = {
  id: string;
  nome: string;
  email: string;
  whatsapp: string;
  quantidade: number;
  valor_total: number;
  status_pagamento: string;
  pdf_path: string | null;
  codigo_compra: string;
  email_enviado: boolean;
};

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

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function extractPaymentId(req: Request, payload: Record<string, unknown>) {
  const url = new URL(req.url);
  const data = payload.data as { id?: string | number } | undefined;
  return (
    data?.id ??
    payload.id ??
    url.searchParams.get("data.id") ??
    url.searchParams.get("id")
  )?.toString();
}

async function getMercadoPagoPayment(paymentId: string) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${env("MERCADO_PAGO_ACCESS_TOKEN")}`,
    },
  });

  const payment = await response.json();
  if (!response.ok) {
    console.error("Erro ao consultar pagamento Mercado Pago", payment);
    throw new Error("Não foi possível consultar o pagamento no Mercado Pago.");
  }

  return payment;
}

async function gerarPdf(compraId: string) {
  const response = await fetch(`${env("SUPABASE_URL")}/functions/v1/gerar-senhas-pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: getSecretKey(),
    },
    body: JSON.stringify({ compra_id: compraId }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("Erro ao gerar PDF", data);
    throw new Error(data.error || "Não foi possível gerar o PDF.");
  }

  return data.pdf_path as string;
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

async function enviarEmailComPdf(supabase: ReturnType<typeof createClient>, compra: Compra, pdfPath: string) {
  if (compra.email_enviado) return;

  const resendApiKey = env("RESEND_API_KEY");
  const fromEmail = env("RESEND_FROM_EMAIL");
  const adminEmail = env("UMEC_ADMIN_EMAIL").trim();
  if (!resendApiKey || !fromEmail) throw new Error("Resend não configurado.");

  const { data: pdfFile, error: downloadError } = await supabase.storage
    .from("senhas-pdf")
    .download(pdfPath);

  if (downloadError || !pdfFile) {
    console.error("Erro ao baixar PDF para e-mail", downloadError);
    throw new Error("Não foi possível anexar o PDF.");
  }

  const content = arrayBufferToBase64(await pdfFile.arrayBuffer());
  const valorTotal = Number(compra.valor_total).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const buyerText = [
    `Olá, ${compra.nome}.`,
    "",
    "Seu pagamento foi confirmado.",
    "",
    "Segue em anexo o PDF com suas ficha(s) da Panqueca UMEC.",
    "",
    `Quantidade de fichas: ${compra.quantidade}`,
    `Valor total: ${valorTotal}`,
    "",
    "Você também pode acessar o site e consultar sua compra usando o código:",
    "",
    compra.codigo_compra,
    "",
    "Atenciosamente,",
    "UMEC",
  ].join("\n");

  const adminText = [
    "Nova compra paga na Panqueca UMEC.",
    "",
    `Nome: ${compra.nome}`,
    `E-mail: ${compra.email}`,
    `WhatsApp: ${compra.whatsapp}`,
    `Código da compra: ${compra.codigo_compra}`,
    `Quantidade de fichas: ${compra.quantidade}`,
    `Valor total: ${valorTotal}`,
    "",
    "O PDF da ficha está em anexo para conferência.",
  ].join("\n");

  const attachment = {
    filename: `fichas-${compra.codigo_compra}.pdf`,
    content,
  };

  const buyerPayload: Record<string, unknown> = {
    from: fromEmail,
    to: [compra.email],
    subject: "Suas fichas da Panqueca UMEC",
    text: buyerText,
    attachments: [attachment],
  };

  const adminPayload: Record<string, unknown> | null = adminEmail
    ? {
        from: fromEmail,
        to: [adminEmail],
        subject: `Compra paga UMEC - ${compra.codigo_compra}`,
        text: adminText,
        attachments: [attachment],
      }
    : null;

  let adminSent = false;
  let buyerSent = false;
  const errors: unknown[] = [];

  if (adminPayload) {
    try {
      await sendResendEmail(resendApiKey, adminPayload);
      adminSent = true;
    } catch (error) {
      console.error("Erro ao enviar e-mail para o Admin", error);
      errors.push(error);
    }
  }

  if (adminEmail && adminEmail.toLowerCase() === compra.email.toLowerCase()) {
    buyerSent = adminSent;
  } else {
    try {
      await sendResendEmail(resendApiKey, buyerPayload);
      buyerSent = true;
    } catch (error) {
      console.error("Erro ao enviar e-mail para o comprador", error);
      errors.push(error);
    }
  }

  if (!adminSent && !buyerSent) {
    console.error("Nenhum e-mail foi enviado", errors);
    throw new Error("Não foi possível enviar o e-mail.");
  }

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

    if (!supabaseUrl || !serviceRoleKey || !mercadoPagoToken) {
      return json({ error: "Variáveis de ambiente do servidor não configuradas." }, 500);
    }

    const payload = await safeJson(req);
    const paymentId = extractPaymentId(req, payload);
    if (!paymentId) return json({ received: true, ignored: true, reason: "Sem payment_id" });

    const payment = await getMercadoPagoPayment(paymentId);
    if (payment.status !== "approved") {
      return json({ received: true, ignored: true, status: payment.status });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    let { data: compra } = await supabase
      .from("compras")
      .select("*")
      .eq("mercado_pago_payment_id", String(payment.id))
      .maybeSingle<Compra>();

    if (!compra && payment.external_reference) {
      const result = await supabase
        .from("compras")
        .select("*")
        .eq("codigo_compra", String(payment.external_reference))
        .maybeSingle<Compra>();
      compra = result.data;
    }

    if (!compra) return json({ error: "Compra não encontrada." }, 404);

    if (compra.status_pagamento === "pendente") {
      const { error: updateError } = await supabase
        .from("compras")
        .update({ status_pagamento: "pago" })
        .eq("id", compra.id)
        .eq("status_pagamento", "pendente");

      if (updateError) {
        console.error("Erro ao confirmar compra", updateError);
        return json({ error: "Não foi possível confirmar a compra." }, 500);
      }

      compra.status_pagamento = "pago";
    }

    if (compra.status_pagamento !== "pago") {
      return json({ received: true, ignored: true, status: compra.status_pagamento });
    }

    const pdfPath = compra.pdf_path || await gerarPdf(compra.id);

    try {
      await enviarEmailComPdf(supabase, compra, pdfPath);
    } catch (emailError) {
      console.error("Pagamento confirmado, mas o e-mail não foi enviado", emailError);
    }

    return json({ received: true, status: "pago", codigo_compra: compra.codigo_compra });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado." }, 500);
  }
});
