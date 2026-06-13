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

function getEstoqueTotal() {
  const raw = env("ESTOQUE_TOTAL").trim();
  if (!raw) return null;

  const estoqueTotal = Number(raw);
  if (!Number.isInteger(estoqueTotal) || estoqueTotal <= 0) {
    throw new Error("ESTOQUE_TOTAL inválido.");
  }

  return estoqueTotal;
}

function normalizePayload(payload: CompraPayload) {
  const nome = String(payload.nome ?? "").trim();
  const whatsapp = onlyDigits(String(payload.whatsapp ?? ""));
  const email = String(payload.email ?? "").trim().toLowerCase();
  const quantidade = Number(payload.quantidade);
  const entrega = payload.entrega === true;
  const enderecoRua = String(payload.endereco_entrega?.rua ?? "").trim();
  const enderecoNumero = String(payload.endereco_entrega?.numero ?? "").trim();
  const enderecoBairro = String(payload.endereco_entrega?.bairro ?? "").trim();
  const enderecoReferencia = String(payload.endereco_entrega?.referencia ?? "").trim();

  if (nome.length < 3) throw new Error("Informe o nome completo.");
  if (!/^\d{10,14}$/.test(whatsapp)) throw new Error("Informe um WhatsApp válido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) {
    throw new Error("Informe uma quantidade entre 1 e 50.");
  }
  if (entrega && (!enderecoRua || !enderecoNumero || !enderecoBairro)) {
    throw new Error("Informe rua, número e bairro para entrega.");
  }

  return { nome, whatsapp, email, quantidade, entrega, enderecoRua, enderecoNumero, enderecoBairro, enderecoReferencia };
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
    .in("status_pagamento", ["pendente", "pago"]);

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
    const eventoNome = env("EVENTO_NOME", "Refeição UMEC");

    if (!supabaseUrl || !serviceRoleKey || !mercadoPagoToken) {
      return json({ error: "Variáveis de ambiente do servidor não configuradas." }, 500);
    }

    if (!Number.isFinite(valorUnitario) || valorUnitario <= 0) {
      return json({ error: "VALOR_UNITARIO inválido." }, 500);
    }

    if (!Number.isFinite(taxaEntregaPadrao) || taxaEntregaPadrao < 0) {
      return json({ error: "TAXA_ENTREGA invÃ¡lida." }, 500);
    }

    const payload = normalizePayload(await req.json());
    const taxaEntrega = payload.entrega ? taxaEntregaPadrao : 0;
    const valorTotal = Number(((payload.quantidade * valorUnitario) + taxaEntrega).toFixed(2));
    const codigoCompra = createCodigoCompra();
    const supabase = createClient(supabaseUrl, serviceRoleKey);

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
        entrega: payload.entrega,
        taxa_entrega: taxaEntrega,
        endereco_rua: payload.entrega ? payload.enderecoRua : null,
        endereco_numero: payload.entrega ? payload.enderecoNumero : null,
        endereco_bairro: payload.entrega ? payload.enderecoBairro : null,
        endereco_referencia: payload.entrega ? payload.enderecoReferencia : null,
        status_pagamento: "pendente",
        codigo_compra: codigoCompra,
      })
      .select()
      .single();

    if (insertError || !compra) {
      console.error("Erro ao criar compra", insertError);
      return json({ error: "Não foi possível registrar a compra." }, 500);
    }

    const { firstName, lastName } = splitName(payload.nome);
    const paymentBody = {
      transaction_amount: valorTotal,
      description: `${eventoNome} - ${payload.quantidade} ficha(s)${payload.entrega ? " com entrega" : ""}`,
      payment_method_id: "pix",
      external_reference: codigoCompra,
      notification_url: env("MERCADO_PAGO_WEBHOOK_URL") || undefined,
      payer: {
        email: payload.email,
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
