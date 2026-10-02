import type { CreateServiceInput } from '@/src/domain/services/types';

// Mesmo padrão de apps/agendae/src/infra/clients/__tests__: mocka o cliente
// Supabase (que lançaria por falta de variáveis de ambiente fora deste
// teste) para exercitar só a lógica do adapter, sem depender de um projeto
// Supabase real. `jest.mock` é hoisted pelo babel; por isso os `jest.fn()`
// nascem dentro do factory, não em consts externas.
jest.mock('@/src/infra/supabase/client', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

import { supabase } from '@/src/infra/supabase/client';
import { SupabaseServiceCatalogAdapter } from '../supabase-service-catalog-adapter';

const mockFrom = supabase.from as jest.Mock;
const mockGetUser = supabase.auth.getUser as jest.Mock;

// Builder fluente mínimo: cada método de filtro/transformação devolve o
// próprio builder (para encadear `.select().eq().order()` como o
// supabase-js real), e o builder também é "thenable" — `listServices` faz
// `await builder` diretamente, sem terminar em `.single()`.
function createQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: any = {};
  // Cada método precisa do seu PRÓPRIO jest.fn(): compartilhar uma única
  // função entre `.update`/`.delete`/etc. faria uma chamada em qualquer um
  // deles aparecer como chamada em todos (mocks são identificados por
  // referência, não por nome de propriedade).
  const chainableMethods = ['select', 'eq', 'order', 'insert', 'update', 'delete'];
  for (const method of chainableMethods) {
    builder[method] = jest.fn(() => builder);
  }
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

const validInput: CreateServiceInput = {
  name: 'Banho e tosa',
  durationMinutes: 60,
  referenceValueCents: 8000,
};

function serviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'service-1',
    name: 'Banho e tosa',
    duration_minutes: 60,
    reference_value_cents: 8000,
    status: 'active',
    created_at: '2026-08-06T00:00:00.000Z',
    updated_at: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: chamador autenticado. Testes que precisam simular sessão
  // expirada sobrescrevem com `mockGetUser.mockResolvedValueOnce(...)`.
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('SupabaseServiceCatalogAdapter.createService', () => {
  it('mapeia nome duplicado ativo para SERVICE_NAME_CONFLICT sem revelar o erro cru do Postgres', async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: 'tenant-1' }, error: null });
    const servicesBuilder = createQueryBuilder({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "services_tenant_active_name_uk"',
        code: '23505',
      },
    });

    mockFrom.mockImplementation((table: string) => (table === 'tenants' ? tenantBuilder : servicesBuilder));

    const adapter = new SupabaseServiceCatalogAdapter();

    await expect(adapter.createService(validInput)).rejects.toMatchObject({
      code: 'SERVICE_NAME_CONFLICT',
    });
  });

  it('cria o serviço vinculado ao próprio tenant do prestador autenticado', async () => {
    const tenantBuilder = createQueryBuilder({ data: { id: 'tenant-1' }, error: null });
    const servicesBuilder = createQueryBuilder({ data: serviceRow(), error: null });

    mockFrom.mockImplementation((table: string) => (table === 'tenants' ? tenantBuilder : servicesBuilder));

    const adapter = new SupabaseServiceCatalogAdapter();
    const service = await adapter.createService(validInput);

    expect(servicesBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant-1', name: 'Banho e tosa' }),
    );
    expect(service.id).toBe('service-1');
  });

  it('rejeita duração zero/negativa/não inteira com DURATION_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseServiceCatalogAdapter();

    await expect(
      adapter.createService({ ...validInput, durationMinutes: 0 }),
    ).rejects.toMatchObject({ code: 'DURATION_INVALID' });
    await expect(
      adapter.createService({ ...validInput, durationMinutes: -10 }),
    ).rejects.toMatchObject({ code: 'DURATION_INVALID' });
    await expect(
      adapter.createService({ ...validInput, durationMinutes: 30.5 }),
    ).rejects.toMatchObject({ code: 'DURATION_INVALID' });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejeita valor de referência negativo ou não inteiro com VALUE_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseServiceCatalogAdapter();

    await expect(
      adapter.createService({ ...validInput, referenceValueCents: -1 }),
    ).rejects.toMatchObject({ code: 'VALUE_INVALID' });
    await expect(
      adapter.createService({ ...validInput, referenceValueCents: 10.5 }),
    ).rejects.toMatchObject({ code: 'VALUE_INVALID' });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejeita nome vazio/só espaços com SERVICE_NAME_INVALID antes de tocar o banco', async () => {
    const adapter = new SupabaseServiceCatalogAdapter();

    await expect(adapter.createService({ ...validInput, name: '   ' })).rejects.toMatchObject({
      code: 'SERVICE_NAME_INVALID',
    });

    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('SupabaseServiceCatalogAdapter.activateService / deactivateService', () => {
  it('activateService é idempotente: reaplicar sobre um serviço já ativo devolve o registro sem erro', async () => {
    const builder = createQueryBuilder({ data: serviceRow({ status: 'active' }), error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();
    const service = await adapter.activateService('service-1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'active' });
    expect(service.status).toBe('active');
  });

  it('deactivateService é idempotente: reaplicar sobre um serviço já inativo devolve o registro sem erro', async () => {
    const builder = createQueryBuilder({ data: serviceRow({ status: 'inactive' }), error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();
    const service = await adapter.deactivateService('service-1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'inactive' });
    expect(service.status).toBe('inactive');
  });

  it('deactivateService nunca chama .delete() — é sempre inativação lógica (UPDATE de status)', async () => {
    const builder = createQueryBuilder({ data: serviceRow({ status: 'inactive' }), error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();
    await adapter.deactivateService('service-1');

    expect(builder.delete).not.toHaveBeenCalled();
  });

  it('lança SERVICE_NOT_FOUND ao ativar/inativar um serviço inexistente ou de outro tenant', async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();

    await expect(adapter.activateService('service-inexistente')).rejects.toMatchObject({
      code: 'SERVICE_NOT_FOUND',
    });
    await expect(adapter.deactivateService('service-inexistente')).rejects.toMatchObject({
      code: 'SERVICE_NOT_FOUND',
    });
  });
});

describe('SupabaseServiceCatalogAdapter.listServices / getService', () => {
  it('filtra por status quando informado', async () => {
    const builder = createQueryBuilder({ data: [serviceRow()], error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();
    await adapter.listServices({ status: 'active' });

    expect(builder.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('getService lança SERVICE_NOT_FOUND quando o serviço não existe ou não pertence ao tenant do chamador', async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();

    await expect(adapter.getService('service-inexistente')).rejects.toMatchObject({
      code: 'SERVICE_NOT_FOUND',
    });
  });

  it('getService retorna um serviço inativo normalmente (nunca há exclusão física)', async () => {
    const builder = createQueryBuilder({ data: serviceRow({ status: 'inactive' }), error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();
    const service = await adapter.getService('service-1');

    expect(service.status).toBe('inactive');
  });
});

describe('SupabaseServiceCatalogAdapter.updateService', () => {
  it('não altera nome/duração/valor quando o campo não é informado no patch', async () => {
    const builder = createQueryBuilder({ data: serviceRow(), error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();
    await adapter.updateService({ id: 'service-1', referenceValueCents: 9000 });

    expect(builder.update).toHaveBeenCalledWith({ reference_value_cents: 9000 });
  });

  it('lança SERVICE_NOT_FOUND quando o serviço não existe ou não pertence ao tenant do chamador', async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const adapter = new SupabaseServiceCatalogAdapter();

    await expect(
      adapter.updateService({ id: 'service-inexistente', referenceValueCents: 9000 }),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
  });
});
