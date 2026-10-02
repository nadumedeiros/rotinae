import type { UpdateProviderSettingsInput } from '@/src/domain/provider/types';

// Mesmo padrão de apps/agendae/src/infra/clients/__tests__: mocka o cliente
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
import { SupabaseProviderSettingsAdapter } from '../supabase-provider-settings-adapter';

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;
const mockGetUser = supabase.auth.getUser as jest.Mock;

// Builder fluente mínimo: cada método de filtro/transformação devolve o
// próprio builder (para encadear `.select().eq()` como o supabase-js real),
// e o builder também é "thenable" — `getSettings` faz `await builder`
// diretamente via `.maybeSingle()`.
function createQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {};
  const chainableMethods = ['select', 'eq'];
  for (const method of chainableMethods) {
    builder[method] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

const authenticatedUser = {
  data: { user: { id: 'user-1', email: 'marcus@exemplo.com' } },
  error: null,
};

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    display_name: 'Marcus',
    phone: '+5511999999999',
    email_notifications: true,
    push_notifications: true,
    updated_at: '2026-08-06T10:00:00.000Z',
    ...overrides,
  };
}

function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    timezone: 'America/Sao_Paulo',
    workday_start: '08:00:00',
    workday_end: '18:00:00',
    minimum_advance_hours: 24,
    profession: null,
    attendance_days: [0, 1, 2, 3, 4, 5, 6],
    updated_at: '2026-08-06T11:00:00.000Z',
    ...overrides,
  };
}

