import { classifyClientReconciliation } from '@/src/domain/clients/link-reconciliation';
import type { ClientListInput, CreateClientInput, RenewClientPolicyInput } from '@/src/domain/clients/types';

// Mesmo padrão de apps/agendae/src/infra/auth/__tests__: mocka o cliente
// Supabase (que lançaria por falta de variáveis de ambiente fora deste
// teste) para exercitar só a lógica do adapter, sem depender de um projeto
// Supabase real. `jest.mock` é hoisted pelo babel; por isso os `jest.fn()`
// nascem dentro do factory, não em consts externas.
jest.mock('@/src/infra/supabase/client', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

import { supabase } from '@/src/infra/supabase/client';
import { SupabaseClientPortfolioAdapter } from '../supabase-client-portfolio-adapter';

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;
const mockGetUser = supabase.auth.getUser as jest.Mock;

// Builder fluente mínimo: cada método de filtro/transformação devolve o
// próprio builder (para encadear `.select().eq().order().range()` como o
// supabase-js real), e o builder também é "thenable" — várias chamadas do
// adapter fazem `await query` diretamente, sem terminar em `.single()`.
function createQueryBuilder(result: { data: unknown; error: unknown; count?: number | null }) {
  const builder: any = {};
  // Cada método precisa do seu PRÓPRIO jest.fn(): compartilhar uma única
  // função entre `.update`/`.delete`/etc. faria uma chamada em qualquer um
  // deles aparecer como chamada em todos (mocks são identificados por
  // referência, não por nome de propriedade).
  const chainableMethods = ['select', 'eq', 'or', 'order', 'range', 'limit', 'gte', 'in', 'insert', 'update', 'delete'];
  for (const method of chainableMethods) {
    builder[method] = jest.fn(() => builder);
  }
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: chamador autenticado. Testes que precisam simular sessão
  // expirada sobrescrevem com `mockGetUser.mockResolvedValueOnce(...)`.
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('SupabaseClientPortfolioAdapter client link flow', () => {
  it('resgata o código no servidor e devolve a solicitação real', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: 'link-1', tenant_id: 'tenant-1', status: 'pending', requested_at: '2026-08-11T10:00:00Z' }],
      error: null,
    });

    const result = await new SupabaseClientPortfolioAdapter().redeemProviderLinkCode(' AGENDA-8F2K ');

    expect(mockRpc).toHaveBeenCalledWith('redeem_provider_link_code', { code: 'AGENDA-8F2K' });
    expect(result).toEqual(expect.objectContaining({ id: 'link-1', tenantId: 'tenant-1', status: 'pending' }));
  });

  it(
    'resgata com sucesso um código recém-gerado mesmo que a tela do Cliente o normalize para maiúsculas ' +
      '(regressão do incidente 2026-08-12: rotate/redeem tinham case-sensitivity divergente)',
    async () => {
      // `rotate_provider_link_code` (SQL) sempre gera hex em minúsculas
      // (`encode(gen_random_bytes(16), 'hex')`); reproduzimos isso aqui.
      const generatedFullCode = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      mockRpc.mockImplementationOnce((fn: string) => {
        expect(fn).toBe('rotate_provider_link_code');
        return Promise.resolve({
          data: [
            {
              id: 'code-1',
              display_prefix: generatedFullCode.slice(0, 8),
              status: 'active',
              expires_at: null,
              created_at: '2026-08-12T10:00:00Z',
              full_code: generatedFullCode,
            },
          ],
          error: null,
        });
      });

      const adapter = new SupabaseClientPortfolioAdapter();
      const rotated = await adapter.rotateLinkCode();
      expect(rotated.fullCode).toBe(generatedFullCode);

      // A tela do Cliente (apps/agendae/app/client-providers.tsx) força
      // maiúsculas no valor digitado/colado antes de chamar
      // `redeemProviderLinkCode`; o adapter não deve depender de o caller
      // preservar o case original — quem precisa tolerar isso é o backend
      // (20260812120000_fix_redeem_link_code_case_sensitivity.sql, que
      // normaliza com `lower(trim(code))` antes de comparar com o hash).
      const submittedByClientScreen = rotated.fullCode.toUpperCase();

      // Mock do comportamento CORRIGIDO da RPC: compara de forma
      // case-insensitive, como a migration 20260812120000 passou a fazer.
      // Antes da correção, essa comparação seria sensível a maiúsculas e
      // devolveria sempre LINK_CODE_NOT_FOUND para um código com qualquer
      // letra a-f — ou seja, na prática, para quase todo código gerado.
      mockRpc.mockImplementationOnce((fn: string, params: { code: string }) => {
        expect(fn).toBe('redeem_provider_link_code');
        const matches = params.code.trim().toLowerCase() === generatedFullCode.toLowerCase();
        if (!matches) {
          return Promise.resolve({
            data: null,
            error: { message: 'LINK_CODE_NOT_FOUND: invalid or expired code', code: '22023' },
          });
        }
        return Promise.resolve({
          data: [{ id: 'link-1', tenant_id: 'tenant-1', status: 'pending', requested_at: '2026-08-12T10:00:05Z' }],
          error: null,
        });
      });

      const redeemed = await adapter.redeemProviderLinkCode(submittedByClientScreen);

      expect(mockRpc).toHaveBeenLastCalledWith('redeem_provider_link_code', {
        code: submittedByClientScreen,
      });
      expect(redeemed).toEqual(
        expect.objectContaining({ id: 'link-1', tenantId: 'tenant-1', status: 'pending' }),
      );
    },
  );

  it('lista solicitações e identifica o prestador apenas para vínculo ativo', async () => {
    const linksBuilder = createQueryBuilder({
      data: [
        { id: 'link-active', tenant_id: 'tenant-1', status: 'active', requested_at: '2026-08-11T10:00:00Z' },
        { id: 'link-pending', tenant_id: 'tenant-2', status: 'pending', requested_at: '2026-08-11T11:00:00Z' },
      ],
      error: null,
    });
    const tenantsBuilder = createQueryBuilder({
      data: [{ id: 'tenant-1', display_name: 'Clínica Real', profession: 'Personal Trainer' }],
      error: null,
    });
    mockFrom.mockImplementation((table: string) => table === 'provider_client_links' ? linksBuilder : tenantsBuilder);

    const result = await new SupabaseClientPortfolioAdapter().listClientProviderLinks();

    expect(tenantsBuilder.in).toHaveBeenCalledWith('id', ['tenant-1']);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'link-active',
        providerName: 'Clínica Real',
        profession: 'Personal Trainer',
        status: 'active',
      }),
      expect.objectContaining({ id: 'link-pending', providerName: null, profession: null, status: 'pending' }),
    ]);
  });
});

