import type {
  CreateServiceInput,
  Service,
  ServiceListQuery,
  UpdateServiceInput,
} from "./types";

/**
 * Fronteira consumida pela gestão de serviços do prestador (RF-CAD-004).
 * Tenant e autorização são derivados da sessão no servidor, nunca do corpo
 * da requisição — mesma convenção de `ClientPortfolioPort`.
 *
 * Não existe tela consumindo esta porta ainda: o contrato existe para
 * desbloquear o schema/adapter do Cris antes de a tela de gestão de
 * serviços ser desenhada (recomenda-se Dante para o fluxo e Nero para a UI)
 * e implementada — mesma lógica já usada para `AppointmentPort`, que tem
 * contrato e adaptador local sem depender de uma tela nova para existir.
 * `AppointmentRecord.serviceId` já pressupõe este catálogo.
 *
 * `activateService`/`deactivateService` são idempotentes: chamar a operação
 * sobre um serviço que já está no status alvo devolve o registro sem erro,
 * em vez de lançar um código de "já está ativo/inativo".
 *
 * Nunca há exclusão física (mesma convenção de `archiveClient`): um serviço
 * inativo permanece consultável para preservar a integridade de
 * `AppointmentRecord.serviceId` em agendamentos históricos e de
 * `Client.primaryServiceId` em clientes que o referenciem como padrão.
 */
export interface ServiceCatalogPort {
  listServices(query?: ServiceListQuery): Promise<Service[]>;
  getService(id: string): Promise<Service>;
  createService(input: CreateServiceInput): Promise<Service>;
  updateService(input: UpdateServiceInput): Promise<Service>;
  activateService(id: string): Promise<Service>;
  deactivateService(id: string): Promise<Service>;
}
