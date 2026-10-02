import type {
  AppointmentErrorCode,
  CreateAppointmentCommand,
  CreateAvailabilityBlockInput,
} from '@/src/domain/agenda/types';

// Mesmo padrão de apps/agendae/src/infra/clients/__tests__ e
// apps/agendae/src/infra/services/__tests__: mocka o cliente Supabase para
// exercitar só a lógica do adapter, sem depender de um projeto Supabase
// real.
jest.mock('@/src/infra/supabase/client', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

import { supabase } from '@/src/infra/supabase/client';
import { SupabaseAppointmentAdapter } from '../supabase-appointment-adapter';

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;
const mockGetUser = supabase.auth.getUser as jest.Mock;

// Builder fluente mínimo — mesmo utilitário replicado em cada suíte desta
// série (supabase-client-portfolio-adapter.test.ts /
// supabase-service-catalog-adapter.test.ts).
function createQueryBuilder(result: { data: unknown; error: unknown; count?: number | null }) {
  const builder: any = {};
  const chainableMethods = [
    'select',
    'eq',
    'or',
    'order',
    'range',
    'limit',
    'gte',
    'lt',
    'gt',
    'insert',
    'update',
    'delete',
  ];
  for (const method of chainableMethods) {
    builder[method] = jest.fn(() => builder);
  }
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appointment-1',
    tenant_id: 'tenant-1',
    client_id: 'client-1',
    service_id: 'service-1',
    service_name_snapshot: 'Banho e tosa',
    value_cents_snapshot: 8000,
    title: null,
    starts_at: '2026-08-11T14:30:00.000Z',
    timezone: 'America/Sao_Paulo',
    duration_minutes: 60,
    state: 'scheduled',
    confirmation_status: 'confirmed',
    confirmation_source: 'client',
    confirmed_at: '2026-08-10T10:00:00.000Z',
    client_message: null,
    internal_notes: null,
    cancellation_reason: null,
    cancelled_by: null,
    cancelled_at: null,
    created_at: '2026-08-10T10:00:00.000Z',
    updated_at: '2026-08-10T10:00:00.000Z',
    recurrence_group_id: null,
    recurrence_index: null,
    recurrence_count: null,
    ...overrides,
  };
}

