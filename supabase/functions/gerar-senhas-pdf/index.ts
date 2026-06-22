import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

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
  forma_pagamento: string;
  troco_para: number | null;
  entrega: boolean;
  taxa_entrega: number;
  endereco_rua: string | null;
  endereco_numero: string | null;
  endereco_bairro: string | null;
  endereco_referencia: string | null;
  status_pagamento: string;
  pdf_path: string | null;
  codigo_compra: string;
};

type Senha = {
  numero_senha: number;
  nome: string;
  email: string;
  whatsapp: string;
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

function assertServiceRole(req: Request) {
  const serviceRoleKey = getSecretKey();
  const authorizationToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const apiKey = req.headers.get("apikey");

  if (!serviceRoleKey || (authorizationToken !== serviceRoleKey && apiKey !== serviceRoleKey)) {
    throw new Error("Acesso não autorizado.");
  }
}

function formatDate(value: string) {
  return value || "A definir";
}

function formatFicha(numero: number) {
  return String(numero).padStart(2, "0");
}

function formatPagamento(compra: Compra) {
  if (compra.forma_pagamento === "dinheiro") {
    const troco = compra.troco_para
      ? ` - Troco para ${Number(compra.troco_para).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
      : "";
    return `Dinheiro${troco}`;
  }

  return "Pix";
}

function formatEnderecoLinhas(compra: Compra) {
  if (!compra.entrega) return ["Retirada na UMEC"];

  const linhas = [
    `Rua: ${compra.endereco_rua || "-"}`,
    `Número: ${compra.endereco_numero || "-"}  Bairro: ${compra.endereco_bairro || "-"}`,
  ];

  if (compra.endereco_referencia) {
    linhas.push(`Referência: ${compra.endereco_referencia}`);
  }

  return linhas;
}

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

async function gerarPdf(compra: Compra, senhas: Senha[]) {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const eventName = env("EVENTO_NOME", "Panqueca UMEC");
  const eventDate = formatDate(env("EVENTO_DATA"));
  const eventLocal = formatDate(env("EVENTO_LOCAL", "UMEC Tancredo Neves"));
  const eventHorario = formatDate(env("EVENTO_HORARIO"));

  for (const senha of senhas) {
    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.97, 0.97, 0.97) });
    page.drawRectangle({ x: 44, y: 70, width: width - 88, height: height - 140, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 44, y: height - 176, width: width - 88, height: 106, color: rgb(0.06, 0.06, 0.06) });
    page.drawCircle({ x: 100, y: height - 123, size: 36, color: rgb(0.85, 0.08, 0.11) });

    page.drawText("UMEC", { x: 78, y: height - 139, size: 28, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText(eventName, { x: 170, y: height - 118, size: 13, font, color: rgb(0.9, 0.9, 0.9) });
    page.drawText("FICHA DA PANQUECA", { x: 170, y: height - 145, size: 22, font: fontBold, color: rgb(1, 1, 1) });

    page.drawText("Número da ficha", { x: 72, y: height - 252, size: 12, font: fontBold, color: rgb(0.36, 0.39, 0.44) });
    page.drawText(formatFicha(senha.numero_senha), { x: 72, y: height - 326, size: 58, font: fontBold, color: rgb(0.85, 0.08, 0.11) });

    page.drawText("Comprador", { x: 72, y: height - 390, size: 12, font: fontBold, color: rgb(0.36, 0.39, 0.44) });
    page.drawText(compra.nome, { x: 72, y: height - 420, size: 18, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText("Entrega", { x: 72, y: height - 454, size: 12, font: fontBold, color: rgb(0.36, 0.39, 0.44) });
    page.drawText(compra.entrega ? "Sim" : "Não", { x: 142, y: height - 454, size: 12, font: fontBold, color: compra.entrega ? rgb(0.85, 0.08, 0.11) : rgb(0.1, 0.1, 0.1) });
    page.drawText(`Contato: ${compra.whatsapp}`, { x: 210, y: height - 454, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(`Pagamento: ${formatPagamento(compra)}`, { x: 72, y: height - 478, size: 12, font, color: rgb(0.1, 0.1, 0.1) });

    page.drawText("Data", { x: 72, y: height - 510, size: 12, font: fontBold, color: rgb(0.36, 0.39, 0.44) });
    page.drawText(eventDate, { x: 72, y: height - 536, size: 16, font, color: rgb(0.1, 0.1, 0.1) });

    page.drawText("Local", { x: 72, y: height - 586, size: 12, font: fontBold, color: rgb(0.36, 0.39, 0.44) });
    page.drawText(eventLocal, { x: 72, y: height - 612, size: 16, font, color: rgb(0.1, 0.1, 0.1) });

    page.drawText("Horário", { x: 72, y: height - 636, size: 12, font: fontBold, color: rgb(0.36, 0.39, 0.44) });
    page.drawText(eventHorario, { x: 72, y: height - 660, size: 16, font, color: rgb(0.1, 0.1, 0.1) });

    page.drawRectangle({ x: 72, y: 92, width: width - 144, height: 76, color: rgb(0.96, 0.96, 0.96) });
    page.drawText(compra.entrega ? "Endereço de entrega" : "Retirada na UMEC", {
      x: 92,
      y: compra.entrega ? 164 : 136,
      size: 14,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    if (compra.entrega) {
      const enderecoLinhas = formatEnderecoLinhas(compra).flatMap((linha) => wrapText(linha, 68)).slice(0, 4);
      enderecoLinhas.forEach((linha, index) => {
        page.drawText(linha, {
          x: 92,
          y: 144 - (index * 16),
          size: 10.5,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
      });
    }

    page.drawText(`Código da compra: ${compra.codigo_compra}`, {
      x: 72,
      y: 84,
      size: 10,
      font,
      color: rgb(0.36, 0.39, 0.44),
    });
  }

  return await pdfDoc.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    assertServiceRole(req);

    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = getSecretKey();

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Variáveis de ambiente do servidor não configuradas." }, 500);
    }

    const { compra_id } = await req.json();
    if (!compra_id) return json({ error: "Informe compra_id." }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: compra, error: compraError } = await supabase
      .from("compras")
      .select("*")
      .eq("id", compra_id)
      .single<Compra>();

    if (compraError || !compra) return json({ error: "Compra não encontrada." }, 404);
    if (!["pago", "dinheiro"].includes(compra.status_pagamento)) return json({ error: "Compra ainda não está paga." }, 409);
    if (compra.pdf_path) return json({ pdf_path: compra.pdf_path, reused: true });

    const { data: senhas, error: senhasError } = await supabase.rpc("gerar_senhas_para_compra", {
      p_compra_id: compra.id,
    });

    if (senhasError || !senhas?.length) {
      console.error("Erro ao gerar senhas", senhasError);
      return json({ error: "Não foi possível gerar as fichas." }, 500);
    }

    const pdfBytes = await gerarPdf(compra, senhas as Senha[]);
    const pdfPath = `${compra.codigo_compra}/senhas-${compra.codigo_compra}.pdf`;
    const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });

    const { error: uploadError } = await supabase.storage
      .from("senhas-pdf")
      .upload(pdfPath, pdfBlob, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("Erro ao salvar PDF", uploadError);
      return json({ error: "Não foi possível salvar o PDF." }, 500);
    }

    const { error: updateError } = await supabase
      .from("compras")
      .update({ pdf_path: pdfPath })
      .eq("id", compra.id);

    if (updateError) {
      console.error("Erro ao atualizar compra com PDF", updateError);
      return json({ error: "PDF salvo, mas não foi possível atualizar a compra." }, 500);
    }

    return json({ pdf_path: pdfPath, reused: false });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Erro inesperado.";
    return json({ error: message }, message === "Acesso não autorizado." ? 401 : 500);
  }
});
