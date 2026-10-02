import { classifyClientReconciliation } from '../link-reconciliation';

const base = { id: 'client-1', email: 'maria@example.com', phone: '+5511999999999', clientUserId: null };

describe('classifyClientReconciliation', () => {
  it('associa cadastro interno por e-mail verificado', () => expect(classifyClientReconciliation([base], { verifiedEmail: ' MARIA@example.com ' })).toEqual({ action: 'attach_existing', clientId: 'client-1' }));
  it('rejeita cadastro já associado a outra identidade', () => expect(classifyClientReconciliation([{ ...base, clientUserId: 'user-existing' }], { verifiedEmail: 'maria@example.com' })).toEqual({ action: 'reject_conflict', clientId: 'client-1' }));
  it('não mescla automaticamente somente por telefone', () => expect(classifyClientReconciliation([base], { verifiedEmail: 'other@example.com', verifiedPhone: '+5511999999999' })).toEqual({ action: 'manual_review', candidateIds: ['client-1'] }));
  it('exige revisão quando existem e-mails internos duplicados', () => expect(classifyClientReconciliation([base, { ...base, id: 'client-2' }], { verifiedEmail: 'maria@example.com' })).toEqual({ action: 'manual_review', candidateIds: ['client-1', 'client-2'] }));
  it('cria novo cadastro quando não encontra correspondência', () => expect(classifyClientReconciliation([base], { verifiedEmail: 'new@example.com' })).toEqual({ action: 'create_new' }));
});
