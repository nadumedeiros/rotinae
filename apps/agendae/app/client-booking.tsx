import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { ClientMobileTabBar } from "@/src/components/layout/client-mobile-tab-bar";
import { AppIcon } from "@/src/components/ui/app-icon";
import { appointmentService } from "@/src/infra/agenda/supabase-appointment-adapter";
import { supabase } from "@/src/infra/supabase/client";
import {
  blockedSlotIds,
  hasAvailableTimeForDay,
  isDayAllowed,
  listTimesForDay,
  validatePlannedAppointment,
  type ClientBookingPolicy,
  type DailyBlockedInterval,
} from "@/src/domain/agenda/client-booking-policy";
import { zonedDateTimeToUtcIso } from "@/src/domain/agenda/timezone";
import { addMonths, buildCalendarMatrix, todayUtc } from "@/src/components/ui/datetime-picker-utils";
import { useClientAppointmentHorizon } from "@/src/hooks/use-provider-plan";
import {
  breakpoints,
  colors,
  elevation,
  layout,
  opacity,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";

type BookingService = { id: string; name: string; durationMinutes: number; referenceValueCents: number };
type BookingContext = {
  tenantId: string; providerId: string; providerName: string; clientId: string;
  /**
   * Profissão/especialidade do prestador (ex.: "Personal Trainer"), quando
   * informada (DEC-137). `null`/ausente é comportamento normal — nunca
   * bloqueia o agendamento (RN-PRF-004) e nunca gera placeholder na UI
   * (RN-PRF-005, docs/HANDOFF_UX_SERVICOS_DANTE.md seção 12.4).
   */
  profession: string | null;
  /**
   * Dias da semana em que o prestador atende (RN-AGD-025/029, DEC-139/
   * BLG-080, docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md). Convenção JS
   * `Date.getDay()` — 0=domingo, ..., 6=sábado —, a mesma já usada por
   * `ClientBookingPolicy.allowedWeekdays`. Vem de
   * `get_client_booking_context`; nunca deveria chegar vazio (o backend
   * rejeita zero dias marcados), mas ver defesa em profundidade em
   * `providerHasNoAttendanceDays` abaixo.
   */
  attendanceDays: number[];
  primaryServiceId: string | null; timezone: string; workdayStart: string; workdayEnd: string;
  minimumAdvanceHours: number; services: BookingService[];
  blocks: { startsAt: string; endsAt: string }[]; occupiedStartsAt: string[];
  /**
   * RN-AGD-030 (20260823140000_client_booking_context_request_window_limits.sql):
   * "Período para solicitar" configurado pelo prestador para ESTE cliente
   * (`clients.request_window_start`/`request_window_end`). `null` em
   * qualquer um dos dois = sem restrição de período — mesma convenção do
   * backend (`_create_appointment_row`/`OUTSIDE_ALLOWED_PERIOD`).
   */
  requestWindowStart: string | null;
  requestWindowEnd: string | null;
  /**
   * Limite total/diário de agendamentos não cancelados deste cliente com o
   * prestador (`clients.total_booking_limit`/`daily_booking_limit`).
   * `null` = sem limite. `totalBookingCount` é a contagem atual (mesma
   * regra usada pelo backend em `v_total_count`), calculada no momento do
   * carregamento do contexto.
   */
  totalBookingLimit: number | null;
  dailyBookingLimit: number | null;
  totalBookingCount: number;
};
const defaultProviderSchedule = {
  allowedWeekdays: [1, 2, 3, 4, 5],
  workdayStart: "08:00",
  workdayEnd: "18:00",
  intervalMinutes: "60",
};
const monthNames = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * Recorta um bloqueio de agenda (`starts_at`/`ends_at`, timestamptz) em um
 * `DailyBlockedInterval` por dia civil afetado, no fuso do prestador. Um
 * bloqueio quase sempre cabe em um único dia, mas o recorte cobre também o
 * caso de um bloqueio que atravessa a meia-noite no fuso do prestador.
 */
function blockToDailyIntervals(
  block: { startsAt: string; endsAt: string },
  timezone: string,
): DailyBlockedInterval[] {
  const start = new Date(block.startsAt);
  const end = new Date(block.endsAt);
  if (!(start.getTime() < end.getTime())) return [];
  const dayFormatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const minutesOfDay = (date: Date) => {
    const [hour, minute] = timeFormatter.format(date).split(":").map(Number);
    return hour * 60 + minute;
  };
  const startDateKey = dayFormatter.format(start);
  const endDateKey = dayFormatter.format(end);
  if (startDateKey === endDateKey) {
    return [
      {
        dateKey: startDateKey,
        startMinutes: minutesOfDay(start),
        endMinutes: minutesOfDay(end),
      },
    ];
  }
  const segments: DailyBlockedInterval[] = [
    { dateKey: startDateKey, startMinutes: minutesOfDay(start), endMinutes: 24 * 60 },
  ];
  let cursor = new Date(start);
  for (let guard = 0; guard < 366; guard += 1) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    const cursorKey = dayFormatter.format(cursor);
    if (cursorKey === endDateKey) {
      segments.push({ dateKey: endDateKey, startMinutes: 0, endMinutes: minutesOfDay(end) });
      break;
    }
    segments.push({ dateKey: cursorKey, startMinutes: 0, endMinutes: 24 * 60 });
  }
  return segments;
}

