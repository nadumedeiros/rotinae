import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";

type ClaimedDelivery = {
  delivery_id: string;
  device_id: string;
  expo_push_token: string;
  notification_id: string;
  recipient_user_id: string;
  title: string;
  description: string;
  destination: string;
  attempt_count: number;
};

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function retryAt(attempt: number): string {
  const seconds = Math.min(900, 30 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: config } = await admin
    .from("push_dispatch_config")
    .select("secret")
    .eq("id", true)
    .maybeSingle();
  const receivedSecret = request.headers.get("x-rotinae-push-secret") ?? "";
  if (!config?.secret || !constantTimeEqual(receivedSecret, config.secret)) {
    return new Response("unauthorized", { status: 401 });
  }

  // Primeiro confirma tickets submetidos anteriormente. O receipt é a fonte
  // confiável para invalidar tokens de aplicativos removidos.
  const cutoff = new Date(Date.now() - 15_000).toISOString();
  const { data: submitted } = await admin
    .from("notification_push_deliveries")
    .select("id, device_id, expo_ticket_id")
    .eq("status", "submitted")
    .not("expo_ticket_id", "is", null)
    .lt("submitted_at", cutoff)
    .limit(300);

  if (submitted?.length) {
    const receiptResponse = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: submitted.map((item) => item.expo_ticket_id) }),
    }).catch(() => null);
    if (receiptResponse?.ok) {
      const receiptPayload = await receiptResponse.json();
      const receipts = receiptPayload?.data ?? {};
      for (const item of submitted) {
        const receipt = receipts[item.expo_ticket_id!];
        if (!receipt) continue;
        if (receipt.status === "ok") {
          await admin.from("notification_push_deliveries").update({
            status: "sent",
            delivered_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", item.id);
          continue;
        }
        const errorCode = receipt.details?.error ?? "UNKNOWN_RECEIPT_ERROR";
        await admin.from("notification_push_deliveries").update({
          status: "failed",
          last_error: String(errorCode).slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq("id", item.id);
        if (errorCode === "DeviceNotRegistered") {
          await admin.from("push_devices").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", item.device_id);
        }
      }
    }
  }

  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_notification_push_deliveries",
    { p_limit: 100 },
  );
  if (claimError) return new Response("dispatcher unavailable", { status: 503 });
  const deliveries = (claimed ?? []) as ClaimedDelivery[];
  if (!deliveries.length) return new Response("ok", { status: 200 });

  const sendResponse = await fetch(EXPO_SEND_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(deliveries.map((item) => ({
      to: item.expo_push_token,
      title: item.title,
      body: item.description,
      sound: "default",
      channelId: "rotinae-events",
      priority: "high",
      data: {
        notificationId: item.notification_id,
        recipientUserId: item.recipient_user_id,
        destination: item.destination,
      },
    }))),
  }).catch(() => null);

  if (!sendResponse?.ok) {
    for (const delivery of deliveries) {
      await admin.from("notification_push_deliveries").update({
        status: delivery.attempt_count >= 5 ? "failed" : "pending",
        last_error: `EXPO_HTTP_${sendResponse?.status ?? "NETWORK"}`,
        next_attempt_at: retryAt(delivery.attempt_count),
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.delivery_id);
    }
    return new Response("push provider unavailable", { status: 202 });
  }

  const payload = await sendResponse.json();
  const tickets: ExpoTicket[] = Array.isArray(payload?.data) ? payload.data : [];
  for (let index = 0; index < deliveries.length; index += 1) {
    const delivery = deliveries[index];
    const ticket = tickets[index];
    if (ticket?.status === "ok" && ticket.id) {
      await admin.from("notification_push_deliveries").update({
        status: "submitted",
        expo_ticket_id: ticket.id,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.delivery_id);
      continue;
    }

    const errorCode = ticket?.details?.error ?? "INVALID_EXPO_RESPONSE";
    const permanent = ["DeviceNotRegistered", "InvalidCredentials", "MessageTooBig"].includes(errorCode);
    await admin.from("notification_push_deliveries").update({
      status: permanent || delivery.attempt_count >= 5 ? "failed" : "pending",
      last_error: String(ticket?.message ?? errorCode).slice(0, 500),
      next_attempt_at: retryAt(delivery.attempt_count),
      updated_at: new Date().toISOString(),
    }).eq("id", delivery.delivery_id);
    if (errorCode === "DeviceNotRegistered") {
      await admin.from("push_devices").update({ enabled: false, updated_at: new Date().toISOString() }).eq("id", delivery.device_id);
    }
  }

  return new Response("ok", { status: 200 });
});
