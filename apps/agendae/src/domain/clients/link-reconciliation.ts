export type ReconciliationRecord = {
  id: string;
  email: string;
  phone: string | null;
  clientUserId: string | null;
};

export type ReconciliationIdentity = {
  verifiedEmail: string;
  verifiedPhone?: string | null;
};

export type ReconciliationResult =
  | { action: 'attach_existing'; clientId: string }
  | { action: 'create_new' }
  | { action: 'manual_review'; candidateIds: string[] }
  | { action: 'reject_conflict'; clientId: string };

const normalizeEmail = (value: string) => value.trim().toLocaleLowerCase('pt-BR');

/** Classificação local para prévia. A decisão e associação finais são sempre transacionais no servidor. */
export function classifyClientReconciliation(records: ReconciliationRecord[], identity: ReconciliationIdentity): ReconciliationResult {
  const emailMatches = records.filter((record) => normalizeEmail(record.email) === normalizeEmail(identity.verifiedEmail));
  if (emailMatches.length > 1) return { action: 'manual_review', candidateIds: emailMatches.map((record) => record.id) };
  if (emailMatches.length === 1) {
    const candidate = emailMatches[0];
    return candidate.clientUserId
      ? { action: 'reject_conflict', clientId: candidate.id }
      : { action: 'attach_existing', clientId: candidate.id };
  }
  const phoneMatches = identity.verifiedPhone
    ? records.filter((record) => record.phone === identity.verifiedPhone)
    : [];
  if (phoneMatches.length) return { action: 'manual_review', candidateIds: phoneMatches.map((record) => record.id) };
  return { action: 'create_new' };
}
