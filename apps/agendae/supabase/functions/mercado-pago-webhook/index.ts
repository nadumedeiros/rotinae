import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyMercadoPagoSignature(
  request: Request,
  dataId: string,
  secret: string,
): Promise<boolean> {
  const signature = request.headers.get("x-signature");
  const requestId = request.headers.get("x-request-id");
  if (!signature || !requestId) return false;

  const parts = new Map<string, string>();
  for (const part of signature.split(",")) {
    const separator = part.indexOf("=");
    parts.set(
      separator < 0 ? part.trim() : part.slice(0, separator).trim(),
      separator < 0 ? "" : part.slice(separator + 1).trim(),
    );
  }
  const timestamp = parts.get("ts");
  const receivedHash = parts.get("v1")?.toLowerCase();
  if (!timestamp || !receivedHash || !/^[a-f0-9]{64}$/.test(receivedHash)) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  const timestampMs = timestampNumber > 1_000_000_000_000
    ? timestampNumber
    : timestampNumber * 1000;
  const ageMs = Date.now() - timestampMs;
  if (ageMs > 5 * 60 * 1000 || ageMs < -60 * 1000) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(manifest));
  const expectedHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return constantTimeEqual(expectedHash, receivedHash);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }
  const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  const webhookSecret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET");
  if (!accessToken || !webhookSecret) return new Response("not configured", { status: 503 });

  const url = new URL(request.url);
  const payload = await request.json().catch(() => ({}));
  const resourceId = payload?.data?.id ?? url.searchParams.get("id") ?? url.searchParams.get("data.id");
  const topic = payload?.type ?? url.searchParams.get("topic");
  if (!resourceId || (topic && !["subscription_preapproval", "preapproval"].includes(topic))) {
    return new Response("ok", { status: 200 });
  }
  if (!(await verifyMercadoPagoSignature(request, String(resourceId), webhookSecret))) {
    return new Response("invalid signature", { status: 401 });
  }

  // Nunca confiamos no status recebido: buscamos o recurso novamente usando o token server-side.
  const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(resourceId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return new Response("resource unavailable", { status: 202 });
  const mp = await response.json();
  if (!mp.external_reference) return new Response("ignored", { status: 200 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: current } = await admin
    .from("provider_subscriptions")
    .select("status, trial_started_at, trial_ends_at, current_period_ends_at, cancel_at_period_end")
    .eq("provider_user_id", mp.external_reference)
    .maybeSingle();
  const now = new Date();
  // Trial só existe quando o recurso reconciliado traz uma próxima cobrança
  // válida. Ausência desse dado nunca inventa 30 dias localmente.
  const nextPaymentAt = typeof mp.next_payment_date === "string"
    && Number.isFinite(new Date(mp.next_payment_date).getTime())
    ? mp.next_payment_date : null;
  const reconciledTrialEndsAt = current?.trial_ends_at
    ?? (current?.status === "pending" && mp.status === "authorized" ? nextPaymentAt : null);
  const inTrial = reconciledTrialEndsAt && new Date(reconciledTrialEndsAt).getTime() > now.getTime();
  const cancellationAccessActive = current?.cancel_at_period_end && current.current_period_ends_at
    && new Date(current.current_period_ends_at).getTime() > now.getTime();
  const status = ["cancelled", "canceled"].includes(mp.status) && cancellationAccessActive
    ? "cancel_at_period_end"
    : mp.status === "authorized" ? inTrial ? "trialing" : "active"
    : mp.status === "paused" ? "paused"
    : ["cancelled", "canceled"].includes(mp.status) ? "canceled" : "pending";
  const { error: saveError } = await admin.from("provider_subscriptions").upsert({
    provider_user_id: mp.external_reference,
    mercado_pago_subscription_id: mp.id,
    status,
    trial_started_at: status === "trialing" ? current?.trial_started_at ?? now.toISOString() : current?.trial_started_at ?? null,
    trial_ends_at: reconciledTrialEndsAt,
    current_period_ends_at: nextPaymentAt ?? current?.current_period_ends_at ?? null,
    cancel_at_period_end: status === "cancel_at_period_end",
    payer_email: mp.payer_email,
    next_payment_at: nextPaymentAt,
    payment_method_label: mp.payment_method_id ?? null,
    checkout_url: mp.init_point ?? null,
    last_mercado_pago_payload: mp,
    version: Date.now(),
  });
  if (saveError) return new Response("storage unavailable", { status: 503 });
  return new Response("ok", { status: 200 });
});