const validInput: UpdateProviderSettingsInput = {
  displayName: 'Marcus',
  phone: '+5511999999999',
  profession: null,
  timezone: 'America/Sao_Paulo',
  workdayStart: '08:00',
  workdayEnd: '18:00',
  minimumAdvanceHours: 24,
  emailNotifications: true,
  pushNotifications: true,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SupabaseProviderSettingsAdapter.getSettings', () => {
  it('combina profiles + tenants + auth.users.email num único DTO, com updatedAt igual ao mais recente dos dois', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    const profileBuilder = createQueryBuilder({ data: profileRow(), error: null });
    const tenantBuilder = createQueryBuilder({ data: tenantRow(), error: null });
    mockFrom.mockImplementation((table: string) => (table === 'profiles' ? profileBuilder : tenantBuilder));

    const adapter = new SupabaseProviderSettingsAdapter();
    const settings = await adapter.getSettings();

    expect(settings).toEqual({
      id: 'user-1',
      displayName: 'Marcus',
      email: 'marcus@exemplo.com',
      phone: '+5511999999999',
      profession: null,
      attendanceDays: [0, 1, 2, 3, 4, 5, 6],
      timezone: 'America/Sao_Paulo',
      workdayStart: '08:00',
      workdayEnd: '18:00',
      minimumAdvanceHours: 24,
      emailNotifications: true,
      pushNotifications: true,
      updatedAt: '2026-08-06T11:00:00.000Z',
    });
  });

  it('devolve profession preenchida quando o tenant tem o campo definido', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    const profileBuilder = createQueryBuilder({ data: profileRow(), error: null });
    const tenantBuilder = createQueryBuilder({
      data: tenantRow({ profession: 'Personal Trainer' }),
      error: null,
    });
    mockFrom.mockImplementation((table: string) => (table === 'profiles' ? profileBuilder : tenantBuilder));

    const adapter = new SupabaseProviderSettingsAdapter();
    const settings = await adapter.getSettings();

    expect(settings.profession).toBe('Personal Trainer');
  });

  it('devolve attendanceDays com o subconjunto real configurado (não sempre os 7 dias)', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    const profileBuilder = createQueryBuilder({ data: profileRow(), error: null });
    const tenantBuilder = createQueryBuilder({
      data: tenantRow({ attendance_days: [1, 2, 3, 4, 5] }),
      error: null,
    });
    mockFrom.mockImplementation((table: string) => (table === 'profiles' ? profileBuilder : tenantBuilder));

    const adapter = new SupabaseProviderSettingsAdapter();
    const settings = await adapter.getSettings();

    expect(settings.attendanceDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('lança SESSION_EXPIRED quando não há sessão autenticada, sem consultar profiles/tenants', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.getSettings()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('lança PROFILE_NOT_FOUND quando não existe linha em profiles para o chamador', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    const profileBuilder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(profileBuilder);

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.getSettings()).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
  });

  it('lança FORBIDDEN quando o chamador não possui tenant (não é prestador dono de negócio)', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    const profileBuilder = createQueryBuilder({ data: profileRow(), error: null });
    const tenantBuilder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockImplementation((table: string) => (table === 'profiles' ? profileBuilder : tenantBuilder));

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.getSettings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('SupabaseProviderSettingsAdapter.updateSettings — validação client-side', () => {
  it('rejeita nome vazio/só espaços com NAME_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.updateSettings({ ...validInput, displayName: '   ' })).rejects.toMatchObject({
      code: 'NAME_INVALID',
    });
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejeita telefone fora do formato E.164 com PHONE_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(
      adapter.updateSettings({ ...validInput, phone: '(11) 99999-0000' }),
    ).rejects.toMatchObject({ code: 'PHONE_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('aceita telefone nulo (campo opcional)', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          display_name: 'Marcus',
          phone: null,
          email_notifications: true,
          push_notifications: true,
          profile_updated_at: '2026-08-06T10:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          workday_start: '08:00:00',
          workday_end: '18:00:00',
          minimum_advance_hours: 24,
          tenant_updated_at: '2026-08-06T11:00:00.000Z',
        },
      ],
      error: null,
    });

    const adapter = new SupabaseProviderSettingsAdapter();
    const result = await adapter.updateSettings({ ...validInput, phone: null });

    expect(result.phone).toBeNull();
  });

  it('rejeita fuso horário inválido com TIMEZONE_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(
      adapter.updateSettings({ ...validInput, timezone: 'Nao/Existe' }),
    ).rejects.toMatchObject({ code: 'TIMEZONE_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejeita horário final anterior/igual ao inicial com WORKING_HOURS_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(
      adapter.updateSettings({ ...validInput, workdayStart: '18:00', workdayEnd: '08:00' }),
    ).rejects.toMatchObject({ code: 'WORKING_HOURS_INVALID' });
    await expect(
      adapter.updateSettings({ ...validInput, workdayStart: '08:00', workdayEnd: '08:00' }),
    ).rejects.toMatchObject({ code: 'WORKING_HOURS_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejeita horário em formato inválido com WORKING_HOURS_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(
      adapter.updateSettings({ ...validInput, workdayStart: '8:00', workdayEnd: '18:00' }),
    ).rejects.toMatchObject({ code: 'WORKING_HOURS_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejeita antecedência fora do intervalo 0-720 com ADVANCE_NOTICE_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(
      adapter.updateSettings({ ...validInput, minimumAdvanceHours: -1 }),
    ).rejects.toMatchObject({ code: 'ADVANCE_NOTICE_INVALID' });
    await expect(
      adapter.updateSettings({ ...validInput, minimumAdvanceHours: 721 }),
    ).rejects.toMatchObject({ code: 'ADVANCE_NOTICE_INVALID' });
    await expect(
      adapter.updateSettings({ ...validInput, minimumAdvanceHours: 12.5 }),
    ).rejects.toMatchObject({ code: 'ADVANCE_NOTICE_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('aceita os limites 0 e 720 de antecedência (intervalo fechado)', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          display_name: 'Marcus',
          phone: '+5511999999999',
          email_notifications: true,
          push_notifications: true,
          profile_updated_at: '2026-08-06T10:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          workday_start: '08:00:00',
          workday_end: '18:00:00',
          minimum_advance_hours: 0,
          tenant_updated_at: '2026-08-06T11:00:00.000Z',
        },
      ],
      error: null,
    });

    const adapter = new SupabaseProviderSettingsAdapter();
    await expect(adapter.updateSettings({ ...validInput, minimumAdvanceHours: 0 })).resolves.toBeTruthy();
    await expect(adapter.updateSettings({ ...validInput, minimumAdvanceHours: 720 })).resolves.toBeTruthy();
  });

  // RN-AGD-025 (docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md, seção 2.4/7.1):
  // zero dias marcados é sempre inválido, defesa em profundidade client-side
  // antes de tocar o banco (a constraint `tenants_attendance_days_check` é a
  // autoridade final, coberta na descrição "envio ao banco" abaixo).
  it('rejeita array vazio de attendanceDays com ATTENDANCE_DAYS_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(
      adapter.updateSettings({ ...validInput, attendanceDays: [] }),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_DAYS_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejeita attendanceDays com valor fora do intervalo 0-6 com ATTENDANCE_DAYS_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(
      adapter.updateSettings({ ...validInput, attendanceDays: [1, 2, 7] }),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_DAYS_INVALID' });
    await expect(
      adapter.updateSettings({ ...validInput, attendanceDays: [-1, 2, 3] }),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_DAYS_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('aceita attendanceDays ausente (campo ainda não enviado por app/settings.tsx) sem validar nem bloquear a chamada', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          display_name: 'Marcus',
          phone: '+5511999999999',
          email_notifications: true,
          push_notifications: true,
          profile_updated_at: '2026-08-06T10:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          workday_start: '08:00:00',
          workday_end: '18:00:00',
          minimum_advance_hours: 24,
          attendance_days: [0, 1, 2, 3, 4, 5, 6],
          tenant_updated_at: '2026-08-06T11:00:00.000Z',
        },
      ],
      error: null,
    });

    const adapter = new SupabaseProviderSettingsAdapter();
    await expect(adapter.updateSettings(validInput)).resolves.toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith(
      'update_provider_settings',
      expect.objectContaining({ new_attendance_days: null }),
    );
  });

  it('aceita um subconjunto válido não vazio de attendanceDays (ex.: apenas terça e quinta)', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          display_name: 'Marcus',
          phone: '+5511999999999',
          email_notifications: true,
          push_notifications: true,
          profile_updated_at: '2026-08-06T10:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          workday_start: '08:00:00',
          workday_end: '18:00:00',
          minimum_advance_hours: 24,
          attendance_days: [2, 4],
          tenant_updated_at: '2026-08-06T11:00:00.000Z',
        },
      ],
      error: null,
    });

    const adapter = new SupabaseProviderSettingsAdapter();
    const result = await adapter.updateSettings({ ...validInput, attendanceDays: [2, 4] });

    expect(mockRpc).toHaveBeenCalledWith(
      'update_provider_settings',
      expect.objectContaining({ new_attendance_days: [2, 4] }),
    );
    expect(result.attendanceDays).toEqual([2, 4]);
  });
});

