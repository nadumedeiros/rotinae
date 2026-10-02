import type {
  Client,
  ClientNote,
  ClientListInput,
  ClientOverview,
  ClientPolicyRenewal,
  CreateClientInput,
  CreateClientNoteInput,
  ClientLinkInvitationDelivery,
  DecideLinkInput,
  LinkRequest,
  LinkReconciliationPreview,
  Page,
  ProviderLinkCodeSummary,
  RedeemedProviderLink,
  ClientProviderLink,
  RenewClientPolicyInput,
  RotatedLinkCode,
  UpdateClientInput,
  SendClientLinkInvitationInput,
} from "./types";

/**
 * Fronteira consumida pela experiência do prestador.
 * Identidade, provider/tenant e autorização são derivados da sessão no servidor.
 */
export interface ClientPortfolioPort {
  getOverview(): Promise<ClientOverview>;
  getClient(clientId: string): Promise<Client>;
  listClients(input: ClientListInput): Promise<Page<Client>>;
  createClient(input: CreateClientInput): Promise<Client>;
  updateClient(input: UpdateClientInput): Promise<Client>;
  /**
   * Renova o pacote do cliente: arquiva os valores antigos (com quanto foi
   * usado no ciclo encerrado) em histórico e reinicia, no servidor, a
   * contagem usada para o limite total de agendamentos a partir de agora.
   * Ver `renew_client_policy` (20260823150000_client_policy_renewal.sql).
   */
  renewClientPolicy(input: RenewClientPolicyInput): Promise<Client>;
  /** Histórico de renovações do cliente, mais recente primeiro. */
  listClientPolicyRenewals(clientId: string): Promise<ClientPolicyRenewal[]>;
  sendClientLinkInvitation(
    input: SendClientLinkInvitationInput,
  ): Promise<ClientLinkInvitationDelivery>;
  archiveClient(clientId: string): Promise<void>;

  getLinkCodeSummary(): Promise<ProviderLinkCodeSummary | null>;
  rotateLinkCode(): Promise<RotatedLinkCode>;
  redeemProviderLinkCode(code: string): Promise<RedeemedProviderLink>;
  listClientProviderLinks(): Promise<ClientProviderLink[]>;
  listPendingLinkRequests(input: {
    page: number;
    pageSize: 10;
  }): Promise<Page<LinkRequest>>;
  previewLinkReconciliation(requestId: string): Promise<LinkReconciliationPreview>;
  decideLinkRequest(input: DecideLinkInput): Promise<void>;
  revokeClientLink(clientId: string): Promise<void>;
  listClientNotes(clientId: string): Promise<ClientNote[]>;
  createClientNote(input: CreateClientNoteInput): Promise<ClientNote>;
  updateClientNote(noteId: string, content: string): Promise<ClientNote>;
  deleteClientNote(noteId: string): Promise<void>;
}
