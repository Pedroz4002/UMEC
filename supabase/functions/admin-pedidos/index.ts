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
  action?: "list" | "pdf" | "pdf_entregas" | "cancel";
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
  entrega: boolean;
  taxa_entrega: number | string;
  endereco_rua: string | null;
  endereco_numero: string | null;
  endereco_bairro: string | null;
  endereco_referencia: string | null;
  status_pagamento: string;
  created_at: string;
};

type Senha = {
  compra_id: string;
  numero_senha: number;
  nome: string;
  whatsapp?: string;
};

type LinhaPdf = {
  ficha: string;
  nome: string;
  whatsapp: string;
  status_pagamento: string;
  entrega: boolean;
  endereco: string;
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

function formatEndereco(compra: {
  entrega?: boolean;
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_bairro?: string | null;
  endereco_referencia?: string | null;
}) {
  if (!compra.entrega) return "-";
  const endereco = [
    compra.endereco_rua,
    compra.endereco_numero ? `nº ${compra.endereco_numero}` : "",
    compra.endereco_bairro,
  ].filter(Boolean).join(", ");
  const referencia = compra.endereco_referencia ? `Referência: ${compra.endereco_referencia}` : "";
  return [endereco, referencia].filter(Boolean).join(" | ") || "-";
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function getEstoqueTotal() {
  const estoqueTotal = Number(env("ESTOQUE_TOTAL", "50"));
  return Number.isInteger(estoqueTotal) && estoqueTotal > 0 ? estoqueTotal : 50;
}

async function getPedidos(supabase: ReturnType<typeof createClient>) {
  const { data: compras, error: comprasError } = await supabase
    .from("compras")
    .select("id,codigo_compra,nome,email,whatsapp,quantidade,valor_total,entrega,taxa_entrega,endereco_rua,endereco_numero,endereco_bairro,endereco_referencia,status_pagamento,created_at")
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
    entrega: compra.entrega,
    taxa_entrega: Number(compra.taxa_entrega ?? 0),
    endereco_rua: compra.endereco_rua,
    endereco_numero: compra.endereco_numero,
    endereco_bairro: compra.endereco_bairro,
    endereco_referencia: compra.endereco_referencia,
    endereco_formatado: formatEndereco(compra),
    status_pagamento: compra.status_pagamento,
    created_at: compra.created_at,
    created_at_formatado: formatDate(compra.created_at),
    senhas: senhasPorCompra.get(compra.id) ?? [],
  }));
}

async function getLinhasPdf(supabase: ReturnType<typeof createClient>, somenteEntregas = false) {
  const { data: compras, error: comprasError } = await supabase
    .from("compras")
    .select("id,nome,whatsapp,status_pagamento,entrega,endereco_rua,endereco_numero,endereco_bairro,endereco_referencia")
    .eq("status_pagamento", "pago");

  if (comprasError) {
    console.error("Erro ao buscar compras para PDF geral", comprasError);
    throw new Error("Nao foi possivel gerar o PDF geral.");
  }

  const comprasPorId = new Map<string, Compra>();
  for (const compra of (compras ?? []) as Compra[]) {
    if (somenteEntregas && !compra.entrega) continue;
    comprasPorId.set(compra.id, compra);
  }

  const { data: senhas, error } = await supabase
    .from("senhas")
    .select("compra_id,numero_senha,nome,whatsapp")
    .order("numero_senha", { ascending: true });

  if (error) {
    console.error("Erro ao buscar senhas para PDF geral", error);
    throw new Error("Nao foi possivel gerar o PDF geral.");
  }

  return ((senhas ?? []) as Senha[])
    .map((senha) => {
      const compra = comprasPorId.get(senha.compra_id);
      if (!compra) return null;
      return {
        ficha: formatFicha(senha.numero_senha),
        nome: senha.nome,
        whatsapp: formatPhone(senha.whatsapp ?? compra.whatsapp),
        status_pagamento: compra.status_pagamento,
        entrega: compra.entrega,
        endereco: formatEndereco(compra),
      };
    })
    .filter(Boolean) as LinhaPdf[];
}

async function gerarPdfGeral(supabase: ReturnType<typeof createClient>, somenteEntregas = false) {
  const linhas = await getLinhasPdf(supabase, somenteEntregas);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]);
  let y = 780;

  function header() {
    page.drawText(somenteEntregas ? "UMEC - Lista de Entregas" : "UMEC - Lista Geral de Fichas", {
      x: 42,
      y,
      size: 18,
      font: bold,
      color: rgb(0.05, 0.05, 0.05),
    });
    y -= 28;
    page.drawText(`Gerado em ${new Date().toLocaleString("pt-BR")}`, {
      x: 42,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 28;
    page.drawText("Ficha", { x: 42, y, size: 10, font: bold });
    page.drawText("Nome", { x: 86, y, size: 10, font: bold });
    page.drawText("Telefone", { x: 235, y, size: 10, font: bold });
    page.drawText("Pago", { x: 350, y, size: 10, font: bold });
    page.drawText("Entrega / Endereço", { x: 395, y, size: 10, font: bold });
    y -= 12;
    page.drawLine({ start: { x: 42, y }, end: { x: 552, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 18;
  }

  header();

  for (const linha of linhas) {
    if (y < 60) {
      page = pdf.addPage([595.28, 841.89]);
      y = 780;
      header();
    }

    page.drawText(linha.ficha, { x: 42, y, size: 10, font: bold });
    page.drawText(truncate(linha.nome, 24), { x: 86, y, size: 10, font });
    page.drawText(linha.whatsapp, { x: 235, y, size: 9, font });
    page.drawText(linha.status_pagamento === "pago" ? "Sim" : "Não", { x: 350, y, size: 10, font: bold });
    page.drawText(linha.entrega ? truncate(linha.endereco, 34) : "Retirada", { x: 395, y, size: 9, font });
    y -= 20;
  }

  if (!linhas.length) {
    page.drawText(somenteEntregas ? "Nenhuma entrega paga foi gerada ainda." : "Nenhuma ficha paga foi gerada ainda.", { x: 50, y, size: 12, font });
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

    if (payload.action === "pdf" || payload.action === "pdf_entregas") {
      const somenteEntregas = payload.action === "pdf_entregas";
      const pdfBytes = await gerarPdfGeral(supabase, somenteEntregas);
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${somenteEntregas ? "entregas-umec.pdf" : "pedidos-umec.pdf"}"`,
        },
      });
    }

    const pedidos = await getPedidos(supabase);
    const estoqueTotal = getEstoqueTotal();
    const totalFichasVendidas = pedidos
      .filter((pedido) => pedido.status_pagamento === "pago")
      .reduce((total, pedido) => total + Number(pedido.quantidade ?? 0), 0);
    const totalFichasReservadas = pedidos
      .filter((pedido) => ["pendente", "pago"].includes(pedido.status_pagamento))
      .reduce((total, pedido) => total + Number(pedido.quantidade ?? 0), 0);

    return json({
      pedidos,
      total_pedidos: pedidos.length,
      total_pagos: pedidos.filter((pedido) => pedido.status_pagamento === "pago").length,
      total_fichas_pagas: pedidos.reduce((total, pedido) => total + pedido.senhas.length, 0),
      total_fichas_vendidas: totalFichasVendidas,
      total_fichas_disponiveis: Math.max(estoqueTotal - totalFichasReservadas, 0),
      total_arrecadado: pedidos
        .filter((pedido) => pedido.status_pagamento === "pago")
        .reduce((total, pedido) => total + Number(pedido.valor_total ?? 0), 0),
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado." }, 500);
  }
});