describe('SupabaseClientPortfolioAdapter.listClients', () => {
  it('pagina no servidor em blocos de 10 e devolve o total correto', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `client-${i}`,
      client_user_id: null,
      record_origin: 'provider_created',
      name: `Cliente ${i}`,
      email: `cliente${i}@exemplo.com`,
      phone: null,
      whatsapp_confirmation_enabled: false,
      whatsapp_reminder_enabled: false,
      status: 'active',
      primary_service: null,
      primary_service_id: null,
      service_value_cents: 5000,
      total_booking_limit: null,
      daily_booking_limit: null,
      request_window_start: null,
      request_window_end: null,
      last_service_at: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    }));
    const builder = createQueryBuilder({ data: rows, error: null, count: 25 });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseClientPortfolioAdapter();
    const input: ClientListInput = { page: 2, pageSize: 10 };
    const page = await adapter.listClients(input);

    // Página 2 de 10 itens -> offset 10..19.
    expect(builder.range).toHaveBeenCalledWith(10, 19);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(10);
    expect(page.totalItems).toBe(25);
    expect(page.totalPages).toBe(3);
    expect(page.items).toHaveLength(10);
    expect(page.items[0].id).toBe('client-0');
  });

  it('aplica busca e filtro de status antes da paginação', async () => {
    const builder = createQueryBuilder({ data: [], error: null, count: 0 });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseClientPortfolioAdapter();
    await adapter.listClients({ page: 1, pageSize: 10, status: 'active', query: 'Ana' });

    expect(builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(builder.or).toHaveBeenCalledWith('name.ilike.%Ana%,email.ilike.%Ana%');
  });
});

