export type PublishedSlot = { id: string; dateKey: string; time: string };
/**
 * Recorte diário de um bloqueio de agenda (`availability_blocks`), já convertido
 * para minutos desde 00:00 no fuso do prestador. Um bloqueio bruto (`starts_at`/
 * `ends_at`, timestamptz) pode atravessar mais de um dia civil; quem monta a
 * política (camada de UI, que já conhece o fuso do prestador) é responsável por
 * recortar o intervalo em um `DailyBlockedInterval` por dia afetado.
 */
export type DailyBlockedInterval = {
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
};
export type ClientBookingPolicy = {
  allowedWeekdays: number[];
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  publishedSlots: PublishedSlot[];
  /** Bloqueios de agenda do prestador que se sobrepõem ao horário de cada vaga. */
  blockedIntervals?: DailyBlockedInterval[];
  /**
   * "Período para solicitar" (RN-AGD-030) configurado pelo prestador para
   * ESTE cliente especificamente (`clients.request_window_start`/
   * `request_window_end`, formato `YYYY-MM-DD`). `null`/ausente em qualquer
   * um dos dois = sem restrição de período, mesma convenção usada pelo
   * backend (`_create_appointment_row`/`OUTSIDE_ALLOWED_PERIOD`).
   */
  requestWindowStart?: string | null;
  requestWindowEnd?: string | null;
  /**
   * Limite total de agendamentos NÃO CANCELADOS deste cliente com o
   * prestador (`clients.total_booking_limit`). `null`/ausente = sem limite.
   * Uma vez atingido, bloqueia QUALQUER dia — não apenas um dia específico
   * — porque o próximo agendamento, em qualquer data, seria rejeitado pelo
   * backend com `TOTAL_LIMIT_REACHED`.
   */
  totalBookingLimit?: number | null;
  /**
   * Contagem atual de agendamentos não cancelados deste cliente,
   * comparável a `totalBookingLimit` (mesma regra de `v_total_count` em
   * `_create_appointment_row`). Vem pronta do backend
   * (`get_client_booking_context`), calculada no momento do carregamento —
   * pode ficar desatualizada se outro agendamento for confirmado enquanto
   * o cliente navega (ver defesa em profundidade na revisão final, em
   * `app/client-booking.tsx`).
   */
  totalBookingCount?: number | null;
  /**
   * Limite diário de agendamentos não cancelados deste cliente com o
   * prestador (`clients.daily_booking_limit`). `null`/ausente = sem
   * limite.
   *
   * LIMITAÇÃO CONHECIDA (documentada em vez de aproximada): não é possível
   * calcular no frontend, com os dados hoje retornados por
   * `get_client_booking_context`, quantos agendamentos NÃO CANCELADOS este
   * cliente específico já possui em cada dia — `BookingContext.
   * occupiedStartsAt` é agregado por PRESTADOR (todos os clientes
   * combinados, sem `client_id`) e o backend só expõe a contagem GERAL
   * (`totalBookingCount`), sem quebra por dia. Por isso, `isDayAllowed`
   * só consegue aplicar este limite contra `plannedCountsByDay` (ver
   * abaixo) — os agendamentos que o PRÓPRIO cliente está adicionando à
   * seleção atual, nesta mesma sessão — e não contra agendamentos já
   * confirmados em sessões anteriores para o mesmo dia. A validação
   * completa e definitiva continua exclusivamente no backend
   * (`DAILY_LIMIT_REACHED`).
   */
  dailyBookingLimit?: number | null;
  /**
   * Quantos itens já adicionados à seleção atual (`plannedSlots`, ainda não
   * confirmados) caem em cada `dateKey`. Calculado pelo chamador
   * (`app/client-booking.tsx`) a partir do próprio estado local — não
   * requer nova chamada ao backend. Usado só para aplicar `dailyBookingLimit`
   * dentro da sessão corrente (ver limitação documentada acima).
   */
  plannedCountsByDay?: Record<string, number>;
};

export type PlannedClientAppointment = {
  id: string;
  dateKey: string;
  time: string;
};
export type BookingPolicyError =
  | "DAY_NOT_ALLOWED"
  | "TIME_NOT_ALLOWED"
  | "SLOT_NOT_PUBLISHED"
  | "DUPLICATE_SLOT"
  | "SLOT_UNAVAILABLE";

const minutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

