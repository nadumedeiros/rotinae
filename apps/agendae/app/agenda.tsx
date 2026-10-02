import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { RowActionsMenu, useRowActionsMenu } from "@/src/components/ui/row-actions-menu";
import { AppIcon } from "@/src/components/ui/app-icon";
import { AppointmentStatusActionModals } from "@/src/components/agenda/appointment-status-action-modals";
import {
  AppointmentDayList,
  webTooltip,
  type Appointment,
  type AppointmentStatus,
} from "@/src/components/agenda/appointment-day-list";
import { useAppointmentStatusActions } from "@/src/hooks/use-appointment-status-actions";
import { DatePickerField } from "@/src/components/ui/date-picker-field";
import { TimePickerField } from "@/src/components/ui/time-picker-field";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { addMonths, buildCalendarMatrix } from "@/src/components/ui/datetime-picker-utils";
import { zonedDateTimeToUtcIso } from "@/src/domain/agenda/timezone";
import type { AppointmentRecord, AvailabilityBlock } from "@/src/domain/agenda/types";
import type { Client as DomainClient } from "@/src/domain/clients/types";
import type { Service as DomainService } from "@/src/domain/services/types";
import { appointmentService } from "@/src/infra/agenda/supabase-appointment-adapter";
import { clientPortfolioService } from "@/src/infra/clients/supabase-client-portfolio-adapter";
import { providerSettingsService } from "@/src/infra/provider/supabase-provider-settings-adapter";
import { serviceCatalogService } from "@/src/infra/services/supabase-service-catalog-adapter";
import {
  useProviderAppointmentHorizon,
} from "@/src/hooks/use-provider-plan";
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

function maskDate(input: string) {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
function maskTime(input: string) {
  const digits = input.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2
    ? digits
    : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
function validDate(input: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[3], +match[2] - 1, +match[1]));
  return (
    date.getUTCDate() === +match[1] &&
    date.getUTCMonth() === +match[2] - 1 &&
    date.getUTCFullYear() === +match[3]
  );
}
function validTime(input: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(input);
  return !!match && +match[1] <= 23 && +match[2] <= 59;
}
function calculateEndTime(startTime: string, durationMinutes: number): string {
  if (!validTime(startTime) || durationMinutes <= 0) return "";
  const [hours, minutes] = startTime.split(":").map(Number);
  let totalMinutes = hours * 60 + minutes + durationMinutes;
  totalMinutes = totalMinutes % (24 * 60);
  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}