describe('SupabaseClientPortfolioAdapter.createClient', () => {
  const validInput: CreateClientInput = {
    name: 'Ana Souza',
    email: 'ana@exemplo.com',
    phone: null,
    communicationPreferences: {
      whatsappAppointmentConfirmation: false,
      whatsappAppointmentReminder: false,
    },
    linkInvitationDelivery: 'none',
    status: 'active',
    serviceValueCents: 8000,
    bookingPolicy: {
      totalBookingLimit: null,
      dailyBookingLimit: null,
      requestWindowStart: null,
      requestWindowEnd: null,
    },
  };

  it('mapeia duplicidade de e-mail para CLIENT_EMAIL_CONFLICT sem revelar o erro cru do Postgres', async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: 'tenant-1' }, error: null });
    const clientsBuilder = createQueryBuilder({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "clients_tenant_normalized_email_active_uk"',
        code: '23505',
      },
    });

    mockFrom.mockImplementation((table: string) => (table === 'tenants' ? tenantBuilder : clientsBuilder));

    const adapter = new SupabaseClientPortfolioAdapter();

    await expect(adapter.createClient(validInput)).rejects.toMatchObject({
      code: 'CLIENT_EMAIL_CONFLICT',
    });
  });

  it('cria o cadastro vinculado ao próprio tenant do prestador autenticado', async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: 'tenant-1' }, error: null });
    const clientsBuilder = createQueryBuilder({
      data: {
        id: 'client-1',
        client_user_id: null,
        record_origin: 'provider_created',
        name: 'Ana Souza',
        email: 'ana@exemplo.com',
        phone: null,
        whatsapp_confirmation_enabled: false,
        whatsapp_reminder_enabled: false,
        status: 'active',
        primary_service: null,
        primary_service_id: 'service-1',
        service_value_cents: 8000,
        total_booking_limit: null,
        daily_booking_limit: null,
        request_window_start: null,
        request_window_end: null,
        last_service_at: null,
        created_at: '2026-08-06T00:00:00.000Z',
        updated_at: '2026-08-06T00:00:00.000Z',
      },
      error: null,
    });

    mockFrom.mockImplementation((table: string) => (table === 'tenants' ? tenantBuilder : clientsBuilder));

    const adapter = new SupabaseClientPortfolioAdapter();
    const client = await adapter.createClient({ ...validInput, primaryServiceId: 'service-1' });

    expect(clientsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        record_origin: 'provider_created',
        primary_service_id: 'service-1',
      }),
    );
    expect(client.id).toBe('client-1');
    expect(client.primaryServiceId).toBe('service-1');
  });

  it('preserva null quando nenhum serviço do catálogo é escolhido', async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: 'tenant-1' }, error: null });
    const clientsBuilder = createQueryBuilder({
      data: {
        id: 'client-1',
        client_user_id: null,
        record_origin: 'provider_created',
        name: 'Ana Souza',
        email: 'ana@exemplo.com',
        phone: null,
        whatsapp_confirmation_enabled: false,
        whatsapp_reminder_enabled: false,
        status: 'active',
        primary_service: null,
        primary_service_id: null,
        service_value_cents: 8000,
        total_booking_limit: null,
        daily_booking_limit: null,
        request_window_start: null,
        request_window_end: null,
        last_service_at: null,
        created_at: '2026-08-06T00:00:00.000Z',
        updated_at: '2026-08-06T00:00:00.000Z',
      },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => (table === 'tenants' ? tenantBuilder : clientsBuilder));

    const client = await new SupabaseClientPortfolioAdapter().createClient(validInput);

    expect(clientsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ primary_service_id: null }),
    );
    expect(client.primaryServiceId).toBeNull();
  });
});