function mockRole(role: 'provider' | 'client' | null) {
  mockGetUser.mockResolvedValue({ data: { user: role ? { id: 'user-1' } : null }, error: null });
  if (role) {
    const profileBuilder = createQueryBuilder({ data: { role }, error: null });
    mockFrom.mockImplementation((table: string) => (table === 'profiles' ? profileBuilder : createQueryBuilder({ data: null, error: null })));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: chamador autenticado. Testes que precisam simular sessão
  // expirada/papel específico sobrescrevem via `mockRole`/`mockGetUser`.
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

const validCommand: CreateAppointmentCommand = {
  clientId: 'client-1',
  serviceId: 'service-1',
  title: null,
  startsAt: '2026-08-11T14:30:00.000Z',
  timezone: 'America/Sao_Paulo',
  durationMinutes: 60,
  clientMessage: null,
  internalNotes: null,
  requestedBy: 'client',
};

describe('SupabaseAppointmentAdapter.createAppointment', () => {
  it('nunca envia requestedBy à RPC — o servidor deriva o papel da sessão', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow(), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.createAppointment(validCommand);

    expect(mockRpc).toHaveBeenCalledWith(
      'create_appointment',
      expect.not.objectContaining({ requestedBy: expect.anything(), p_requested_by: expect.anything() }),
    );
    const [, payload] = mockRpc.mock.calls[0];
    expect(payload).toEqual({
      p_client_id: 'client-1',
      p_service_id: 'service-1',
      p_starts_at: '2026-08-11T14:30:00.000Z',
      p_timezone: 'America/Sao_Paulo',
      p_duration_minutes: 60,
      p_client_message: null,
      p_internal_notes: null,
      p_title: null,
    });
  });

  it('envia p_frequency/p_occurrences quando a recorrência é por frequência', async () => {
    mockRpc.mockResolvedValue({ data: [appointmentRow(), appointmentRow({ id: 'appointment-2' })], error: null });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.createAppointment({
      ...validCommand,
      recurrence: { frequency: 'weekly', occurrences: 4 },
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'create_recurring_appointments',
      expect.objectContaining({
        p_frequency: 'weekly',
        p_occurrences: 4,
        p_dates: null,
      }),
    );
    // Devolve a PRIMEIRA ocorrência como confirmação (contrato só permite um
    // único AppointmentRecord de retorno).
    expect(result.id).toBe('appointment-1');
  });

  it('envia p_dates quando a recorrência é por lista de datas explícitas', async () => {
    mockRpc.mockResolvedValue({ data: [appointmentRow()], error: null });

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.createAppointment({
      ...validCommand,
      recurrence: { dates: ['2026-08-11T14:30:00.000Z', '2026-08-18T14:30:00.000Z'] },
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'create_recurring_appointments',
      expect.objectContaining({
        p_dates: ['2026-08-11T14:30:00.000Z', '2026-08-18T14:30:00.000Z'],
        p_frequency: null,
        p_occurrences: null,
      }),
    );
  });

  const errorScenarios: Array<{ raised: string; expected: AppointmentErrorCode }> = [
    { raised: 'CLIENT_NOT_FOUND: client does not exist', expected: 'CLIENT_NOT_FOUND' },
    { raised: 'CLIENT_LINK_INACTIVE: client link is not active', expected: 'CLIENT_LINK_INACTIVE' },
    { raised: 'SERVICE_NOT_FOUND: service does not exist or is not active', expected: 'SERVICE_NOT_FOUND' },
    { raised: 'SERVICE_REQUIRED: a service is required for appointments with a client', expected: 'SERVICE_REQUIRED' },
    { raised: 'TITLE_REQUIRED: title is required for appointments without a client', expected: 'TITLE_REQUIRED' },
    { raised: 'AGENDA_BLOCKED: requested slot overlaps a provider availability block', expected: 'AGENDA_BLOCKED' },
    { raised: 'ADVANCE_NOTICE_INVALID: minimum advance notice not met', expected: 'ADVANCE_NOTICE_INVALID' },
    { raised: 'OUTSIDE_ALLOWED_PERIOD: requested date is outside the allowed window', expected: 'OUTSIDE_ALLOWED_PERIOD' },
    { raised: 'ATTENDANCE_DAY_UNAVAILABLE: requested date falls outside the provider attendance days', expected: 'ATTENDANCE_DAY_UNAVAILABLE' },
    { raised: 'DAILY_LIMIT_REACHED: daily booking limit reached', expected: 'DAILY_LIMIT_REACHED' },
    { raised: 'TOTAL_LIMIT_REACHED: total booking limit reached', expected: 'TOTAL_LIMIT_REACHED' },
    { raised: 'SLOT_UNAVAILABLE: requested slot conflicts with an existing appointment', expected: 'SLOT_UNAVAILABLE' },
    { raised: 'FORBIDDEN: caller does not own this tenant', expected: 'FORBIDDEN' },
    { raised: 'INVALID_DATE_TIME: duration must be a positive integer of minutes', expected: 'INVALID_DATE_TIME' },
  ];

  it.each(errorScenarios)('mapeia "$raised" para $expected', async ({ raised, expected }) => {
    mockRpc.mockResolvedValue({ data: null, error: { message: raised, code: '22023' } });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.createAppointment(validCommand)).rejects.toMatchObject({ code: expected });
  });

  it('mapeia erro de permissão (42501) sem prefixo conhecido para FORBIDDEN', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.createAppointment(validCommand)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('SupabaseAppointmentAdapter.createAppointment — bypass de ADVANCE_NOTICE_INVALID para o prestador', () => {
  // `mockFrom.mockImplementation` (abaixo) não é desfeito por
  // `jest.clearAllMocks()` no `beforeEach` global (que só limpa chamadas,
  // não a implementação) — sem este `mockReset`, a implementação
  // configurada aqui vazaria para os testes seguintes do arquivo que
  // dependem de `mockFrom` continuar sem configuração nenhuma (ex.:
  // `updateAppointment › mapeia ATTENDANCE_DAY_UNAVAILABLE`, que espera o
  // bypass local falhar silenciosamente).
  afterEach(() => {
    mockFrom.mockReset();
  });

  it('nasce pending (nunca confirmed) mesmo quando a RPC bloqueia o prestador por antecedência mínima', async () => {
    // BUG encontrado (relato do usuário, 06/09/2026): "A confirmar" salvava
    // como "Confirmado". Causa raiz: `create_appointment` bloqueia
    // ADVANCE_NOTICE_INVALID mesmo para o prestador (não é uma restrição
    // pensada para ele), e este bypass local — pensado para deixar o
    // prestador seguir mesmo assim — gravava sempre
    // confirmation_status='confirmed', ignorando o status escolhido no
    // formulário. Correção: nasce 'pending', igual ao caminho normal via
    // RPC (`requestedBy='provider'`) — quem confirma depois é
    // `confirmManually`, chamado por `app/agenda.tsx` só quando o
    // prestador realmente escolhe "Confirmado".
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ADVANCE_NOTICE_INVALID: minimum advance notice not met', code: '22023' },
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const tenantBuilder = createQueryBuilder({ data: { id: 'tenant-1', timezone: 'America/Sao_Paulo' }, error: null });
    const serviceBuilder = createQueryBuilder({ data: { id: 'service-1', name: 'Banho e tosa', reference_value_cents: 8000 }, error: null });
    const appointmentsBuilder = createQueryBuilder({
      data: appointmentRow({ confirmation_status: 'pending', confirmation_source: null, confirmed_at: null }),
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantBuilder;
      if (table === 'services') return serviceBuilder;
      if (table === 'appointments') return appointmentsBuilder;
      return createQueryBuilder({ data: null, error: null });
    });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.createAppointment({ ...validCommand, requestedBy: 'provider' });

    expect(appointmentsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmation_status: 'pending',
        confirmation_source: null,
        confirmed_at: null,
      }),
    );
    expect(result.confirmationStatus).toBe('pending');
  });
});

describe('SupabaseAppointmentAdapter.createAppointment — cliente opcional (DEC-127)', () => {
  it('envia p_client_id nulo quando o prestador cria um agendamento manual sem cliente', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ client_id: null, confirmation_status: 'pending', confirmation_source: null, confirmed_at: null }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.createAppointment({
      ...validCommand,
      clientId: null,
      title: 'Bloqueio pessoal',
      requestedBy: 'provider',
    });

    const [, payload] = mockRpc.mock.calls[0];
    expect(payload).toMatchObject({ p_client_id: null, p_title: 'Bloqueio pessoal' });
    expect(result.clientId).toBeNull();
  });

  it('mapeia FORBIDDEN quando o servidor rejeita um chamador cliente tentando criar sem client_id', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'FORBIDDEN: client callers must always provide their own client_id', code: '42501' },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(
      adapter.createAppointment({ ...validCommand, clientId: null, title: 'Bloqueio pessoal', requestedBy: 'client' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('SupabaseAppointmentAdapter.createAppointment — serviço opcional sem cliente (DECISÃO DE PRODUTO 2026-08-18)', () => {
  it('cria um compromisso sem cliente e sem serviço quando o título está preenchido', async () => {
    mockRpc.mockResolvedValue({
      data: appointmentRow({
        client_id: null,
        service_id: null,
        service_name_snapshot: null,
        value_cents_snapshot: null,
        title: 'Reunião',
        confirmation_status: 'pending',
        confirmation_source: null,
        confirmed_at: null,
      }),
      error: null,
    });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.createAppointment({
      ...validCommand,
      clientId: null,
      serviceId: null,
      title: 'Reunião',
      requestedBy: 'provider',
    });

    const [, payload] = mockRpc.mock.calls[0];
    expect(payload).toMatchObject({ p_client_id: null, p_service_id: null, p_title: 'Reunião' });
    expect(result.clientId).toBeNull();
    expect(result.serviceId).toBeNull();
    expect(result.title).toBe('Reunião');
  });

  it('rejeita com TITLE_REQUIRED, sem chamar a RPC, quando não há cliente nem título', async () => {
    const adapter = new SupabaseAppointmentAdapter();

    await expect(
      adapter.createAppointment({ ...validCommand, clientId: null, serviceId: null, title: null, requestedBy: 'provider' }),
    ).rejects.toMatchObject({ code: 'TITLE_REQUIRED' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejeita com TITLE_REQUIRED, sem chamar a RPC, quando o título é só espaços em branco', async () => {
    const adapter = new SupabaseAppointmentAdapter();

    await expect(
      adapter.createAppointment({ ...validCommand, clientId: null, serviceId: null, title: '   ', requestedBy: 'provider' }),
    ).rejects.toMatchObject({ code: 'TITLE_REQUIRED' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejeita com SERVICE_REQUIRED, sem chamar a RPC, quando há cliente mas nenhum serviço foi selecionado', async () => {
    const adapter = new SupabaseAppointmentAdapter();

    await expect(
      adapter.createAppointment({ ...validCommand, clientId: 'client-1', serviceId: null }),
    ).rejects.toMatchObject({ code: 'SERVICE_REQUIRED' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('SupabaseAppointmentAdapter.updateAppointment — title é imutável (DECISÃO DE PRODUTO 2026-08-18)', () => {
  it('rejeita reatribuição de title sem chamar a RPC', async () => {
    const adapter = new SupabaseAppointmentAdapter();

    await expect(adapter.updateAppointment('appointment-1', { title: 'Novo título' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('SupabaseAppointmentAdapter.cancelAppointment', () => {
  it('envia exatamente p_id e p_reason — cancelledBy nunca é parâmetro (vem da sessão no servidor)', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ state: 'cancelled' }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.cancelAppointment('appointment-1', { reason: 'Cliente remarcou por telefone' });

    expect(mockRpc).toHaveBeenCalledWith('cancel_appointment', {
      p_id: 'appointment-1',
      p_reason: 'Cliente remarcou por telefone',
    });
  });

  it('envia p_reason nulo quando nenhum motivo é informado', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ state: 'cancelled' }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.cancelAppointment('appointment-1');

    expect(mockRpc).toHaveBeenCalledWith('cancel_appointment', { p_id: 'appointment-1', p_reason: null });
  });

  it('mapeia INVALID_STATE_TRANSITION ao tentar cancelar um atendimento concluído', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'INVALID_STATE_TRANSITION: completed or no_show appointments cannot be cancelled', code: '22023' },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.cancelAppointment('appointment-1')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('continua funcionando para um agendamento sem cliente (client_id nulo na linha retornada)', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ client_id: null, state: 'cancelled' }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.cancelAppointment('appointment-1');

    expect(result.clientId).toBeNull();
  });
});

// RN-CAN-009 (revisada por DEC-150), RN-CAN-015/016, RF-CAN-007/008
// (BLG-092): antecedência mínima de 24h corridas para o cancelamento PELO
// CLIENTE. O ator (client/provider) e a comparação de tempo são resolvidos
// inteiramente dentro de `cancel_appointment` (server-side) — o adapter
// nunca envia um parâmetro de ator nem calcula datas, então estes testes
// cobrem exatamente a fronteira do adapter: (1) o caminho de sucesso
// continua intacto após a migration, (2) o novo prefixo de erro do servidor
// é mapeado para o código público correto, com a mensagem humana esperada.
// A aritmética exata do limite de 24h (23h59min59s bloqueado vs. 24h00min00s
// permitido) é uma decisão inteiramente server-side e é coberta por teste de
// regressão na própria migration
// (`20260814110000_cancel_appointment_advance_notice.sql`, segundo bloco
// `do $$`), não neste arquivo — o cliente Supabase mockado aqui não executa
// nenhuma lógica de data real.
describe('SupabaseAppointmentAdapter.cancelAppointment — antecedência mínima de 24h (RN-CAN-009/015/016, DEC-150, BLG-092)', () => {
  it('cancelamento do cliente é bem-sucedido quando o servidor aceita a antecedência (>= 24h)', async () => {
    mockRpc.mockResolvedValue({
      data: appointmentRow({ state: 'cancelled', starts_at: '2026-09-01T12:00:00.000Z' }),
      error: null,
    });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.cancelAppointment('appointment-1', { reason: 'Imprevisto' });

    expect(result.state).toBe('cancelled');
    expect(mockRpc).toHaveBeenCalledWith('cancel_appointment', {
      p_id: 'appointment-1',
      p_reason: 'Imprevisto',
    });
  });

  it('mapeia CANCELLATION_ADVANCE_NOTICE_INVALID quando o servidor rejeita o cancelamento do cliente por antecedência insuficiente (< 24h)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'CANCELLATION_ADVANCE_NOTICE_INVALID: client cancellation requires at least 24 hours of advance notice',
        code: '22023',
      },
    });

    const adapter = new SupabaseAppointmentAdapter();
    const error = await adapter.cancelAppointment('appointment-1').catch((e) => e);

    expect(error).toMatchObject({ code: 'CANCELLATION_ADVANCE_NOTICE_INVALID' });
    expect(error.message).toBe(
      'Este atendimento já está a menos de 24 horas do horário marcado. Não é possível concluir o cancelamento por aqui — entre em contato diretamente com o prestador.',
    );
  });

  it('distingue CANCELLATION_ADVANCE_NOTICE_INVALID (janela de 24h) de INVALID_STATE_TRANSITION (atendimento já iniciado) — códigos nunca se confundem', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'INVALID_STATE_TRANSITION: client cannot cancel after the appointment has started', code: '22023' },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.cancelAppointment('appointment-1')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('cancelamento pelo prestador continua funcionando independentemente da proximidade do horário (RN-CAN-010, sem antecedência mínima)', async () => {
    // O ator é resolvido pelo servidor via auth.uid()/profiles.role — o
    // adapter nunca sabe (nem precisa saber) se quem chamou é prestador ou
    // cliente. Um agendamento cujo starts_at está a poucos minutos de
    // distância, cancelado com sucesso pelo servidor, representa o
    // cancelamento pelo prestador sem nenhuma restrição de antecedência
    // (RN-CAN-010) — nenhuma regressão introduzida por esta migration para
    // esse ator.
    mockRpc.mockResolvedValue({
      data: appointmentRow({ state: 'cancelled', starts_at: '2026-08-14T10:05:00.000Z' }),
      error: null,
    });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.cancelAppointment('appointment-1');

    expect(result.state).toBe('cancelled');
  });
});

describe('SupabaseAppointmentAdapter.confirmManually', () => {
  it('chama confirm_appointment_manually apenas com o id', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ confirmation_status: 'confirmed' }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.confirmManually('appointment-1');

    expect(mockRpc).toHaveBeenCalledWith('confirm_appointment_manually', { p_id: 'appointment-1' });
  });

  it('continua funcionando para um agendamento sem cliente (client_id nulo na linha retornada)', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ client_id: null, confirmation_status: 'confirmed' }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.confirmManually('appointment-1');

    expect(result.clientId).toBeNull();
  });
});

// Reversão de "Confirmado" -> "A confirmar" (bug report 2026-09-06,
// 20260906130000_unconfirm_appointment_manually.sql): o seletor de Situação
// do formulário de edição sempre permitia escolher "A confirmar" de volta,
// mas nenhuma chamada de rede desfazia a confirmação.
describe('SupabaseAppointmentAdapter.unconfirmManually', () => {
  it('chama unconfirm_appointment_manually apenas com o id', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ confirmation_status: 'pending', confirmation_source: null, confirmed_at: null }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.unconfirmManually('appointment-1');

    expect(mockRpc).toHaveBeenCalledWith('unconfirm_appointment_manually', { p_id: 'appointment-1' });
    expect(result.confirmationStatus).toBe('pending');
  });

  it('mapeia INVALID_STATE_TRANSITION quando o agendamento não está scheduled', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'INVALID_STATE_TRANSITION: only scheduled appointments can have their confirmation reverted', code: '22023' },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.unconfirmManually('appointment-1')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('mapeia FORBIDDEN quando o chamador não é o prestador dono do tenant', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'FORBIDDEN: only the provider can revert a manual confirmation', code: '42501' },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.unconfirmManually('appointment-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// Reversão de estado terminal -> scheduled (bug report 2026-08-23,
// 20260823120000_revert_terminal_appointment_to_scheduled.sql). O ator
// (prestador vs. cliente) e a checagem de estado/conflito de horário são
// inteiramente resolvidos dentro de `revert_appointment_to_scheduled`
// (server-side) — o adapter só precisa repassar o id e mapear os erros
// devolvidos pelo servidor para os códigos públicos já existentes.
describe('SupabaseAppointmentAdapter.revertToScheduled', () => {
  it('chama revert_appointment_to_scheduled apenas com o id', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ state: 'scheduled' }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.revertToScheduled('appointment-1');

    expect(mockRpc).toHaveBeenCalledWith('revert_appointment_to_scheduled', { p_id: 'appointment-1' });
  });

  it('devolve o agendamento revertido para scheduled, confirmado pelo prestador', async () => {
    mockRpc.mockResolvedValue({
      data: appointmentRow({
        state: 'scheduled',
        confirmation_status: 'confirmed',
        confirmation_source: 'provider_manual',
        cancellation_reason: null,
        cancelled_by: null,
        cancelled_at: null,
      }),
      error: null,
    });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.revertToScheduled('appointment-1');

    expect(result.state).toBe('scheduled');
    expect(result.confirmationSource).toBe('provider_manual');
    expect(result.cancelledBy).toBeNull();
  });

  it('mapeia APPOINTMENT_NOT_FOUND quando o id não existe', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'APPOINTMENT_NOT_FOUND: appointment does not exist', code: '22023' },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.revertToScheduled('appointment-inexistente')).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    });
  });

  it('mapeia FORBIDDEN quando o chamador não é o prestador dono do tenant (inclui o cliente tentando reverter)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'FORBIDDEN: only the provider can revert a terminal appointment to scheduled',
        code: '42501',
      },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.revertToScheduled('appointment-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('mapeia INVALID_STATE_TRANSITION quando o agendamento já está scheduled (não é um estado terminal)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'INVALID_STATE_TRANSITION: only completed, cancelled or no_show appointments can be reverted to scheduled',
        code: '22023',
      },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.revertToScheduled('appointment-1')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('mapeia SLOT_UNAVAILABLE quando o horário original foi ocupado por outro agendamento nesse meio-tempo', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'SLOT_UNAVAILABLE: requested slot is already booked for this provider (2026-08-11T14:30:00.000Z)',
        code: '22023',
      },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.revertToScheduled('appointment-1')).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
    });
  });
});

