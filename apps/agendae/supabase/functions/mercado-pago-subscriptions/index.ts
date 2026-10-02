import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const mpStatus = (status?: string) => {
  if (status === "authorized") return "active";
  if (status === "paused") return "paused";
  if (status === "cancelled" || status === "canceled") return "canceled";
  return "pending";
};

const validHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};

const validCardToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{20,256}$/.test(value);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  const environment = Deno.env.get("MERCADO_PAGO_ENVIRONMENT") ?? "test";
  const configuredPriceCents = Number(Deno.env.get("ROTINAE_PREMIUM_PRICE_CENTS") ?? "2900");
  const priceCents = Number.isSafeInteger(configuredPriceCents) && configuredPriceCents > 0
    ? configuredPriceCents : 2900;
  if (!accessToken) return json({ error: "PAYMENT_PROVIDER_NOT_CONFIGURED" }, 503);

  const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return json({ error: "SESSION_EXPIRED" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
  if (profileError) return json({ error: "SUBSCRIPTION_STORAGE_ERROR" }, 503);
  if (profile?.role !== "provider") return json({ error: "PROVIDER_PROFILE_REQUIRED" }, 403);

  const body = await request.json().catch(() => ({}));
  const action = body.action ?? "status";
  const { data: current, error: currentError } = await admin.from("provider_subscriptions").select("*").eq("provider_user_id", user.id).maybeSingle();
  if (currentError) return json({ error: "SUBSCRIPTION_STORAGE_ERROR" }, 503);

  if (action === "status") {
    const periodEndsAt = current?.current_period_ends_at ?? current?.trial_ends_at ?? null;
    const cancellationAccessActive = current?.status === "cancel_at_period_end" && periodEndsAt
      && new Date(periodEndsAt).getTime() > Date.now();
    const hasPremiumAccess = Boolean(current && (["trialing", "active"].includes(current.status) || cancellationAccessActive));
    const publicStatus = current?.status === "cancel_at_period_end" && !cancellationAccessActive
      ? "canceled" : current?.status ?? "free";
    return json({
      providerUserId: user.id,
      plan: hasPremiumAccess ? "premium" : "free",
      status: publicStatus,
      source: current?.status === "trialing" ? "trial" : hasPremiumAccess ? "subscription" : "free",
      trialStartedAt: current?.trial_started_at ?? null,
      trialEndsAt: current?.trial_ends_at ?? null,
      currentPeriodEndsAt: periodEndsAt,
      cancelAtPeriodEnd: Boolean(cancellationAccessActive),
      dailyAppointmentLimit: hasPremiumAccess ? null : 2,
      clientLimit: hasPremiumAccess ? null : 5,
      canAddClientNotes: hasPremiumAccess,
      canCreateRecurrence: hasPremiumAccess,
      usedAppointmentsToday: 0,
      usedClients: 0,
      version: current?.version ?? 1,
      updatedAt: current?.updated_at ?? new Date().toISOString(),
      billing: {
        status: publicStatus,
        priceCents,
        currency: "BRL",
        nextPaymentAt: current?.next_payment_at ?? current?.trial_ends_at ?? null,
        paymentMethodLabel: current?.payment_method_label ?? null,
        cancelAtPeriodEnd: Boolean(cancellationAccessActive),
      },
    });
  }

  const idempotencyKey = String(body.idempotencyKey ?? "").trim();
  if (!idempotencyKey) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);
  const { data: previous } = await admin.from("subscription_idempotency_keys")
    .select("operation, response_payload")
    .eq("provider_user_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (previous) {
    if (previous.operation !== action) return json({ error: "IDEMPOTENCY_KEY_REUSED" }, 409);
    if (previous.response_payload) return json(previous.response_payload);
    return json({ error: "OPERATION_IN_PROGRESS" }, 409);
  }
  const { error: reservationError } = await admin.from("subscription_idempotency_keys").insert({
    provider_user_id: user.id, idempotency_key: idempotencyKey, operation: action,
  });
  if (reservationError) return json({ error: "OPERATION_IN_PROGRESS" }, 409);
  const releaseReservation = async () => {
    await admin.from("subscription_idempotency_keys").delete()
      .eq("provider_user_id", user.id).eq("idempotency_key", idempotencyKey);
  };
  const completeReservation = async (responsePayload: Record<string, unknown>) => {
    await admin.from("subscription_idempotency_keys").update({ response_payload: responsePayload })
      .eq("provider_user_id", user.id).eq("idempotency_key", idempotencyKey);
  };

  if (action === "create_authorized") {
    if (!validCardToken(body.cardTokenId)) {
      await releaseReservation();
      return json({ error: "CARD_TOKEN_INVALID", detail: "O token do cartão é inválido ou expirou." }, 400);
    }
    if (current?.mercado_pago_subscription_id && ["pending", "trialing", "active"].includes(current.status)) {
      await releaseReservation();
      return json({ error: "CHECKOUT_ALREADY_OPEN", detail: "Já existe uma assinatura em andamento para esta conta." }, 409);
    }

    const configuredTestPayer = Deno.env.get("MERCADO_PAGO_TEST_PAYER_EMAIL");
    const payerEmail = environment === "production"
      ? user.email
      : configuredTestPayer?.includes("@")
        ? configuredTestPayer
        : "test@testuser.com";
    const now = Date.now();
    const activeTrialEndsAt = current?.status === "trialing" && current.trial_ends_at
      && new Date(current.trial_ends_at).getTime() > now
      ? current.trial_ends_at
      : null;
    const trialAlreadyUsed = Boolean(current?.trial_started_at || current?.trial_ends_at);
    const autoRecurring: Record<string, unknown> = {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: priceCents / 100,
      currency_id: "BRL",
    };
    if (activeTrialEndsAt) autoRecurring.start_date = activeTrialEndsAt;
    else if (!trialAlreadyUsed) {
      autoRecurring.free_trial = { frequency: 30, frequency_type: "days" };
    }

    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        reason: "Rotinaê Premium",
        external_reference: user.id,
        payer_email: payerEmail,
        card_token_id: body.cardTokenId,
        notification_url: `${supabaseUrl}/functions/v1/mercado-pago-webhook`,
        auto_recurring: autoRecurring,
        status: "authorized",
      }),
    });
    const mp = await response.json();
    if (!response.ok || typeof mp?.id !== "string") {
      const causes = Array.isArray(mp?.cause)
        ? mp.cause.map((cause: { description?: string; code?: string }) => cause.description ?? cause.code).filter(Boolean).join(" · ")
        : "";
      await releaseReservation();
      return json({
        error: "MERCADO_PAGO_ERROR",
        detail: [mp?.message, causes].filter(Boolean).join(" — ") || "O Mercado Pago recusou a assinatura.",
      }, response.status >= 400 && response.status < 500 ? 422 : 503);
    }

    const { error: saveError } = await admin.from("provider_subscriptions").upsert({
      provider_user_id: user.id,
      mercado_pago_subscription_id: mp.id,
      // A resposta de criação aceita o cartão, mas o entitlement só muda após
      // o webhook assinado reconciliar o recurso diretamente no Mercado Pago.
      status: activeTrialEndsAt ? "trialing" : "pending",
      payer_email: payerEmail,
      trial_started_at: current?.trial_started_at ?? null,
      trial_ends_at: current?.trial_ends_at ?? null,
      current_period_ends_at: current?.current_period_ends_at ?? null,
      next_payment_at: current?.next_payment_at ?? null,
      cancel_at_period_end: false,
      checkout_url: null,
      last_mercado_pago_payload: mp,
    });
    if (saveError) {
      await releaseReservation();
      return json({ error: "SUBSCRIPTION_STORAGE_ERROR" }, 503);
    }
    const result = { accepted: true, subscriptionId: mp.id, status: "processing" };
    await completeReservation(result);
    return json(result, 202);
  }

  if (action === "update_card") {
    if (!validCardToken(body.cardTokenId)) {
      await releaseReservation();
      return json({ error: "CARD_TOKEN_INVALID", detail: "O token do cartão é inválido ou expirou." }, 400);
    }
    if (!current?.mercado_pago_subscription_id || !["trialing", "active", "past_due", "cancel_at_period_end"].includes(current.status)) {
      await releaseReservation();
      return json({ error: "SUBSCRIPTION_NOT_FOUND" }, 404);
    }
    const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(current.mercado_pago_subscription_id)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ card_token_id: body.cardTokenId }),
    });
    const mp = await response.json();
    if (!response.ok) {
      await releaseReservation();
      return json({
        error: "CARD_UPDATE_FAILED",
        detail: mp?.message ?? "O Mercado Pago não aceitou o novo cartão.",
      }, response.status >= 400 && response.status < 500 ? 422 : 503);
    }
    const { error: saveError } = await admin.from("provider_subscriptions").update({
      payment_method_label: mp.payment_method_id ?? current.payment_method_label,
      last_mercado_pago_payload: mp,
    }).eq("provider_user_id", user.id);
    if (saveError) {
      await releaseReservation();
      return json({ error: "SUBSCRIPTION_STORAGE_ERROR" }, 503);
    }
    const status = current.status === "trialing" ? "trialing" : current.status === "active" ? "active" : "processing";
    const result = { accepted: true, subscriptionId: current.mercado_pago_subscription_id, status };
    await completeReservation(result);
    return json(result);
  }

  if (action === "create") {
    const configuredTestPayer = Deno.env.get("MERCADO_PAGO_TEST_PAYER_EMAIL");
    const payerEmail = environment === "production"
      ? user.email
      : configuredTestPayer?.includes("@")
        ? configuredTestPayer
        : "test@testuser.com";
    if (
      current?.mercado_pago_subscription_id &&
      ["pending", "trialing", "active"].includes(current.status) &&
      current.payer_email === payerEmail &&
      validHttpsUrl(current.checkout_url)
    ) {
      const reused = {
        id: current.mercado_pago_subscription_id,
        url: current.checkout_url,
        expiresAt: current.trial_ends_at ?? new Date(Date.now() + 30 * 60_000).toISOString(),
        reused: true,
      };
      await completeReservation(reused);
      return json(reused);
    }
    if (current?.mercado_pago_subscription_id && current.payer_email !== payerEmail) {
      await fetch(`https://api.mercadopago.com/preapproval/${current.mercado_pago_subscription_id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
    }
    const returnTarget = String(body.successUrl ?? "").startsWith("rotinae://") ? "app" : "web";
    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        reason: "Rotinaê Premium",
        external_reference: user.id,
        payer_email: payerEmail,
        back_url: `${supabaseUrl}/functions/v1/mercado-pago-return?target=${returnTarget}`,
        notification_url: `${supabaseUrl}/functions/v1/mercado-pago-webhook`,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: priceCents / 100,
          currency_id: "BRL",
          free_trial: { frequency: 30, frequency_type: "days" },
        },
        status: "pending",
      }),
    });
    const mp = await response.json();
    if (!response.ok) {
      const causes = Array.isArray(mp?.cause)
        ? mp.cause.map((cause: { description?: string; code?: string }) => cause.description ?? cause.code).filter(Boolean).join(" · ")
        : "";
      await releaseReservation();
      return json({
        error: "MERCADO_PAGO_ERROR",
        detail: [mp?.message, causes].filter(Boolean).join(" — ") || "O Mercado Pago recusou a criação da assinatura de teste.",
      });
    }

    const { error: saveError } = await admin.from("provider_subscriptions").upsert({
      provider_user_id: user.id,
      mercado_pago_subscription_id: mp.id,
      // Criar o checkout nunca libera Premium. Apenas o webhook assinado,
      // após reconciliar o recurso no Mercado Pago, promove o entitlement.
      status: "pending",
      payer_email: payerEmail,
      trial_started_at: null,
      trial_ends_at: null,
      next_payment_at: null,
      cancel_at_period_end: false,
      checkout_url: mp.init_point,
      last_mercado_pago_payload: mp,
    });
    if (saveError || !validHttpsUrl(mp.init_point)) {
      await releaseReservation();
      return json({ error: saveError ? "SUBSCRIPTION_STORAGE_ERROR" : "CHECKOUT_URL_INVALID" }, 503);
    }
    const result = { id: mp.id, url: mp.init_point, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
    await completeReservation(result);
    return json(result);
  }

  if (!["cancel", "resume"].includes(action) || !current?.mercado_pago_subscription_id) {
    await releaseReservation();
    return json({ error: "SUBSCRIPTION_NOT_FOUND" }, 404);
  }
  const accessEndsAt = current.current_period_ends_at ?? current.next_payment_at ?? current.trial_ends_at;
  if (action === "cancel" && (!accessEndsAt || new Date(accessEndsAt).getTime() <= Date.now())) {
    await releaseReservation();
    return json({ error: "BILLING_PERIOD_UNKNOWN", detail: "Não foi possível determinar o fim do período atual." }, 409);
  }
  if (
    action === "resume" &&
    current.status === "cancel_at_period_end" &&
    (!accessEndsAt || new Date(accessEndsAt).getTime() <= Date.now())
  ) {
    await releaseReservation();
    return json({ error: "SUBSCRIPTION_NOT_FOUND" }, 404);
  }
  if (
    action === "resume" &&
    current.status === "cancel_at_period_end" &&
    (!accessEndsAt || new Date(accessEndsAt).getTime() <= Date.now())
  ) {
    await releaseReservation();
    return json({ error: "SUBSCRIPTION_NOT_FOUND" }, 404);
  }
  // `cancel` no contrato do app significa agendar o fim do acesso. O recurso
  // fica pausado (reversível) até o período confirmado terminar; `resume`
  // volta a autorizar. Nunca enviamos `cancelled` antes do fim do período.
  const targetStatus = action === "cancel" ? "paused" : "authorized";
  const response = await fetch(`https://api.mercadopago.com/preapproval/${current.mercado_pago_subscription_id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: targetStatus }),
  });
  const mp = await response.json();
  if (!response.ok) {
    await releaseReservation();
    return json({ error: "MERCADO_PAGO_ERROR", detail: mp?.message ?? "O Mercado Pago recusou a operação." });
  }
  const nextStatus = action === "cancel" ? "cancel_at_period_end" : mpStatus(mp.status);
  const { error: saveError } = await admin.from("provider_subscriptions").update({
    status: nextStatus,
    cancel_at_period_end: action === "cancel",
    current_period_ends_at: action === "cancel" ? accessEndsAt : current.current_period_ends_at,
    last_mercado_pago_payload: mp,
  }).eq("provider_user_id", user.id);
  if (saveError) {
    await releaseReservation();
    return json({ error: "SUBSCRIPTION_STORAGE_ERROR" }, 503);
  }
  const result = { ok: true };
  await completeReservation(result);
  return json(result);
});
