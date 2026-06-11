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
  action?: "list" | "pdf" | "cancel";
  codigo_compra?: string;
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
  whatsapp?: string;
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

function formatFicha(numero: number) {
  return String(numero).padStart(2, "0");
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhone(value: string) {
  const digits = onlyDigits(value);
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return value || "-";
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

  const senhasPorCompra = new Map<string, string[]>();
  for (const senha of (senhas ?? []) as Senha[]) {
    const lista = senhasPorCompra.get(senha.compra_id) ?? [];
    lista.push(formatFicha(senha.numero_senha));
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
    .select("numero_senha,nome,whatsapp")
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
    page.drawText("Ficha", { x: 42, y, size: 11, font: bold });
    page.drawText("Nome", { x: 100, y, size: 11, font: bold });
    page.drawText("Telefone", { x: 360, y, size: 11, font: bold });
    y -= 12;
    page.drawLine({ start: { x: 42, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 18;
  }

  header();

  for (const senha of (senhas ?? []) as Array<{ numero_senha: number; nome: string; whatsapp: string }>) {
    if (y < 60) {
      page = pdf.addPage([595.28, 841.89]);
      y = 780;
      header();
    }

    page.drawText(formatFicha(senha.numero_senha), { x: 42, y, size: 11, font: bold });
    page.drawText(senha.nome.slice(0, 36), { x: 100, y, size: 11, font });
    page.drawText(formatPhone(senha.whatsapp), { x: 360, y, size: 11, font });
    y -= 20;
  }

  if (!senhas?.length) {
    page.drawText("Nenhuma ficha paga foi gerada ainda.", { x: 50, y, size: 12, font });
  }

  return await pdf.save();
}

async function cancelarPedido(supabase: ReturnType<typeof createClient>, codigoCompra: string) {
  const codigo = codigoCompra.trim();
  if (!codigo) throw new Error("Informe o codigo da compra.");

  const { data: compra, error: compraError } = await supabase
    .from("compras")
    .select("id,codigo_compra,status_pagamento,pdf_path")
    .eq("codigo_compra", codigo)
    .single();

  if (compraError || !compra) {
    console.error("Pedido nao encontrado para cancelar", compraError);
    throw new Error("Pedido nao encontrado.");
  }

  if (compra.status_pagamento === "cancelado") {
    return { codigo_compra: compra.codigo_compra, status_pagamento: "cancelado", already_cancelled: true };
  }

  const { error: senhasError } = await supabase
    .from("senhas")
    .delete()
    .eq("compra_id", compra.id);

  if (senhasError) {
    console.error("Erro ao remover fichas do pedido cancelado", senhasError);
    throw new Error("Nao foi possivel remover as fichas do pedido.");
  }

  if (compra.pdf_path) {
    const { error: storageError } = await supabase.storage
      .from("senhas-pdf")
      .remove([compra.pdf_path]);

    if (storageError) {
      console.error("PDF antigo nao foi removido do storage", storageError);
    }
  }

  const { error: updateError } = await supabase
    .from("compras")
    .update({
      status_pagamento: "cancelado",
      pdf_path: null,
      email_enviado: false,
      email_enviado_at: null,
    })
    .eq("id", compra.id);

  if (updateError) {
    console.error("Erro ao cancelar pedido", updateError);
    throw new Error("Nao foi possivel cancelar o pedido.");
  }

  return { codigo_compra: compra.codigo_compra, status_pagamento: "cancelado", already_cancelled: false };
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

    if (payload.action === "cancel") {
      const cancelado = await cancelarPedido(supabase, String(payload.codigo_compra ?? ""));
      return json({ ok: true, pedido: cancelado });
    }

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
