import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: config } = await admin
    .from("subscription_finalization_config")
    .select("secret")
    .eq("id", true)
    .maybeSingle();
  const receivedSecret = request.headers.get("x-rotinae-subscription-secret") ?? "";
  if (!config?.secret || !constantTimeEqual(receivedSecret, config.secret)) {
    return new Response("unauthorized", { status: 401 });
  }

  const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  if (!accessToken) return new Response("payment provider unavailable", { status: 503 });

  const now = new Date().toISOString();
  const { data: due, error: readError } = await admin
    .from("provider_subscriptions")
    .select("provider_user_id, mercado_pago_subscription_id")
    .eq("status", "cancel_at_period_end")
    .eq("cancel_at_period_end", true)
    .not("mercado_pago_subscription_id", "is", null)
    .lte("current_period_ends_at", now)
    .limit(100);
  if (readError) return new Response("storage unavailable", { status: 503 });

  let finalized = 0;
  let failed = 0;
  for (const item of due ?? []) {
    const response = await fetch(
      `https://api.mercadopago.com/preapproval/${item.mercado_pago_subscription_id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "canceled" }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      failed += 1;
      continue;
    }

    const mercadoPagoPayload = await response.json().catch(() => ({}));
    const { error: updateError } = await admin
      .from("provider_subscriptions")
      .update({
        status: "canceled",
        cancel_at_period_end: false,
        checkout_url: null,
        last_mercado_pago_payload: mercadoPagoPayload,
        updated_at: now,
      })
      .eq("provider_user_id", item.provider_user_id)
      .eq("status", "cancel_at_period_end")
      .eq("cancel_at_period_end", true)
      .lte("current_period_ends_at", now);
    if (updateError) failed += 1;
    else finalized += 1;
  }

  return Response.json({ checked: due?.length ?? 0, finalized, failed });
});