describe('SupabaseProviderSettingsAdapter.updateSettings — envio ao banco', () => {
  it('nunca inclui e-mail no payload enviado à RPC', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          display_name: 'Marcus',
          phone: '+5511999999999',
          email_notifications: true,
          push_notifications: true,
          profile_updated_at: '2026-08-06T10:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          workday_start: '08:00:00',
          workday_end: '18:00:00',
          minimum_advance_hours: 24,
          tenant_updated_at: '2026-08-06T11:00:00.000Z',
        },
      ],
      error: null,
    });

    const adapter = new SupabaseProviderSettingsAdapter();
    await adapter.updateSettings(validInput);

    expect(mockRpc).toHaveBeenCalledWith(
      'update_provider_settings',
      expect.not.objectContaining({ email: expect.anything() }),
    );
    const [, payload] = mockRpc.mock.calls[0];
    expect(Object.keys(payload)).not.toContain('email');
    expect(Object.keys(payload)).not.toContain('new_email');
  });

  it('envia exatamente os campos esperados pela RPC, com nome/telefone normalizados', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          display_name: 'Marcus Aurelio',
          phone: '+5511999999999',
          email_notifications: false,
          push_notifications: true,
          profile_updated_at: '2026-08-06T10:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          workday_start: '09:00:00',
          workday_end: '19:00:00',
          minimum_advance_hours: 48,
          tenant_updated_at: '2026-08-06T11:00:00.000Z',
        },
      ],
      error: null,
    });

    const adapter = new SupabaseProviderSettingsAdapter();
    await adapter.updateSettings({
      ...validInput,
      displayName: '  Marcus Aurelio  ',
      workdayStart: '09:00',
      workdayEnd: '19:00',
      minimumAdvanceHours: 48,
      emailNotifications: false,
    });

    expect(mockRpc).toHaveBeenCalledWith('update_provider_settings', {
      new_display_name: 'Marcus Aurelio',
      new_phone: '+5511999999999',
      new_profession: null,
      new_attendance_days: null,
      new_timezone: 'America/Sao_Paulo',
      new_workday_start: '09:00',
      new_workday_end: '19:00',
      new_minimum_advance_hours: 48,
      new_email_notifications: false,
      new_push_notifications: true,
    });
  });

  it('normaliza profession para Title Case e trim antes de enviar à RPC (RN-PRF-003)', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          display_name: 'Marcus',
          phone: '+5511999999999',
          email_notifications: true,
          push_notifications: true,
          profile_updated_at: '2026-08-06T10:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          workday_start: '08:00:00',
          workday_end: '18:00:00',
          minimum_advance_hours: 24,
          profession: 'Personal Trainer',
          tenant_updated_at: '2026-08-06T11:00:00.000Z',
        },
      ],
      error: null,
    });

    const adapter = new SupabaseProviderSettingsAdapter();
    const result = await adapter.updateSettings({ ...validInput, profession: '  personal TRAINER  ' });

    expect(mockRpc).toHaveBeenCalledWith(
      'update_provider_settings',
      expect.objectContaining({ new_profession: 'Personal Trainer' }),
    );
    expect(result.profession).toBe('Personal Trainer');
  });

  it('normaliza profession em branco para null (não persiste string vazia)', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          display_name: 'Marcus',
          phone: '+5511999999999',
          email_notifications: true,
          push_notifications: true,
          profile_updated_at: '2026-08-06T10:00:00.000Z',
          timezone: 'America/Sao_Paulo',
          workday_start: '08:00:00',
          workday_end: '18:00:00',
          minimum_advance_hours: 24,
          profession: null,
          tenant_updated_at: '2026-08-06T11:00:00.000Z',
        },
      ],
      error: null,
    });

    const adapter = new SupabaseProviderSettingsAdapter();
    await adapter.updateSettings({ ...validInput, profession: '   ' });

    expect(mockRpc).toHaveBeenCalledWith(
      'update_provider_settings',
      expect.objectContaining({ new_profession: null }),
    );
  });

  it('rejeita profession com mais de 60 caracteres com PROFESSION_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(
      adapter.updateSettings({ ...validInput, profession: 'a'.repeat(61) }),
    ).rejects.toMatchObject({ code: 'PROFESSION_INVALID' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('mapeia violação de constraint de tamanho de profession (defesa em profundidade) para PROFESSION_INVALID', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'new row for relation "tenants" violates check constraint "tenants_profession_length_check"',
        code: '23514',
      },
    });

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.updateSettings(validInput)).rejects.toMatchObject({ code: 'PROFESSION_INVALID' });
  });

  it('mapeia violação de constraint de não-vazio/intervalo de attendanceDays (defesa em profundidade) para ATTENDANCE_DAYS_INVALID', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'new row for relation "tenants" violates check constraint "tenants_attendance_days_check"',
        code: '23514',
      },
    });

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.updateSettings(validInput)).rejects.toMatchObject({ code: 'ATTENDANCE_DAYS_INVALID' });
  });

  it('mapeia PROFILE_NOT_FOUND devolvido pela RPC', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'PROFILE_NOT_FOUND: profile does not exist for the caller', code: '22023' },
    });

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.updateSettings(validInput)).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
  });

  it('mapeia FORBIDDEN devolvido pela RPC quando o chamador não possui tenant', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'FORBIDDEN: caller does not own a tenant', code: '42501' },
    });

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.updateSettings(validInput)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('mapeia violação de constraint de jornada (defesa em profundidade) para WORKING_HOURS_INVALID', async () => {
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'new row for relation "tenants" violates check constraint "tenants_workday_order_check"',
        code: '23514',
      },
    });

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.updateSettings(validInput)).rejects.toMatchObject({ code: 'WORKING_HOURS_INVALID' });
  });

  it('lança SESSION_EXPIRED quando não há sessão autenticada, sem chamar a RPC', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const adapter = new SupabaseProviderSettingsAdapter();

    await expect(adapter.updateSettings(validInput)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
