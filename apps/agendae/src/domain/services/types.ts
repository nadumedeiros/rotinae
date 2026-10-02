export type ServiceStatus = "active" | "inactive";

/**
 * Catálogo de serviços do prestador (RF-CAD-004, RN-AGD-002, RN-AGD-003).
 *
 * Isolamento por tenant é responsabilidade do servidor (RLS), assim como em
 * `Client`: o tipo não carrega `tenantId` porque a interface nunca decide
 * nem confere isolamento — apenas `AppointmentRecord` (contrato anterior a
 * este catálogo) mantém esse campo por convenção própria já implementada.
 */
export type Service = {
  id: string;
  name: string;
  /** Minutos inteiros, maior que zero. Usada para calcular slots de agenda (RN-AGD-002, RN-AGD-003). */
  durationMinutes: number;
  /**
   * Valor de referência em centavos ("de tabela"), não um histórico.
   * `AppointmentRecord.valueCentsSnapshot` copia este valor no instante da
   * confirmação (RN-AGD-023, `docs/HANDOFF_AGENDA_CRIS.md`) e pode divergir
   * dele depois que o prestador reajustar o catálogo — alterar este campo
   * nunca reescreve snapshots já gravados em agendamentos existentes.
   */
  referenceValueCents: number;
  status: ServiceStatus;
  /**
   * `true` somente para o serviço "Atendimento padrão" auto-provisionado por
   * tenant (DEC-163, `seed_default_standard_service()`,
   * `20260825130000_default_standard_service_provision.sql`). Campo aditivo:
   * ausente em qualquer linha que não seja essa (o banco sempre devolve
   * `false`, nunca `null`, então nenhum consumidor precisa tratar ausência).
   * Serve para o frontend localizar/destacar o serviço padrão sem comparar
   * por nome — o prestador pode renomear este serviço livremente depois de
   * criado, e `isDefault` continua `true`.
   */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateServiceInput = {
  name: string;
  durationMinutes: number;
  referenceValueCents: number;
};

export type UpdateServiceInput = Partial<CreateServiceInput> & { id: string };

/**
 * Sem paginação: o catálogo de um prestador tende a poucas dezenas de
 * registros (serviços são itens curados, não um histórico transacional como
 * clientes/agendamentos). Uma lista simples, filtrável por status, é
 * suficiente para preencher seletores em telas de cliente e de agenda sem
 * exigir paginação no servidor. Revisar para paginação real se o volume
 * observado invalidar essa premissa (YAGNI).
 */
export type ServiceListQuery = {
  status?: ServiceStatus;
};

export type ServiceErrorCode =
  | "SERVICE_NOT_FOUND"
  | "SERVICE_NAME_INVALID"
  | "SERVICE_NAME_CONFLICT"
  | "DURATION_INVALID"
  | "VALUE_INVALID"
  | "FORBIDDEN"
  | "SESSION_EXPIRED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