describe('SupabaseAppointmentAdapter.updateAppointment', () => {
  it('rejeita reatribuição de clientId sem chamar a RPC', async () => {
    const adapter = new SupabaseAppointmentAdapter();

    await expect(adapter.updateAppointment('appointment-1', { clientId: 'client-2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejeita reatribuição de serviceId sem chamar a RPC', async () => {
    const adapter = new SupabaseAppointmentAdapter();

    await expect(adapter.updateAppointment('appointment-1', { serviceId: 'service-2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('usa as flags *_provided para permitir limpar clientMessage/internalNotes explicitamente com null', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow(), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.updateAppointment('appointment-1', { clientMessage: null, internalNotes: null });

    expect(mockRpc).toHaveBeenCalledWith('update_appointment', {
      p_id: 'appointment-1',
      p_client_message: null,
      p_client_message_provided: true,
      p_internal_notes: null,
      p_internal_notes_provided: true,
    });
  });

  it('não inclui parâmetros de campos não informados no patch', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow(), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.updateAppointment('appointment-1', { startsAt: '2026-08-12T14:30:00.000Z' });

    expect(mockRpc).toHaveBeenCalledWith('update_appointment', {
      p_id: 'appointment-1',
      p_starts_at: '2026-08-12T14:30:00.000Z',
    });
  });

  it('continua funcionando para um agendamento sem cliente (client_id nulo na linha retornada)', async () => {
    mockRpc.mockResolvedValue({ data: appointmentRow({ client_id: null }), error: null });

    const adapter = new SupabaseAppointmentAdapter();
    const result = await adapter.updateAppointment('appointment-1', { startsAt: '2026-08-12T14:30:00.000Z' });

    expect(result.clientId).toBeNull();
  });

  // RN-AGD-027 (BACKLOG.md, DEC-139): a remarcação segue a mesma regra de
  // dia de atendimento da criação (validada dentro da RPC `update_appointment`,
  // 20260813140000) — aqui garantimos apenas que o mapeamento de erro chega
  // corretamente ao domínio quando o servidor rejeita.
  it('mapeia ATTENDANCE_DAY_UNAVAILABLE quando a remarcação cai fora do dia de atendimento do prestador', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ATTENDANCE_DAY_UNAVAILABLE: requested date falls outside the provider attendance days', code: '22023' },
    });

    const adapter = new SupabaseAppointmentAdapter();
    await expect(
      adapter.updateAppointment('appointment-1', { startsAt: '2026-08-16T14:30:00.000Z' }),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_DAY_UNAVAILABLE' });
  });
});

describe('SupabaseAppointmentAdapter — visibilidade de internal_notes por papel', () => {
  it('listAppointments consulta appointments_client_view (sem internal_notes) quando o chamador é cliente', async () => {
    mockRole('client');
    const listBuilder = createQueryBuilder({ data: [appointmentRow()], error: null, count: 1 });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createQueryBuilder({ data: { role: 'client' }, error: null });
      return listBuilder;
    });

    const adapter = new SupabaseAppointmentAdapter();
    const page = await adapter.listAppointments({ month: '2026-08', page: 1, pageSize: 10 });

    expect(mockFrom).toHaveBeenCalledWith('appointments_client_view');
    expect(mockFrom).not.toHaveBeenCalledWith('appointments');
    expect(page.items[0].internalNotes).toBeNull();
  });

  it('listAppointments consulta a tabela appointments quando o chamador é prestador', async () => {
    mockRole('provider');
    const listBuilder = createQueryBuilder({ data: [appointmentRow({ internal_notes: 'Cliente pediu desconto' })], error: null, count: 1 });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createQueryBuilder({ data: { role: 'provider' }, error: null });
      return listBuilder;
    });

    const adapter = new SupabaseAppointmentAdapter();
    const page = await adapter.listAppointments({ month: '2026-08', page: 1, pageSize: 10 });

    expect(mockFrom).toHaveBeenCalledWith('appointments');
    expect(mockFrom).not.toHaveBeenCalledWith('appointments_client_view');
    expect(page.items[0].internalNotes).toBe('Cliente pediu desconto');
  });

  it('getAppointment consulta appointments_client_view quando o chamador é cliente, e o resultado nunca expõe internal_notes mesmo que a coluna venha ausente', async () => {
    mockRole('client');
    // A view real nunca devolve esta coluna; simulado aqui pela ausência da
    // chave `internal_notes` no objeto (não apenas `null`).
    const { internal_notes, ...rowWithoutInternalNotes } = appointmentRow();
    const detailBuilder = createQueryBuilder({ data: rowWithoutInternalNotes, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createQueryBuilder({ data: { role: 'client' }, error: null });
      return detailBuilder;
    });

    const adapter = new SupabaseAppointmentAdapter();
    const appointment = await adapter.getAppointment('appointment-1');

    expect(mockFrom).toHaveBeenCalledWith('appointments_client_view');
    expect(appointment.internalNotes).toBeNull();
  });

  it('sem sessão válida (getUser falha), trata o chamador como não-cliente e usa a tabela bruta', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const listBuilder = createQueryBuilder({ data: [], error: null, count: 0 });
    mockFrom.mockReturnValue(listBuilder);

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.listAppointments({ month: '2026-08', page: 1, pageSize: 10 });

    expect(mockFrom).toHaveBeenCalledWith('appointments');
  });
});

