import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ConsultaPayload = {
  codigo_compra?: string;
  email?: string;
  whatsapp?: string;
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

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = getSecretKey();

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Variáveis de ambiente do servidor não configuradas." }, 500);
    }

    const payload = await req.json() as ConsultaPayload;
    const codigoCompra = String(payload.codigo_compra ?? "").trim().toUpperCase();
    const email = String(payload.email ?? "").trim().toLowerCase();
    const whatsapp = onlyDigits(String(payload.whatsapp ?? ""));

    if (!codigoCompra && !email && !whatsapp) {
      return json({ error: "Informe código da compra, e-mail ou WhatsApp." }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    let query = supabase
      .from("compras")
      .select("status_pagamento,quantidade,valor_total,created_at,pdf_path")
      .order("created_at", { ascending: false })
      .limit(1);

    if (codigoCompra) {
      query = query.eq("codigo_compra", codigoCompra);
    } else if (email) {
      query = query.eq("email", email);
    } else {
      query = query.eq("whatsapp", whatsapp);
    }

    const { data: compra, error } = await query.maybeSingle();

    if (error) {
      console.error("Erro ao consultar compra", error);
      return json({ error: "Não foi possível consultar a compra." }, 500);
    }

    if (!compra) return json({ error: "Compra não encontrada." }, 404);

    const response: Record<string, unknown> = {
      status_pagamento: compra.status_pagamento,
      quantidade: compra.quantidade,
      valor_total: compra.valor_total,
      created_at: compra.created_at,
    };

    if (compra.status_pagamento === "pago" && compra.pdf_path) {
      const { data: signed, error: signedError } = await supabase.storage
        .from("senhas-pdf")
        .createSignedUrl(compra.pdf_path, 60 * 15, { download: true });

      if (signedError) {
        console.error("Erro ao gerar URL assinada", signedError);
        return json({ error: "Não foi possível gerar o link de download." }, 500);
      }

      response.download_url = signed.signedUrl;
    }

    return json(response);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Erro inesperado.";
    return json({ error: message }, 400);
  }
});
