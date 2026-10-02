import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260903120000_financial_monthly_history.sql'),
  'utf8',
).replace(/--.*$/gm, '');

describe('manual payments RLS migration', () => {
  it('requires the client and payment to belong to the same tenant', () => {
    expect(source).toMatch(/where\s+c\.id\s*=\s*manual_payments\.client_id/);
    expect(source).toMatch(/c\.tenant_id\s*=\s*manual_payments\.tenant_id/);
    expect(source).not.toMatch(/c\.tenant_id\s*=\s*tenant_id\b/);
  });
});