export default function ClientBookingScreen() {
  const [initialLoading, setInitialLoading] = useState(true);
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [provider, setProvider] = useState("");
  const [contexts, setContexts] = useState<BookingContext[]>([]);
  const providerSchedule = defaultProviderSchedule;
  const [selectedDay, setSelectedDay] = useState("");
  // Ano/mês (0-11) do mês exibido no calendário, mesma representação
  // ({ year, month }) usada por `addMonths`/`buildCalendarMatrix`
  // (`datetime-picker-utils.ts`) — evita reconstruir `Date` local a cada
  // navegação de mês, fonte do bug clássico de dia deslocado por fuso.
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = todayUtc();
    return { year: today.getUTCFullYear(), month: today.getUTCMonth() };
  });
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [exception, setException] = useState("");
  // Feedback visual de clique (padrão Nero): estado de pendência da
  // confirmação final do agendamento, setado de forma síncrona antes do
  // `await` e sempre resetado em `finally`.
  const [confirmingBooking, setConfirmingBooking] = useState(false);
  // Escopado por tenantId (prestador) — nunca um array plano compartilhado
  // entre prestadores. Cada contexto retornado por `get_client_booking_context`
  // traz seu próprio `occupiedStartsAt`; o horário ocupado do Prestador A não
  // pode marcar como indisponível o mesmo horário civil do Prestador B.
  const [unavailableSlotsByTenant, setUnavailableSlotsByTenant] = useState<
    Record<string, string[]>
  >({});
  const [plannedSlots, setPlannedSlots] = useState<
    { id: string; dateKey: string; date: string; time: string }[]
  >([]);
  const currentContext = contexts.find((item) => item.tenantId === provider);
  // RN-PLN-018/019/020 (20260819100000_provider_plan_horizon_limit.sql):
  // horizonte de agendamento do PLANO DO PRESTADOR selecionado — Gratuito
  // limitado a ~1 mês à frente, Premium sem teto. Otimização de UX do
  // calendário (`dayAvailable`); o servidor sempre revalida no envio
  // (`PLAN_LIMIT_REACHED`, tratado no `catch` de `confirmBooking`).
  const appointmentHorizon = useClientAppointmentHorizon(currentContext?.tenantId ?? null);
  const unavailableSlots = currentContext
    ? unavailableSlotsByTenant[currentContext.tenantId] ?? []
    : [];
  const selectedService = currentContext?.services.find((item) => item.id === currentContext.primaryServiceId) ?? currentContext?.services[0];
  const blockedIntervals = currentContext
    ? currentContext.blocks.flatMap((block) =>
        blockToDailyIntervals(block, currentContext.timezone),
      )
    : [];
  // RN-AGD-030: quantos itens da seleção ATUAL (ainda não confirmados) já
  // caem em cada dia — única contagem por-dia possível no frontend hoje
  // (ver limitação documentada em `ClientBookingPolicy.dailyBookingLimit`).
  const plannedCountsByDay = plannedSlots.reduce<Record<string, number>>(
    (acc, item) => {
      acc[item.dateKey] = (acc[item.dateKey] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const policy: ClientBookingPolicy = {
    // RN-AGD-025/029 (docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md seção 7.2):
    // mesmo padrão de fallback já usado para workdayStart/workdayEnd —
    // `providerSchedule.allowedWeekdays` só é usado enquanto o contexto real
    // ainda não carregou.
    allowedWeekdays: currentContext?.attendanceDays ?? providerSchedule.allowedWeekdays,
    startTime: currentContext?.workdayStart.slice(0, 5) ?? providerSchedule.workdayStart,
    endTime: currentContext?.workdayEnd.slice(0, 5) ?? providerSchedule.workdayEnd,
    intervalMinutes: selectedService?.durationMinutes ?? 60,
    publishedSlots: [],
    blockedIntervals,
    requestWindowStart: currentContext?.requestWindowStart ?? null,
    requestWindowEnd: currentContext?.requestWindowEnd ?? null,
    totalBookingLimit: currentContext?.totalBookingLimit ?? null,
    totalBookingCount: currentContext?.totalBookingCount ?? null,
    dailyBookingLimit: currentContext?.dailyBookingLimit ?? null,
    plannedCountsByDay,
  };
  // RN-AGD-030: limite total de agendamentos já atingido para este
  // prestador — o calendário inteiro fica bloqueado (via `isDayAllowed`),
  // mas o cliente precisa de uma explicação explícita em vez de só ver
  // todos os dias cinza (Nielsen #1, visibilidade do status do sistema).
  const totalLimitReached =
    !!currentContext &&
    currentContext.totalBookingLimit != null &&
    currentContext.totalBookingCount >= currentContext.totalBookingLimit;

  // BLG-077 (mesmo padrão já aprovado em `app/payments.tsx`, DEC-109/BLG-064):
  // sem isso, `contexts` só era buscado uma vez no mount/troca de mês — se o
  // prestador alterasse `attendanceDays`/horários/bloqueios enquanto o
  // cliente já estava com esta tela aberta (ou a app em segundo plano), a
  // política de agendamento exibida ficava presa ao dado antigo até o
  // cliente trocar de mês manualmente ou recarregar a página inteira.
  // `useFocusEffect` cobre tanto o mount inicial quanto o retorno de
  // navegação (Web e nativo); o listener de `AppState` cobre o app nativo
  // voltando do segundo plano sem perder o foco da rota.
  const loadContext = useCallback(async () => {
    const month = `${calendarMonth.year}-${String(calendarMonth.month + 1).padStart(2, "0")}`;
    try {
      const { data, error } = await supabase.rpc("get_client_booking_context", { p_month: month });
      if (error) throw error;
      const next = (data ?? []) as BookingContext[];
      setContexts(next);
      setProvider((current) => next.some((item) => item.tenantId === current) ? current : (next[0]?.tenantId ?? ""));
      // Escopado por tenantId: o horário ocupado de um prestador nunca deve
      // "contaminar" a disponibilidade de outro prestador que, por
      // coincidência, tenha uma vaga na mesma data/hora civil.
      const occupiedByTenant: Record<string, string[]> = {};
      for (const item of next) {
        occupiedByTenant[item.tenantId] = item.occupiedStartsAt.map((startsAt) => {
          const date = new Date(startsAt);
          const dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: item.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
          const time = new Intl.DateTimeFormat("pt-BR", { timeZone: item.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
          return `open-${dateKey}-${time}`;
        });
      }
      setUnavailableSlotsByTenant(occupiedByTenant);
    } catch (loadError) {
      setException(loadError instanceof Error ? loadError.message : "Não foi possível carregar os prestadores.");
    } finally {
      setInitialLoading(false);
    }
  }, [calendarMonth]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        void loadContext();
      }, 250);
      return () => clearTimeout(timer);
    }, [loadContext]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void loadContext();
      }
    });
    return () => subscription.remove();
  }, [loadContext]);
  const availableSlots = selectedDay
    ? listTimesForDay(policy, selectedDay)
    : policy.publishedSlots;
  const chosen = availableSlots.find((slot) => slot.id === selected);
  const visibleSlots = availableSlots.filter(
    (slot) => slot.dateKey === selectedDay,
  );
  const blockedSlotIdsForSelectedDay = selectedDay
    ? blockedSlotIds(policy, selectedDay)
    : [];
  const calendarYear = calendarMonth.year;
  const calendarMonthIndex = calendarMonth.month;
  // Mesma função usada pelo `DatePickerField` (`buildCalendarMatrix`),
  // ancorada em UTC — a grade de dias deixa de depender de `Date` local,
  // eliminando a segunda implementação divergente que existia aqui.
  const calendarCells = buildCalendarMatrix(calendarYear, calendarMonthIndex);
  function dayKey(day: number) {
    return `${calendarYear}-${String(calendarMonthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  function dateLabel(dateKey: string) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "UTC",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  function dayAvailable(day: number) {
    const candidate = new Date(calendarYear, calendarMonthIndex, day, 23, 59, 59);
    if (candidate < new Date())
      return false;
    // RN-PLN-018/019/020: horizonte de agendamento do plano do prestador —
    // dias além de `maxAllowedDate` só ficam desabilitados quando o
    // prestador está no Plano Gratuito (`unrestricted === false`); Premium
    // (ativo ou trial vigente) nunca aplica este teto.
    if (!appointmentHorizon.unrestricted && appointmentHorizon.maxAllowedDate) {
      const candidateUtcDate = new Date(Date.UTC(calendarYear, calendarMonthIndex, day));
      if (candidateUtcDate.getTime() > appointmentHorizon.maxAllowedDate.getTime()) return false;
    }
    const key = dayKey(day);
    return hasAvailableTimeForDay(policy, key, [
      ...unavailableSlots,
      ...blockedSlotIds(policy, key),
    ]);
  }
  function moveMonth(amount: number) {
    setCalendarMonth((current) => addMonths(current.year, current.month, amount));
    setSelectedDay("");
    setSelected("");
    setConfirmed(false);
  }

  function requestConfirmation() {
    if (!plannedSlots.length)
      return setException("Adicione pelo menos um dia e horário à seleção.");
    // Defesa em profundidade contra condição de corrida (ex.: o limite
    // total/diário foi atingido por OUTRO agendamento, ou o prestador
    // encurtou o período permitido, enquanto o cliente já navegava com
    // itens na seleção): revalida cada item planejado contra a política
    // ATUAL antes de abrir a revisão, em vez de deixar a confirmação falhar
    // de forma confusa lá na frente. A decisão final continua sempre do
    // backend — isto só evita abrir um modal fadado a falhar.
    if (plannedSlots.some((item) => unavailableSlots.includes(item.id))) {
      return setException(
        "Um dos horários selecionados acabou de ser ocupado. Remova-o da seleção e escolha outro horário.",
      );
    }
    const outdated = plannedSlots.some(
      (item) =>
        !isDayAllowed(policy, item.dateKey) ||
        !listTimesForDay(policy, item.dateKey).some(
          (slot) => slot.id === item.id,
        ),
    );
    if (outdated) {
      return setException(
        "Um dos agendamentos da sua seleção não está mais dentro do período ou limite permitido pelo prestador. Remova-o da lista e escolha outro horário.",
      );
    }
    setReviewOpen(true);
  }

  function addToPlan() {
    if (!chosen) return setException("Escolha um horário antes de adicionar.");
    const violation = validatePlannedAppointment({
      policy,
      candidate: chosen,
      planned: plannedSlots,
      unavailableIds: [...unavailableSlots, ...blockedSlotIdsForSelectedDay],
    });
    if (violation === "DUPLICATE_SLOT")
      return setException("Este horário já foi selecionado.");
    if (violation === "SLOT_UNAVAILABLE")
      return setException("Este horário acabou de ser ocupado.");
    if (violation)
      return setException(
        "Este dia ou horário não está liberado pelo prestador.",
      );
    setPlannedSlots((current) => [
      ...current,
      {
        id: chosen.id,
        dateKey: chosen.dateKey,
        date: dateLabel(chosen.dateKey),
        time: chosen.time,
      },
    ]);
    setSelected("");
  }

  async function confirmBooking() {
    if (
      !plannedSlots.length ||
      plannedSlots.some((item) => unavailableSlots.includes(item.id))
    ) {
      setReviewOpen(false);
      setException(
        "Não foi possível reservar esta vaga. Atualize a escolha e tente novamente.",
      );
      return;
    }
    if (!currentContext || !selectedService) {
      setReviewOpen(false);
      return setException("Este prestador ainda não possui um serviço disponível para agendamento.");
    }
    const starts = plannedSlots.map((item) =>
      zonedDateTimeToUtcIso(item.dateKey, item.time, currentContext.timezone),
    );
    setConfirmingBooking(true);
    try {
      await appointmentService.createAppointment({
        clientId: currentContext.clientId,
        serviceId: selectedService.id,
        title: null,
        startsAt: starts[0],
        timezone: currentContext.timezone,
        durationMinutes: selectedService.durationMinutes,
        clientMessage: null,
        internalNotes: null,
        requestedBy: "client",
        recurrence: starts.length > 1 ? { dates: starts } : undefined,
      });
      setUnavailableSlotsByTenant((current) => ({
        ...current,
        [currentContext.tenantId]: [
          ...(current[currentContext.tenantId] ?? []),
          ...plannedSlots.map((item) => item.id),
        ],
      }));
      setReviewOpen(false);
      setConfirmed(true);
      setSuccessOpen(true);
    } catch (bookingError) {
      setReviewOpen(false);
      setException(bookingError instanceof Error ? bookingError.message : "Não foi possível concluir o agendamento.");
    } finally {
      setConfirmingBooking(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {initialLoading && <PageLoadingOverlay />}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.mobile]}>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>NOVO AGENDAMENTO</Text>
            <Text style={[styles.title, !wide && styles.titleMobile]}>
              Escolha um horário
            </Text>
            <Text style={styles.subtitle}>
              Selecione primeiro o prestador e depois uma vaga publicada na
              agenda.
            </Text>
          </View>
          <View style={[styles.layout, wide && styles.layoutWide]}>
            <View style={[styles.main, !wide && styles.mainMobile]}>
              <View style={[styles.panel, !wide && styles.panelMobile]}>
                <Text style={styles.step}>1</Text>
                <View style={[styles.flex, !wide && styles.panelBodyMobile]}>
                  <Text style={styles.panelTitle}>
                    Com quem você quer agendar?
                  </Text>
                  <ScrollView
                    style={styles.providerViewport}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.providerOptions}
                  >
                    {contexts.map((context) => {
                      const contextService = context.services.find((serviceItem) => serviceItem.id === context.primaryServiceId) ?? context.services[0];
                      const initials = context.providerName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
                      return (
                      <Pressable
                        key={context.tenantId}
                        onPress={() => {
                          setProvider(context.tenantId);
                          setSelectedDay("");
                          setSelected("");
                          setPlannedSlots([]);
                          setConfirmed(false);
                        }}
                        style={[
                          styles.provider,
                          styles.providerCarouselCard,
                          provider === context.tenantId && styles.providerActive,
                        ]}
                      >
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>{initials}</Text>
                        </View>
                        <View style={styles.flex}>
                          <Text style={styles.providerName}>{context.providerName}</Text>
                          {!!context.profession && (
                            <Text style={styles.providerProfession}>{context.profession}</Text>
                          )}
                          <Text style={styles.providerService}>
                            {contextService ? `${contextService.name} · ${contextService.durationMinutes} min` : "Sem serviço ativo"}
                          </Text>
                        </View>
                        {provider === context.tenantId && (
                          <AppIcon
                            name="success"
                            size={20}
                            color={colors.success}
                          />
                        )}
                      </Pressable>
                    );})}
                  </ScrollView>
                </View>
              </View>
              <View style={[styles.panel, !wide && styles.panelMobile]}>
                <Text style={styles.step}>2</Text>
                <View style={[styles.flex, !wide && styles.panelBodyMobile]}>
                  <Text style={styles.panelTitle}>Escolha o dia</Text>
                  <View style={styles.modeNotice}>
                    <AppIcon name="schedule" size={18} color={colors.brand} />
                    <Text style={styles.modeNoticeText}>
                      Vagas específicas valem apenas para o dia em que foram
                      publicadas.
                    </Text>
                  </View>
                  <Text style={styles.helper}>
                    Nos outros dias, aparecem os horários definidos pelo
                    prestador nas configurações do perfil.
                  </Text>
                  {/*
                    Defesa em profundidade (RN-AGD-025,
                    docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md seção 4.1): o
                    backend já rejeita salvar zero dias de atendimento, então
                    isto não deveria ocorrer em operação normal — mas, se
                    `attendanceDays` chegar vazio por qualquer anomalia de
                    dado, o cliente recebe uma explicação em vez de um
                    calendário inteiro apagado sem nenhum aviso.
                  */}
                  {!!currentContext && currentContext.attendanceDays.length === 0 && (
                    <View style={styles.modeNotice}>
                      <AppIcon name="warning" size={18} color={colors.warning} />
                      <Text style={styles.modeNoticeText}>
                        Este prestador ainda não tem horários disponíveis
                        configurados. Tente novamente mais tarde.
                      </Text>
                    </View>
                  )}
                  {/*
                    RN-AGD-030 (20260823140000_client_booking_context_
                    request_window_limits.sql): limite total de
                    agendamentos já atingido bloqueia TODO o calendário
                    (`isDayAllowed`) — sem este aviso explícito, o cliente
                    veria só dias cinza sem entender o motivo (Nielsen #1,
                    visibilidade do status do sistema).
                  */}
                  {totalLimitReached && (
                    <View
                      style={[styles.modeNotice, styles.limitNoticeWarning]}
                    >
                      <AppIcon name="warning" size={18} color={colors.warning} />
                      <Text style={styles.modeNoticeText}>
                        Você atingiu o limite de{" "}
                        {currentContext?.totalBookingLimit} agendamento
                        {currentContext?.totalBookingLimit === 1 ? "" : "s"}{" "}
                        com este prestador. Fale com ele para renovar.
                      </Text>
                    </View>
                  )}
                  {/*
                    Aviso informativo do período liberado para este cliente
                    (RN-AGD-030) — só exibido quando o prestador configurou
                    uma janela restrita, para explicar por que dias fora
                    dela aparecem desabilitados no calendário.
                  */}
                  {!totalLimitReached &&
                    !!currentContext &&
                    (!!currentContext.requestWindowStart ||
                      !!currentContext.requestWindowEnd) && (
                      <View style={styles.modeNotice}>
                        <AppIcon name="schedule" size={18} color={colors.brand} />
                        <Text style={styles.modeNoticeText}>
                          Este prestador libera agendamentos para você
                          {currentContext.requestWindowStart
                            ? ` a partir de ${dateLabel(currentContext.requestWindowStart)}`
                            : ""}
                          {currentContext.requestWindowEnd
                            ? ` até ${dateLabel(currentContext.requestWindowEnd)}`
                            : ""}
                          .
                        </Text>
                      </View>
                    )}
                  <View style={styles.calendar}>
                    <View style={styles.calendarHeader}>
                      <Pressable
                        accessibilityLabel="Mês anterior"
                        onPress={() => moveMonth(-1)}
                        style={styles.calendarArrow}
                      >
                        <AppIcon name="back" size={16} color={colors.brand} />
                      </Pressable>
                      <Text style={styles.calendarTitle}>
                        {monthNames[calendarMonthIndex]} de {calendarYear}
                      </Text>
                      <Pressable
                        accessibilityLabel="Próximo mês"
                        onPress={() => moveMonth(1)}
                        style={styles.calendarArrow}
                      >
                        <AppIcon
                          name="forward"
                          size={16}
                          color={colors.brand}
                        />
                      </Pressable>
                    </View>
                    <View style={styles.weekRow}>
                      {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map(
                        (day) => (
                          <Text key={day} style={styles.weekLabel}>
                            {day}
                          </Text>
                        ),
                      )}
                    </View>
                    <View style={styles.calendarGrid}>
                      {calendarCells.map((day, index) =>
                        day === null ? (
                          <View
                            key={`empty-${index}`}
                            style={styles.calendarDay}
                          />
                        ) : (
                          <Pressable
                            key={day}
                            disabled={!dayAvailable(day)}
                            accessibilityLabel={`${day} de ${monthNames[calendarMonthIndex]} de ${calendarYear}${dayAvailable(day) ? ", disponível" : ", indisponível"}`}
                            accessibilityState={{
                              selected: selectedDay === dayKey(day),
                              disabled: !dayAvailable(day),
                            }}
                            onPress={() => {
                              setSelectedDay(dayKey(day));
                              setSelected("");
                              setConfirmed(false);
                            }}
                            style={[
                              styles.calendarDay,
                              dayAvailable(day) && styles.calendarDayAvailable,
                              (selectedDay === dayKey(day) ||
                                plannedSlots.some(
                                  (item) => item.date === dayKey(day),
                                )) &&
                                styles.calendarDaySelected,
                            ]}
                          >
                            <Text
                              style={[
                                styles.calendarDayText,
                                !dayAvailable(day) &&
                                  styles.calendarDayTextDisabled,
                                (selectedDay === dayKey(day) ||
                                  plannedSlots.some(
                                    (item) => item.date === dayKey(day),
                                  )) &&
                                  styles.calendarDayTextSelected,
                              ]}
                            >
                              {day}
                            </Text>
                            {dayAvailable(day) && (
                              <View
                                style={[
                                  styles.calendarDot,
                                  (selectedDay === dayKey(day) ||
                                    plannedSlots.some(
                                      (item) => item.date === dayKey(day),
                                    )) &&
                                    styles.calendarDotSelected,
                                ]}
                              />
                            )}
                          </Pressable>
                        ),
                      )}
                    </View>
                    <View style={styles.calendarLegend}>
                      <View style={styles.legendDot} />
                      <Text style={styles.legendText}>
                        Dia com disponibilidade
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
              <View
                style={[
                  styles.panel,
                  !wide && styles.panelMobile,
                  !selectedDay && styles.panelMuted,
                ]}
              >
                <Text style={styles.step}>3</Text>
                <View style={[styles.flex, !wide && styles.panelBodyMobile]}>
                  <Text style={styles.panelTitle}>Escolha o horário</Text>
                  <Text style={styles.helper}>
                    {selectedDay
                      ? `Vagas para ${dateLabel(selectedDay)}. Adicione uma e continue navegando pelos meses.`
                      : "Selecione um dia para ver os horários."}
                  </Text>
                  {selectedDay && (
                    <>
                      <View style={styles.slots}>
                        {visibleSlots.map((slot) => {
                          const unavailable =
                            unavailableSlots.includes(slot.id) ||
                            blockedSlotIdsForSelectedDay.includes(slot.id) ||
                            plannedSlots.some((item) => item.id === slot.id);
                          return (
                            <Pressable
                              key={slot.id}
                              disabled={unavailable}
                              accessibilityState={{
                                selected: selected === slot.id,
                                disabled: unavailable,
                              }}
                              onPress={() => {
                                setSelected(slot.id);
                                setConfirmed(false);
                              }}
                              style={[
                                styles.slot,
                                selected === slot.id && styles.slotActive,
                                unavailable && styles.slotUnavailable,
                              ]}
                            >
                              <View style={styles.slotDateBlock}>
                                <AppIcon
                                  name="calendar"
                                  size={16}
                                  color={colors.brand}
                                />
                                <Text style={styles.slotDate}>
                                  {dateLabel(slot.dateKey)}
                                </Text>
                              </View>
                              <Text
                                style={[
                                  styles.slotTime,
                                  selected === slot.id && styles.slotTimeActive,
                                ]}
                              >
                                {slot.time}
                              </Text>
                              {unavailable ? (
                                <Text style={styles.unavailableText}>
                                  Selecionado
                                </Text>
                              ) : (
                                selected === slot.id && (
                                  <AppIcon
                                    name="success"
                                    size={20}
                                    color={colors.success}
                                  />
                                )
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                      <Pressable
                        onPress={addToPlan}
                        style={[
                          styles.addPlanButton,
                          !chosen && styles.confirmDisabled,
                        ]}
                      >
                        <AppIcon name="add" size={16} color={colors.onBrand} />
                        <Text style={styles.addPlanButtonText}>
                          Adicionar à seleção
                        </Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            </View>
            <View
              style={[
                styles.summary,
                wide && styles.summaryDesktopSticky,
                !wide && styles.summaryMobile,
              ]}
            >
              <Text style={styles.summaryLabel}>RESUMO</Text>
              <Text style={styles.summaryTitle}>
                {selectedService?.name ?? "Sem serviço ativo"}
              </Text>
              <View style={styles.summaryRow}>
                <AppIcon name="provider" size={18} color={colors.brand} />
                <Text style={styles.summaryText}>
                  {currentContext?.providerName ? `com ${currentContext.providerName}` : "Selecione um prestador"}
                </Text>
              </View>
              <View style={styles.summaryDateRow}>
                <AppIcon name="calendar" size={18} color={colors.accentSoft} />
                <View style={styles.flex}>
                  <Text style={styles.summaryDateLabel}>DATA SELECIONADA</Text>
                  <Text style={styles.summaryDateText}>
                    {selectedDay
                      ? dateLabel(selectedDay)
                      : "Escolha uma data no calendário"}
                  </Text>
                </View>
              </View>
              <Text style={styles.planCount}>
                {plannedSlots.length} agendamento
                {plannedSlots.length === 1 ? "" : "s"} selecionado
                {plannedSlots.length === 1 ? "" : "s"}
              </Text>
              <View style={styles.planList}>
                {plannedSlots.map((item) => (
                  <View key={item.id} style={styles.planItem}>
                    <Text style={styles.planItemText}>
                      {item.date} · {item.time}
                    </Text>
                    <Pressable
                      onPress={() =>
                        setPlannedSlots((current) =>
                          current.filter((slot) => slot.id !== item.id),
                        )
                      }
                    >
                      <AppIcon
                        name="delete"
                        size={16}
                        color={colors.accentSoft}
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
              {confirmed ? (
                <View style={styles.success}>
                  <AppIcon name="success" size={20} color={colors.success} />
                  <Text style={styles.successText}>
                    Agendamentos confirmados!
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={requestConfirmation}
                  style={[
                    styles.confirm,
                    !plannedSlots.length && styles.confirmDisabled,
                  ]}
                >
                  <Text style={styles.confirmText}>Revisar agendamentos</Text>
                </Pressable>
              )}
              <Text style={styles.note}>
                As escolhas continuam salvas ao trocar de mês.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
      <ClientMobileTabBar />
      <Modal
        visible={reviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReviewOpen(false)}
      >
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.modal}>
            <View style={styles.modalIcon}>
              <AppIcon name="calendar" size={24} color={colors.brand} />
            </View>
            <Text style={styles.modalTitle}>
              Confirmar {plannedSlots.length} agendamento(s)?
            </Text>
            <Text style={styles.modalText}>
              As datas selecionadas podem atravessar meses diferentes.
            </Text>
            <ScrollView style={styles.successList} showsVerticalScrollIndicator={false}>
              {plannedSlots.map((item) => (
                <Text key={item.id} style={styles.modalPlanItem}>
                  {item.date} · {item.time}
                </Text>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                disabled={confirmingBooking}
                onPress={() => setReviewOpen(false)}
                style={[
                  styles.modalSecondary,
                  styles.formActionButton,
                  confirmingBooking && { opacity: opacity.disabled },
                ]}
              >
                <Text style={styles.modalSecondaryText}>Voltar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: confirmingBooking, busy: confirmingBooking }}
                disabled={confirmingBooking}
                onPress={() => void confirmBooking()}
                style={({ pressed }) => [
                  styles.modalPrimary,
                  styles.formActionButton,
                  styles.confirmButtonSpinnerRow,
                  pressed && !confirmingBooking && { opacity: opacity.pressed },
                ]}
              >
                {confirmingBooking && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.modalPrimaryText}>Confirmar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={!!exception}
        transparent
        animationType="fade"
        onRequestClose={() => setException("")}
      >
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.modal}>
            <View style={[styles.modalIcon, styles.modalIconWarning]}>
              <AppIcon name="warning" size={24} color={colors.warning} />
            </View>
            <Text style={styles.modalTitle}>Revise o agendamento</Text>
            <Text accessibilityRole="alert" style={styles.modalText}>
              {exception}
            </Text>
            <Pressable
              onPress={() => setException("")}
              style={[styles.modalPrimary, styles.modalPrimaryStandalone]}
            >
              <Text style={styles.modalPrimaryText}>Entendi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={successOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessOpen(false)}
      >
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.modal}>
            <View style={[styles.modalIcon, styles.successModalIcon]}>
              <AppIcon name="success" size={24} color={colors.success} />
            </View>
            <Text style={styles.modalTitle}>Agendamentos confirmados!</Text>
            <Text style={styles.modalText}>
              {plannedSlots.length} agendamento(s) foram registrados. O
              prestador recebeu uma notificação individual para cada horário.
            </Text>
            <ScrollView style={styles.successList}>
              {plannedSlots.map((item) => (
                <Text key={item.id} style={styles.modalPlanItem}>
                  {item.date} · {item.time}
                </Text>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => setSuccessOpen(false)}
              style={[styles.modalPrimary, styles.modalPrimaryStandalone]}
            >
              <Text style={styles.modalPrimaryText}>Concluir</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  mainMobile: {
    width: "100%",
    alignSelf: "stretch",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
  },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  panelMobile: {
    flexDirection: "column",
    alignItems: "stretch",
    alignSelf: "stretch",
    width: "100%",
    padding: spacing.md,
  },
  panelBodyMobile: {
    width: "100%",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
  },
  providerViewport: {
    width: "100%",
    height: 92,
    flexGrow: 0,
    flexShrink: 0,
    marginTop: spacing.md,
  },
  providerCarouselCard: {
    width: 272,
    minHeight: 76,
    flexShrink: 0,
  },
  successModalIcon: { backgroundColor: colors.successSoft },
  successList: { maxHeight: 220 },
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1 },
  content: {
    width: "100%",
    maxWidth: layout.contentMax,
    alignSelf: "center",
    padding: spacing.xl,
    gap: spacing.lg,
  },
  mobile: { padding: spacing.md, paddingTop: spacing.lg },
  heading: { gap: spacing.xs },
  eyebrow: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.1,
  },
  title: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 36,
    lineHeight: 42,
  },
  titleMobile: { fontSize: 30, lineHeight: 36 },
  subtitle: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
  },
  layout: { gap: spacing.lg },
  layoutWide: { flexDirection: "row", alignItems: "flex-start" },
  main: { flex: 1.5, gap: spacing.md },
  panel: {
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  panelMuted: { opacity: 0.7 },
  step: {
    width: 32,
    height: 32,
    textAlign: "center",
    lineHeight: 32,
    borderRadius: radius.pill,
    overflow: "hidden",
    backgroundColor: colors.brand,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  flex: { flex: 1, minWidth: 0 },
  panelTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  helper: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  modeNotice: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  modeNoticeText: {
    flex: 1,
    color: colors.brandDark,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  // RN-AGD-030: aviso de limite total de agendamentos atingido — bloqueia
  // TODO o calendário, então usa a mesma paleta de aviso (`warningSoft`)
  // já usada em `modalIconWarning`, em vez do azul neutro de `modeNotice`.
  limitNoticeWarning: { backgroundColor: colors.warningSoft },
  providerOptions: {
    gap: spacing.sm,
    paddingRight: spacing.md,
    paddingBottom: spacing.xs,
  },
  provider: {
    minHeight: 68,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  providerActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  avatarText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  providerName: { color: colors.ink, fontFamily: typography.family.bold },
  providerProfession: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  providerService: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  calendar: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  calendarArrow: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  calendarTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
    textTransform: "capitalize",
  },
  weekRow: { marginTop: spacing.md, flexDirection: "row" },
  weekLabel: {
    width: "14.285%",
    textAlign: "center",
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: 9,
  },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarDay: {
    width: "14.285%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  calendarDayAvailable: { backgroundColor: colors.surface },
  calendarDaySelected: { backgroundColor: colors.brand },
  calendarDayText: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  calendarDayTextDisabled: { color: colors.mutedSoft, opacity: 0.45 },
  calendarDayTextSelected: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  calendarDot: {
    width: 4,
    height: 4,
    marginTop: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  calendarDotSelected: { backgroundColor: colors.onBrand },
  calendarLegend: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  legendText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: 10,
  },
  slots: { marginTop: spacing.md, gap: spacing.sm },
  slot: {
    minHeight: 64,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  slotActive: {
    borderWidth: 2,
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  slotUnavailable: { opacity: 0.5 },
  slotDateBlock: {
    flex: 1,
    minWidth: 160,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  slotDate: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    textTransform: "capitalize",
  },
  slotTime: {
    marginLeft: "auto",
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  slotTimeActive: { color: colors.brand },
  unavailableText: {
    color: colors.danger,
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  addPlanButton: {
    minHeight: 46,
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  addPlanButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  summary: {
    flex: 0.75,
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brandDark,
    ...elevation.card,
  },
  summaryDesktopSticky: {
    position: "sticky" as "absolute",
    top: spacing.lg,
    alignSelf: "flex-start",
    zIndex: 2,
  },
  summaryMobile: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    alignSelf: "stretch",
    width: "100%",
  },
  summaryLabel: {
    color: colors.accentSoft,
    fontFamily: typography.family.bold,
    fontSize: 10,
    letterSpacing: 1,
  },
  summaryTitle: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  summaryText: {
    flex: 1,
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
  },
  summaryDateRow: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brandMid,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  summaryDateLabel: {
    color: colors.accentSoft,
    fontFamily: typography.family.bold,
    fontSize: 9,
    letterSpacing: 0.7,
  },
  summaryDateText: {
    marginTop: spacing.xs,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
    textTransform: "capitalize",
  },
  planCount: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  planList: { gap: spacing.xs },
  planItem: {
    paddingVertical: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.brandMid,
  },
  planItemText: {
    color: colors.accentSoft,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  confirm: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.onBrand,
  },
  confirmDisabled: { opacity: 0.45 },
  confirmText: { color: colors.brandDark, fontFamily: typography.family.bold },
  note: {
    textAlign: "center",
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
    fontSize: 10,
  },
  success: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.successSoft,
  },
  successText: { color: colors.success, fontFamily: typography.family.bold },
  backdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 12, 38, 0.58)",
  },
  modal: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "90%",
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  modalIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  modalIconWarning: { backgroundColor: colors.warningSoft },
  modalTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    textAlign: "center",
  },
  modalText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  modalPlanItem: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    color: colors.brandDark,
    fontFamily: typography.family.bold,
  },
  modalActions: { width: "100%", flexDirection: "column-reverse", gap: spacing.sm },
  // Layout auxiliar aplicado inline ao botão "Confirmar" do modal de revisão
  // para acomodar o `ActivityIndicator` de loading ao lado do texto, sem
  // alterar a altura/estrutura do botão (mesmo padrão de `app/agenda.tsx`).
  confirmButtonSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  modalSecondary: {
    minHeight: 48,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  modalSecondaryText: {
    color: colors.muted,
    fontFamily: typography.family.bold,
  },
  modalPrimary: {
    minHeight: 48,
    flex: 1,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  modalPrimaryStandalone: {
    width: "100%",
    flexGrow: 0,
    flexShrink: 0,
  },
  modalPrimaryText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
});
