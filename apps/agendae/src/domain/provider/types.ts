export type ProviderSettings = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  /**
   * Profissão/especialidade do prestador (ex.: "Personal Trainer",
   * "Adestrador(a)"). Texto livre opcional, sem lista fechada (RN-PRF-001–002,
   * docs/HANDOFF_UX_SERVICOS_DANTE.md, seção 12). Campo aditivo (DEC-137):
   * fonte de dado é `tenants.profession`, não `profiles` — ver justificativa
   * completa em
   * apps/agendae/supabase/migrations/20260813120000_provider_profession.sql.
   * `null`/ausente significa "não informado"; nunca bloqueia nenhum fluxo
   * (RN-PRF-004). Chave OPCIONAL de propósito (não apenas valor nulável):
   * `app/settings.tsx` ainda não foi religado a este campo (fora do escopo
   * desta entrega, cabe à ADA) e hoje monta `UpdateProviderSettingsInput`
   * sem essa propriedade — tornar a chave obrigatória quebraria essa tela
   * sem que esta mudança tivesse autorização para editá-la. O adapter trata
   * `undefined` da mesma forma que `null` (campo não informado).
   */
  profession?: string | null;
  /**
   * Dias da semana em que o prestador atende (RN-AGD-025/029,
   * BACKLOG.md DEC-139/BLG-080). Convenção JS `Date.getDay()` — 0=domingo,
   * 1=segunda, ..., 6=sábado —, a MESMA já usada por
   * `ClientBookingPolicy.allowedWeekdays`
   * (src/domain/agenda/client-booking-policy.ts) e por
   * `defaultProviderSchedule.allowedWeekdays` em `app/client-booking.tsx`,
   * para não exigir nenhuma tradução de convenção na camada de domínio.
   * Fonte de dado: `tenants.attendance_days` (smallint[], NOT NULL, default
   * com os 7 dias) — ver justificativa completa em
   * apps/agendae/supabase/migrations/20260813130000_provider_attendance_days.sql.
   * Nunca vazio quando lido do banco (constraint de banco garante isso);
   * chave OPCIONAL de propósito, mesmo padrão aditivo já usado para
   * `profession` (DEC-137): `app/settings.tsx` ainda não foi religado a este
   * campo (fora do escopo desta entrega, cabe à ADA) e hoje monta
   * `UpdateProviderSettingsInput` sem essa propriedade — tornar a chave
   * obrigatória quebraria essa tela sem que esta mudança tivesse
   * autorização para editá-la. O adapter trata `undefined` como "campo não
   * enviado nesta chamada" (a RPC preserva o valor já configurado no banco,
   * nunca esvazia); diferente de `profession`, `attendanceDays` nunca é
   * enviado como `null`/vazio de propósito, porque zero dias marcados é
   * sempre inválido (RN-AGD-025), reforçado também no banco.
   */
  attendanceDays?: number[];
  timezone: string;
  workdayStart: string;
  workdayEnd: string;
  minimumAdvanceHours: number;
  emailNotifications: boolean;
  pushNotifications: boolean;
  updatedAt: string;
};
export type UpdateProviderSettingsInput = Omit<
  ProviderSettings,
  "id" | "email" | "updatedAt"
>;
export type ProviderErrorCode =
  | "PROFILE_NOT_FOUND"
  | "NAME_INVALID"
  | "PHONE_INVALID"
  | "PROFESSION_INVALID"
  | "ATTENDANCE_DAYS_INVALID"
  | "TIMEZONE_INVALID"
  | "WORKING_HOURS_INVALID"
  | "ADVANCE_NOTICE_INVALID"
  | "FORBIDDEN"
  | "SESSION_EXPIRED"
  | "NETWORK_ERROR"
  | "UNKNOWN";
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
