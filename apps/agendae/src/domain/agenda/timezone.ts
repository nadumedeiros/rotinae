/**
 * Converte uma data/hora "de parede" (o que o usuário vê e escolhe na tela,
 * ex. `dateKey="2026-08-20"`, `time="14:30"`) para o instante UTC
 * correspondente, usando o fuso IANA do TENANT — nunca o fuso do
 * dispositivo que está executando o código.
 *
 * ## Bug que esta função corrige
 * `new Date(\`${dateKey}T${time}:00\`).toISOString()` (usado antes em
 * `app/client-booking.tsx#confirmBooking` e em
 * `app/agenda.tsx#localDateTimeToIso`) interpreta a string de data/hora no
 * fuso do DISPOSITIVO do usuário, não no fuso configurado em
 * `tenants.timezone`. Esse é o mesmo fuso que as RPCs de agendamento usam
 * para validar `minimum_bookable_instant` e o dia de atendimento
 * (`ATTENDANCE_DAY_UNAVAILABLE`). Se o fuso do dispositivo divergir do fuso
 * do tenant, o `starts_at` persistido pode cair em um dia civil diferente
 * do que o usuário efetivamente escolheu.
 *
 * ## Implementação
 * Usa somente `Intl.DateTimeFormat` (nenhuma biblioteca externa de fuso
 * horário está instalada no projeto). Técnica de "palpite com correção por
 * offset":
 * 1. Monta um palpite (`target`) tratando a data/hora de parede pedida como
 *    se já fosse um instante UTC.
 * 2. Formata esse palpite no fuso de destino e mede a diferença entre o que
 *    ele mostraria e o que foi pedido — essa diferença é o offset real do
 *    fuso naquele instante.
 * 3. Corrige o palpite por esse offset. Repete uma segunda vez porque o
 *    offset que importa é o vigente no INSTANTE FINAL, não no palpite
 *    inicial — a segunda iteração cobre o caso em que os dois instantes
 *    caem em lados opostos de uma transição de horário de verão (DST).
 *
 * ## Limitação conhecida
 * Horários de parede que não existem por causa de um "salto" de DST (ex.
 * 02:30 no dia em que o relógio avança em `America/New_York`) não têm um
 * instante UTC exato correspondente; o resultado nesses casos é o instante
 * mais próximo que a correção de offset conseguir convergir, não um erro.
 * Isso é uma ambiguidade inerente ao próprio conceito de DST, não uma falha
 * do algoritmo, e não afeta o fuso padrão do projeto (`America/Sao_Paulo`,
 * sem DST desde 2019).
 */
export function zonedDateTimeToUtcIso(
  dateKey: string,
  time: string,
  timeZone: string,
): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new Error(
      `zonedDateTimeToUtcIso: dateKey/time em formato inesperado (dateKey="${dateKey}", time="${time}"). Esperado dateKey="YYYY-MM-DD" e time="HH:MM".`,
    );
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  // Palpite inicial: data/hora de parede pedida, tratada como se já fosse UTC.
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);

  let instant = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const wallAtInstant = wallTimeAsUtcMillis(instant, timeZone);
    const offset = wallAtInstant - instant;
    instant = target - offset;
  }

  return new Date(instant).toISOString();
}

/**
 * Lê a hora de parede exibida em `timeZone` no instante `utcMillis` e a
 * reinterpreta como se já fosse UTC, devolvendo o resultado em
 * milissegundos. É um valor fictício, útil apenas para calcular a diferença
 * (offset) entre o que o fuso mostra e o instante real — nunca deve ser
 * exposto como um instante válido fora desta função.
 */
function wallTimeAsUtcMillis(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMillis));

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? "0");

  const hour = part("hour");

  return Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    // Alguns motores ICU antigos retornam "24" em vez de "00" para meia-noite
    // mesmo com hourCycle "h23"; normaliza defensivamente.
    hour === 24 ? 0 : hour,
    part("minute"),
    0,
  );
}