describe('SupabaseAppointmentAdapter — bloqueios de disponibilidade', () => {
  const validBlockInput: CreateAvailabilityBlockInput = {
    startsAt: '2026-08-20T00:00:00.000Z',
    endsAt: '2026-08-21T00:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    reason: 'Feriado local',
    conflictPolicy: 'keep_existing',
  };

  it('resolve o tenant do chamador e nunca envia conflictPolicy ao banco (garantia estrutural, não um campo persistido)', async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: 'tenant-1' }, error: null });
    const blockRow = {
      id: 'block-1',
      tenant_id: 'tenant-1',
      starts_at: validBlockInput.startsAt,
      ends_at: validBlockInput.endsAt,
      timezone: validBlockInput.timezone,
      reason: validBlockInput.reason,
      created_at: '2026-08-06T00:00:00.000Z',
    };
    const blocksBuilder = createQueryBuilder({ data: blockRow, error: null });
    mockFrom.mockImplementation((table: string) => (table === 'tenants' ? tenantBuilder : blocksBuilder));

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.createAvailabilityBlock(validBlockInput);

    expect(blocksBuilder.insert).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      starts_at: validBlockInput.startsAt,
      ends_at: validBlockInput.endsAt,
      timezone: validBlockInput.timezone,
      reason: validBlockInput.reason,
    });
  });

  it('mapeia sobreposição de bloqueio (exclusion_violation cru) para AGENDA_BLOCK_OVERLAP', async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: 'tenant-1' }, error: null });
    const blocksBuilder = createQueryBuilder({
      data: null,
      error: {
        message: 'conflicting key value violates exclusion constraint "availability_blocks_no_overlap_exclude"',
        code: '23P01',
      },
    });
    mockFrom.mockImplementation((table: string) => (table === 'tenants' ? tenantBuilder : blocksBuilder));

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.createAvailabilityBlock(validBlockInput)).rejects.toMatchObject({
      code: 'AGENDA_BLOCK_OVERLAP',
    });
  });

  it('deleteAvailabilityBlock lança AGENDA_BLOCK_NOT_FOUND quando nenhuma linha é afetada', async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.deleteAvailabilityBlock('block-inexistente')).rejects.toMatchObject({
      code: 'AGENDA_BLOCK_NOT_FOUND',
    });
  });
});

describe('SupabaseAppointmentAdapter.deleteAppointment', () => {
  it('nunca faz UPDATE — exclusão administrativa é sempre DELETE físico com auditoria via trigger', async () => {
    const builder = createQueryBuilder({ data: { id: 'appointment-1' }, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseAppointmentAdapter();
    await adapter.deleteAppointment('appointment-1');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('lança APPOINTMENT_NOT_FOUND quando o agendamento não existe ou não pertence ao tenant do chamador', async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseAppointmentAdapter();
    await expect(adapter.deleteAppointment('appointment-inexistente')).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    });
  });
});