describe('SupabaseClientPortfolioAdapter.updateClient', () => {
  it('permite definir e limpar a referência ao serviço padrão', async () => {
    const builder = createQueryBuilder({
      data: {
        id: 'client-1', client_user_id: null, record_origin: 'provider_created', name: 'Ana',
        email: 'ana@exemplo.com', phone: null, whatsapp_confirmation_enabled: false,
        whatsapp_reminder_enabled: false, status: 'active', primary_service: null,
        primary_service_id: null, service_value_cents: 8000, total_booking_limit: null,
        daily_booking_limit: null, request_window_start: null, request_window_end: null,
        last_service_at: null, created_at: '2026-08-06T00:00:00.000Z',
        updated_at: '2026-08-06T00:00:00.000Z',
      },
      error: null,
    });
    mockFrom.mockReturnValue(builder);
    const adapter = new SupabaseClientPortfolioAdapter();

    await adapter.updateClient({ id: 'client-1', primaryServiceId: 'service-1' });
    expect(builder.update).toHaveBeenLastCalledWith({ primary_service_id: 'service-1' });

    await adapter.updateClient({ id: 'client-1', primaryServiceId: null });
    expect(builder.update).toHaveBeenLastCalledWith({ primary_service_id: null });
  });
});

describe('SupabaseClientPortfolioAdapter.archiveClient', () => {
  it('faz arquivamento lógico (UPDATE de status), nunca DELETE físico', async () => {
    const builder = createQueryBuilder({ data: { id: 'client-1' }, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseClientPortfolioAdapter();
    await adapter.archiveClient('client-1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'inactive' });
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it('lança CLIENT_NOT_FOUND quando o cliente não existe ou não pertence ao tenant do chamador', async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseClientPortfolioAdapter();

    await expect(adapter.archiveClient('client-inexistente')).rejects.toMatchObject({
      code: 'CLIENT_NOT_FOUND',
    });
  });
});

describe('SupabaseClientPortfolioAdapter.previewLinkReconciliation', () => {
  // A classificação de verdade roda em SQL (preview_link_reconciliation,
  // 20260806101600_client_reconciliation_rpcs.sql) e não pode ser executada
  // num teste JS sem um Postgres real. Em vez de reimplementar SQL aqui,
  // usamos `classifyClientReconciliation` (a mesma referência de
  // classificação citada no comentário da função SQL) para CONSTRUIR o
  // payload que a RPC deveria produzir num cenário equivalente, e validamos
  // que o adapter expõe esse resultado ao domínio sem perder nem mutar
  // informação.

  it('reflete attach_existing quando há exatamente um cadastro sem identidade com o mesmo e-mail verificado', async () => {
    const records = [{ id: 'client-1', email: 'ana@exemplo.com', phone: null, clientUserId: null }];
    const identity = { verifiedEmail: 'ana@exemplo.com' };
    const expected = classifyClientReconciliation(records, identity);
    expect(expected).toEqual({ action: 'attach_existing', clientId: 'client-1' });

    mockRpc.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            clientId: 'client-1',
            clientName: 'Ana Souza',
            maskedEmail: 'a***@exemplo.com',
            maskedPhone: null,
            matchReason: 'verified_email',
            alreadyAttached: false,
          },
        ],
        recommendedAction: 'attach_existing',
      },
      error: null,
    });

    const adapter = new SupabaseClientPortfolioAdapter();
    const preview = await adapter.previewLinkReconciliation('link-1');

    expect(mockRpc).toHaveBeenCalledWith('preview_link_reconciliation', { link_id: 'link-1' });
    expect(preview.requestId).toBe('link-1');
    expect(preview.recommendedAction).toBe(expected.action);
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0].clientId).toBe('client-1');
    expect(preview.candidates[0].maskedEmail).not.toBe('ana@exemplo.com');
  });

  it('reflete manual_review quando mais de um cadastro compartilha o mesmo e-mail verificado', async () => {
    const records = [
      { id: 'client-1', email: 'ana@exemplo.com', phone: null, clientUserId: null },
      { id: 'client-2', email: 'ana@exemplo.com', phone: null, clientUserId: null },
    ];
    const identity = { verifiedEmail: 'ana@exemplo.com' };
    const expected = classifyClientReconciliation(records, identity);
    expect(expected).toEqual({ action: 'manual_review', candidateIds: ['client-1', 'client-2'] });

    mockRpc.mockResolvedValueOnce({
      data: {
        candidates: records.map((record) => ({
          clientId: record.id,
          clientName: 'Ana Souza',
          maskedEmail: 'a***@exemplo.com',
          maskedPhone: null,
          matchReason: 'verified_email',
          alreadyAttached: false,
        })),
        recommendedAction: 'manual_review',
      },
      error: null,
    });

    const adapter = new SupabaseClientPortfolioAdapter();
    const preview = await adapter.previewLinkReconciliation('link-2');

    expect(preview.recommendedAction).toBe(expected.action);
    expect(preview.candidates.map((c) => c.clientId)).toEqual(
      (expected as { candidateIds: string[] }).candidateIds,
    );
  });

  it('reflete reject_conflict quando o único cadastro correspondente já está associado a outra identidade', async () => {
    const records = [{ id: 'client-1', email: 'ana@exemplo.com', phone: null, clientUserId: 'other-user' }];
    const identity = { verifiedEmail: 'ana@exemplo.com' };
    const expected = classifyClientReconciliation(records, identity);
    expect(expected).toEqual({ action: 'reject_conflict', clientId: 'client-1' });

    mockRpc.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            clientId: 'client-1',
            clientName: 'Ana Souza',
            maskedEmail: 'a***@exemplo.com',
            maskedPhone: null,
            matchReason: 'verified_email',
            alreadyAttached: true,
          },
        ],
        recommendedAction: 'reject_conflict',
      },
      error: null,
    });

    const adapter = new SupabaseClientPortfolioAdapter();
    const preview = await adapter.previewLinkReconciliation('link-3');

    expect(preview.recommendedAction).toBe(expected.action);
    expect(preview.candidates[0].alreadyAttached).toBe(true);
  });
});

