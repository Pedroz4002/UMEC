# umec-senhas

Site estático e backend Supabase para venda online de senhas/fichas de refeição da UMEC com Pix do Mercado Pago, confirmação automática por webhook, geração de PDF, Storage privado e envio por e-mail via Resend.

## Estrutura

```text
index.html
style.css
script.js
.env.example
assets/logo-umec.png
supabase/schema.sql
supabase/functions/criar-pagamento/index.ts
supabase/functions/webhook-mercadopago/index.ts
supabase/functions/gerar-senhas-pdf/index.ts
supabase/functions/consultar-compra/index.ts
```

## 1. Criar o projeto no Supabase

1. Acesse o painel do Supabase.
2. Crie um novo projeto.
3. Copie:
   - `Project URL`
   - `anon public key`
   - `service_role key`

Use a `service_role key` somente nas Edge Functions. Nunca coloque essa chave no frontend.

## 2. Executar o schema

1. Abra o SQL Editor no Supabase.
2. Cole o conteúdo de `supabase/schema.sql`.
3. Execute o script.

O schema cria:

- tabela `compras`
- tabela `senhas`
- sequence `senha_numero_seq` começando em `1001`
- função segura `gerar_senhas_para_compra`
- índices
- constraint de status
- trigger de `updated_at`
- bucket privado `senhas-pdf`, quando permitido pelo ambiente

## 3. Criar o bucket `senhas-pdf`

Se o bucket não for criado pelo SQL:

1. Vá em Storage.
2. Crie um bucket chamado `senhas-pdf`.
3. Deixe o bucket privado.

O site usa URL assinada temporária para download. Não torne o bucket público.

## 4. Configurar variáveis de ambiente