function calculateDurationMinutes(startTime: string, endTime: string): number {
  if (!validTime(startTime) || !validTime(endTime)) return 0;
  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  const startTotal = startHours * 60 + startMinutes;
  let endTotal = endHours * 60 + endMinutes;
  if (endTotal < startTotal) {
    endTotal += 24 * 60;
  }
  return endTotal - startTotal;
}
function dateToUtc(input: string) {
  const [day, month, year] = input.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
function utcToDate(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}
function currentBrazilianDate() {
  const current = new Date();
  return `${String(current.getDate()).padStart(2, "0")}/${String(current.getMonth() + 1).padStart(2, "0")}/${current.getFullYear()}`;
}
function recurrenceDates(
  start: string,
  _frequency: "weekly" | "biweekly" | "monthly",
  _count: number,
) {
  return [start];
}
function longDate(input: string) {
  if (!validDate(input)) return input;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(dateToUtc(input));
}

// Retorna apenas o primeiro nome — usado em mensagens de conflito de
// horário para evitar expor o nome completo (dado pessoal) de um cliente
// de terceiro ao prestador que está tentando agendar naquele horário.
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function monthKey(input: string) {
  const [, month, year] = input.split("/");
  return month && year ? `${year}-${month}` : "";
}

/**
 * Converte data (`DD/MM/AAAA`, formato usado nos estados desta tela) + hora
 * (`HH:MM`) de parede para o instante UTC correspondente, usando o fuso do
 * prestador (`timeZone`) — nunca o fuso do dispositivo. Normaliza o formato
 * de data e delega para `zonedDateTimeToUtcIso` (BLG pendente — bug de
 * escrita de fuso encontrado pelo Leon).
 */
function localDateTimeToIso(
  dateValue: string,
  timeValue: string,
  timeZone: string,
) {
  const [day, month, year] = dateValue.split("/");
  return zonedDateTimeToUtcIso(`${year}-${month}-${day}`, timeValue, timeZone);
}

function zonedParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("day")}/${part("month")}/${part("year")}`, time: `${part("hour")}:${part("minute")}` };
}

function toUiAppointment(record: AppointmentRecord, clientsById: Map<string, string>): Appointment {
  const when = zonedParts(record.startsAt, record.timezone);
  const status: AppointmentStatus = record.state === "cancelled" ? "Cancelado"
    : record.state === "completed" || record.state === "no_show" ? "Concluído"
      : record.confirmationStatus === "confirmed" ? "Confirmado" : "A confirmar";
  return {
    id: record.id, clientId: record.clientId, serviceId: record.serviceId, title: record.title,
    client: record.clientId
      ? clientsById.get(record.clientId) ?? "Cliente"
      : record.title ?? "Agendamento manual",
    service: record.serviceNameSnapshot ?? "Sem serviço", date: when.date, time: when.time,
    value: (record.valueCentsSnapshot ?? 0) / 100, status, state: record.state,
    confirmationStatus: record.confirmationStatus,
    clientMessage: record.clientMessage ?? "", internalNotes: record.internalNotes ?? "",
    cancellationReason: record.cancellationReason ?? undefined,
    cancelledBy: record.cancelledBy ?? undefined,
    confirmedManually: record.confirmationSource === "provider_manual",
    recurrenceGroupId: record.recurrenceGroupId ?? undefined,
    recurrenceIndex: record.recurrenceIndex ?? undefined,
    recurrenceCount: record.recurrenceCount ?? undefined,
    durationMinutes: record.durationMinutes, timezone: record.timezone,
  };
}

export default function AgendaScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  // RN-PLN-018/019/020: horizonte de agendamento do plano do prestador —
  // otimização de UX do seletor de datas (Gratuito = teto de ~1 mês à
  // frente; Premium = sem teto). O servidor sempre revalida no envio
  // (`PLAN_LIMIT_REACHED`), então uma falha de leitura aqui nunca bloqueia o
  // formulário por conta própria.
  const appointmentHorizon = useProviderAppointmentHorizon();
  const appointmentMaxDate = appointmentHorizon.unrestricted
    ? undefined
    : appointmentHorizon.maxAllowedDate ?? undefined;
  // Suporta abertura automática do modal de novo agendamento quando a tela é
  // acessada pelo botão "Novo agendamento" do menu rápido da tab bar mobile
  // (`/agenda?openCreate=1`) — sem esse parâmetro o comportamento de
  // navegação permanece inalterado.
  const { openCreate } = useLocalSearchParams<{ openCreate?: string }>();
  const openCreateHandledRef = useRef(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [initialAgendaLoading, setInitialAgendaLoading] = useState(true);
  const [referenceDataReady, setReferenceDataReady] = useState(false);
  const [clientOptions, setClientOptions] = useState<DomainClient[]>([]);
  // RN-CAN-013/014, BLG-091 (DEC-147/DEC-148): mapa completo cliente -> conta
  // vinculada, usado apenas para decidir se "Excluir agendamento" fica
  // disponível. Precisa cobrir clientes inativos também — ao contrário de
  // `clientOptions` (só ativos, usado no seletor do formulário), pois um
  // cliente inativo com `clientUserId` preenchido ainda tem conta vinculada e
  // a exclusão definitiva continua proibida para ele (achado da seção 7 do
  // handoff `docs/HANDOFF_CANCELAMENTO_CLIENTE_UX_DANTE.md`).
  const [clientLinkedById, setClientLinkedById] = useState<Map<string, string | null>>(new Map());
  const [serviceOptions, setServiceOptions] = useState<DomainService[]>([]);
  const [providerTimezone, setProviderTimezone] = useState("America/Sao_Paulo");
  const [selectedDate, setSelectedDate] = useState(currentBrazilianDate);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"Todos" | AppointmentStatus>("Todos");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [metricCarouselIndex, setMetricCarouselIndex] = useState(0);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(() =>
    String(new Date().getFullYear()),
  );
  const [statusPickerVisible, setStatusPickerVisible] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = wide ? 10 : 5;
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // RN-CAN-013/014, BLG-091 (DEC-147/DEC-148): modal informativo aberto ao
  // tocar no ícone "Excluir" quando desabilitado por vínculo de cliente —
  // nunca abre o modal de exclusão definitiva neste caso.
  const [deleteRestrictedVisible, setDeleteRestrictedVisible] = useState(false);
  const [manualConfirmId, setManualConfirmId] = useState<string | null>(null);
  // Modal de ações rápidas no mobile (três pontinhos)
  const [mobileActionsItem, setMobileActionsItem] = useState<Appointment | null>(null);
  const rowActionsMenu = useRowActionsMenu<Appointment>();
  // Feedback visual de clique (padrão Nero): cada ação assíncrona expõe seu
  // próprio estado de pendência, setado de forma síncrona antes do `await` e
  // sempre resetado em `finally` — nunca deixa o botão preso em loading.
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingManually, setConfirmingManually] = useState(false);
  const [savingBlock, setSavingBlock] = useState(false);
  const [removingBlockId, setRemovingBlockId] = useState<string | null>(null);
  const [client, setClient] = useState("");
  const [service, setService] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("03/08/2026");
  const [multipleDays, setMultipleDays] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<
    "weekly" | "biweekly" | "monthly"
  >("weekly");
  const [recurrenceCount, setRecurrenceCount] = useState("4");
  const [recurrenceSelectedDates, setRecurrenceSelectedDates] = useState<
    string[]
  >([]);
  const [recurrenceCalendarVisible, setRecurrenceCalendarVisible] =
    useState(false);
  const [recurrenceCalendarDate, setRecurrenceCalendarDate] =
    useState(currentBrazilianDate);
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<AppointmentStatus>("A confirmar");
  const [clientMessage, setClientMessage] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    service?: string;
    date?: string;
    time?: string;
    endTime?: string;
    value?: string;
  }>({});
  // Estado/mutações de "concluir"/"cancelar" compartilhados com o Perfil do
  // Cliente (`app/clients/[id].tsx`) via `useAppointmentStatusActions` — a
  // mesma tabela/serviço é usada nas duas telas, então a lógica de mutação
  // não pode divergir entre elas.
  const statusActions = useAppointmentStatusActions({
    onChanged: reloadAgenda,
    onError: setError,
  });
  const [blockModalVisible, setBlockModalVisible] = useState(false);
  const [blockStartDate, setBlockStartDate] = useState("");
  const [blockStartTime, setBlockStartTime] = useState("");
  const [blockEndDate, setBlockEndDate] = useState("");
  const [blockEndTime, setBlockEndTime] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blockError, setBlockError] = useState("");
  const [blockFieldErrors, setBlockFieldErrors] = useState<{
    blockStartDate?: string;
    blockEndDate?: string;
    blockStartTime?: string;
    blockEndTime?: string;
  }>({});
  const [blockConflictVisible, setBlockConflictVisible] = useState(false);
  const [blockSuccessVisible, setBlockSuccessVisible] = useState(false);
  const [providerOverrideVisible, setProviderOverrideVisible] = useState(false);
  const [blockedPeriods, setBlockedPeriods] = useState<
    {
      id: string;
      startDate: string;
      startTime: string;
      endDate: string;
      endTime: string;
      reason: string;
    }[]
  >([]);
  const [clientPickerVisible, setClientPickerVisible] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientPage, setClientPage] = useState(1);
  const clientPageSize = 10;
  const [servicePickerVisible, setServicePickerVisible] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");

  const clients = useMemo(() => clientOptions.map((item) => item.name), [clientOptions]);

  const filteredServices = useMemo(() => {
    if (!serviceQuery.trim()) return serviceOptions;
    const q = serviceQuery.trim().toLocaleLowerCase("pt-BR");
    return serviceOptions.filter((item) =>
      item.name.toLocaleLowerCase("pt-BR").includes(q),
    );
  }, [serviceOptions, serviceQuery]);

  const selectedServiceObj = useMemo(() => {
    return serviceOptions.find(
      (item) =>
        item.name.trim().toLocaleLowerCase("pt-BR") ===
        service.trim().toLocaleLowerCase("pt-BR"),
    );
  }, [serviceOptions, service]);

  // BLG-076: `serviceOptions`/`clientOptions` precisam ser recarregados sempre
  // que a tela ganha foco (não apenas na primeira montagem), pois o Stack de
  // navegação não desmonta `/agenda` ao ir para `/services` (RF-CAD-014) e
  // voltar — sem isso o prestador ficava com o catálogo desatualizado depois
  // de cadastrar um serviço e retornar pelo gesto/botão nativo.
  const loadingReferenceDataRef = useRef(false);

  const loadReferenceData = useCallback(async () => {
    if (loadingReferenceDataRef.current) return;
    loadingReferenceDataRef.current = true;
    try {
      // Sem filtro de `status` aqui (seção 7 do handoff de UX): a mesma
      // chamada precisa servir a duas necessidades diferentes — (a) só
      // clientes ativos para o seletor de cliente do formulário e (b) o mapa
      // completo `clientId -> clientUserId` (ativos + inativos) usado pela
      // regra de restrição do "Excluir agendamento". Filtrar por `status:
      // "active"` nesta única chamada faria (b) tratar erroneamente um
      // cliente inativo com conta vinculada como "sem cliente vinculado".
      const firstPage = await clientPortfolioService.listClients({ page: 1, pageSize: 10 });
      const pages = [firstPage];
      for (let pageNumber = 2; pageNumber <= firstPage.totalPages; pageNumber += 1) {
        pages.push(await clientPortfolioService.listClients({ page: pageNumber, pageSize: 10 }));
      }
      let [services, settings] = await Promise.all([
        serviceCatalogService.listServices({ status: "active" }),
        providerSettingsService.getSettings(),
      ]);

      // Se o catálogo estiver vazio, provisiona automaticamente o serviço padrão "Atendimento"
      if (!services || services.length === 0) {
        try {
          const autoCreated = await serviceCatalogService.createService({
            name: "Atendimento",
            durationMinutes: 60,
            referenceValueCents: 0,
          });
          services = [autoCreated];
        } catch {
          // Se falhar (ex: offline), segue com array vazio
        }
      }

      const allClients = pages.flatMap((pageResult) => pageResult.items);
      setClientOptions(allClients.filter((item) => item.status === "active"));
      setClientLinkedById(new Map(allClients.map((item) => [item.id, item.clientUserId])));
      setServiceOptions(services);
      setProviderTimezone(settings.timezone);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a agenda.");
    } finally {
      loadingReferenceDataRef.current = false;
      setReferenceDataReady(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadReferenceData();
    }, [loadReferenceData]),
  );

  async function reloadAgenda() {
    const month = monthKey(selectedDate);
    if (!month) {
      setAgendaLoading(false);
      return;
    }
    setAgendaLoading(true);
    try {
      const [firstPage, blocks] = await Promise.all([
        appointmentService.listAppointments({ month, page: 1, pageSize: 10 }),
        appointmentService.listAvailabilityBlocks(month),
      ]);
      const remainingPages = await Promise.all(
        Array.from({ length: Math.max(0, firstPage.totalPages - 1) }, (_, index) =>
          appointmentService.listAppointments({ month, page: index + 2, pageSize: 10 }),
        ),
      );
      const pages = [firstPage, ...remainingPages];
      const names = new Map(clientOptions.map((item) => [item.id, item.name]));
      setAppointments(pages.flatMap((pageResult) => pageResult.items).map((item) => toUiAppointment(item, names)));
      setBlockedPeriods(blocks.map((block: AvailabilityBlock) => {
        const start = zonedParts(block.startsAt, block.timezone);
        const end = zonedParts(block.endsAt, block.timezone);
        return { id: block.id, startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time, reason: block.reason ?? "Período indisponível" };
      }));
    } finally {
      setAgendaLoading(false);
      setInitialAgendaLoading(false);
    }
  }

  useEffect(() => {
    if (!referenceDataReady) return;
    void reloadAgenda().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a agenda."));
    // A troca do mês e a resolução dos nomes dos clientes exigem nova leitura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate.slice(3), clientOptions, referenceDataReady]);

  useEffect(() => {
    if (openCreate !== "1" || openCreateHandledRef.current || !referenceDataReady) return;
    openCreateHandledRef.current = true;
    openNew();
    // Remove o parâmetro para não reabrir o modal em focos futuros da tela.
    router.setParams({ openCreate: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate, referenceDataReady]);

  const selectedDayItems = useMemo(
    () =>
      appointments
        .filter((item) => item.date === selectedDate)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [appointments, selectedDate],
  );
  const filteredDayItems = useMemo(
    () =>
      selectedDayItems
        .filter(
          (item) =>
            (filter === "Todos" || item.status === filter) &&
            `${item.client} ${item.service}`
              .toLocaleLowerCase("pt-BR")
              .includes(query.trim().toLocaleLowerCase("pt-BR")),
        ),
    [filter, query, selectedDayItems],
  );
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredDayItems.length / pageSize)),
    [filteredDayItems.length, pageSize],
  );
  const dayItems = useMemo(
    () => filteredDayItems.slice((page - 1) * pageSize, page * pageSize),
    [filteredDayItems, page, pageSize],
  );
  const scheduled = useMemo(
    () => selectedDayItems.filter((item) => item.state === "scheduled").length,
    [selectedDayItems],
  );
  const completed = useMemo(
    () => selectedDayItems.filter((item) => item.state === "completed").length,
    [selectedDayItems],
  );
  const pending = useMemo(
    () =>
      selectedDayItems.filter(
        (item) => item.state === "scheduled" && item.status === "A confirmar",
      ).length,
    [selectedDayItems],
  );
  const filteredClients = useMemo(
    () =>
      clients.filter((item) =>
        item
          .toLocaleLowerCase("pt-BR")
          .includes(clientQuery.trim().toLocaleLowerCase("pt-BR")),
      ),
    [clientQuery, clients],
  );
  const clientTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredClients.length / clientPageSize)),
    [filteredClients.length, clientPageSize],
  );
  const visibleClients = useMemo(
    () =>
      filteredClients.slice(
        (clientPage - 1) * clientPageSize,
        clientPage * clientPageSize,
      ),
    [filteredClients, clientPage, clientPageSize],
  );
  const selectedUtc = dateToUtc(selectedDate);
  const calendarYear = selectedUtc.getUTCFullYear();
  const calendarMonth = selectedUtc.getUTCMonth();
  // Grade 7×N (domingo primeiro, dias nulos preenchendo início/fim da
  // semana) construída pela mesma função usada pelo `DatePickerField`
  // (`buildCalendarMatrix`), eliminando uma segunda implementação que
  // divergia do componente padrão dos modais.
  const calendarCells = buildCalendarMatrix(calendarYear, calendarMonth);
  const scheduledDates = new Set(
    appointments
      .filter((item) => {
        const itemDate = dateToUtc(item.date);
        return (
          itemDate.getUTCFullYear() === calendarYear &&
          itemDate.getUTCMonth() === calendarMonth
        );
      })
      .map((item) => item.date),
  );
  const calendarTitle = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(selectedUtc);
  // KPI "Atendimentos do mês": `appointments` já carrega o mês inteiro
  // (`appointmentService.listAppointments({ month, ... })` em
  // `reloadAgenda`), então não é preciso nova busca — só recontar quando o
  // mês exibido (`calendarMonth`/`calendarYear`, movidos por `moveMonth`)
  // ou a lista mudarem.
  const monthlyAppointmentsCount = useMemo(
    () =>
      appointments.filter((item) => {
        const itemDate = dateToUtc(item.date);
        return (
          itemDate.getUTCFullYear() === calendarYear &&
          itemDate.getUTCMonth() === calendarMonth
        );
      }).length,
    [appointments, calendarYear, calendarMonth],
  );
  const pickerYears = Array.from(
    new Set([
      String(new Date().getFullYear()),
      ...appointments.map((item) => item.date.slice(6, 10)),
    ]),
  ).sort((a, b) => b.localeCompare(a));
  const pickerMonths = [
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "12",
  ];
  const recurrenceCalendarUtc = dateToUtc(recurrenceCalendarDate);
  const recurrenceCalendarYear = recurrenceCalendarUtc.getUTCFullYear();
  const recurrenceCalendarMonth = recurrenceCalendarUtc.getUTCMonth();
  const recurrenceCalendarCells = buildCalendarMatrix(
    recurrenceCalendarYear,
    recurrenceCalendarMonth,
  );
  useEffect(() => {
    setPage(1);
  }, [filter, query, selectedDate]);

  function moveDay(amount: number) {
    const next = dateToUtc(selectedDate);
    next.setUTCDate(next.getUTCDate() + amount);
    setSelectedDate(utcToDate(next));
  }
  function moveMonth(amount: number) {
    const next = addMonths(calendarYear, calendarMonth, amount);
    setSelectedDate(
      utcToDate(new Date(Date.UTC(next.year, next.month, 1))),
    );
  }
  function moveRecurrenceMonth(amount: number) {
    const next = addMonths(
      recurrenceCalendarYear,
      recurrenceCalendarMonth,
      amount,
    );
    setRecurrenceCalendarDate(
      utcToDate(new Date(Date.UTC(next.year, next.month, 1))),
    );
  }
  function toggleRecurrenceDate(day: number) {
    const selected = utcToDate(
      new Date(Date.UTC(recurrenceCalendarYear, recurrenceCalendarMonth, day)),
    );
    if (selected === date) return;
    setRecurrenceSelectedDates((current) =>
      current.includes(selected)
        ? current.filter((item) => item !== selected)
        : current.length >= 23
          ? current
          : [...current, selected],
    );
  }
  function selectCalendarDay(day: number) {
    setSelectedDate(
      utcToDate(new Date(Date.UTC(calendarYear, calendarMonth, day))),
    );
  }
  function openNew() {
    const defaultService =
      serviceOptions.find(
        (item) => item.name.trim().toLocaleLowerCase("pt-BR") === "atendimento",
      ) ?? serviceOptions[0];
    setEditingId(null);
    setClient("");
    setService(defaultService?.name ?? "");
    setTitle(defaultService?.name ?? "");
    setDate(selectedDate);
    setMultipleDays(false);
    setRecurrenceSelectedDates([]);
    setRecurrenceCalendarDate(selectedDate);
    setTime("");
    setEndTime("");
    setValue(
      defaultService && defaultService.referenceValueCents > 0
        ? (defaultService.referenceValueCents / 100).toFixed(2).replace(".", ",")
        : "",
    );
    setStatus("A confirmar");
    setClientMessage("");
    setInternalNotes("");
    setError("");
    setFieldErrors({});
    setFormVisible(true);
  }
  function openBlockAgenda() {
    setBlockStartDate(selectedDate);
    setBlockEndDate(selectedDate);
    setBlockStartTime("");
    setBlockEndTime("");
    setBlockReason("");
    setBlockError("");
    setBlockFieldErrors({});
    setBlockModalVisible(true);
  }
  async function saveBlockedPeriod(confirmed = false) {
    const nextBlockFieldErrors: typeof blockFieldErrors = {};
    if (!validDate(blockStartDate)) nextBlockFieldErrors.blockStartDate = "Informe uma data válida (DD/MM/AAAA).";
    if (!validDate(blockEndDate)) nextBlockFieldErrors.blockEndDate = "Informe uma data válida (DD/MM/AAAA).";
    if (!validTime(blockStartTime)) nextBlockFieldErrors.blockStartTime = "Informe um horário válido (HH:MM).";
    if (!validTime(blockEndTime)) nextBlockFieldErrors.blockEndTime = "Informe um horário válido (HH:MM).";
    setBlockFieldErrors(nextBlockFieldErrors);
    if (Object.keys(nextBlockFieldErrors).length > 0) {
      setBlockError("Confira os campos destacados abaixo.");
      return;
    }
    const toKey = (dateValue: string, timeValue: string) => {
      const [day, month, year] = dateValue.split("/");
      return `${year}-${month}-${day}T${timeValue}`;
    };
    if (
      toKey(blockEndDate, blockEndTime) <= toKey(blockStartDate, blockStartTime)
    ) {
      setBlockFieldErrors({ blockStartDate: "Verifique o início.", blockEndDate: "Deve ser posterior ao início." });
      return setBlockError("O fim do bloqueio deve ser posterior ao início.");
    }
    const hasExistingAppointments = appointments.some((item) => {
      const key = toKey(item.date, item.time);
      return (
        item.status !== "Cancelado" &&
        key >= toKey(blockStartDate, blockStartTime) &&
        key < toKey(blockEndDate, blockEndTime)
      );
    });
    if (hasExistingAppointments && !confirmed) {
      setBlockConflictVisible(true);
      return;
    }
    setSavingBlock(true);
    try {
      await appointmentService.createAvailabilityBlock({
        startsAt: localDateTimeToIso(blockStartDate, blockStartTime, providerTimezone),
        endsAt: localDateTimeToIso(blockEndDate, blockEndTime, providerTimezone),
        timezone: providerTimezone,
        reason: blockReason.trim() || null,
        conflictPolicy: "keep_existing",
      });
      await reloadAgenda();
      setBlockConflictVisible(false);
      setBlockModalVisible(false);
      setBlockSuccessVisible(true);
    } catch (saveError) {
      setBlockError(saveError instanceof Error ? saveError.message : "Não foi possível bloquear a agenda.");
    } finally {
      setSavingBlock(false);
    }
  }
  async function removeBlockedPeriod(id: string) {
    setRemovingBlockId(id);
    try {
      await appointmentService.deleteAvailabilityBlock(id);
      await reloadAgenda();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Não foi possível remover o bloqueio.");
    } finally {
      setRemovingBlockId(null);
    }
  }
  function openEdit(item: Appointment) {
    setEditingId(item.id);
    setClient(item.clientId ? item.client : "");
    setService(item.serviceId ? item.service : "");
    setTitle(item.title ?? "");
    setDate(item.date);
    setMultipleDays(false);
    setRecurrenceSelectedDates([]);
    setRecurrenceCalendarDate(item.date);
    setTime(item.time);
    setEndTime(calculateEndTime(item.time, item.durationMinutes));
    setValue(item.value.toFixed(2).replace(".", ","));
    setStatus(item.status);
    setClientMessage(item.clientMessage ?? "");
    
    setInternalNotes(item.internalNotes ?? item.notes ?? "");
    
    setError("");
    setFieldErrors({});
    setFormVisible(true);
  }
  async function save(confirmedProviderOverride = false) {
    const cleanedValue = value.trim();
    const parsed = cleanedValue ? Number(cleanedValue.replace(/\./g, "").replace(",", ".")) : 0;
    const dates = multipleDays
      ? [
          date,
          ...recurrenceSelectedDates
            .filter((item) => item !== date)
            .sort((a, b) => dateToUtc(a).getTime() - dateToUtc(b).getTime()),
        ]
      : [date];
    const nextFieldErrors: typeof fieldErrors = {};
    if (!client.trim() && !title.trim()) nextFieldErrors.title = "Informe um título para o compromisso.";
    if (client.trim() && !service.trim()) nextFieldErrors.service = "Selecione um serviço para o cliente.";
    if (!validDate(date)) nextFieldErrors.date = "Informe uma data válida (DD/MM/AAAA).";
    if (!validTime(time)) nextFieldErrors.time = "Informe um horário de início válido (HH:MM).";
    if (!validTime(endTime)) {
      nextFieldErrors.endTime = "Informe um horário de término válido (HH:MM).";
    } else if (validTime(time)) {
      const duration = calculateDurationMinutes(time, endTime);
      if (duration <= 0) {
        nextFieldErrors.endTime = "Término deve ser posterior ao início.";
      }
    }
    if (cleanedValue && (!Number.isFinite(parsed) || parsed < 0)) {
      nextFieldErrors.value = "Informe um valor válido ou deixe em branco.";
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setError("Confira os campos destacados abaixo.");
      return;
    }
    if (multipleDays && !recurrenceSelectedDates.length)
      return setError("Selecione pelo menos mais um dia no calendário.");
    if (dates.length > 24)
      return setError("Selecione no máximo 24 dias para a recorrência.");
    const conflict = appointments.find(
      (item) =>
        item.id !== editingId &&
        dates.includes(item.date) &&
        item.time === time &&
        item.status !== "Cancelado",
    );
    if (conflict) {
      // Cliente vinculado (clientId presente): mostra apenas o primeiro nome
      // (dado de terceiro). Sem cliente vinculado (bloqueio manual, folga,
      // compromisso sem cliente): mensagem genérica, sem tentar exibir nome.
      const conflictMessage = conflict.clientId
        ? `O horário ${time} já está ocupado por ${firstName(conflict.client)} em ${conflict.date}. Escolha outro horário ou remova essa data.`
        : `Horário indisponível em ${conflict.date}. Escolha outro horário ou remova essa data.`;
      return setError(conflictMessage);
    }
    const toKey = (dateValue: string, timeValue: string) => {
      const [day, month, year] = dateValue.split("/");
      return `${year}-${month}-${day}T${timeValue}`;
    };
    const isInsideBlockedPeriod = dates.some((itemDate) =>
      blockedPeriods.some((block) => {
        const appointmentKey = toKey(itemDate, time);
        return (
          appointmentKey >= toKey(block.startDate, block.startTime) &&
          appointmentKey < toKey(block.endDate, block.endTime)
        );
      }),
    );
    if (isInsideBlockedPeriod && !confirmedProviderOverride) {
      setProviderOverrideVisible(true);
      return;
    }
    const normalize = (value: string) => value.trim().toLocaleLowerCase("pt-BR");
    const selectedClient = client
      ? clientOptions.find((item) => normalize(item.name) === normalize(client))
      : undefined;

    const selectedService = service
      ? serviceOptions.find((item) => normalize(item.name) === normalize(service))
      : undefined;

    if (client && !selectedClient) return setError("Selecione um cliente cadastrado.");
    if (service && !selectedService) return setError("Selecione um serviço ativo do catálogo.");
    if (selectedClient && !selectedService) return setError("Selecione um serviço ativo do catálogo para o cliente.");
    if (selectedService && service !== selectedService.name) setService(selectedService.name);
    const computedDuration = calculateDurationMinutes(time, endTime);
    const formattedNotes = internalNotes.trim();

    setSaving(true);
    try {
      if (editingId) {
        const previous = appointments.find((item) => item.id === editingId);
        if (!previous) return setError("Agendamento não encontrado.");
        if (
          previous.clientId !== (selectedClient?.id ?? null) ||
          previous.serviceId !== (selectedService?.id ?? null) ||
          previous.title !== (title.trim() || null)
        ) return setError("Para trocar cliente, serviço ou título, cancele este agendamento e crie outro.");
        // Bug encontrado (relato do usuário, 06/09/2026): selecionar
        // "Cancelado" aqui enviava `state: "cancelled"` para
        // `update_appointment`, que nunca soube processar cancelamento (só
        // grava `cancellation_reason`/`cancelled_by`/`cancelled_at` a RPC
        // dedicada `cancel_appointment`) — violava
        // `appointments_cancellation_consistency_check` e nunca refletia na
        // tabela. Salva as demais edições primeiro (mesma chamada de
        // sempre, sem tocar `state`) e só depois cancela pela RPC certa.
        await appointmentService.updateAppointment(editingId, {
          startsAt: localDateTimeToIso(date, time, providerTimezone), timezone: providerTimezone,
          durationMinutes: computedDuration,
          clientMessage: clientMessage.trim() || null,
          internalNotes: formattedNotes || null,
          state: status === "Concluído" ? "completed" : "scheduled",
        });
        if (status === "Cancelado" && previous.status !== "Cancelado") {
          await appointmentService.cancelAppointment(editingId, { reason: null });
        }
        // Bug encontrado (relato do usuário, 06/09/2026): selecionar "A
        // confirmar" para um agendamento já "Confirmado" não fazia nada —
        // só existia o caminho para frente (`confirmManually`). Ver
        // `unconfirmManually`/20260906130000_unconfirm_appointment_manually.sql.
        else if (status === "Confirmado" && previous.status !== "Confirmado") await appointmentService.confirmManually(editingId);
        else if (status === "A confirmar" && previous.status === "Confirmado") await appointmentService.unconfirmManually(editingId);
      } else {
        const created = await appointmentService.createAppointment({
          clientId: selectedClient?.id ?? null,
          serviceId: selectedService?.id ?? null,
          title: title.trim() || null,
          startsAt: localDateTimeToIso(date, time, providerTimezone), timezone: providerTimezone,
          durationMinutes: computedDuration,
          clientMessage: clientMessage.trim() || null,
          internalNotes: formattedNotes || null,
          requestedBy: "provider",
          recurrence: multipleDays ? { dates: dates.map((itemDate) => localDateTimeToIso(itemDate, time, providerTimezone)) } : undefined,
        });
        // Bug encontrado (relato do usuário, 06/09/2026, reproduzido de novo
        // após a correção da regressão de confirmação): ao CRIAR um
        // agendamento, o seletor de Situação só tratava "Confirmado" — a
        // criação sempre nasce `scheduled`/`pending` (RN-AGD-014), então
        // escolher "Concluído"/"Cancelado" aqui não fazia nada, e a tabela
        // mostrava "A confirmar" mesmo com "Concluído" selecionado. Mesmo
        // escopo de `confirmManually` (só a primeira ocorrência quando é
        // uma série recorrente).
        if (status === "Concluído") await appointmentService.updateAppointment(created.id, { state: "completed" });
        else if (status === "Cancelado") await appointmentService.cancelAppointment(created.id, { reason: null });
        else if (status === "Confirmado") await appointmentService.confirmManually(created.id);
      }
      setProviderOverrideVisible(false);
      setSelectedDate(date);
      setFormVisible(false);
      await reloadAgenda();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o agendamento.");
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!deleteId) return;
    setRemoving(true);
    try { await appointmentService.deleteAppointment(deleteId); await reloadAgenda(); setDeleteId(null); setFormVisible(false); }
    catch (removeError) { setError(removeError instanceof Error ? removeError.message : "Não foi possível excluir o agendamento."); }
    finally { setRemoving(false); }
  }
  // RN-CAN-013/014 (DEC-147/DEC-148): exclusão definitiva só é oferecida
  // quando o agendamento não tem identidade de cliente vinculada capaz de
  // vê-lo — sem cliente associado, ou cliente associado sem `clientUserId`.
  function hasLinkedClientAccount(item: Appointment) {
    return item.clientId ? Boolean(clientLinkedById.get(item.clientId)) : false;
  }
  function onDeletePress(item: Appointment) {
    if (hasLinkedClientAccount(item)) {
      setDeleteRestrictedVisible(true);
      return;
    }
    setDeleteId(item.id);
  }
  async function confirmManually() {
    if (!manualConfirmId) return;
    setConfirmingManually(true);
    try { await appointmentService.confirmManually(manualConfirmId); await reloadAgenda(); setManualConfirmId(null); }
    catch (confirmError) { setError(confirmError instanceof Error ? confirmError.message : "Não foi possível confirmar o agendamento."); }
    finally { setConfirmingManually(false); }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {initialAgendaLoading && <PageLoadingOverlay />}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View style={[styles.heading, wide && styles.headingWide]}>
            <View style={styles.headingCopy}>
              <Text style={styles.eyebrow}>ROTINA</Text>
              <Text
                accessibilityRole="header"
                style={[styles.title, !wide && styles.titleMobile]}
              >
                Agenda
              </Text>
              <Text style={styles.description}>
                Organize seus compromissos e acompanhe a rotina do dia.
              </Text>
            </View>
            <View
              style={[
                styles.headingButtons,
                !wide && styles.headingButtonsMobile,
              ]}
            >
              <Pressable onPress={openBlockAgenda} style={styles.blockButton}>
                <AppIcon name="lock" size={20} color={colors.brand} />
                <Text style={styles.blockButtonText}>Bloquear agenda</Text>
              </Pressable>
              <Pressable onPress={openNew} style={styles.primaryButton}>
                <AppIcon name="add" size={20} color={colors.onBrand} />
                <Text style={styles.primaryButtonText}>Novo agendamento</Text>
              </Pressable>
            </View>
          </View>
          {!!blockedPeriods.length && (
            <View style={styles.blockedSection}>
              <View style={styles.blockedSectionHeader}>
                <View>
                  <Text style={styles.blockedSummaryTitle}>
                    Períodos indisponíveis para clientes
                  </Text>
                  <Text style={styles.blockedSummaryText}>
                    {blockedPeriods.length} bloqueio(s) ativo(s). Você ainda
                    pode adicionar compromissos.
                  </Text>
                </View>
                <View style={styles.blockedStatus}>
                  <AppIcon name="lock" size={16} color={colors.brand} />
                  <Text style={styles.blockedStatusText}>Bloqueado</Text>
                </View>
              </View>
              <View style={styles.blockedList}>
                {blockedPeriods.map((block) => (
                  <View key={block.id} style={styles.blockedItem}>
                    <View style={styles.blockedSummaryIcon}>
                      <AppIcon name="lock" size={20} color={colors.brand} />
                    </View>
                    <View style={styles.blockedSummaryCopy}>
                      <View style={styles.blockedItemTitleRow}>
                        <Text style={styles.blockedItemTitle}>
                          {block.reason}
                        </Text>
                        <View style={styles.blockedStatus}>
                          <Text style={styles.blockedStatusText}>
                            Bloqueado
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.blockedSummaryText}>
                        {block.startDate} às {block.startTime} até{" "}
                        {block.endDate} às {block.endTime}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`Remover bloqueio ${block.reason}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: removingBlockId === block.id, busy: removingBlockId === block.id }}
                      disabled={removingBlockId === block.id}
                      onPress={() => void removeBlockedPeriod(block.id)}
                      style={({ pressed }) => [styles.removeBlock, pressed && removingBlockId !== block.id && { opacity: opacity.pressed }]}
                    >
                      {removingBlockId === block.id ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <AppIcon name="delete" size={18} color={colors.danger} />
                      )}
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          )}

          <ScrollView
            style={styles.metricsViewport}
            horizontal={!wide}
            showsHorizontalScrollIndicator={false}
            snapToInterval={272}
            decelerationRate="fast"
            onMomentumScrollEnd={(
              event: NativeSyntheticEvent<NativeScrollEvent>,
            ) =>
              setMetricCarouselIndex(
                Math.max(
                  0,
                  Math.min(
                    3,
                    Math.round(event.nativeEvent.contentOffset.x / 272),
                  ),
                ),
              )
            }
            contentContainerStyle={[styles.metrics, wide && styles.metricsWide]}
          >
            <View style={[styles.metric, wide && styles.metricWide]}>
              <View style={[styles.metricIcon, styles.brandMetricIcon]}>
                <AppIcon name="calendar" size={24} color={colors.brand} />
              </View>
              <Text style={styles.metricLabel}>Agenda</Text>
              <Text style={styles.metricValue}>{scheduled}</Text>
              <Text style={[styles.metricDetail, styles.brandMetricDetail]}>
                agendado(s) na data
              </Text>
            </View>
            <View style={[styles.metric, wide && styles.metricWide]}>
              <View style={[styles.metricIcon, styles.successMetricIcon]}>
                <AppIcon name="success" size={24} color={colors.success} />
              </View>
              <Text style={styles.metricLabel}>Atendimentos</Text>
              <Text style={styles.metricValue}>{completed}</Text>
              <Text style={[styles.metricDetail, styles.successMetricDetail]}>
                concluído(s) de verdade
              </Text>
            </View>
            <View style={[styles.metric, wide && styles.metricWide]}>
              <View style={[styles.metricIcon, styles.warningMetricIcon]}>
                <AppIcon name="schedule" size={24} color={colors.warning} />
              </View>
              <Text style={styles.metricLabel}>A confirmar</Text>
              <Text style={styles.metricValue}>{pending}</Text>
              <Text style={[styles.metricDetail, styles.warningMetricDetail]}>
                {pending === 1
                  ? "confirmação pendente"
                  : "confirmações pendentes"}
              </Text>
            </View>
            <View style={[styles.metric, wide && styles.metricWide]}>
              <View style={[styles.metricIcon, styles.accentMetricIcon]}>
                <AppIcon name="calendar" size={24} color={colors.brandMid} />
              </View>
              <Text style={styles.metricLabel}>Atendimentos do mês</Text>
              <Text style={styles.metricValue}>{monthlyAppointmentsCount}</Text>
              <Text style={[styles.metricDetail, styles.accentMetricDetail]}>
                agendamento(s) em {calendarTitle}
              </Text>
            </View>
          </ScrollView>
          {!wide && (
            <View
              accessibilityLabel={`Indicador do carrossel: item ${metricCarouselIndex + 1} de 4`}
              style={styles.carouselDots}
            >
              {[0, 1, 2, 3].map((index) => (
                <View
                  key={index}
                  style={[
                    styles.carouselDot,
                    index === metricCarouselIndex && styles.carouselDotActive,
                  ]}
                />
              ))}
            </View>
          )}

          <View style={styles.directory}>
            <View style={[styles.toolbar, !wide && styles.toolbarMobile]}>
              <View style={styles.search}>
                <AppIcon name="search" size={20} color={colors.mutedSoft} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar cliente ou serviço"
                  placeholderTextColor={colors.mutedSoft}
                  style={styles.searchInput}
                />
              </View>
              <Pressable
                onPress={() => {
                  setPickerYear(String(calendarYear));
                  setMonthPickerVisible(true);
                }}
                style={styles.monthFilter}
              >
                <View style={styles.monthFilterCopy}>
                  <Text style={styles.statusFilterLabel}>Data</Text>
                  <Text style={styles.monthFilterText}>
                    {String(calendarMonth + 1).padStart(2, "0")}/{calendarYear}
                  </Text>
                </View>
                <AppIcon name="forward" size={16} color={colors.mutedSoft} />
              </Pressable>
              <Pressable
                accessibilityLabel="Selecionar status"
                onPress={() => setStatusPickerVisible(true)}
                style={styles.statusFilter}
              >
                <View>
                  <Text style={styles.statusFilterLabel}>Status</Text>
                  <Text style={styles.statusFilterValue}>{filter}</Text>
                </View>
                <AppIcon name="forward" size={16} color={colors.mutedSoft} />
              </Pressable>
              <View style={styles.viewToggle}>
                <Pressable
                  onPress={() => setViewMode("list")}
                  style={[
                    styles.viewOption,
                    viewMode === "list" && styles.viewOptionActive,
                  ]}
                >
                  <AppIcon
                    name="packages"
                    size={16}
                    color={viewMode === "list" ? colors.onBrand : colors.muted}
                  />
                  <Text
                    style={[
                      styles.viewOptionText,
                      viewMode === "list" && styles.viewOptionTextActive,
                    ]}
                  >
                    Lista
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setViewMode("calendar")}
                  style={[
                    styles.viewOption,
                    viewMode === "calendar" && styles.viewOptionActive,
                  ]}
                >
                  <AppIcon
                    name="calendar"
                    size={16}
                    color={
                      viewMode === "calendar" ? colors.onBrand : colors.muted
                    }
                  />
                  <Text
                    style={[
                      styles.viewOptionText,
                      viewMode === "calendar" && styles.viewOptionTextActive,
                    ]}
                  >
                    Calendário
                  </Text>
                </Pressable>
              </View>
            </View>
            {viewMode === "list" ? (
              <>
                <View style={styles.datePanel}>
                  <Pressable
                    {...webTooltip("Dia anterior")}
                    accessibilityLabel="Dia anterior"
                    onPress={() => moveDay(-1)}
                    style={styles.navButton}
                  >
                    <AppIcon name="back" size={16} color={colors.brand} />
                  </Pressable>
                  <Pressable
                    onPress={() => setSelectedDate(currentBrazilianDate())}
                    style={styles.dateCopy}
                  >
                    <Text style={styles.dateTitle}>
                      {longDate(selectedDate)}
                    </Text>
                    <Text style={styles.dateSubtitle}>
                      {filteredDayItems.length} compromisso
                      {filteredDayItems.length === 1 ? "" : "s"}
                    </Text>
                  </Pressable>
                  <Pressable
                    {...webTooltip("Próximo dia")}
                    accessibilityLabel="Próximo dia"
                    onPress={() => moveDay(1)}
                    style={styles.navButton}
                  >
                    <AppIcon name="forward" size={16} color={colors.brand} />
                  </Pressable>
                </View>
                <AppointmentDayList
                  items={dayItems}
                  loading={agendaLoading}
                  wide={wide}
                  onMobileActions={setMobileActionsItem}
                  onDesktopActions={rowActionsMenu.open}
                  onCreateNew={openNew}
                />
                <View
                  style={[styles.pagination, !wide && styles.paginationMobile]}
                >
                  <Text style={styles.paginationInfo}>
                    {filteredDayItems.length
                      ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredDayItems.length)} de ${filteredDayItems.length}`
                      : "0 compromissos"}
                  </Text>
                  <View style={styles.paginationActions}>
                    <Pressable
                      {...webTooltip("Página anterior")}
                      accessibilityLabel="Página anterior"
                      disabled={page === 1}
                      onPress={() =>
                        setPage((current) => Math.max(1, current - 1))
                      }
                      style={[
                        styles.pageButton,
                        page === 1 && styles.pageButtonDisabled,
                      ]}
                    >
                      <AppIcon
                        name="back"
                        size={16}
                        color={page === 1 ? colors.mutedSoft : colors.brand}
                      />
                    </Pressable>
                    <Text style={styles.pageText}>
                      {page} de {totalPages}
                    </Text>
                    <Pressable
                      {...webTooltip("Próxima página")}
                      accessibilityLabel="Próxima página"
                      disabled={page === totalPages}
                      onPress={() =>
                        setPage((current) => Math.min(totalPages, current + 1))
                      }
                      style={[
                        styles.pageButton,
                        page === totalPages && styles.pageButtonDisabled,
                      ]}
                    >
                      <AppIcon
                        name="forward"
                        size={16}
                        color={
                          page === totalPages ? colors.mutedSoft : colors.brand
                        }
                      />
                    </Pressable>
                  </View>
                </View>
              </>
            ) : (
              <View
                style={[
                  styles.calendarView,
                  !wide && styles.calendarViewMobile,
                ]}
              >
                <View style={styles.calendarHeader}>
                  <Pressable
                    {...webTooltip("Mês anterior")}
                    accessibilityLabel="Mês anterior"
                    onPress={() => moveMonth(-1)}
                    style={styles.calendarNav}
                  >
                    <AppIcon name="back" size={18} color={colors.brand} />
                  </Pressable>
                  <View>
                    <Text style={styles.calendarTitle}>{calendarTitle}</Text>
                    <Text style={styles.calendarSubtitle}>
                      Selecione um dia para filtrar a agenda
                    </Text>
                  </View>
                  <Pressable
                    {...webTooltip("Próximo mês")}
                    accessibilityLabel="Próximo mês"
                    onPress={() => moveMonth(1)}
                    style={styles.calendarNav}
                  >
                    <AppIcon name="forward" size={18} color={colors.brand} />
                  </Pressable>
                </View>
                <View style={styles.weekHeader}>
                  {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map(
                    (weekday) => (
                      <Text key={weekday} style={styles.weekLabel}>
                        {weekday}
                      </Text>
                    ),
                  )}
                </View>
                <View style={styles.calendarGrid}>
                  {calendarCells.map((day, index) => {
                    if (!day)
                      return (
                        <View
                          key={`empty-${index}`}
                          style={[
                            styles.calendarCell,
                            !wide && styles.calendarCellMobile,
                            styles.calendarCellEmpty,
                          ]}
                        />
                      );
                    const cellDate = utcToDate(
                      new Date(Date.UTC(calendarYear, calendarMonth, day)),
                    );
                    const cellItems = appointments
                      .filter(
                        (item) =>
                          item.date === cellDate &&
                          (filter === "Todos" || item.status === filter) &&
                          `${item.client} ${item.service}`
                            .toLocaleLowerCase("pt-BR")
                            .includes(query.trim().toLocaleLowerCase("pt-BR")),
                      )
                      .sort((a, b) => a.time.localeCompare(b.time));
                    const selected = cellDate === selectedDate;
                    const toDayKey = (value: string) => {
                      const [dateDay, dateMonth, dateYear] = value.split("/");
                      return `${dateYear}-${dateMonth}-${dateDay}`;
                    };
                    const cellBlocked = blockedPeriods.some(
                      (block) =>
                        toDayKey(cellDate) >= toDayKey(block.startDate) &&
                        toDayKey(cellDate) <= toDayKey(block.endDate),
                    );
                    return (
                      <Pressable
                        key={cellDate}
                        onPress={() => selectCalendarDay(day)}
                        style={[
                          styles.calendarCell,
                          !wide && styles.calendarCellMobile,
                          cellBlocked && styles.calendarCellBlocked,
                          selected && styles.calendarCellSelected,
                        ]}
                      >
                        <View style={styles.calendarDayRow}>
                          <Text
                            style={[
                              styles.calendarDay,
                              selected && styles.calendarDaySelected,
                            ]}
                          >
                            {day}
                          </Text>
                          {scheduledDates.has(cellDate) && (
                            <View style={styles.calendarDot} />
                          )}
                          {cellBlocked && <View style={styles.blockedDot} />}
                        </View>
                        {wide && cellBlocked && (
                          <View style={styles.calendarBlockedLabel}>
                            <AppIcon
                              name="lock"
                              size={16}
                              color={colors.brand}
                            />
                            <Text style={styles.calendarBlockedText}>
                              Bloqueado
                            </Text>
                          </View>
                        )}
                        {wide &&
                          cellItems.slice(0, 2).map((item) => (
                            <Pressable
                              key={item.id}
                              onPress={() => openEdit(item)}
                              style={styles.calendarEvent}
                            >
                              <Text
                                numberOfLines={1}
                                style={styles.calendarEventTime}
                              >
                                {item.time}
                              </Text>
                              <Text
                                numberOfLines={1}
                                style={styles.calendarEventName}
                              >
                                {item.client}
                              </Text>
                            </Pressable>
                          ))}
                        {wide && cellItems.length > 2 && (
                          <Text style={styles.calendarMore}>
                            +{cellItems.length - 2} compromisso
                            {cellItems.length - 2 === 1 ? "" : "s"}
                          </Text>
                        )}
                        {!wide && cellItems.length > 0 && (
                          <Text style={styles.calendarMobileCount}>
                            {cellItems.length}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.calendarDayListHeader}>
                  <Text style={styles.calendarDayListTitle}>
                    {longDate(selectedDate)}
                  </Text>
                  <Text style={styles.calendarDayListSubtitle}>
                    {filteredDayItems.length} compromisso
                    {filteredDayItems.length === 1 ? "" : "s"}
                  </Text>
                </View>
                <AppointmentDayList
                  items={dayItems}
                  loading={agendaLoading}
                  wide={wide}
                  onMobileActions={setMobileActionsItem}
                  onDesktopActions={rowActionsMenu.open}
                  onCreateNew={openNew}
                />
              </View>
            )}
          </View>
          {Platform.OS === "web" && <View style={[styles.footer, !wide && styles.footerMobile]}>
            <Text style={styles.footerBrand}>
              rotina<Text style={styles.accent}>ê</Text>
            </Text>
            <Text style={styles.footerText}>
              © {new Date().getFullYear()} Rotinaê. Todos os direitos
              reservados.
            </Text>
          </View>}
        </View>
      </ScrollView>

      <Modal
        visible={blockModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBlockModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={[styles.backdrop, !wide && styles.backdropMobile]}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <View accessibilityViewIsModal style={[styles.blockModal, !wide && styles.blockModalMobile]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Bloquear agenda</Text>
                <Text style={styles.modalSubtitle}>
                  Impeça novas solicitações de clientes neste período.
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Fechar bloqueio"
                onPress={() => setBlockModalVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.formModalScroll}
              contentContainerStyle={styles.blockFormContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.formRow, !wide && styles.formRowMobile]}>
                <View style={styles.rowField}>
                  <Text style={styles.label}>Data de início<Text style={styles.requiredMark}> *</Text></Text>
                  <DatePickerField
                    label="Data de início do bloqueio"
                    value={blockStartDate}
                    onChangeText={(text) => { setBlockStartDate(maskDate(text)); setBlockFieldErrors((current) => ({ ...current, blockStartDate: undefined })); }}
                    keyboardType="number-pad"
                    maxLength={10}
                    placeholder="DD/MM/AAAA"
                    invalid={!!blockFieldErrors.blockStartDate}
                  />
                  {!!blockFieldErrors.blockStartDate && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{blockFieldErrors.blockStartDate}</Text>}
                </View>
                <View style={styles.rowField}>
                  <Text style={styles.label}>Horário de início<Text style={styles.requiredMark}> *</Text></Text>
                  <TimePickerField
                    label="Horário de início do bloqueio"
                    value={blockStartTime}
                    onChangeText={(text) => { setBlockStartTime(maskTime(text)); setBlockFieldErrors((current) => ({ ...current, blockStartTime: undefined })); }}
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="HH:MM"
                    invalid={!!blockFieldErrors.blockStartTime}
                  />
                  {!!blockFieldErrors.blockStartTime && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{blockFieldErrors.blockStartTime}</Text>}
                </View>
              </View>
              <View style={[styles.formRow, !wide && styles.formRowMobile]}>
                <View style={styles.rowField}>
                  <Text style={styles.label}>Data de fim<Text style={styles.requiredMark}> *</Text></Text>
                  <DatePickerField
                    label="Data de fim do bloqueio"
                    value={blockEndDate}
                    onChangeText={(text) => { setBlockEndDate(maskDate(text)); setBlockFieldErrors((current) => ({ ...current, blockEndDate: undefined })); }}
                    keyboardType="number-pad"
                    maxLength={10}
                    placeholder="DD/MM/AAAA"
                    invalid={!!blockFieldErrors.blockEndDate}
                  />
                  {!!blockFieldErrors.blockEndDate && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{blockFieldErrors.blockEndDate}</Text>}
                </View>
                <View style={styles.rowField}>
                  <Text style={styles.label}>Horário de fim<Text style={styles.requiredMark}> *</Text></Text>
                  <TimePickerField
                    label="Horário de fim do bloqueio"
                    value={blockEndTime}
                    onChangeText={(text) => { setBlockEndTime(maskTime(text)); setBlockFieldErrors((current) => ({ ...current, blockEndTime: undefined })); }}
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="HH:MM"
                    invalid={!!blockFieldErrors.blockEndTime}
                  />
                  {!!blockFieldErrors.blockEndTime && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{blockFieldErrors.blockEndTime}</Text>}
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>
                  Motivo <Text style={styles.optional}>(opcional)</Text>
                </Text>
                <TextInput
                  value={blockReason}
                  onChangeText={setBlockReason}
                  placeholder="Ex.: Férias, compromisso pessoal"
                  placeholderTextColor={colors.mutedSoft}
                  style={styles.input}
                />
              </View>
              {blockError && (
                <View style={styles.error}>
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    {blockError}
                  </Text>
                </View>
              )}
            </ScrollView>
            <View style={styles.formActions}>
              <Pressable
                disabled={savingBlock}
                onPress={() => setBlockModalVisible(false)}
                style={[styles.cancelButton, styles.formActionButton, savingBlock && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: savingBlock, busy: savingBlock }}
                disabled={savingBlock}
                onPress={() => saveBlockedPeriod()}
                style={({ pressed }) => [styles.saveButton, styles.formActionButton, pressed && !savingBlock && { opacity: opacity.pressed }]}
              >
                {savingBlock && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.saveButtonText}>Confirmar bloqueio</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={blockError !== ""}
        transparent
        animationType="fade"
        onRequestClose={() => setBlockError("")}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.confirmIcon}>
              <AppIcon name="error" size={24} color={colors.danger} />
            </View>
            <Text style={styles.confirmTitle}>Não foi possível bloquear</Text>
            <Text accessibilityRole="alert" style={styles.confirmText}>
              {blockError}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setBlockError("")}
                style={styles.saveButton}
              >
                <Text style={styles.saveButtonText}>Corrigir informações</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={blockConflictVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBlockConflictVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.manualConfirmIcon}>
              <AppIcon name="calendar" size={24} color={colors.success} />
            </View>
            <Text style={styles.confirmTitle}>
              Há compromissos neste período
            </Text>
            <Text style={styles.confirmText}>
              Eles serão preservados e não serão cancelados. O bloqueio impedirá
              somente novas solicitações feitas por clientes.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={savingBlock}
                onPress={() => setBlockConflictVisible(false)}
                style={[styles.cancelButton, savingBlock && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Revisar período</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: savingBlock, busy: savingBlock }}
                disabled={savingBlock}
                onPress={() => saveBlockedPeriod(true)}
                style={({ pressed }) => [styles.saveButton, pressed && !savingBlock && { opacity: opacity.pressed }]}
              >
                {savingBlock && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.saveButtonText}>Bloquear mesmo assim</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={blockSuccessVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBlockSuccessVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.manualConfirmIcon}>
              <AppIcon name="success" size={24} color={colors.success} />
            </View>
            <Text style={styles.confirmTitle}>Agenda bloqueada</Text>
            <Text style={styles.confirmText}>
              Clientes não poderão solicitar horários nesse intervalo. Você
              continuará podendo adicionar compromissos manualmente.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setBlockSuccessVisible(false)}
                style={styles.saveButton}
              >
                <Text style={styles.saveButtonText}>Entendi</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={providerOverrideVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setProviderOverrideVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.manualConfirmIcon}>
              <AppIcon name="lock" size={24} color={colors.success} />
            </View>
            <Text style={styles.confirmTitle}>
              Horário bloqueado para clientes
            </Text>
            <Text style={styles.confirmText}>
              Como prestador, você pode adicionar este compromisso. O bloqueio
              continuará ativo para novas solicitações dos clientes.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={saving}
                onPress={() => setProviderOverrideVisible(false)}
                style={[styles.cancelButton, saving && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>
                  Escolher outro horário
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving, busy: saving }}
                disabled={saving}
                onPress={() => save(true)}
                style={({ pressed }) => [styles.saveButton, pressed && !saving && { opacity: opacity.pressed }]}
              >
                {saving && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.saveButtonText}>Adicionar mesmo assim</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={statusPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusPickerVisible(false)}
      >
        <Pressable
          onPress={() => setStatusPickerVisible(false)}
          style={styles.backdrop}
        >
          <Pressable onPress={() => undefined} style={styles.statusPickerModal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Filtrar por status</Text>
                <Text style={styles.modalSubtitle}>
                  Selecione quais compromissos deseja visualizar.
                </Text>
              </View>
              <Pressable
                onPress={() => setStatusPickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.statusPickerOptions}>
              {(
                [
                  "Todos",
                  "Confirmado",
                  "A confirmar",
                  "Concluído",
                  "Cancelado",
                ] as const
              ).map((item) => (
                <Pressable
                  key={item}
                  onPress={() => {
                    setFilter(item);
                    setStatusPickerVisible(false);
                  }}
                  style={[
                    styles.statusPickerOption,
                    filter === item && styles.statusPickerOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPickerOptionText,
                      filter === item && styles.statusPickerOptionTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                  {filter === item && (
                    <AppIcon name="success" size={20} color={colors.brand} />
                  )}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={recurrenceCalendarVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRecurrenceCalendarVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.recurrenceCalendarModal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Selecionar dias</Text>
                <Text style={styles.modalSubtitle}>
                  {recurrenceSelectedDates.length + 1} de 24 dias selecionados
                </Text>
              </View>
              <Pressable
                onPress={() => setRecurrenceCalendarVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.recurrenceCalendarScroll}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.recurrenceCalendarHeader}>
                <Pressable
                  onPress={() => moveRecurrenceMonth(-1)}
                  style={styles.calendarNav}
                >
                  <AppIcon name="back" size={18} color={colors.brand} />
                </Pressable>
                <Text style={styles.recurrenceCalendarTitle}>
                  {new Intl.DateTimeFormat("pt-BR", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(recurrenceCalendarUtc)}
                </Text>
                <Pressable
                  onPress={() => moveRecurrenceMonth(1)}
                  style={styles.calendarNav}
                >
                  <AppIcon name="forward" size={18} color={colors.brand} />
                </Pressable>
              </View>
              <View style={styles.weekHeader}>
                {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((item) => (
                  <Text key={item} style={styles.weekLabel}>
                    {item}
                  </Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {recurrenceCalendarCells.map((day, index) => {
                  if (!day)
                    return (
                      <View
                        key={`rec-empty-${index}`}
                        style={[
                          styles.calendarCell,
                          styles.calendarCellMobile,
                          styles.calendarCellEmpty,
                        ]}
                      />
                    );
                  const itemDate = utcToDate(
                    new Date(
                      Date.UTC(
                        recurrenceCalendarYear,
                        recurrenceCalendarMonth,
                        day,
                      ),
                    ),
                  );
                  const selected =
                    itemDate === date ||
                    recurrenceSelectedDates.includes(itemDate);
                  return (
                    <Pressable
                      key={itemDate}
                      onPress={() => toggleRecurrenceDate(day)}
                      style={[
                        styles.calendarCell,
                        styles.calendarCellMobile,
                        selected && styles.calendarCellSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.calendarDay,
                          selected && styles.calendarDaySelected,
                        ]}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <View style={styles.recurrenceCalendarActions}>
              <Text style={[styles.fieldHint, styles.recurrenceCalendarHint]}>
                A primeira data do formulário já está incluída.
              </Text>
              <Pressable
                onPress={() => setRecurrenceCalendarVisible(false)}
                style={styles.saveButton}
              >
                <Text style={styles.saveButtonText}>Concluir seleção</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {/* Bloco duplicado e incompleto removido da renderização. */}{/*
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.manualConfirmIcon}>
              <AppIcon name="lock" size={24} color={colors.success} />
            </View>
            <Text style={styles.confirmTitle}>
              Horário bloqueado para clientes
            </Text>
            <Text style={styles.confirmText}>
              Como prestador, você pode adicionar este compromisso. O bloqueio
              continuará ativo para novas solicitações dos clientes.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setProviderOverrideVisible(false)}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonText}>
                  Escolher outro horário
                </Text>
              </Pressable>
              <Pressable onPress={() => save(true)} style={styles.saveButton}>
                <Text style={styles.saveButtonText}>Adicionar mesmo assim</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={statusPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusPickerVisible(false)}
      >
        <Pressable
          onPress={() => setStatusPickerVisible(false)}
          style={styles.backdrop}
        >
          <Pressable onPress={() => undefined} style={styles.statusPickerModal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Filtrar por status</Text>
                <Text style={styles.modalSubtitle}>
                  Selecione quais compromissos deseja visualizar.
                </Text>
              </View>
              <Pressable
                onPress={() => setStatusPickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.statusPickerOptions}>
              {(
                [
                  "Todos",
                  "Confirmado",
                  "A confirmar",
                  "Concluído",
                  "Cancelado",
                ] as const
              ).map((item) => (
                <Pressable
                  key={item}
                  onPress={() => {
                    setFilter(item);
                    setStatusPickerVisible(false);
                  }}
                  style={[
                    styles.statusPickerOption,
                    filter === item && styles.statusPickerOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPickerOptionText,
                      filter === item && styles.statusPickerOptionTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                  {filter === item && (
                    <AppIcon name="success" size={20} color={colors.brand} />
                  )}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={recurrenceCalendarVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRecurrenceCalendarVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.recurrenceCalendarModal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Selecionar dias</Text>
                <Text style={styles.modalSubtitle}>
                  {recurrenceSelectedDates.length + 1} de 24 dias selecionados
                </Text>
              </View>
              <Pressable
                onPress={() => setRecurrenceCalendarVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.recurrenceCalendarScroll}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.recurrenceCalendarHeader}>
                <Pressable
                  onPress={() => moveRecurrenceMonth(-1)}
                  style={styles.calendarNav}
                >
                  <AppIcon name="back" size={18} color={colors.brand} />
                </Pressable>
                <Text style={styles.recurrenceCalendarTitle}>
                  {new Intl.DateTimeFormat("pt-BR", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(recurrenceCalendarUtc)}
                </Text>
                <Pressable
                  onPress={() => moveRecurrenceMonth(1)}
                  style={styles.calendarNav}
                >
                  <AppIcon name="forward" size={18} color={colors.brand} />
                </Pressable>
              </View>
              <View style={styles.weekHeader}>
                {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((item) => (
                  <Text key={item} style={styles.weekLabel}>
                    {item}
                  </Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {recurrenceCalendarCells.map((day, index) => {
                  if (!day)
                    return (
                      <View
                        key={`rec-empty-${index}`}
                        style={[
                          styles.calendarCell,
                          styles.calendarCellMobile,
                          styles.calendarCellEmpty,
                        ]}
                      />
                    );
                  const itemDate = utcToDate(
                    new Date(
                      Date.UTC(
                        recurrenceCalendarYear,
                        recurrenceCalendarMonth,
                        day,
                      ),
                    ),
                  );
                  const selected =
                    itemDate === date ||
                    recurrenceSelectedDates.includes(itemDate);
                  return (
                    <Pressable
                      key={itemDate}
                      onPress={() => toggleRecurrenceDate(day)}
                      style={[
                        styles.calendarCell,
                        styles.calendarCellMobile,
                        selected && styles.calendarCellSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.calendarDay,
                          selected && styles.calendarDaySelected,
                        ]}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <View style={styles.recurrenceCalendarActions}>
              <Text style={[styles.fieldHint, styles.recurrenceCalendarHint]}>
                A primeira data do formulário já está incluída.
              </Text>
              <Pressable
                onPress={() => setRecurrenceCalendarVisible(false)}
                style={styles.saveButton}
              >
                <Text style={styles.saveButtonText}>Concluir seleção</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      */}
      <Modal
        visible={monthPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthPickerVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.monthPickerModal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Filtrar mês e ano</Text>
                <Text style={styles.modalSubtitle}>
                  Escolha o período da agenda.
                </Text>
              </View>
              <Pressable
                onPress={() => setMonthPickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <Text style={styles.pickerLabel}>Ano</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.yearOptions}
            >
              {pickerYears.map((year) => (
                <Pressable
                  key={year}
                  onPress={() => setPickerYear(year)}
                  style={[
                    styles.yearOption,
                    pickerYear === year && styles.yearOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.yearOptionText,
                      pickerYear === year && styles.yearOptionTextActive,
                    ]}
                  >
                    {year}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.pickerLabel}>Mês</Text>
            <View style={styles.monthOptions}>
              {pickerMonths.map((month) => (
                <Pressable
                  key={month}
                  onPress={() => {
                    setSelectedDate(`01/${month}/${pickerYear}`);
                    setMonthPickerVisible(false);
                    setPage(1);
                  }}
                  style={[
                    styles.monthOption,
                    month === String(calendarMonth + 1).padStart(2, "0") &&
                      pickerYear === String(calendarYear) &&
                      styles.monthOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.monthOptionNumber,
                      month === String(calendarMonth + 1).padStart(2, "0") &&
                        pickerYear === String(calendarYear) &&
                        styles.monthOptionTextActive,
                    ]}
                  >
                    {month}
                  </Text>
                  <Text
                    style={[
                      styles.monthOptionName,
                      month === String(calendarMonth + 1).padStart(2, "0") &&
                        pickerYear === String(calendarYear) &&
                        styles.monthOptionTextActive,
                    ]}
                  >
                    {new Intl.DateTimeFormat("pt-BR", {
                      month: "short",
                      timeZone: "UTC",
                    })
                      .format(new Date(Date.UTC(2026, Number(month) - 1, 1)))
                      .replace(".", "")}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={formVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFormVisible(false)}
      >
        <KeyboardAvoidingView
          style={[styles.backdrop, !wide && styles.backdropMobile]}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <View style={[styles.formModal, !wide && styles.formModalMobile]}>
            <ScrollView
              style={styles.formModalScroll}
              contentContainerStyle={[styles.formContent, !wide && styles.formContentMobile]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderCopy}>
                  <Text style={styles.modalTitle}>
                    {editingId ? "Editar agendamento" : "Novo agendamento"}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    Preencha os dados do compromisso.
                  </Text>
                </View>
                <Pressable
                  onPress={() => setFormVisible(false)}
                  style={styles.closeButton}
                >
                  <AppIcon name="error" size={20} color={colors.muted} />
                </Pressable>
              </View>
              <View style={styles.form}>
                <View style={styles.field}>
                  <Text style={styles.label}>
                    Título {!client && <Text style={styles.requiredMark}>*</Text>}
                    {!!client && <Text style={styles.optional}> (opcional)</Text>}
                  </Text>
                  <TextInput
                    accessibilityLabel="Título do compromisso"
                    editable={!editingId}
                    maxLength={120}
                    onChangeText={(nextTitle) => {
                      setTitle(nextTitle);
                      setFieldErrors((current) => ({ ...current, title: undefined }));
                      setError("");
                    }}
                    placeholder="Ex.: Reunião, almoço ou bloqueio pessoal"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, !!fieldErrors.title && styles.inputError]}
                    value={title}
                  />
                  {!!fieldErrors.title && (
                    <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.title}</Text>
                  )}
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>
                    Cliente <Text style={styles.optional}>(opcional)</Text>
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      client
                        ? `Cliente selecionado: ${client}`
                        : "Selecionar cliente (opcional)"
                    }
                    onPress={() => {
                      setClientQuery("");
                      setClientPage(1);
                      setClientPickerVisible(true);
                    }}
                    style={styles.clientSelector}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.clientSelectorText,
                        !client && styles.clientSelectorPlaceholder,
                      ]}
                    >
                      {client || "Selecione um cliente (opcional)"}
                    </Text>
                    <AppIcon
                      name="forward"
                      size={16}
                      color={colors.mutedSoft}
                    />
                  </Pressable>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>
                    Serviço {!!client && <Text style={styles.requiredMark}>*</Text>}
                    {!client && <Text style={styles.optional}> (opcional)</Text>}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      service
                        ? `Serviço selecionado: ${service}`
                        : client ? "Selecionar serviço" : "Selecionar serviço (opcional)"
                    }
                    onPress={() => {
                      setServiceQuery("");
                      setServicePickerVisible(true);
                    }}
                    style={[
                      styles.serviceSelector,
                      !!fieldErrors.service && styles.inputError,
                    ]}
                  >
                    <View style={styles.serviceSelectorLeft}>
                      <View style={styles.serviceSelectorIcon}>
                        <AppIcon name="services" size={16} color={colors.brand} />
                      </View>
                      <View style={styles.serviceSelectorCopy}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.serviceSelectorText,
                            !service && styles.clientSelectorPlaceholder,
                          ]}
                        >
                          {service || (client ? "Selecione um serviço" : "Sem serviço")}
                        </Text>
                        {selectedServiceObj && (
                          <Text style={styles.serviceSelectorMeta}>
                            {selectedServiceObj.durationMinutes} min
                          </Text>
                        )}
                      </View>
                    </View>
                    <AppIcon
                      name="forward"
                      size={16}
                      color={colors.mutedSoft}
                    />
                  </Pressable>
                  {!!fieldErrors.service && (
                    <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                      {fieldErrors.service}
                    </Text>
                  )}
                </View>
                <View style={[styles.formRow, !wide && styles.formRowMobile]}>
                  <View style={styles.rowField}>
                    <Text style={styles.label}>Data<Text style={styles.requiredMark}> *</Text></Text>
                    <DatePickerField
                      label="Data do agendamento"
                      value={date}
                      onChangeText={(text) => { setDate(maskDate(text)); setFieldErrors((current) => ({ ...current, date: undefined })); }}
                      keyboardType="number-pad"
                      maxLength={10}
                      placeholder="DD/MM/AAAA"
                      invalid={!!fieldErrors.date}
                      maxDate={appointmentMaxDate}
                    />
                    {!!fieldErrors.date && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.date}</Text>}
                  </View>
                  <View style={styles.rowField}>
                    <Text style={styles.label}>
                      Início<Text style={styles.requiredMark}> *</Text>
                    </Text>
                    <TimePickerField
                      label="Horário de início do agendamento"
                      accessibilityLabel="Horário de início no formato hora e minuto"
                      value={time}
                      onChangeText={(text) => {
                        const masked = maskTime(text);
                        setTime(masked);
                        setFieldErrors((current) => ({ ...current, time: undefined }));
                        if (validTime(masked)) {
                          const selectedService = serviceOptions.find(
                            (s) => s.name.trim().toLowerCase() === service.trim().toLowerCase()
                          );
                          const duration = selectedService?.durationMinutes ?? 60;
                          setEndTime(calculateEndTime(masked, duration));
                        }
                      }}
                      keyboardType="number-pad"
                      maxLength={5}
                      placeholder="Ex.: 09:30"
                      invalid={!!fieldErrors.time}
                    />
                    {!!fieldErrors.time && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.time}</Text>}
                  </View>
                  <View style={styles.rowField}>
                    <Text style={styles.label}>
                      Término<Text style={styles.requiredMark}> *</Text>
                    </Text>
                    <TimePickerField
                      label="Horário de término do agendamento"
                      accessibilityLabel="Horário de término no formato hora e minuto"
                      value={endTime}
                      onChangeText={(text) => {
                        const masked = maskTime(text);
                        setEndTime(masked);
                        setFieldErrors((current) => ({ ...current, endTime: undefined }));
                      }}
                      keyboardType="number-pad"
                      maxLength={5}
                      placeholder="Ex.: 10:30"
                      invalid={!!fieldErrors.endTime}
                    />
                    {!!fieldErrors.endTime && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.endTime}</Text>}
                  </View>
                </View>
                <View style={styles.recurrenceBox}>
                  <View
                    style={[
                      styles.recurrenceHeader,
                      !wide && styles.recurrenceHeaderMobile,
                    ]}
                  >
                    <View style={styles.recurrenceHeaderCopy}>
                      <Text style={styles.label}>Agendamento recorrente</Text>
                      <Text style={styles.fieldHint}>
                        Repita este compromisso para o mesmo cliente, serviço e
                        horário.
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.modeToggle,
                        !wide && styles.modeToggleMobile,
                      ]}
                    >
                      <Pressable
                        onPress={() => {
                          setMultipleDays(false);
                          setRecurrenceSelectedDates([]);
                        }}
                        style={[
                          styles.modeOption,
                          !wide && styles.modeOptionMobile,
                          !multipleDays && styles.modeOptionActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modeOptionText,
                            !multipleDays && styles.modeOptionTextActive,
                          ]}
                        >
                          Não
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setMultipleDays(true);
                          setRecurrenceCalendarDate(date);
                        }}
                        style={[
                          styles.modeOption,
                          !wide && styles.modeOptionMobile,
                          multipleDays && styles.modeOptionActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modeOptionText,
                            multipleDays && styles.modeOptionTextActive,
                          ]}
                        >
                          Sim
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  {false && multipleDays && (
                    <View style={styles.recurrenceContent}>
                      <Pressable
                        onPress={() => {
                          setRecurrenceCalendarDate(date);
                          setRecurrenceCalendarVisible(true);
                        }}
                        style={styles.calendarSelectButton}
                      >
                        <AppIcon
                          name="calendar"
                          size={20}
                          color={colors.brand}
                        />
                        <View style={styles.calendarSelectCopy}>
                          <Text style={styles.calendarSelectTitle}>
                            Selecionar dias no calendário
                          </Text>
                          <Text style={styles.fieldHint}>
                            {recurrenceSelectedDates.length
                              ? `${recurrenceSelectedDates.length + 1} dias selecionados`
                              : "Marque manualmente os dias da recorrência"}
                          </Text>
                        </View>
                        <AppIcon
                          name="forward"
                          size={16}
                          color={colors.mutedSoft}
                        />
                      </Pressable>
                      {!!recurrenceSelectedDates.length && (
                        <View style={styles.recurrenceDates}>
                          {[date, ...recurrenceSelectedDates].map(
                            (item, index) => (
                              <View
                                key={`${item}-${index}`}
                                style={styles.recurrenceDate}
                              >
                                <Text style={styles.recurrenceDateText}>
                                  {item}
                                </Text>
                              </View>
                            ),
                          )}
                        </View>
                      )}
                      <Text style={styles.recurrenceDivider}>
                        OU REPITA AUTOMATICAMENTE
                      </Text>
                      <Text style={styles.miniLabel}>Frequência</Text>
                      <View style={styles.recurrenceOptions}>
                        {(
                          [
                            { id: "weekly", label: "Semanal" },
                            { id: "biweekly", label: "Quinzenal" },
                            { id: "monthly", label: "Mensal" },
                          ] as const
                        ).map((item) => (
                          <Pressable
                            key={item.id}
                            onPress={() => {
                              setRecurrenceFrequency(item.id);
                              setRecurrenceSelectedDates([]);
                            }}
                            style={[
                              styles.recurrenceOption,
                              recurrenceFrequency === item.id &&
                                styles.recurrenceOptionActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.recurrenceOptionText,
                                recurrenceFrequency === item.id &&
                                  styles.recurrenceOptionTextActive,
                              ]}
                            >
                              {item.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <View style={styles.field}>
                        <Text style={styles.miniLabel}>Quantidade de dias</Text>
                        <TextInput
                          accessibilityLabel="Quantidade de ocorrências recorrentes"
                          value={recurrenceCount}
                          onChangeText={(text) => {
                            setRecurrenceCount(
                              text.replace(/\D/g, "").slice(0, 2),
                            );
                            setRecurrenceSelectedDates([]);
                          }}
                          keyboardType="number-pad"
                          placeholder="Ex.: 4"
                          placeholderTextColor={colors.mutedSoft}
                          style={styles.input}
                        />
                        <Text style={styles.fieldHint}>
                          Mínimo de 2 e máximo de 24, incluindo a primeira data.
                        </Text>
                      </View>
                      {validDate(date) && Number(recurrenceCount) >= 2 && (
                        <View style={styles.recurrencePreview}>
                          <Text style={styles.recurrencePreviewTitle}>
                            Datas previstas
                          </Text>
                          <View style={styles.recurrenceDates}>
                            {recurrenceDates(
                              date,
                              recurrenceFrequency,
                              Math.min(24, Number(recurrenceCount)),
                            ).map((item, index) => (
                              <View
                                key={`${item}-${index}`}
                                style={styles.recurrenceDate}
                              >
                                <Text style={styles.recurrenceDateText}>
                                  {item}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                  {multipleDays && (
                    <View style={styles.recurrenceInlineCalendar}>
                      <View
                        style={[
                          styles.recurrenceInlineHeader,
                          !wide && styles.recurrenceInlineHeaderMobile,
                        ]}
                      >
                        <View style={styles.recurrenceInlineHeading}>
                          <Text style={styles.recurrenceInlineTitle}>
                            Selecione os dias
                          </Text>
                          <Text style={styles.fieldHint}>
                            {recurrenceSelectedDates.length + 1} de 24 dias
                            selecionados
                          </Text>
                        </View>
                        <View style={styles.recurrenceInlineNav}>
                          <Pressable
                            onPress={() => moveRecurrenceMonth(-1)}
                            style={styles.calendarNav}
                          >
                            <AppIcon
                              name="back"
                              size={18}
                              color={colors.brand}
                            />
                          </Pressable>
                          <Text style={styles.recurrenceInlineMonth}>
                            {new Intl.DateTimeFormat("pt-BR", {
                              month: "long",
                              year: "numeric",
                              timeZone: "UTC",
                            }).format(recurrenceCalendarUtc)}
                          </Text>
                          <Pressable
                            onPress={() => moveRecurrenceMonth(1)}
                            style={styles.calendarNav}
                          >
                            <AppIcon
                              name="forward"
                              size={18}
                              color={colors.brand}
                            />
                          </Pressable>
                        </View>
                      </View>
                      <View style={styles.weekHeader}>
                        {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map(
                          (item) => (
                            <Text key={item} style={styles.weekLabel}>
                              {item}
                            </Text>
                          ),
                        )}
                      </View>
                      <View style={styles.calendarGrid}>
                        {recurrenceCalendarCells.map((day, index) => {
                          if (!day)
                            return (
                              <View
                                key={`inline-empty-${index}`}
                                style={[
                                  styles.calendarCell,
                                  styles.calendarCellMobile,
                                  styles.calendarCellEmpty,
                                ]}
                              />
                            );
                          const itemDate = utcToDate(
                            new Date(
                              Date.UTC(
                                recurrenceCalendarYear,
                                recurrenceCalendarMonth,
                                day,
                              ),
                            ),
                          );
                          const selected =
                            itemDate === date ||
                            recurrenceSelectedDates.includes(itemDate);
                          return (
                            <Pressable
                              key={itemDate}
                              onPress={() => toggleRecurrenceDate(day)}
                              style={[
                                styles.calendarCell,
                                styles.calendarCellMobile,
                                selected && styles.calendarCellSelected,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.calendarDay,
                                  selected && styles.calendarDaySelected,
                                ]}
                              >
                                {day}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Situação</Text>
                  <View style={styles.statusSelector}>
                    {(
                      [
                        "Confirmado",
                        "A confirmar",
                        "Concluído",
                        "Cancelado",
                      ] as AppointmentStatus[]
                    ).map((item) => {
                      const icon =
                        item === "Confirmado"
                          ? "success"
                          : item === "A confirmar"
                            ? "schedule"
                            : item === "Concluído"
                              ? "success"
                              : "error";
                      return (
                        <Pressable
                          key={item}
                          onPress={() => setStatus(item)}
                          style={[
                            styles.statusOption,
                            status === item && styles.statusOptionActive,
                          ]}
                        >
                          <AppIcon
                            name={icon}
                            size={16}
                            color={status === item ? colors.onBrand : colors.muted}
                          />
                          <Text
                            style={[
                              styles.statusOptionText,
                              status === item && styles.statusOptionTextActive,
                            ]}
                          >
                            {item}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>
                    Mensagem para o cliente{" "}
                    <Text style={styles.optional}>(opcional)</Text>
                  </Text>
                  <Text style={styles.fieldHint}>
                    Esta mensagem será exibida ao cliente junto aos detalhes do
                    agendamento.
                  </Text>
                  <TextInput
                    value={clientMessage}
                    onChangeText={setClientMessage}
                    multiline
                    numberOfLines={3}
                    placeholder="Ex.: Traga os exames da última consulta."
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, styles.notes]}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>
                    Observação interna{" "}
                    <Text style={styles.optional}>(opcional)</Text>
                  </Text>
                  <Text style={styles.fieldHint}>
                    Visível somente para você. O cliente não terá acesso.
                  </Text>
                  <TextInput
                    value={internalNotes}
                    onChangeText={setInternalNotes}
                    multiline
                    numberOfLines={3}
                    placeholder="Anotações internas sobre o atendimento"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, styles.notes]}
                  />
                </View>
                {error ? (
                  <View style={styles.error}>
                    <AppIcon name="warning" size={16} color={colors.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}
                <View style={styles.formActions}>
                  <Pressable
                    disabled={saving}
                    onPress={() => setFormVisible(false)}
                    style={[styles.cancelButton, styles.formActionButton, saving && { opacity: opacity.disabled }]}
                  >
                    <Text style={styles.cancelButtonText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: saving, busy: saving }}
                    disabled={saving}
                    onPress={() => save()}
                    style={({ pressed }) => [styles.saveButton, styles.formActionButton, pressed && !saving && { opacity: opacity.pressed }]}
                  >
                    {saving && <ActivityIndicator size="small" color={colors.onBrand} />}
                    <Text style={styles.saveButtonText}>
                      {editingId ? "Salvar" : "Agendar"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={servicePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setServicePickerVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.clientPickerModal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Selecionar serviço</Text>
                <Text style={styles.modalSubtitle}>
                  {filteredServices.length} serviço(s) disponível(is)
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Fechar seleção de serviço"
                onPress={() => setServicePickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            {serviceOptions.length > 3 && (
              <View style={styles.clientSearch}>
                <AppIcon name="search" size={20} color={colors.mutedSoft} />
                <TextInput
                  value={serviceQuery}
                  onChangeText={setServiceQuery}
                  placeholder="Buscar serviço..."
                  placeholderTextColor={colors.mutedSoft}
                  style={styles.clientSearchInput}
                />
              </View>
            )}
            <ScrollView
              style={styles.clientPickerList}
              contentContainerStyle={styles.clientPickerItems}
            >
              {!client && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Criar compromisso sem serviço"
                  onPress={() => {
                    setService("");
                    setValue("");
                    setFieldErrors((current) => ({ ...current, service: undefined }));
                    setServicePickerVisible(false);
                    setError("");
                  }}
                  style={[styles.servicePickerItem, !service && styles.servicePickerItemActive]}
                >
                  <View style={styles.servicePickerAvatar}>
                    <AppIcon name="services" size={18} color={colors.brand} />
                  </View>
                  <View style={styles.serviceSelectorCopy}>
                    <Text style={styles.servicePickerName}>Sem serviço</Text>
                    <Text style={styles.serviceSelectorMeta}>Compromisso livre</Text>
                  </View>
                </Pressable>
              )}
              {filteredServices.map((item) => {
                const isSelected =
                  item.name.trim().toLocaleLowerCase("pt-BR") ===
                  service.trim().toLocaleLowerCase("pt-BR");
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      setService(item.name);
                      setValue(
                        item.referenceValueCents > 0
                          ? (item.referenceValueCents / 100)
                              .toFixed(2)
                              .replace(".", ",")
                          : "",
                      );
                      setFieldErrors((current) => ({
                        ...current,
                        service: undefined,
                      }));
                      if (validTime(time)) {
                        setEndTime(calculateEndTime(time, item.durationMinutes));
                      }
                      setServicePickerVisible(false);
                      setError("");
                    }}
                    style={[
                      styles.servicePickerItem,
                      isSelected && styles.servicePickerItemActive,
                    ]}
                  >
                    <View style={styles.servicePickerAvatar}>
                      <AppIcon
                        name="services"
                        size={18}
                        color={isSelected ? colors.brand : colors.muted}
                      />
                    </View>
                    <View style={styles.serviceSelectorCopy}>
                      <Text
                        style={[
                          styles.servicePickerName,
                          isSelected && styles.servicePickerNameActive,
                        ]}
                      >
                        {item.name}
                      </Text>
                      <Text style={styles.serviceSelectorMeta}>
                        {item.durationMinutes} min
                      </Text>
                    </View>
                    {isSelected ? (
                      <AppIcon name="success" size={20} color={colors.brand} />
                    ) : (
                      <AppIcon name="forward" size={16} color={colors.mutedSoft} />
                    )}
                  </Pressable>
                );
              })}
              {!filteredServices.length && (
                <View style={styles.serviceEmptyNotice}>
                  <Text style={styles.serviceEmptyNoticeText}>
                    Nenhum serviço encontrado.
                  </Text>
                </View>
              )}
            </ScrollView>
            <View style={styles.servicePickerFooter}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setServicePickerVisible(false);
                  setFormVisible(false);
                  router.push("/services" as never);
                }}
                style={styles.servicePickerAddButton}
              >
                <AppIcon name="add" size={16} color={colors.brand} />
                <Text style={styles.servicePickerAddButtonText}>
                  Gerenciar catálogo de serviços
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={clientPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setClientPickerVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.clientPickerModal}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Selecionar cliente</Text>
                <Text style={styles.modalSubtitle}>
                  {filteredClients.length} clientes encontrados
                </Text>
              </View>
              <Pressable
                onPress={() => setClientPickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.clientSearch}>
              <AppIcon name="search" size={20} color={colors.mutedSoft} />
              <TextInput
                value={clientQuery}
                onChangeText={(text) => {
                  setClientQuery(text);
                  setClientPage(1);
                }}
                placeholder="Buscar cliente"
                placeholderTextColor={colors.mutedSoft}
                style={styles.clientSearchInput}
              />
            </View>
            <ScrollView
              style={styles.clientPickerList}
              contentContainerStyle={styles.clientPickerItems}
            >
              <Pressable
                onPress={() => {
                  setClient("");
                  setClientPickerVisible(false);
                  setError("");
                }}
                style={[
                  styles.clientPickerItem,
                  !client && styles.clientPickerItemActive,
                ]}
              >
                <View style={styles.clientPickerAvatar}>
                  <AppIcon name="clients" size={16} color={colors.brand} />
                </View>
                <Text style={styles.clientPickerName}>
                  Sem cliente (agendamento manual)
                </Text>
                {!client && (
                  <AppIcon name="success" size={20} color={colors.success} />
                )}
              </Pressable>
              {visibleClients.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => {
                    setClient(item);
                    setClientPickerVisible(false);
                    setError("");
                  }}
                  style={[
                    styles.clientPickerItem,
                    client === item && styles.clientPickerItemActive,
                  ]}
                >
                  <View style={styles.clientPickerAvatar}>
                    <AppIcon name="user" size={16} color={colors.brand} />
                  </View>
                  <Text style={styles.clientPickerName}>{item}</Text>
                  {client === item && (
                    <AppIcon name="success" size={20} color={colors.success} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.clientPickerPagination}>
              <Text style={styles.paginationInfo}>
                {filteredClients.length
                  ? `${(clientPage - 1) * clientPageSize + 1}–${Math.min(clientPage * clientPageSize, filteredClients.length)} de ${filteredClients.length}`
                  : "0 clientes"}
              </Text>
              <View style={styles.paginationActions}>
                <Pressable
                  disabled={clientPage === 1}
                  onPress={() =>
                    setClientPage((current) => Math.max(1, current - 1))
                  }
                  style={[
                    styles.pageButton,
                    clientPage === 1 && styles.pageButtonDisabled,
                  ]}
                >
                  <AppIcon
                    name="back"
                    size={16}
                    color={clientPage === 1 ? colors.mutedSoft : colors.brand}
                  />
                </Pressable>
                <Text style={styles.pageText}>
                  {clientPage} de {clientTotalPages}
                </Text>
                <Pressable
                  disabled={clientPage === clientTotalPages}
                  onPress={() =>
                    setClientPage((current) =>
                      Math.min(clientTotalPages, current + 1),
                    )
                  }
                  style={[
                    styles.pageButton,
                    clientPage === clientTotalPages &&
                      styles.pageButtonDisabled,
                  ]}
                >
                  <AppIcon
                    name="forward"
                    size={16}
                    color={
                      clientPage === clientTotalPages
                        ? colors.mutedSoft
                        : colors.brand
                    }
                  />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
      {/* ─── Menu de ações do desktop (painel flutuante) ─── */}
      <RowActionsMenu
        position={rowActionsMenu.position}
        onRequestClose={rowActionsMenu.close}
        items={
          rowActionsMenu.item
            ? [
                ...(rowActionsMenu.item.status === "A confirmar"
                  ? [
                      {
                        key: "confirm",
                        label: "Confirmar manualmente",
                        icon: "success" as const,
                        iconBackgroundColor: colors.successSoft,
                        iconColor: colors.success,
                        onPress: () => setManualConfirmId(rowActionsMenu.item!.id),
                      },
                    ]
                  : []),
                ...(rowActionsMenu.item.status !== "Cancelado" && rowActionsMenu.item.status !== "Concluído"
                  ? [
                      {
                        key: "finalize",
                        label: "Marcar como concluído",
                        icon: "success" as const,
                        onPress: () => statusActions.setFinalizeId(rowActionsMenu.item!.id),
                      },
                      {
                        key: "cancel",
                        label: "Cancelar agendamento",
                        icon: "error" as const,
                        iconBackgroundColor: colors.dangerSoft,
                        iconColor: colors.danger,
                        labelColor: colors.danger,
                        onPress: () => statusActions.openCancel(rowActionsMenu.item!.id),
                      },
                    ]
                  : []),
                ...(rowActionsMenu.item.state === "cancelled" ||
                rowActionsMenu.item.state === "completed" ||
                rowActionsMenu.item.state === "no_show"
                  ? [
                      {
                        key: "revert",
                        label: "Reverter para agendado",
                        icon: "schedule" as const,
                        iconBackgroundColor: colors.warningSoft,
                        iconColor: colors.warning,
                        onPress: () => statusActions.setRevertId(rowActionsMenu.item!.id),
                      },
                    ]
                  : []),
                {
                  key: "edit",
                  label: "Editar agendamento",
                  icon: "edit",
                  onPress: () => openEdit(rowActionsMenu.item!),
                },
                {
                  key: "delete",
                  label: hasLinkedClientAccount(rowActionsMenu.item)
                    ? "Excluir (indisponível — use Cancelar)"
                    : "Excluir agendamento",
                  icon: "delete",
                  iconBackgroundColor: colors.dangerSoft,
                  iconColor: hasLinkedClientAccount(rowActionsMenu.item) ? colors.mutedSoft : colors.danger,
                  labelColor: hasLinkedClientAccount(rowActionsMenu.item) ? colors.mutedSoft : colors.danger,
                  onPress: () => onDeletePress(rowActionsMenu.item!),
                },
              ]
            : []
        }
      />

      {/* ─── Modal de ações rápidas (mobile três pontinhos) ─── */}
      {mobileActionsItem !== null && (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() => setMobileActionsItem(null)}
      >
        <Pressable
          style={styles.mobileActionsBackdrop}
          onPress={() => setMobileActionsItem(null)}
        >
          <Pressable style={styles.mobileActionsSheet} onPress={() => {}}>  
            <View style={styles.mobileActionsHandle} />
            <Text style={styles.mobileActionsTitle} numberOfLines={1}>
              {mobileActionsItem?.client ?? ""}
            </Text>
            {/* Confirmar manualmente — só se "A confirmar" */}
            {mobileActionsItem?.status === "A confirmar" && (
              <Pressable
                style={styles.mobileActionRow}
                onPress={() => {
                  setManualConfirmId(mobileActionsItem.id);
                  setMobileActionsItem(null);
                }}
              >
                <View style={[styles.mobileActionIcon, { backgroundColor: colors.successSoft }]}>
                  <AppIcon name="success" size={18} color={colors.success} />
                </View>
                <Text style={styles.mobileActionLabel}>Confirmar manualmente</Text>
              </Pressable>
            )}
            {/* Concluir — se não cancelado nem concluído */}
            {mobileActionsItem?.status !== "Cancelado" &&
              mobileActionsItem?.status !== "Concluído" && (
                <Pressable
                  style={styles.mobileActionRow}
                  onPress={() => {
                    statusActions.setFinalizeId(mobileActionsItem!.id);
                    setMobileActionsItem(null);
                  }}
                >
                  <View style={[styles.mobileActionIcon, { backgroundColor: colors.brandSoft }]}>
                    <AppIcon name="success" size={18} color={colors.brand} />
                  </View>
                  <Text style={styles.mobileActionLabel}>Marcar como concluído</Text>
                </Pressable>
              )}
            {/* Cancelar — se não cancelado nem concluído */}
            {mobileActionsItem?.status !== "Cancelado" &&
              mobileActionsItem?.status !== "Concluído" && (
                <Pressable
                  style={styles.mobileActionRow}
                  onPress={() => {
                    statusActions.openCancel(mobileActionsItem!.id);
                    setMobileActionsItem(null);
                  }}
                >
                  <View style={[styles.mobileActionIcon, { backgroundColor: colors.dangerSoft }]}>
                    <AppIcon name="error" size={18} color={colors.danger} />
                  </View>
                  <Text style={[styles.mobileActionLabel, { color: colors.danger }]}>Cancelar agendamento</Text>
                </Pressable>
              )}
            {/* Reverter para agendado — só em estado terminal (Cancelado,
                Concluído ou Não compareceu) */}
            {(mobileActionsItem?.state === "cancelled" ||
              mobileActionsItem?.state === "completed" ||
              mobileActionsItem?.state === "no_show") && (
                <Pressable
                  style={styles.mobileActionRow}
                  onPress={() => {
                    statusActions.setRevertId(mobileActionsItem!.id);
                    setMobileActionsItem(null);
                  }}
                >
                  <View style={[styles.mobileActionIcon, { backgroundColor: colors.warningSoft }]}>
                    <AppIcon name="schedule" size={18} color={colors.warning} />
                  </View>
                  <Text style={styles.mobileActionLabel}>Reverter para agendado</Text>
                </Pressable>
              )}
            {/* Editar */}
            <Pressable
              style={styles.mobileActionRow}
              onPress={() => {
                openEdit(mobileActionsItem!);
                setMobileActionsItem(null);
              }}
            >
              <View style={[styles.mobileActionIcon, { backgroundColor: colors.brandSoft }]}>
                <AppIcon name="edit" size={18} color={colors.brand} />
              </View>
              <Text style={styles.mobileActionLabel}>Editar agendamento</Text>
            </Pressable>
            {/* Excluir */}
            <Pressable
              style={styles.mobileActionRow}
              onPress={() => {
                onDeletePress(mobileActionsItem!);
                setMobileActionsItem(null);
              }}
            >
              <View style={[styles.mobileActionIcon, { backgroundColor: colors.dangerSoft }]}>
                <AppIcon name="delete" size={18} color={colors.danger} />
              </View>
              <Text
                style={[
                  styles.mobileActionLabel,
                  hasLinkedClientAccount(mobileActionsItem!) && { color: colors.mutedSoft },
                ]}
              >
                {hasLinkedClientAccount(mobileActionsItem!)
                  ? "Excluir (indisponível — use Cancelar)"
                  : "Excluir agendamento"}
              </Text>
            </Pressable>
            {/* Fechar */}
            <Pressable
              style={[styles.mobileActionRow, styles.mobileActionClose]}
              onPress={() => setMobileActionsItem(null)}
            >
              <Text style={styles.mobileActionCloseLabel}>Fechar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      )}
      <Modal
        visible={manualConfirmId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setManualConfirmId(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.manualConfirmIcon}>
              <AppIcon name="success" size={24} color={colors.success} />
            </View>
            <Text style={styles.confirmTitle}>Confirmar manualmente?</Text>
            <Text style={styles.confirmText}>
              Use esta opção quando o cliente não responder. O agendamento será
              marcado como confirmado pelo prestador e essa origem ficará
              registrada.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={confirmingManually}
                onPress={() => setManualConfirmId(null)}
                style={[styles.cancelButton, confirmingManually && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Voltar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: confirmingManually, busy: confirmingManually }}
                disabled={confirmingManually}
                onPress={() => void confirmManually()}
                style={({ pressed }) => [styles.manualConfirmButton, styles.confirmButtonSpinnerRow, pressed && !confirmingManually && { opacity: opacity.pressed }]}
              >
                {confirmingManually && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.manualConfirmButtonText}>
                  Confirmar agendamento
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <AppointmentStatusActionModals actions={statusActions} />
      <Modal
        visible={deleteId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteId(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.confirmIcon}>
              <AppIcon name="delete" size={24} color={colors.danger} />
            </View>
            <Text style={styles.confirmTitle}>Excluir agendamento?</Text>
            <Text style={styles.confirmText}>
              O compromisso será removido da agenda. Essa ação não pode ser
              desfeita.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={removing}
                onPress={() => setDeleteId(null)}
                style={[styles.cancelButton, removing && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: removing, busy: removing }}
                disabled={removing}
                onPress={() => void remove()}
                style={({ pressed }) => [styles.confirmDelete, styles.confirmButtonSpinnerRow, pressed && !removing && { opacity: opacity.pressed }]}
              >
                {removing && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.confirmDeleteText}>Excluir</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={deleteRestrictedVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteRestrictedVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={[styles.confirmIcon, styles.confirmIconWarning]}>
              <AppIcon name="warning" size={24} color={colors.warning} />
            </View>
            <Text style={styles.confirmTitle}>
              Este agendamento não pode ser excluído
            </Text>
            <Text style={styles.confirmText}>
              Este cliente tem conta vinculada ao Rotinaê e já pode ver este
              agendamento. Para removê-lo, use &ldquo;Cancelar
              agendamento&rdquo;.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setDeleteRestrictedVisible(false)}
                style={styles.saveButton}
              >
                <Text style={styles.saveButtonText}>Entendi</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <MobileTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  availabilityModes: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  availabilityMode: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  availabilityModeActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  availabilityModeText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
  },
  availabilityModeTextActive: { color: colors.onBrand },
  limitField: { maxWidth: 420, gap: spacing.xs },
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1 },
  content: {
    width: "100%",
    maxWidth: layout.contentMax,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  contentMobile: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  heading: { gap: spacing.md },
  headingWide: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  eyebrow: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  title: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 36,
    lineHeight: 42,
  },
  titleMobile: { fontSize: 30, lineHeight: 36 },
  description: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
  },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    ...elevation.card,
  },
  primaryButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  headingButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headingButtonsMobile: {
    width: "100%",
    flexDirection: "column",
    alignItems: "stretch",
  },
  blockButton: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  blockButtonText: { color: colors.brand, fontFamily: typography.family.bold },
  blockedSummary: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  blockedSection: {
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  blockedSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  blockedList: { gap: spacing.sm },
  blockedItem: {
    minHeight: 68,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  blockedItemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  blockedItemTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.bold,
  },
  blockedStatus: {
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  blockedStatusText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  removeBlock: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  blockedSummaryIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  blockedSummaryCopy: { flex: 1, minWidth: 0 },
  blockedSummaryTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  blockedSummaryText: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  datePanel: {
    minHeight: 88,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brandDark,
    ...elevation.card,
  },
  navButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  dateCopy: { flex: 1, alignItems: "center" },
  dateTitle: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
    textAlign: "center",
    textTransform: "capitalize",
  },
  dateSubtitle: {
    marginTop: spacing.xs,
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    textAlign: "center",
  },
  metricsViewport: { marginHorizontal: -12, marginVertical: -20 },
  metrics: { gap: spacing.md, paddingHorizontal: 12, paddingVertical: 20 },
  metricsWide: { flexDirection: "row", flexGrow: 1 },
  metric: {
    width: 256,
    minHeight: 168,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  metricWide: { flex: 1, width: "auto" },
  metricIcon: {
    width: 44,
    height: 44,
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  brandMetricIcon: { backgroundColor: colors.brandSoft },
  successMetricIcon: { backgroundColor: colors.successSoft },
  warningMetricIcon: { backgroundColor: colors.warningSoft },
  accentMetricIcon: { backgroundColor: colors.accentSoft },
  metricLabel: {
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
  },
  metricValue: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 28,
    lineHeight: 34,
  },
  metricDetail: {
    marginTop: spacing.xs,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  brandMetricDetail: { color: colors.brand },
  successMetricDetail: { color: colors.success },
  warningMetricDetail: { color: colors.warning },
  accentMetricDetail: { color: colors.brandMid },
  carouselDots: {
    marginTop: -spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  carouselDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
  },
  carouselDotActive: { width: 18, backgroundColor: colors.brand },
  directory: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  toolbar: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarMobile: { alignItems: "stretch", flexDirection: "column" },
  search: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  searchInput: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  filters: { gap: spacing.xs },
  filter: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  filterActive: { backgroundColor: colors.brand },
  filterText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  filterTextActive: { color: colors.onBrand },
  classBadge: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.xs,
    backgroundColor: colors.brandSoft,
  },
  classBadgeText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  value: {
    minWidth: 100,
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    textAlign: "right",
  },
  mobileValue: {
    marginTop: spacing.sm,
    color: colors.brandDark,
    fontFamily: typography.family.bold,
  },
  backdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  backdropMobile: {
    padding: spacing.md,
  },
  formModal: {
    width: "100%",
    maxWidth: 680,
    maxHeight: "92%",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  formModalMobile: {
    borderRadius: radius.md,
  },
  blockModal: {
    width: "100%",
    maxWidth: 680,
    maxHeight: "92%",
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  blockModalScroll: { flexShrink: 1 },
  blockFormContent: { width: "100%", padding: 0 },
  formContent: { padding: spacing.lg },
  formContentMobile: { padding: spacing.md },
  blockModalMobile: { padding: spacing.md, borderRadius: radius.md },
  formModalScroll: { flexShrink: 1 },
  modalHeader: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  modalTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  modalSubtitle: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    flexShrink: 0,
  },
  form: { marginTop: spacing.lg, gap: 20 },
  field: { gap: 6 },
  serviceOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  serviceOption: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  serviceOptionActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  serviceOptionText: { color: colors.muted, fontFamily: typography.family.semibold, fontSize: typography.size.caption },
  serviceOptionTextActive: { color: colors.brandDark },
  serviceEmptyNotice: {
    padding: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.xs,
    backgroundColor: colors.warningSoft,
  },
  serviceEmptyNoticeText: {
    flex: 1,
    minWidth: 160,
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
  },
  serviceEmptyNoticeLink: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  label: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  fieldHint: {
    marginTop: -spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  recurrenceBox: {
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  recurrenceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  recurrenceHeaderMobile: { flexDirection: "column", alignItems: "stretch" },
  recurrenceHeaderCopy: { flex: 1, gap: spacing.xs },
  modeToggle: {
    padding: 3,
    flexDirection: "row",
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  modeToggleMobile: { width: "100%" },
  modeOption: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xs,
  },
  modeOptionMobile: { flex: 1 },
  modeOptionActive: { backgroundColor: colors.brand },
  modeOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  modeOptionTextActive: { color: colors.onBrand },
  recurrenceContent: { gap: spacing.md },
  recurrenceInlineCalendar: {
    marginTop: spacing.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  recurrenceInlineHeader: { padding: spacing.md, gap: spacing.md },
  recurrenceInlineHeaderMobile: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },
  recurrenceInlineHeading: { gap: spacing.sm },
  recurrenceInlineTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
    lineHeight: typography.lineHeight.subtitle,
  },
  recurrenceInlineNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  recurrenceInlineMonth: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
    textAlign: "center",
    textTransform: "capitalize",
  },
  calendarSelectButton: {
    minHeight: 60,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  calendarSelectCopy: { flex: 1 },
  calendarSelectTitle: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  recurrenceDivider: {
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: 10,
    letterSpacing: 1,
    textAlign: "center",
  },
  recurrenceCalendarModal: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "92%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  recurrenceCalendarScroll: { flexShrink: 1 },
  recurrenceCalendarHeader: {
    marginVertical: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  recurrenceCalendarTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
    textAlign: "center",
    textTransform: "capitalize",
  },
  recurrenceCalendarActions: {
    marginTop: spacing.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  recurrenceCalendarHint: { flexShrink: 1, flexGrow: 1, minWidth: 160 },
  miniLabel: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  recurrenceOptions: { flexDirection: "row", gap: spacing.xs },
  recurrenceOption: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  recurrenceOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  recurrenceOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  recurrenceOptionTextActive: { color: colors.brand },
  recurrencePreview: { gap: spacing.sm },
  recurrencePreviewTitle: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  recurrenceDates: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  recurrenceDate: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  recurrenceDateText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  inputError: { borderColor: colors.danger },
  requiredMark: { color: colors.danger },
  fieldErrorText: {
    color: colors.danger,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
    marginTop: 4,
  },
  timeInput: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  timeInputField: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  clientOptions: { gap: spacing.sm },
  clientOption: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  clientOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  clientOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  clientOptionTextActive: { color: colors.onBrand },
  formRow: { flexDirection: "row", gap: spacing.md },
  formRowMobile: { flexDirection: "column", gap: 20 },
  rowField: { flex: 1, width: "100%", gap: 6 },
  currency: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  currencyPrefix: { color: colors.brand, fontFamily: typography.family.bold },
  currencyInput: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
  },
  statusSelector: {
    padding: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  statusOption: {
    flex: 1,
    minWidth: "46%",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.xs,
  },
  statusOptionActive: { backgroundColor: colors.brand },
  statusOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  statusOptionTextActive: { color: colors.onBrand },
  optional: { color: colors.mutedSoft, fontFamily: typography.family.regular },
  notes: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: "top" },
  error: {
    flexShrink: 0,
    marginVertical: spacing.xs,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  formActions: {
    flexShrink: 0,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    flexDirection: "column-reverse",
    justifyContent: "flex-end",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  cancelButtonText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    textAlign: "center",
  },
  saveButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  saveButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    textAlign: "center",
  },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  confirmModal: {
    width: "100%",
    maxWidth: 420,
    padding: spacing.lg,
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  confirmIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  // Mesma estrutura de `modalIconWarning` já usada em `client-booking.tsx`
  // para o modal informativo "Revise o agendamento" — reaproveitada aqui
  // (seção 6.2/8 do handoff) para "Este agendamento não pode ser excluído".
  confirmIconWarning: { backgroundColor: colors.warningSoft },
  confirmTitle: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    textAlign: "center",
  },
  confirmText: {
    marginTop: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  cancellationReasonField: {
    width: "100%",
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  cancellationReasonInput: {
    minHeight: 96,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  helperText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  confirmActions: {
    marginTop: spacing.lg,
    width: "100%",
    flexDirection: "column-reverse",
    justifyContent: "center",
    gap: spacing.sm,
  },
  // Layout auxiliar aplicado inline aos botões de confirmação de modal
  // (Excluir/Cancelar/Confirmar/Concluir) para acomodar o `ActivityIndicator`
  // de loading ao lado do texto, sem alterar a altura/estrutura do botão.
  confirmButtonSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  confirmDelete: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.danger,
  },
  confirmDeleteText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  footer: {
    minHeight: 72,
    paddingTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerMobile: {
    minHeight: 88,
    flexDirection: "column",
    justifyContent: "center",
    gap: spacing.xs,
  },
  footerBrand: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  accent: { color: colors.brand },
  footerText: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  bottomBar: {
    minHeight: 72,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  bottomAction: { flex: 1, alignItems: "center", gap: spacing.xs },
  bottomIcon: { height: 28, alignItems: "center", justifyContent: "center" },
  bottomLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.medium,
    fontSize: 10,
  },
  bottomLabelActive: {
    color: colors.brand,
    fontFamily: typography.family.bold,
  },
  manualConfirmIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  manualConfirmButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.success,
  },
  manualConfirmButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  finalizeIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  finalizeConfirmButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  finalizeConfirmButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  mobileAppointmentCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  mobileAppointmentActions: { alignItems: "flex-end", gap: spacing.sm },
  mobileValueText: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  mobileServiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  // Modal de ações mobile
  mobileActionsBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  mobileActionsSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  mobileActionsHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  mobileActionsTitle: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  mobileActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  mobileActionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileActionLabel: {
    flex: 1,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    color: colors.ink,
  },
  mobileActionClose: {
    marginTop: spacing.sm,
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  mobileActionCloseLabel: {
    flex: 1,
    textAlign: "center",
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    color: colors.muted,
  },
  manualConfirmAction: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.successSoft,
  },
  manualConfirmActionText: {
    color: colors.success,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  pagination: {
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  paginationMobile: {
    padding: spacing.sm,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  paginationInfo: {
    flexShrink: 1,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  paginationActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  pageButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  pageButtonDisabled: { opacity: 0.55 },
  pageText: {
    minWidth: 54,
    fontSize: typography.size.caption,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    textAlign: "center",
  },
  clientSelector: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  serviceSelector: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  serviceSelectorLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  serviceSelectorIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  serviceSelectorCopy: {
    flex: 1,
    minWidth: 0,
  },
  serviceSelectorText: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  serviceSelectorMeta: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  servicePickerItem: {
    minHeight: 64,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  servicePickerItemActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  servicePickerAvatar: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  servicePickerName: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  servicePickerNameActive: {
    color: colors.brand,
  },
  servicePickerFooter: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  servicePickerAddButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  servicePickerAddButtonText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  clientSelectorText: {
    flex: 1,
    minWidth: 0,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  clientSelectorPlaceholder: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
  },
  clientPickerModal: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "86%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  clientSearch: {
    minHeight: 48,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  clientSearchInput: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  clientPickerList: { flexShrink: 1, marginTop: spacing.md },
  clientPickerItems: { gap: spacing.sm },
  clientPickerItem: {
    minHeight: 58,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  clientPickerItemActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  clientPickerAvatar: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  clientPickerName: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  clientPickerPagination: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  monthFilter: {
    minWidth: 150,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  monthFilterCopy: { flex: 1, minWidth: 0 },
  monthFilterText: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  statusFilter: {
    minWidth: 150,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  statusFilterLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: 10,
  },
  statusFilterValue: {
    marginTop: 1,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  viewToggle: {
    minHeight: 42,
    padding: 3,
    flexDirection: "row",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  viewOption: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.xs,
  },
  viewOptionActive: { backgroundColor: colors.brand },
  viewOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  viewOptionTextActive: { color: colors.onBrand },
  calendarView: { padding: spacing.lg },
  calendarViewMobile: { padding: spacing.sm },
  calendarHeader: {
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  calendarNav: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  calendarTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    textAlign: "center",
    textTransform: "capitalize",
  },
  calendarSubtitle: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  // Cabeçalho da lista de compromissos do dia selecionado, exibida logo
  // abaixo do grid do mês na visão Calendário — mesma lista/ações da visão
  // Lista (`AppointmentDayList`), só reposicionada.
  calendarDayListHeader: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  calendarDayListTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
    textTransform: "capitalize",
  },
  calendarDayListSubtitle: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  weekHeader: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  weekLabel: {
    width: "14.285%",
    paddingVertical: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  calendarCellBlocked: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  blockedDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  calendarBlockedLabel: {
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  calendarBlockedText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  calendarCell: {
    width: "14.285%",
    minHeight: 124,
    padding: spacing.sm,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  calendarCellEmpty: { backgroundColor: colors.surfaceSubtle },
  calendarCellMobile: { minHeight: 58, padding: 4 },
  calendarCellSelected: { backgroundColor: colors.brandSoft },
  calendarDayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  calendarDay: {
    width: 28,
    height: 28,
    paddingTop: 5,
    color: colors.ink,
    fontFamily: typography.family.bold,
    textAlign: "center",
    borderRadius: radius.pill,
  },
  calendarDaySelected: { color: colors.onBrand, backgroundColor: colors.brand },
  calendarDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  calendarEvent: {
    marginTop: spacing.xs,
    padding: 5,
    borderRadius: radius.xs,
    backgroundColor: colors.brandSoft,
  },
  calendarEventTime: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  calendarEventName: {
    marginTop: 1,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: 10,
  },
  calendarMobileCount: {
    marginTop: 2,
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 10,
    textAlign: "center",
  },
  calendarMore: {
    marginTop: spacing.xs,
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: 10,
  },
  monthPickerModal: {
    width: "100%",
    maxWidth: 480,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  pickerLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    color: colors.ink,
    fontFamily: typography.family.semibold,
  },
  yearOptions: { gap: spacing.sm },
  yearOption: {
    minWidth: 76,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  yearOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  yearOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
  },
  yearOptionTextActive: { color: colors.onBrand },
  monthOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  monthOption: {
    width: "22%",
    minHeight: 62,
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  monthOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  monthOptionNumber: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  monthOptionName: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    textTransform: "capitalize",
  },
  monthOptionTextActive: { color: colors.onBrand },
  statusPickerModal: {
    width: "100%",
    maxWidth: 420,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  statusPickerOptions: { marginTop: spacing.lg, gap: spacing.sm },
  statusPickerOption: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  statusPickerOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  statusPickerOptionText: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
  },
  statusPickerOptionTextActive: { color: colors.brand },
});
