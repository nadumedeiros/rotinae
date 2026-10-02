jest.mock('@/src/infra/supabase/client', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

/* eslint-disable import/first -- o mock precisa ser elevado antes do adapter. */
import { supabase } from '@/src/infra/supabase/client';
import { SupabaseSubscriptionAdapter } from '../supabase-subscription-adapter';

const invoke = supabase.functions.invoke as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('SupabaseSubscriptionAdapter', () => {
  it('envia somente o token descartável para criar a assinatura interna', async () => {
    invoke.mockResolvedValue({
      data: { accepted: true, subscriptionId: 'preapproval-1', status: 'processing' },
      error: null,
    });

    await new SupabaseSubscriptionAdapter().createPremiumSubscription({
      cardTokenId: 'card_token_12345678901234567890',
      idempotencyKey: 'subscription-1',
    });

    expect(invoke).toHaveBeenCalledWith('mercado-pago-subscriptions', {
      body: {
        action: 'create_authorized',
        cardTokenId: 'card_token_12345678901234567890',
        idempotencyKey: 'subscription-1',
      },
    });
  });

  it('troca o cartão pela operação server-side dedicada', async () => {
    invoke.mockResolvedValue({
      data: { accepted: true, subscriptionId: 'preapproval-1', status: 'active' },
      error: null,
    });

    await new SupabaseSubscriptionAdapter().updatePaymentCard({
      cardTokenId: 'card_token_12345678901234567890',
      idempotencyKey: 'card-1',
    });

    expect(invoke).toHaveBeenCalledWith('mercado-pago-subscriptions', {
      body: expect.objectContaining({ action: 'update_card', idempotencyKey: 'card-1' }),
    });
  });

  it('envia retorno por deep link no app sem expor credencial do provedor', async () => {
    invoke.mockResolvedValue({
      data: { id: 'preapproval-1', url: 'https://www.mercadopago.com/checkout', expiresAt: '2026-09-01T00:00:00Z' },
      error: null,
    });

    await new SupabaseSubscriptionAdapter().createPremiumCheckout({
      successUrl: '/subscription-return',
      cancelUrl: '/plans',
      idempotencyKey: 'checkout-1',
    });

    expect(invoke).toHaveBeenCalledWith('mercado-pago-subscriptions', {
      body: expect.objectContaining({
        action: 'create',
        successUrl: 'rotinae://subscription-return',
        cancelUrl: 'rotinae://plans',
      }),
    });
  });

  it('não fabrica um portal de cobrança que o backend não oferece', async () => {
    await expect(new SupabaseSubscriptionAdapter().createBillingPortal('/plans')).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('recusa checkout reutilizado sem URL HTTPS válida', async () => {
    invoke.mockResolvedValue({
      data: { id: 'preapproval-1', url: '', expiresAt: '2026-09-01T00:00:00Z' },
      error: null,
    });
    await expect(new SupabaseSubscriptionAdapter().createPremiumCheckout({
      successUrl: '/subscription-return', cancelUrl: '/plans', idempotencyKey: 'checkout-2',
    })).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});
