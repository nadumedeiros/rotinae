import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const subscriptionsSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/mercado-pago-subscriptions/index.ts'),
  'utf8',
);
const webhookSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/mercado-pago-webhook/index.ts'),
  'utf8',
);
const finalizerSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/finalize-subscription-cancellations/index.ts'),
  'utf8',
);

describe('contrato server-side Mercado Pago', () => {
  it('reserva e persiste chaves idempotentes para todas as mutações', () => {
    expect(subscriptionsSource).toContain('subscription_idempotency_keys');
    expect(subscriptionsSource).toContain('IDEMPOTENCY_KEY_REUSED');
    expect(subscriptionsSource).toContain('OPERATION_IN_PROGRESS');
    expect(subscriptionsSource).toContain('response_payload: responsePayload');
  });

  it('não inicia trial nem libera Premium ao apenas criar checkout', () => {
    expect(subscriptionsSource).toContain('status: "pending"');
    expect(subscriptionsSource).toContain('trial_started_at: null');
    expect(subscriptionsSource).toContain('trial_ends_at: null');
    expect(webhookSource).toContain('current?.status === "pending" && mp.status === "authorized"');
  });

  it('cria assinatura autorizada com token e mantém o webhook como fonte do entitlement', () => {
    expect(subscriptionsSource).toContain('action === "create_authorized"');
    expect(subscriptionsSource).toContain('card_token_id: body.cardTokenId');
    expect(subscriptionsSource).toContain('status: "authorized"');
    expect(subscriptionsSource).toContain('status: activeTrialEndsAt ? "trialing" : "pending"');
    expect(subscriptionsSource).toContain('status: "processing"');
  });

  it('atualiza cartão por token sem receber dados brutos do cartão', () => {
    expect(subscriptionsSource).toContain('action === "update_card"');
    expect(subscriptionsSource).toContain('JSON.stringify({ card_token_id: body.cardTokenId })');
    expect(subscriptionsSource).not.toContain('security_code');
    expect(subscriptionsSource).not.toContain('card_number');
  });

  it('valida checkout HTTPS e preserva acesso só até o fim do período cancelado', () => {
    expect(subscriptionsSource).toContain('validHttpsUrl(current.checkout_url)');
    expect(subscriptionsSource).toContain('status: nextStatus');
    expect(subscriptionsSource).toContain('current_period_ends_at: action === "cancel" ? accessEndsAt');
    expect(webhookSource).toContain('"cancel_at_period_end"');
    expect(subscriptionsSource).toContain('action === "cancel" ? "paused" : "authorized"');
    expect(subscriptionsSource).not.toContain('action === "cancel" ? "cancelled"');
  });

  it('não inventa 30 dias de trial quando o Mercado Pago omite a próxima cobrança', () => {
    expect(webhookSource).toContain('? mp.next_payment_date : null');
    expect(webhookSource).not.toContain('now.getTime() + 30 * 86400000');
  });

  it('rejeita metodos e assinaturas fora da janela anti-replay', () => {
    expect(webhookSource).toContain('request.method !== "POST"');
    expect(webhookSource).toContain('ageMs > 5 * 60 * 1000');
    expect(webhookSource).toContain('ageMs < -60 * 1000');
  });

  it('finaliza no provedor somente depois que o período agendado terminou', () => {
    expect(finalizerSource).toContain('.eq("status", "cancel_at_period_end")');
    expect(finalizerSource).toContain('.lte("current_period_ends_at", now)');
    expect(finalizerSource).toContain('JSON.stringify({ status: "canceled" })');
    expect(finalizerSource).toContain('x-rotinae-subscription-secret');
    expect(subscriptionsSource).toContain('action === "resume" &&');
  });
});