Copie `.env.example` para `.env` quando for testar localmente com Supabase CLI.

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MERCADO_PAGO_ACCESS_TOKEN=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
WHATSAPP_UMEC=
VALOR_UNITARIO=10.00
EVENTO_NOME=Refeição UMEC
EVENTO_DATA=
EVENTO_LOCAL=
EVENTO_HORARIO=
MERCADO_PAGO_WEBHOOK_URL=
```

Configure os mesmos secrets no Supabase:

```bash
supabase secrets set SUPABASE_URL="https://SEU-PROJETO.supabase.co"
supabase secrets set SUPABASE_ANON_KEY="SUA_ANON_KEY"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="SUA_SERVICE_ROLE_KEY"
supabase secrets set MERCADO_PAGO_ACCESS_TOKEN="SEU_ACCESS_TOKEN"
supabase secrets set RESEND_API_KEY="SUA_RESEND_API_KEY"
supabase secrets set RESEND_FROM_EMAIL="UMEC <senhas@seudominio.com>"
supabase secrets set WHATSAPP_UMEC="5599999999999"
supabase secrets set VALOR_UNITARIO="10.00"
supabase secrets set EVENTO_NOME="Refeição UMEC"
supabase secrets set EVENTO_DATA="DD/MM/AAAA"
supabase secrets set EVENTO_LOCAL="UMEC Tancredo Neves"
supabase secrets set EVENTO_HORARIO="12h"
supabase secrets set MERCADO_PAGO_WEBHOOK_URL="https://SEU-PROJETO.supabase.co/functions/v1/webhook-mercadopago"
```

## 5. Configurar o frontend

Edite `script.js` e troque:

```js
SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
SUPABASE_ANON_KEY: "SUA_SUPABASE_ANON_KEY",
WHATSAPP_UMEC: "5599999999999",
VALOR_UNITARIO: 10.0,
EVENTO_NOME: "Refeição UMEC",
EVENTO_DATA: "A definir",
EVENTO_LOCAL: "UMEC Tancredo Neves",
EVENTO_HORARIO: "A definir",
```

No frontend devem ficar apenas dados públicos: URL do projeto, anon key, WhatsApp da UMEC e informações do evento. Não coloque chaves secretas no `script.js`.

## 6. Configurar Mercado Pago Pix

1. Crie uma aplicação no Mercado Pago.
2. Ative Pix para a conta vendedora.
3. Copie o `Access Token`.
4. Salve em `MERCADO_PAGO_ACCESS_TOKEN`.

A função `criar-pagamento` cria um pagamento Pix em `/v1/payments`, salva `payment_id`, QR Code e código copia e cola no Supabase.

## 7. Configurar webhook do Mercado Pago

1. No painel do Mercado Pago, configure notificações/webhooks.
2. URL:

```text
https://SEU-PROJETO.supabase.co/functions/v1/webhook-mercadopago
```

3. Eventos: pagamentos.

A função `webhook-mercadopago` nunca confia apenas no payload recebido. Ela extrai o `payment_id`, consulta a API do Mercado Pago e só confirma a compra quando o status real estiver `approved`.

## 8. Configurar Resend

1. Crie uma conta no Resend.
2. Valide seu domínio ou use um remetente permitido.
3. Gere a API key.
4. Configure:

```bash
supabase secrets set RESEND_API_KEY="SUA_RESEND_API_KEY"
supabase secrets set RESEND_FROM_EMAIL="UMEC <senhas@seudominio.com>"
```

Depois que o pagamento for aprovado, o PDF é enviado para o comprador como anexo.

## 9. Deploy das Edge Functions

Instale e autentique a Supabase CLI. Depois rode na pasta do projeto:

```bash
supabase functions deploy criar-pagamento
supabase functions deploy consultar-compra
supabase functions deploy gerar-senhas-pdf
supabase functions deploy webhook-mercadopago --no-verify-jwt
```

O webhook precisa de `--no-verify-jwt` porque o Mercado Pago não envia JWT do Supabase. A função `gerar-senhas-pdf` também valida manualmente a `SUPABASE_SERVICE_ROLE_KEY` no header `Authorization`, então não deve ser chamada pelo frontend.

## 10. Publicar no GitHub Pages

1. Suba este projeto para um repositório GitHub.
2. Confirme que `script.js` está com `SUPABASE_URL` e `SUPABASE_ANON_KEY` corretos.
3. Em `Settings > Pages`, escolha a branch e a pasta raiz do site.
4. Acesse a URL publicada.

Como o frontend é HTML, CSS e JavaScript puro, não há build obrigatório.

## 11. Testar o fluxo completo

1. Abra o site.
2. Preencha nome, WhatsApp, e-mail e quantidade.
3. Clique em `Gerar Pix`.
4. Confira se aparece QR Code, código copia e cola e botão do WhatsApp.
5. Pague o Pix em ambiente real ou sandbox compatível com sua conta Mercado Pago.
6. Verifique se o webhook foi chamado.
7. Confira no Supabase se a compra mudou para `pago`.
8. Confira se foram criadas linhas em `senhas`.
9. Confira se o PDF foi salvo no bucket `senhas-pdf`.
10. Confira se o e-mail chegou com o PDF em anexo.

## 12. Consultar compra e baixar PDF

Na área `Consultar Compra`, informe:

- código da compra, ou
- e-mail, ou
- WhatsApp

Se o pagamento estiver pendente, o site mostra:

```text
Pagamento ainda não confirmado.
```

Se estiver pago e o PDF existir, o site mostra:

```text
Pagamento confirmado.
```

E exibe o botão `Baixar minhas senhas em PDF`.

O PDF baixado é o mesmo salvo no Supabase Storage e enviado por e-mail. A função `consultar-compra` apenas gera uma URL assinada temporária.

## 13. Verificar logs de erro

Pelo Supabase CLI:

```bash
supabase functions logs criar-pagamento
supabase functions logs webhook-mercadopago
supabase functions logs gerar-senhas-pdf
supabase functions logs consultar-compra
```

Também é possível verificar logs no painel do Supabase em Edge Functions.

## Segurança aplicada

- O frontend não expõe `SUPABASE_SERVICE_ROLE_KEY`.
- O frontend não expõe `MERCADO_PAGO_ACCESS_TOKEN`.
- O frontend não expõe `RESEND_API_KEY`.
- Entradas são validadas no frontend e no backend.
- O pagamento é confirmado consultando a API do Mercado Pago.
- O PDF só é gerado com `status_pagamento = pago`.
- A geração das senhas usa sequence PostgreSQL e função transacional.
- O PDF não é recriado se `pdf_path` já existir.
- O bucket `senhas-pdf` deve ser privado.
- O download usa URL assinada temporária.