export function isDayAllowed(policy: ClientBookingPolicy, dateKey: string) {
  // RN-AGD-030: limite total já atingido bloqueia QUALQUER dia — checado
  // antes até de vaga publicada, porque nenhum agendamento novo passaria
  // pelo backend independentemente do dia escolhido.
  if (
    policy.totalBookingLimit != null &&
    policy.totalBookingCount != null &&
    policy.totalBookingCount >= policy.totalBookingLimit
  )
    return false;
  // RN-AGD-030: período ("Período para solicitar") configurado pelo
  // prestador para este cliente. Comparação lexicográfica de strings
  // `YYYY-MM-DD` é segura (mesmo formato/largura fixa em ambos os lados).
  if (policy.requestWindowStart && dateKey < policy.requestWindowStart)
    return false;
  if (policy.requestWindowEnd && dateKey > policy.requestWindowEnd)
    return false;
  // Limite diário — só cobre o que a sessão atual já colocou na seleção
  // (ver limitação documentada em `ClientBookingPolicy.dailyBookingLimit`).
  if (
    policy.dailyBookingLimit != null &&
    (policy.plannedCountsByDay?.[dateKey] ?? 0) >= policy.dailyBookingLimit
  )
    return false;
  if (policy.publishedSlots.some((slot) => slot.dateKey === dateKey))
    return true;
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return policy.allowedWeekdays.includes(weekday);
}

export function listTimesForDay(
  policy: ClientBookingPolicy,
  dateKey: string,
): PublishedSlot[] {
  if (!isDayAllowed(policy, dateKey)) return [];
  const publishedForDay = policy.publishedSlots.filter(
    (slot) => slot.dateKey === dateKey,
  );
  if (publishedForDay.length) return publishedForDay;
  const result: PublishedSlot[] = [];
  for (
    let current = minutes(policy.startTime);
    current < minutes(policy.endTime);
    current += policy.intervalMinutes
  ) {
    const time = `${String(Math.floor(current / 60)).padStart(2, "0")}:${String(current % 60).padStart(2, "0")}`;
    result.push({ id: `open-${dateKey}-${time}`, dateKey, time });
  }
  return result;
}

/**
 * Ids das vagas do dia que caem, total ou parcialmente, dentro de algum
 * bloqueio de agenda do prestador. Segue o mesmo formato de id usado para
 * `occupiedStartsAt` (`open-{dateKey}-{time}`), permitindo que o chamador
 * combine os dois conjuntos em uma única lista de indisponibilidade.
 */
export function blockedSlotIds(
  policy: ClientBookingPolicy,
  dateKey: string,
): string[] {
  const intervals = (policy.blockedIntervals ?? []).filter(
    (block) => block.dateKey === dateKey,
  );
  if (!intervals.length) return [];
  return listTimesForDay(policy, dateKey)
    .filter((slot) => {
      const slotStart = minutes(slot.time);
      const slotEnd = slotStart + policy.intervalMinutes;
      return intervals.some(
        (block) => slotStart < block.endMinutes && slotEnd > block.startMinutes,
      );
    })
    .map((slot) => slot.id);
}

/**
 * Indica se ainda resta ao menos um horário disponível no dia depois de
 * remover as vagas já ocupadas (`unavailableIds`, tipicamente
 * `occupiedStartsAt` + `blockedSlotIds`). Usado para decidir se o dia deve
 * aparecer como disponível no calendário — um bloqueio parcial não torna o
 * dia indisponível, mas um bloqueio que cobre todo o expediente (ou some
 * com as últimas vagas livres) sim.
 */
export function hasAvailableTimeForDay(
  policy: ClientBookingPolicy,
  dateKey: string,
  unavailableIds: string[] = [],
): boolean {
  if (!isDayAllowed(policy, dateKey)) return false;
  return listTimesForDay(policy, dateKey).some(
    (slot) => !unavailableIds.includes(slot.id),
  );
}

export function validatePlannedAppointment(input: {
  policy: ClientBookingPolicy;
  candidate: PlannedClientAppointment;
  planned: PlannedClientAppointment[];
  unavailableIds?: string[];
}): BookingPolicyError | null {
  const { policy, candidate, planned, unavailableIds = [] } = input;
  if (planned.some((item) => item.id === candidate.id)) return "DUPLICATE_SLOT";
  if (unavailableIds.includes(candidate.id)) return "SLOT_UNAVAILABLE";
  if (!isDayAllowed(policy, candidate.dateKey)) return "DAY_NOT_ALLOWED";
  if (
    !listTimesForDay(policy, candidate.dateKey).some(
      (slot) => slot.id === candidate.id && slot.time === candidate.time,
    )
  )
    return policy.publishedSlots.some(
      (slot) => slot.dateKey === candidate.dateKey,
    )
      ? "SLOT_NOT_PUBLISHED"
      : "TIME_NOT_ALLOWED";
  return null;
}