describe('SupabaseClientPortfolioAdapter.renewClientPolicy', () => {
  // A lógica de negócio real (zerar a contagem por ciclo em
  // `_create_appointment_row`, arquivar o `appointments_used` correto do
  // ciclo encerrado, bloquear quem não é dono do tenant) roda inteiramente em
  // SQL (`renew_client_policy`/`_create_appointment_row`,
  // 20260823150000_client_policy_renewal.sql) e não pode ser executada num
  // teste JS sem um Postgres real — mesma limitação já documentada acima
  // para `previewLinkReconciliation`. Os testes abaixo cobrem o contrato do
  // adapter: parâmetros enviados à RPC, mapeamento do retorno (incluindo o
  // "usou X de Y" do histórico) e propagação fiel de uma rejeição do
  // servidor (não é mascarada nem convertida em sucesso).
  const validInput: RenewClientPolicyInput = {
    clientId: 'client-1',
    totalBookingLimit: 10,
    serviceValueCents: 9000,
    requestWindowStart: '2026-09-01',
    requestWindowEnd: '2026-09-30',
  };

  it('envia os novos valores para renew_client_policy e devolve o cliente atualizado (limite zerado no servidor)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        client: {
          id: 'client-1',
          client_user_id: null,
          record_origin: 'provider_created',
          name: 'Ana Souza',
          email: 'ana@exemplo.com',
          phone: null,
          whatsapp_confirmation_enabled: false,
          whatsapp_reminder_enabled: false,
          status: 'active',
          primary_service: null,
          primary_service_id: null,
          service_value_cents: 9000,
          total_booking_limit: 10,
          daily_booking_limit: null,
          request_window_start: '2026-09-01',
          request_window_end: '2026-09-30',
          last_service_at: null,
          created_at: '2026-08-01T00:00:00.000Z',
          updated_at: '2026-08-23T00:00:00.000Z',
        },
        renewal: {
          id: 'renewal-1',
          client_id: 'client-1',
          total_booking_limit: 8,
          service_value_cents: 8000,
          request_window_start: '2026-08-01',
          request_window_end: '2026-08-31',
          appointments_used: 8,
          renewed_by_user_id: 'user-1',
          renewed_at: '2026-08-23T00:00:00.000Z',
        },
      },
      error: null,
    });

    const client = await new SupabaseClientPortfolioAdapter().renewClientPolicy(validInput);

    expect(mockRpc).toHaveBeenCalledWith('renew_client_policy', {
      p_client_id: 'client-1',
      p_total_booking_limit: 10,
      p_service_value_cents: 9000,
      p_request_window_start: '2026-09-01',
      p_request_window_end: '2026-09-30',
    });
    // O novo limite (o `TOTAL_LIMIT_REACHED` antigo deixa de valer a partir
    // daqui) volta refletido no cliente devolvido pela RPC.
    expect(client.bookingPolicy.totalBookingLimit).toBe(10);
  });

  it('rejeita client-side (sem chamar a RPC) quando o novo limite total é menor que 1', async () => {
    const adapter = new SupabaseClientPortfolioAdapter();
    await expect(
      adapter.renewClientPolicy({ ...validInput, totalBookingLimit: 0 }),
    ).rejects.toMatchObject({ code: 'BOOKING_POLICY_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('propaga FORBIDDEN quando quem chama não é dono do tenant do cliente', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'FORBIDDEN: caller does not own this tenant', code: '42501' },
    });

    await expect(new SupabaseClientPortfolioAdapter().renewClientPolicy(validInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('SupabaseClientPortfolioAdapter.listClientPolicyRenewals', () => {
  it('lista o histórico mais recente primeiro, incluindo quanto do pacote anterior foi usado', async () => {
    const builder = createQueryBuilder({
      data: [
        {
          id: 'renewal-2',
          client_id: 'client-1',
          total_booking_limit: 10,
          service_value_cents: 9000,
          request_window_start: '2026-09-01',
          request_window_end: '2026-09-30',
          appointments_used: 3,
          renewed_by_user_id: 'user-1',
          renewed_at: '2026-09-15T00:00:00.000Z',
        },
        {
          id: 'renewal-1',
          client_id: 'client-1',
          total_booking_limit: 8,
          service_value_cents: 8000,
          request_window_start: '2026-08-01',
          request_window_end: '2026-08-31',
          appointments_used: 8,
          renewed_by_user_id: 'user-1',
          renewed_at: '2026-08-23T00:00:00.000Z',
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    const renewals = await new SupabaseClientPortfolioAdapter().listClientPolicyRenewals('client-1');

    expect(mockFrom).toHaveBeenCalledWith('client_policy_renewals');
    expect(builder.eq).toHaveBeenCalledWith('client_id', 'client-1');
    expect(builder.order).toHaveBeenCalledWith('renewed_at', { ascending: false });
    expect(renewals).toHaveLength(2);
    expect(renewals[1]).toEqual(
      expect.objectContaining({ id: 'renewal-1', totalBookingLimit: 8, appointmentsUsed: 8 }),
    );
  });
});
