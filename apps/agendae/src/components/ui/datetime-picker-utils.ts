/**
 * Funções puras de apoio aos componentes `DatePickerField`/`TimePickerField`
 * (BLG-095/BLG-096, DEC-155/DEC-157). Isoladas do componente visual para
 * serem testáveis sem renderizar nenhum elemento de UI.
 *
 * Convenções (mesmas já usadas em `app/agenda.tsx`/`app/clients.tsx`/
 * `app/payments.tsx`/`app/settings.tsx` — nenhuma nova é introduzida aqui):
 * - Datas de calendário são representadas como `Date` normalizadas em UTC
 *   (meia-noite UTC do dia civil), o mesmo truque já usado por
 *   `dateToUtc`/`utcToDate` em `agenda.tsx`, para evitar que o fuso do
 *   dispositivo desloque o dia exibido.
 * - Strings de data usam o formato `DD/MM/AAAA`; strings de hora usam
 *   `HH:MM` (24h) — os mesmos formatos já produzidos por `maskDate`/
 *   `maskTime`/`formatDateInput` em cada tela.
 */

/** Valores de hora do Seletor de Hora (00–23), Dante seção 6.3. */
export const HOURS: readonly number[] = Array.from({ length: 24 }, (_, index) => index);

/** Granularidade de minuto do Seletor de Hora (passos de 5, de 00 a 55). */
export const MINUTE_STEP_VALUES: readonly number[] = [
  0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
];

/** Quantas vezes o array de horas é repetido para simular o carrossel infinito (seção 6.5.1). */
export const HOUR_LOOP_REPEAT = 9;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Interpreta `DD/MM/AAAA`; devolve `null` se o formato ou a data forem inválidos. */
export function parseBrDate(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCDate() === day &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCFullYear() === year;
  return valid ? date : null;
}

/** Formata uma data (normalizada em UTC) como `DD/MM/AAAA`. */
export function formatBrDate(date: Date): string {
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** Interpreta `HH:MM`; devolve `null` se o formato ou os limites (0–23/0–59) forem inválidos. */
export function parseBrTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Formata hora/minuto como `HH:MM`. */
export function formatBrTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** `Date` normalizada em UTC representando o dia civil atual (independe de hora do relógio). */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Normaliza qualquer `Date` para meia-noite UTC do mesmo dia civil (componentes UTC). */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Monta a grade de células do mês (domingo primeiro, DEC-153), mesmo
 * algoritmo já usado em `agenda.tsx` (`calendarCells`): `null` preenche o
 * início/fim da grade 7×N para completar semanas.
 */
export function buildCalendarMatrix(year: number, month: number): (number | null)[] {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7) cells.push(null);
  return cells;
}

/**
 * Data inicial de abertura do calendário quando o campo está vazio (Dante,
 * seção 5.7): hoje, a menos que hoje esteja fora de `minDate`/`maxDate`,
 * caso em que abre no mês do limite mais próximo.
 */
export function initialCalendarAnchor(minDate?: Date, maxDate?: Date): Date {
  const today = todayUtc();
  if (minDate && today.getTime() < startOfUtcDay(minDate).getTime()) return startOfUtcDay(minDate);
  if (maxDate && today.getTime() > startOfUtcDay(maxDate).getTime()) return startOfUtcDay(maxDate);
  return today;
}

export function isDateDisabled(date: Date, minDate?: Date, maxDate?: Date): boolean {
  const time = date.getTime();
  if (minDate && time < startOfUtcDay(minDate).getTime()) return true;
  if (maxDate && time > startOfUtcDay(maxDate).getTime()) return true;
  return false;
}

/** Soma/subtrai meses ao par ano/mês, com virada de ano (0–11). */
export function addMonths(year: number, month: number, amount: number): { year: number; month: number } {
  const total = year * 12 + month + amount;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Arredonda o minuto para baixo até o múltiplo de 15 mais próximo (Dante, seção 6.7). */
export function roundDownToStep(hour: number, minute: number, step: number): { hour: number; minute: number } {
  const flooredMinute = Math.floor(minute / step) * step;
  return { hour, minute: flooredMinute };
}

/**
 * Arredonda o minuto para cima até o múltiplo de 15 mais próximo, com
 * virada de hora (e de dia, circular) quando o arredondamento ultrapassa 59
 * (Dante, seção 6.7 — evita que o usuário sempre precise rolar a partir de
 * `00:00`).
 */
export function roundUpToStep(hour: number, minute: number, step: number): { hour: number; minute: number } {
  const raw = Math.ceil(minute / step) * step;
  if (raw >= 60) return { hour: (hour + 1) % 24, minute: 0 };
  return { hour, minute: raw };
}

/** Avança/recua circularmente dentro de 0–23 (coluna de hora, seção 6.5.1: "gira"). */
export function nextHourValue(current: number, delta: number): number {
  return ((current + delta) % 24 + 24) % 24;
}

/** Avança/recua a coluna de minuto TRAVANDO em 00/45 (seção 6.5.1: "trava", nunca gira). */
export function nextMinuteValue(current: number, delta: number): number {
  const index = MINUTE_STEP_VALUES.indexOf(current);
  const base = index === -1 ? 0 : index;
  const next = Math.min(Math.max(base + delta, 0), MINUTE_STEP_VALUES.length - 1);
  return MINUTE_STEP_VALUES[next];
}

/** Constrói o array de dados do carrossel infinito de horas (`HOURS` repetido `HOUR_LOOP_REPEAT` vezes). */
export function buildLoopedHourData(): number[] {
  return Array.from({ length: HOUR_LOOP_REPEAT }, () => HOURS).flat();
}

/** Índice inicial (no array repetido) do bloco central, para abrir o carrossel sem estar perto de nenhuma borda real. */
export function initialLoopedHourIndex(value: number): number {
  const middleBlock = Math.floor(HOUR_LOOP_REPEAT / 2);
  return middleBlock * HOURS.length + value;
}

/** `true` quando o índice está perto o bastante da borda real do array repetido para precisar recentralizar. */
export function isNearLoopEdge(index: number): boolean {
  const block = Math.floor(index / HOURS.length);
  const safeMargin = 2;
  return block < safeMargin || block > HOUR_LOOP_REPEAT - 1 - safeMargin;
}

/** Recentraliza um índice do carrossel de horas de volta ao bloco central, preservando o valor exibido. */
export function recenterLoopedHourIndex(index: number): number {
  const value = ((index % HOURS.length) + HOURS.length) % HOURS.length;
  return initialLoopedHourIndex(value);
}
