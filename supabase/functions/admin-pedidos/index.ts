import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AdminPayload = {
  usuario?: string;
  senha?: string;
  action?: "list" | "pdf";
};

type Compra = {
  id: string;
  codigo_compra: string;
  nome: string;
  email: string;
  whatsapp: string;
  quantidade: number;
  valor_total: number | string;
  status_pagamento: string;
  created_at: string;
};

type Senha = {
  compra_id: string;
  numero_senha: number;
  nome: string;
};

function env(name: string, fallback = "") {
  return Deno.env.get(name) ?? fallback;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function isAuthorized(payload: AdminPayload) {
  const adminUser = env("ADMIN_USER");
  const adminPassword = env("ADMIN_PASSWORD");
  return Boolean(adminUser && adminPassword && payload.usuario === adminUser && payload.senha === adminPassword);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

async function getPedidos(supabase: ReturnType<typeof createClient>) {
  const { data: compras, error: comprasError } = await supabase
    .from("compras")
    .select("id,codigo_compra,nome,email,whatsapp,quantidade,valor_total,status_pagamento,created_at")
    .order("created_at", { ascending: false });

  if (comprasError) {
    console.error("Erro ao buscar compras", comprasError);
    throw new Error("Nao foi possivel buscar os pedidos.");
  }

  const { data: senhas, error: senhasError } = await supabase
    .from("senhas")
    .select("compra_id,numero_senha,nome")
    .order("numero_senha", { ascending: true });

  if (senhasError) {
    console.error("Erro ao buscar senhas", senhasError);
    throw new Error("Nao foi possivel buscar as fichas.");
  }

  const senhasPorCompra = new Map<string, number[]>();
  for (const senha of (senhas ?? []) as Senha[]) {
    const lista = senhasPorCompra.get(senha.compra_id) ?? [];
    lista.push(senha.numero_senha);
    senhasPorCompra.set(senha.compra_id, lista);
  }

  return ((compras ?? []) as Compra[]).map((compra) => ({
    codigo_compra: compra.codigo_compra,
    nome: compra.nome,
    email: compra.email,
    whatsapp: compra.whatsapp,
    quantidade: compra.quantidade,
    valor_total: Number(compra.valor_total),
    status_pagamento: compra.status_pagamento,
    created_at: compra.created_at,
    created_at_formatado: formatDate(compra.created_at),
    senhas: senhasPorCompra.get(compra.id) ?? [],
  }));
}

async function gerarPdfGeral(supabase: ReturnType<typeof createClient>) {
  const { data: senhas, error } = await supabase
    .from("senhas")
    .select("numero_senha,nome")
    .order("numero_senha", { ascending: true });

  if (error) {
    console.error("Erro ao buscar senhas para PDF geral", error);
    throw new Error("Nao foi possivel gerar o PDF geral.");
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]);
  let y = 780;

  function header() {
    page.drawText("UMEC - Lista Geral de Fichas", {
      x: 50,
      y,
      size: 18,
      font: bold,
      color: rgb(0.05, 0.05, 0.05),
    });
    y -= 28;
    page.drawText(`Gerado em ${new Date().toLocaleString("pt-BR")}`, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 28;
    page.drawText("Ficha", { x: 50, y, size: 11, font: bold });
    page.drawText("Nome", { x: 130, y, size: 11, font: bold });
    y -= 12;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 18;
  }

  header();

  for (const senha of (senhas ?? []) as Array<{ numero_senha: number; nome: string }>) {
    if (y < 60) {
      page = pdf.addPage([595.28, 841.89]);
      y = 780;
      header();
    }

    page.drawText(String(senha.numero_senha), { x: 50, y, size: 11, font: bold });
    page.drawText(senha.nome, { x: 130, y, size: 11, font });
    y -= 20;
  }

  if (!senhas?.length) {
    page.drawText("Nenhuma ficha paga foi gerada ainda.", { x: 50, y, size: 12, font });
  }

  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo nao permitido." }, 405);

  try {
    const payload = await req.json() as AdminPayload;
    if (!isAuthorized(payload)) return json({ error: "Usuario ou senha invalidos." }, 401);

    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = getSecretKey();
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Variaveis de ambiente do servidor nao configuradas." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (payload.action === "pdf") {
      const pdfBytes = await gerarPdfGeral(supabase);
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="pedidos-umec.pdf"',
        },
      });
    }

    const pedidos = await getPedidos(supabase);
    return json({
      pedidos,
      total_pedidos: pedidos.length,
      total_pagos: pedidos.filter((pedido) => pedido.status_pagamento === "pago").length,
      total_fichas_pagas: pedidos.reduce((total, pedido) => total + pedido.senhas.length, 0),
      total_arrecadado: pedidos
        .filter((pedido) => pedido.status_pagamento === "pago")
        .reduce((total, pedido) => total + Number(pedido.valor_total ?? 0), 0),
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado." }, 500);
  }
});
