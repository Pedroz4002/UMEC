import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { strToU8, zipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AdminPayload = {
  usuario?: string;
  senha?: string;
  action?: "list" | "pdf" | "pdf_entregas" | "cancel" | "fichas" | "marcar_entregue" | "backup" | "backup_limpar";
  codigo_compra?: string;
  senha_id?: string;
  entregue?: boolean;
  confirmacao_limpeza?: string;
};

type Compra = {
  id: string;
  codigo_compra: string;
  nome: string;
  email: string;
  whatsapp: string;
  quantidade: number;
  valor_total: number | string;
  forma_pagamento: string;
  troco_para: number | string | null;
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
  id?: string;
  compra_id: string;
  numero_senha: number;
  nome: string;
  whatsapp?: string;
  usada?: boolean;
  created_at?: string;
};

type LinhaPdf = {
  ficha: string;
  nome: string;
  whatsapp: string;
  status_pagamento: string;
  forma_pagamento: string;
  troco_para: number | null;
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

function formatPagamento(linha: { forma_pagamento: string; troco_para?: number | null }) {
  if (linha.forma_pagamento !== "dinheiro") return "Pix";
  if (!linha.troco_para) return "Dinheiro";
  const troco = Number(linha.troco_para).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  return `Dinheiro - troco para ${troco}`;
}

function wrapTextByWidth(
  text: string,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  size: number,
  maxWidth: number,
) {
  const words = String(text || "-").split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function getEstoqueTotal() {
  const estoqueTotal = Number(env("ESTOQUE_TOTAL", "50"));
  return Number.isInteger(estoqueTotal) && estoqueTotal > 0 ? estoqueTotal : 50;
}

function getPixExpirationMinutes() {
  const raw = env("PIX_EXPIRATION_MINUTES", "10").trim();
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1) return 10;
  return Math.min(Math.floor(minutes), 60);
}

async function cancelMercadoPagoPayment(paymentId: string) {
  const mercadoPagoToken = env("MERCADO_PAGO_ACCESS_TOKEN");
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
    console.error("Nao foi possivel cancelar Pix vencido no Mercado Pago", { paymentId, error });
    return false;
  }

  return true;
}

async function getMercadoPagoPaymentStatus(paymentId: string) {
  const mercadoPagoToken = env("MERCADO_PAGO_ACCESS_TOKEN");
  if (!paymentId || !mercadoPagoToken) return "";

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${mercadoPagoToken}`,
    },
  });
  const payment = await response.json().catch(() => ({}));
  return String(payment?.status ?? "");
}

async function cancelExpiredPendingPix(supabase: ReturnType<typeof createClient>) {
  const cutoff = new Date(Date.now() - (getPixExpirationMinutes() * 60 * 1000)).toISOString();
  const { data: compras, error } = await supabase
    .from("compras")
    .select("id,codigo_compra,mercado_pago_payment_id,status_pagamento")
    .in("status_pagamento", ["pendente", "cancelado"])
    .lte("created_at", cutoff)
    .limit(100);

  if (error) {
    console.error("Erro ao buscar Pix pendentes vencidos", error);
    return { encontrados: 0, tentados_mercado_pago: 0, cancelados_mercado_pago: 0, marcados_cancelados: 0, falhas: 0, detalhes: [] };
  }

  let tentadosMercadoPago = 0;
  let canceladosMercadoPago = 0;
  let marcadosCancelados = 0;
  let falhas = 0;
  const detalhes: Array<{
    codigo_compra: string;
    payment_id: string;
    status_mercado_pago: string;
    cancelado_mercado_pago: boolean;
  }> = [];

  for (const compra of compras ?? []) {
    const paymentId = String(compra.mercado_pago_payment_id ?? "");
    if (compra.status_pagamento === "cancelado" && !paymentId) continue;

    let shouldCancel = true;
    if (paymentId) {
      tentadosMercadoPago += 1;
      shouldCancel = await cancelMercadoPagoPayment(paymentId);
      if (shouldCancel) {
        canceladosMercadoPago += 1;
      }
      detalhes.push({
        codigo_compra: String(compra.codigo_compra),
        payment_id: paymentId,
        status_mercado_pago: await getMercadoPagoPaymentStatus(paymentId),
        cancelado_mercado_pago: shouldCancel,
      });
    }
    if (!shouldCancel) {
      falhas += 1;
      continue;
    }

    if (compra.status_pagamento === "cancelado") {
      continue;
    }

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
      falhas += 1;
    } else {
      marcadosCancelados += 1;
    }
  }

  return {
    encontrados: compras?.length ?? 0,
    tentados_mercado_pago: tentadosMercadoPago,
    cancelados_mercado_pago: canceladosMercadoPago,
    marcados_cancelados: marcadosCancelados,
    falhas,
    detalhes,
  };
}

async function getPedidos(supabase: ReturnType<typeof createClient>) {
  const { data: compras, error: comprasError } = await supabase
    .from("compras")
    .select("id,codigo_compra,nome,email,whatsapp,quantidade,valor_total,forma_pagamento,troco_para,entrega,taxa_entrega,endereco_rua,endereco_numero,endereco_bairro,endereco_referencia,status_pagamento,created_at")
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
    forma_pagamento: compra.forma_pagamento,
    troco_para: compra.troco_para === null ? null : Number(compra.troco_para),
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
    .select("id,nome,whatsapp,status_pagamento,forma_pagamento,troco_para,entrega,endereco_rua,endereco_numero,endereco_bairro,endereco_referencia")
    .in("status_pagamento", ["pago", "dinheiro"]);

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
        forma_pagamento: compra.forma_pagamento,
        troco_para: compra.troco_para === null ? null : Number(compra.troco_para),
        entrega: compra.entrega,
        endereco: formatEndereco(compra),
      };
    })
    .filter(Boolean) as LinhaPdf[];
}

function uint8ArrayToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function csvCell(value: unknown) {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replaceAll('"', '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>) {
  const keys = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));

  if (!keys.length) return "";

  const header = keys.map(csvCell).join(",");
  const body = rows.map((row) => keys.map((key) => csvCell(row[key])).join(","));
  return [header, ...body].join("\n");
}

function sanitizeZipPath(path: string) {
  return path
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replaceAll("../", "")
    .replaceAll("..", "_");
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

async function collectStorageFiles(
  supabase: ReturnType<typeof createClient>,
  files: Record<string, Uint8Array>,
  prefix = "",
) {
  const { data, error } = await supabase.storage
    .from("senhas-pdf")
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });

  if (error) {
    console.error("Erro ao listar arquivos do storage para backup", { prefix, error });
    return 0;
  }

  let count = 0;
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    const { data: blob, error: downloadError } = await supabase.storage
      .from("senhas-pdf")
      .download(path);

    if (!downloadError && blob) {
      files[`storage/senhas-pdf/${sanitizeZipPath(path)}`] = new Uint8Array(await blob.arrayBuffer());
      count += 1;
      continue;
    }

    count += await collectStorageFiles(supabase, files, path);
  }

  return count;
}

async function collectStoragePaths(
  supabase: ReturnType<typeof createClient>,
  prefix = "",
) {
  const { data, error } = await supabase.storage
    .from("senhas-pdf")
    .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });

  if (error) {
    console.error("Erro ao listar arquivos do storage para limpeza", { prefix, error });
    return [] as string[];
  }

  const paths: string[] = [];
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    const { data: blob, error: downloadError } = await supabase.storage
      .from("senhas-pdf")
      .download(path);

    if (!downloadError && blob) {
      paths.push(path);
      continue;
    }

    paths.push(...await collectStoragePaths(supabase, path));
  }

  return paths;
}

async function gerarBackupEnviarEmail(supabase: ReturnType<typeof createClient>) {
  const { data: compras, error: comprasError } = await supabase
    .from("compras")
    .select("*")
    .order("created_at", { ascending: true });

  if (comprasError) {
    console.error("Erro ao buscar compras para backup", comprasError);
    throw new Error("Não foi possível gerar o backup das compras.");
  }

  const { data: senhas, error: senhasError } = await supabase
    .from("senhas")
    .select("*")
    .order("numero_senha", { ascending: true });

  if (senhasError) {
    console.error("Erro ao buscar fichas para backup", senhasError);
    throw new Error("Não foi possível gerar o backup das fichas.");
  }

  const comprasRows = (compras ?? []) as Array<Record<string, unknown>>;
  const senhasRows = (senhas ?? []) as Array<Record<string, unknown>>;
  const resumo = {
    gerado_em: new Date().toISOString(),
    total_pedidos: comprasRows.length,
    total_fichas: senhasRows.length,
    total_pagos: comprasRows.filter((compra) => ["pago", "dinheiro"].includes(String(compra.status_pagamento))).length,
    total_cancelados: comprasRows.filter((compra) => compra.status_pagamento === "cancelado").length,
  };

  const files: Record<string, Uint8Array> = {
    "banco/compras.json": strToU8(JSON.stringify(comprasRows, null, 2)),
    "banco/compras.csv": strToU8(toCsv(comprasRows)),
    "banco/senhas.json": strToU8(JSON.stringify(senhasRows, null, 2)),
    "banco/senhas.csv": strToU8(toCsv(senhasRows)),
    "banco/resumo.json": strToU8(JSON.stringify(resumo, null, 2)),
  };

  const arquivosStorage = await collectStorageFiles(supabase, files);
  const zipBytes = zipSync(files, { level: 6 });
  const resendApiKey = env("RESEND_API_KEY");
  const fromEmail = env("RESEND_FROM_EMAIL");
  const adminEmail = env("UMEC_ADMIN_EMAIL", "ph493591@gmail.com").trim();

  if (!resendApiKey || !fromEmail || !adminEmail) {
    throw new Error("Resend ou e-mail do Admin não configurado.");
  }

  const filename = `backup-umec-${new Date().toISOString().slice(0, 10)}.zip`;
  await sendResendEmail(resendApiKey, {
    from: fromEmail,
    to: [adminEmail],
    subject: "Backup UMEC - banco de dados e PDFs",
    text: [
      "Backup do sistema UMEC em anexo.",
      "",
      `Pedidos no banco: ${comprasRows.length}`,
      `Fichas no banco: ${senhasRows.length}`,
      `Arquivos do storage: ${arquivosStorage}`,
      "",
      "Guarde este arquivo em local seguro.",
    ].join("\n"),
    attachments: [{ filename, content: uint8ArrayToBase64(zipBytes) }],
  });

  return {
    email: adminEmail,
    compras: comprasRows.length,
    senhas: senhasRows.length,
    arquivos_storage: arquivosStorage,
    tamanho_zip_bytes: zipBytes.byteLength,
  };
}

async function limparBancoPedidos(supabase: ReturnType<typeof createClient>) {
  const storagePaths = await collectStoragePaths(supabase);
  let arquivosStorageRemovidos = 0;

  for (let i = 0; i < storagePaths.length; i += 100) {
    const chunk = storagePaths.slice(i, i + 100);
    const { error } = await supabase.storage
      .from("senhas-pdf")
      .remove(chunk);

    if (error) {
      console.error("Erro ao remover PDFs do storage", { chunk, error });
      throw new Error("Não foi possível remover todos os PDFs antigos.");
    }

    arquivosStorageRemovidos += chunk.length;
  }

  const { count: senhasRemovidas, error: senhasError } = await supabase
    .from("senhas")
    .delete({ count: "exact" })
    .not("id", "is", null);

  if (senhasError) {
    console.error("Erro ao limpar fichas", senhasError);
    throw new Error("Não foi possível limpar as fichas.");
  }

  const { count: comprasRemovidas, error: comprasError } = await supabase
    .from("compras")
    .delete({ count: "exact" })
    .not("id", "is", null);

  if (comprasError) {
    console.error("Erro ao limpar compras", comprasError);
    throw new Error("Não foi possível limpar os pedidos.");
  }

  const { error: resetSeqError } = await supabase.rpc("reset_senha_numero_seq");
  if (resetSeqError) {
    console.error("Erro ao resetar sequência das fichas", resetSeqError);
    throw new Error("Pedidos removidos, mas não foi possível resetar a numeração das fichas.");
  }

  return {
    compras_removidas: comprasRemovidas ?? 0,
    senhas_removidas: senhasRemovidas ?? 0,
    arquivos_storage_removidos: arquivosStorageRemovidos,
  };
}

async function gerarBackupEnviarEmailELimpar(supabase: ReturnType<typeof createClient>) {
  const backup = await gerarBackupEnviarEmail(supabase);
  const limpeza = await limparBancoPedidos(supabase);
  return { backup, limpeza };
}

async function getFichasTempoReal(supabase: ReturnType<typeof createClient>) {
  const { data: compras, error: comprasError } = await supabase
    .from("compras")
    .select("id,codigo_compra,nome,email,whatsapp,valor_total,forma_pagamento,troco_para,entrega,endereco_rua,endereco_numero,endereco_bairro,endereco_referencia,status_pagamento,created_at")
    .in("status_pagamento", ["pago", "dinheiro"])
    .order("created_at", { ascending: true });

  if (comprasError) {
    console.error("Erro ao buscar compras para tempo real", comprasError);
    throw new Error("Não foi possível carregar as fichas em tempo real.");
  }

  const comprasPorId = new Map<string, Compra>();
  for (const compra of (compras ?? []) as Compra[]) {
    comprasPorId.set(compra.id, compra);
  }

  const compraIds = Array.from(comprasPorId.keys());
  if (!compraIds.length) return { fichas: [], total: 0 };

  const { data: senhas, error: senhasError } = await supabase
    .from("senhas")
    .select("id,compra_id,numero_senha,nome,whatsapp,usada,created_at")
    .in("compra_id", compraIds)
    .order("numero_senha", { ascending: true });

  if (senhasError) {
    console.error("Erro ao buscar fichas para tempo real", senhasError);
    throw new Error("Não foi possível carregar as fichas em tempo real.");
  }

  const fichas = ((senhas ?? []) as Senha[])
    .map((senha) => {
      const compra = comprasPorId.get(senha.compra_id);
      if (!compra) return null;
      return {
        id: senha.id,
        numero_senha: senha.numero_senha,
        numero_senha_formatado: formatFicha(senha.numero_senha),
        nome: senha.nome || compra.nome,
        whatsapp: senha.whatsapp || compra.whatsapp,
        whatsapp_formatado: formatPhone(senha.whatsapp || compra.whatsapp),
        codigo_compra: compra.codigo_compra,
        status_pagamento: compra.status_pagamento,
        forma_pagamento: compra.forma_pagamento,
        troco_para: compra.troco_para === null ? null : Number(compra.troco_para),
        entrega: compra.entrega,
        endereco_formatado: formatEndereco(compra),
        valor_total: Number(compra.valor_total ?? 0),
        entregue: Boolean(senha.usada),
        created_at: senha.created_at,
      };
    })
    .filter(Boolean);

  return { fichas, total: fichas.length };
}

async function marcarFichaEntregue(
  supabase: ReturnType<typeof createClient>,
  senhaId: string,
  entregue: boolean,
) {
  const id = senhaId.trim();
  if (!id) throw new Error("Ficha não informada.");

  const { data, error } = await supabase
    .from("senhas")
    .update({ usada: entregue })
    .eq("id", id)
    .select("id,numero_senha,usada")
    .single();

  if (error || !data) {
    console.error("Erro ao marcar ficha como entregue", error);
    throw new Error("Não foi possível atualizar a ficha.");
  }

  return {
    id: data.id,
    numero_senha: formatFicha(Number(data.numero_senha)),
    entregue: Boolean(data.usada),
  };
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
    if (somenteEntregas) {
      page.drawText("Ficha", { x: 42, y, size: 10, font: bold });
      page.drawText("Nome e entrega", { x: 86, y, size: 10, font: bold });
      page.drawText("Telefone", { x: 430, y, size: 10, font: bold });
      y -= 12;
      page.drawLine({ start: { x: 42, y }, end: { x: 552, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
      y -= 18;
      return;
    }

    page.drawText("Ficha", { x: 42, y, size: 10, font: bold });
    page.drawText("Nome", { x: 86, y, size: 10, font: bold });
    page.drawText("Telefone", { x: 235, y, size: 10, font: bold });
    page.drawText("Pagamento", { x: 330, y, size: 10, font: bold });
    page.drawText("Tipo", { x: 455, y, size: 10, font: bold });
    y -= 12;
    page.drawLine({ start: { x: 42, y }, end: { x: 552, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 18;
  }

  header();

  for (const linha of linhas) {
    const pagamento = formatPagamento(linha);

    if (somenteEntregas) {
      const pagamentoLinhas = wrapTextByWidth(`Pagamento: ${pagamento}`, font, 9, 450);
      const enderecoLinhas = wrapTextByWidth(`Endereço: ${linha.endereco}`, font, 9, 450);
      const rowHeight = 46 + ((pagamentoLinhas.length + enderecoLinhas.length) * 12);

      if (y - rowHeight < 54) {
        page = pdf.addPage([595.28, 841.89]);
        y = 780;
        header();
      }

      page.drawRectangle({
        x: 38,
        y: y - rowHeight + 12,
        width: 516,
        height: rowHeight - 8,
        borderColor: rgb(0.84, 0.84, 0.84),
        borderWidth: 0.8,
        color: rgb(0.985, 0.985, 0.985),
      });

      page.drawText(linha.ficha, { x: 48, y: y - 14, size: 12, font: bold, color: rgb(0.85, 0.08, 0.11) });
      page.drawText(truncate(linha.nome, 42), { x: 86, y: y - 12, size: 11, font: bold });
      page.drawText(linha.whatsapp, { x: 430, y: y - 12, size: 9, font });

      let textY = y - 30;
      for (const line of pagamentoLinhas) {
        page.drawText(line, { x: 86, y: textY, size: 9, font });
        textY -= 12;
      }
      for (const line of enderecoLinhas) {
        page.drawText(line, { x: 86, y: textY, size: 9, font });
        textY -= 12;
      }

      y -= rowHeight;
      continue;
    }

    if (y < 60) {
      page = pdf.addPage([595.28, 841.89]);
      y = 780;
      header();
    }

    page.drawText(linha.ficha, { x: 42, y, size: 10, font: bold });
    page.drawText(truncate(linha.nome, 24), { x: 86, y, size: 10, font });
    page.drawText(linha.whatsapp, { x: 235, y, size: 9, font });
    page.drawText(truncate(pagamento, 26), { x: 330, y, size: 9, font: bold });
    page.drawText(linha.entrega ? "Delivery" : "Sem delivery", { x: 455, y, size: 9, font });
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
    .select("id,codigo_compra,status_pagamento,pdf_path,mercado_pago_payment_id")
    .eq("codigo_compra", codigo)
    .single();

  if (compraError || !compra) {
    console.error("Pedido nao encontrado para cancelar", compraError);
    throw new Error("Pedido nao encontrado.");
  }

  const paymentId = String(compra.mercado_pago_payment_id ?? "");
  let mercadoPagoCancelado: boolean | null = null;
  let mercadoPagoStatus = "";

  if (compra.status_pagamento === "cancelado") {
    if (paymentId) {
      mercadoPagoCancelado = await cancelMercadoPagoPayment(paymentId);
      mercadoPagoStatus = await getMercadoPagoPaymentStatus(paymentId);
    }
    return {
      codigo_compra: compra.codigo_compra,
      status_pagamento: "cancelado",
      already_cancelled: true,
      mercado_pago_cancelado: mercadoPagoCancelado,
      mercado_pago_status: mercadoPagoStatus,
    };
  }

  if (compra.status_pagamento === "pendente" && paymentId) {
    mercadoPagoCancelado = await cancelMercadoPagoPayment(paymentId);
    mercadoPagoStatus = await getMercadoPagoPaymentStatus(paymentId);
  }

  const { error: senhasError } = await supabase
    .from("senhas")
    .delete()
    .eq("compra_id", compra.id);

  if (senhasError) {
    console.error("Erro ao remover fichas do pedido cancelado", senhasError);
    throw new Error("Nao foi possivel remover as fichas do pedido.");
  }

  const { error: resetSeqError } = await supabase.rpc("reset_senha_numero_seq");
  if (resetSeqError) {
    console.error("Erro ao reajustar sequencia das fichas", resetSeqError);
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

  return {
    codigo_compra: compra.codigo_compra,
    status_pagamento: "cancelado",
    already_cancelled: false,
    mercado_pago_cancelado: mercadoPagoCancelado,
    mercado_pago_status: mercadoPagoStatus,
  };
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
    const limpezaPix = await cancelExpiredPendingPix(supabase);

    if (payload.action === "cancel") {
      const cancelado = await cancelarPedido(supabase, String(payload.codigo_compra ?? ""));
      return json({ ok: true, pedido: cancelado });
    }

    if (payload.action === "fichas") {
      return json(await getFichasTempoReal(supabase));
    }

    if (payload.action === "marcar_entregue") {
      const ficha = await marcarFichaEntregue(supabase, String(payload.senha_id ?? ""), payload.entregue === true);
      return json({ ok: true, ficha });
    }

    if (payload.action === "backup") {
      return json(await gerarBackupEnviarEmail(supabase));
    }

    if (payload.action === "backup_limpar") {
      if (String(payload.confirmacao_limpeza ?? "").trim() !== "UMEC") {
        return json({ error: "Digite UMEC para confirmar a limpeza do banco." }, 400);
      }
      return json(await gerarBackupEnviarEmailELimpar(supabase));
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
      .filter((pedido) => ["pago", "dinheiro"].includes(pedido.status_pagamento))
      .reduce((total, pedido) => total + Number(pedido.quantidade ?? 0), 0);
    const totalFichasReservadas = pedidos
      .filter((pedido) => ["pendente", "pago", "dinheiro"].includes(pedido.status_pagamento))
      .reduce((total, pedido) => total + Number(pedido.quantidade ?? 0), 0);

    return json({
      pedidos,
      total_pedidos: pedidos.length,
      total_pagos: pedidos.filter((pedido) => ["pago", "dinheiro"].includes(pedido.status_pagamento)).length,
      total_fichas_pagas: pedidos.reduce((total, pedido) => total + pedido.senhas.length, 0),
      total_fichas_vendidas: totalFichasVendidas,
      total_fichas_disponiveis: Math.max(estoqueTotal - totalFichasReservadas, 0),
      total_arrecadado: pedidos
        .filter((pedido) => ["pago", "dinheiro"].includes(pedido.status_pagamento))
        .reduce((total, pedido) => total + Number(pedido.valor_total ?? 0), 0),
      limpeza_pix: limpezaPix,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado." }, 500);
  }
});
