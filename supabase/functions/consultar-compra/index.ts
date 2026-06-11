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

type CompraConsulta = {
  status_pagamento: string;
  quantidade: number;
  valor_total: number | string;
  created_at: string;
  pdf_path: string | null;
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

async function createDownloadUrl(
  supabase: ReturnType<typeof createClient>,
  pdfPath: string,
) {
  const { data: signed, error } = await supabase.storage
    .from("senhas-pdf")
    .createSignedUrl(pdfPath, 60 * 15, { download: true });

  if (error) {
    console.error("Erro ao gerar URL assinada", error);
    throw new Error("Não foi possível gerar o link de download.");
  }

  return signed.signedUrl;
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

    if (codigoCompra) {
      const { data: compra, error } = await supabase
        .from("compras")
        .select("status_pagamento,quantidade,valor_total,created_at,pdf_path")
        .eq("codigo_compra", codigoCompra)
        .maybeSingle<CompraConsulta>();

      if (error) {
        console.error("Erro ao consultar compra", error);
        return json({ error: "Não foi possível consultar a compra." }, 500);
      }

      if (!compra) return json({ error: "Compra não encontrada." }, 404);

      const response: Record<string, unknown> = {
        tipo_consulta: "compra",
        status_pagamento: compra.status_pagamento,
        quantidade: compra.quantidade,
        valor_total: compra.valor_total,
        created_at: compra.created_at,
      };

      if (compra.status_pagamento === "pago" && compra.pdf_path) {
        response.download_url = await createDownloadUrl(supabase, compra.pdf_path);
      }

      return json(response);
    }

    let query = supabase
      .from("compras")
      .select("status_pagamento,quantidade,valor_total,created_at,pdf_path")
      .order("created_at", { ascending: false });

    if (email) {
      query = query.eq("email", email);
    } else {
      query = query.eq("whatsapp", whatsapp);
    }

    const { data: compras, error } = await query;

    if (error) {
      console.error("Erro ao consultar compras do cliente", error);
      return json({ error: "Não foi possível consultar as compras." }, 500);
    }

    if (!compras?.length) return json({ error: "Compra não encontrada." }, 404);

    const comprasPagas = (compras as CompraConsulta[]).filter(
      (compra) => compra.status_pagamento === "pago",
    );
    const quantidadeTotalPaga = comprasPagas.reduce(
      (total, compra) => total + Number(compra.quantidade ?? 0),
      0,
    );
    const valorTotalPago = comprasPagas.reduce(
      (total, compra) => total + Number(compra.valor_total ?? 0),
      0,
    );

    return json({
      tipo_consulta: "resumo_cliente",
      status_pagamento: quantidadeTotalPaga > 0 ? "pago" : "sem_pagamento_pago",
      quantidade_total_paga: quantidadeTotalPaga,
      valor_total_pago: Number(valorTotalPago.toFixed(2)),
      compras_pagas: comprasPagas.length,
      compras_encontradas: compras.length,
      created_at_ultima_compra_paga: comprasPagas[0]?.created_at ?? null,
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Erro inesperado.";
    return json({ error: message }, 400);
  }
});
