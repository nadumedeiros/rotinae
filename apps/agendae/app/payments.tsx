import {
  ActivityIndicator,
  AppState,
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
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppIcon } from "@/src/components/ui/app-icon";
import { CurrencyInput } from "@/src/components/ui/currency-input";
import { DatePickerField } from "@/src/components/ui/date-picker-field";
import { todayUtc } from "@/src/components/ui/datetime-picker-utils";
import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { RowActionsMenu, useRowActionsMenu } from "@/src/components/ui/row-actions-menu";
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
import { PaymentError } from "@/src/domain/payments/types";
import { resolveReceiptActionLabel } from "@/src/domain/payments/payment-row-actions";
import { loadAllClients } from "@/src/domain/clients/load-all-clients";
import { resolveClientService } from "@/src/domain/services/default-service";
import type { Service } from "@/src/domain/services/types";
import { clientPortfolioService } from "@/src/infra/clients/supabase-client-portfolio-adapter";
import { paymentService } from "@/src/infra/payments/supabase-payment-adapter";
import { serviceCatalogService } from "@/src/infra/services/supabase-service-catalog-adapter";

type PaymentStatus = "Pendente" | "Recebido" | "Atrasado" | "Cancelado";
type PaymentRecord = {
  id: string;
  clientId: string;
  clientName: string;
  service: string;
  value: number;
  /**
   * Saldo ainda em aberto (`balanceCents` do domínio, ver
   * `PaymentRecord.balanceCents`), em reais — mesmo padrão de `value`.
   * Só é o valor "certo" para exibição quando `status` é `Pendente`/
   * `Atrasado`; para `Recebido`/`Cancelado`, a exibição continua usando
   * `value` (total original), ver `displayValue`.
   */
  balance: number;
  dueDate: string;
  status: PaymentStatus;
  notes: string;
  receivedAt?: string | null;
  kind?: "charge" | "receipt";
  parentPaymentId?: string | null;
  hasReceipt?: boolean;
};

type StatusAction = { id: string; status: "Atrasado" | "Cancelado" };

const statusToDomain = {
  Pendente: "pending",
  Recebido: "received",
  Atrasado: "overdue",
  Cancelado: "cancelled",
} as const;

const domainToStatus = {
  pending: "Pendente",
  received: "Recebido",
  overdue: "Atrasado",
  cancelled: "Cancelado",
} as const;
type PaymentClient = {
  id: string;
  name: string;
  email: string;
  /** Ver `Client.primaryServiceId` — usado para pré-selecionar o serviço no formulário. */
  primaryServiceId: string | null;
  /** Ver `Client.serviceValueCents` — valor por cliente, pode divergir de `Service.referenceValueCents`. */
  serviceValueCents: number;
};

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

function formatDateInput(input: string) {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isValidBrazilianDate(input: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (!match) return false;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
function brazilianToIso(input: string) {
  const [day, month, year] = input.split("/");
  return `${year}-${month}-${day}`;
}
function isoToBrazilian(input: string) {
  const [year, month, day] = input.split("-");
  return `${day}/${month}/${year}`;
}
/**
 * Valor a exibir na coluna "Valor" da lista/tabela principal de pagamentos.
 * Cobranças ainda em aberto (`Pendente`/`Atrasado`) mostram o saldo restante
 * (`balance`) — relevante quando já existe um recebimento parcial. Cobranças
 * já encerradas (`Recebido`/`Cancelado`) continuam mostrando o total
 * original (`value`), pois `balance` não é confiável nesses casos (ver
 * `PaymentRecord.balanceCents` no domínio).
 */
function displayValue(item: PaymentRecord) {
  return item.status === "Pendente" || item.status === "Atrasado" ? item.balance : item.value;
}
/** Data do dia (fuso do dispositivo, mesma referência do calendário do `DatePickerField`) no formato `DD/MM/AAAA` — valor padrão do campo "Data do recebimento". */
function todayBr() {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}
/**
 * Converte `DD/MM/AAAA` para um instante ISO ao meio-dia UTC do mesmo dia
 * civil (mesmo truque de `DatePickerField.selectDay`/`datetime-picker-utils`)
 * — evita que o fuso do prestador desloque `received_at` para o dia anterior
 * (meia-noite UTC) e o recebimento caia no mês errado em `get_financial_monthly_history`.
 */
function brazilianToReceivedAtIso(input: string) {
  const [day, month, year] = input.split("/");
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0)).toISOString();
}
function currentMonthKey() {
  const current = new Date();
  return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
}

export default function PaymentsScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  // A tabela de pagamentos tem 6 colunas fixas (cliente, serviço, valor,
  // vencimento, situação, ações) — no tablet isso fica espremido demais.
  // Só desktop de verdade usa a tabela; tablet continua com os cards.
  const paymentTableWide = width >= breakpoints.desktop;
  // Modal dedicado de "Registrar recebimento" (separado do formulário geral
  // de editar cobrança): etapa 1 pergunta total ou parcial, etapa 2 mostra
  // só os campos daquela opção. `receiptItem` é a cobrança sendo recebida;
  // `receiptMode` null = etapa 1 (ainda não escolheu).
  const [receiptItem, setReceiptItem] = useState<PaymentRecord | null>(null);
  const [receiptMode, setReceiptMode] = useState<"total" | "partial" | null>(null);
  const [receiptAmountCents, setReceiptAmountCents] = useState(0);
  const [receiptBalanceCents, setReceiptBalanceCents] = useState<number | null>(null);
  const [loadingReceiptBalance, setLoadingReceiptBalance] = useState(false);
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [receiptFieldError, setReceiptFieldError] = useState("");
  const [receiptSuccessVisible, setReceiptSuccessVisible] = useState(false);
  // Data em que o dinheiro efetivamente entrou (padrão hoje, ajuste manual)
  // — define o mês do recebimento no histórico financeiro mensal (DEC-166).
  const [receiptDate, setReceiptDate] = useState("");
  const [receiptDateError, setReceiptDateError] = useState("");
  // Modal dedicado de "Alterar vencimento" (cobranças atrasadas).
  const [dueDateItem, setDueDateItem] = useState<PaymentRecord | null>(null);
  const [dueDateValue, setDueDateValue] = useState("");
  const [dueDateError, setDueDateError] = useState("");
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientPickerVisible, setClientPickerVisible] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientPage, setClientPage] = useState(1);
  const [service, setService] = useState("");
  // Catálogo de serviços do tenant + seleção atual do formulário de
  // pagamento (RN-SRV-010: catálogo não paginado, mesma chamada usada em
  // `app/agenda.tsx`). `selectedServiceId` é null quando o pagamento usa o
  // campo de texto livre (`serviceManualMode`) — fallback para origens que
  // não existem no catálogo, nunca o caminho principal.
  const [serviceOptions, setServiceOptions] = useState<Service[]>([]);
  const [loadingServiceOptions, setLoadingServiceOptions] = useState(true);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [serviceManualMode, setServiceManualMode] = useState(false);
  const [servicePickerVisible, setServicePickerVisible] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  // Evita reaplicar o auto-preenchimento de serviço para o mesmo cliente
  // depois que o prestador já trocou manualmente o serviço sugerido (ex.:
  // `serviceOptions` recarrega em foco e dispararia o efeito de novo).
  const autoFilledServiceClientIdRef = useRef<string | null>(null);
  const [valueCents, setValueCents] = useState(0);
  const [receivedValueCents, setReceivedValueCents] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<PaymentStatus>("Pendente");
  // Mesma ideia de `receiptDate` (modal dedicado), para quando "Recebido" é
  // escolhido diretamente no seletor de situação deste formulário.
  const [receivedDate, setReceivedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    clientId?: string;
    service?: string;
    value?: string;
    dueDate?: string;
    receivedValue?: string;
    receivedDate?: string;
  }>({});
  const [successVisible, setSuccessVisible] = useState(false);
  const [paymentFormVisible, setPaymentFormVisible] = useState(false);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentClients, setPaymentClients] = useState<PaymentClient[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientLoadError, setClientLoadError] = useState("");
  const [kpiCarouselIndex, setKpiCarouselIndex] = useState(0);
  const [paymentQuery, setPaymentQuery] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"Todos" | PaymentStatus>(
    "Todos",
  );
  const [periodFilter, setPeriodFilter] = useState(currentMonthKey);
  const [periodPickerVisible, setPeriodPickerVisible] = useState(false);
  const [tableStatusPickerVisible, setTableStatusPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(() =>
    String(new Date().getFullYear()),
  );
  const [paymentPage, setPaymentPage] = useState(1);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  // Suporta abertura automática do modal de novo registro financeiro quando a
  // tela é acessada pelo botão "Registro financeiro" do menu rápido da tab
  // bar mobile (`/payments?openCreate=1`) — sem esse parâmetro o
  // comportamento de navegação permanece inalterado.
  const { openCreate } = useLocalSearchParams<{ openCreate?: string }>();
  const openCreateHandledRef = useRef(false);
  const [serverTotalItems, setServerTotalItems] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [paymentSummary, setPaymentSummary] = useState({
    receivedTotalCents: 0,
    pendingTotalCents: 0,
    pendingCount: 0,
  });
  const [historyError, setHistoryError] = useState("");
  // Feedback visual de clique (padrão Nero): cada ação assíncrona expõe seu
  // próprio estado de pendência, setado de forma síncrona antes do `await` e
  // sempre resetado em `finally` — nunca deixa o botão preso em loading.
  const [savingPayment, setSavingPayment] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const [retryingHistory, setRetryingHistory] = useState(false);
  const [retryingClients, setRetryingClients] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // Erro específico do modal de exclusão (ex.: PAYMENT_HAS_RECEIPTS, RLS,
  // rede): dedicado porque `error` só é renderizado dentro de `paymentForm`,
  // que fica escondido quando a exclusão é acionada direto da linha da
  // tabela (sem abrir o formulário de edição) — sem este estado próprio, uma
  // falha na exclusão fechava o modal de confirmação e não mostrava
  // absolutamente nada ao usuário (bug corrigido nesta revisão).
  const [deleteError, setDeleteError] = useState("");
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [mobileActionPayment, setMobileActionPayment] = useState<PaymentRecord | null>(null);
  const rowActionsMenu = useRowActionsMenu<PaymentRecord>();
  const selectedClient = useMemo(
    () => paymentClients.find((item) => item.id === clientId),
    [paymentClients, clientId],
  );
  const selectedServiceObj = useMemo(
    () => serviceOptions.find((item) => item.id === selectedServiceId),
    [serviceOptions, selectedServiceId],
  );
  const filteredServiceOptions = useMemo(
    () =>
      serviceOptions.filter((item) =>
        item.name.toLocaleLowerCase("pt-BR").includes(serviceQuery.trim().toLocaleLowerCase("pt-BR")),
      ),
    [serviceOptions, serviceQuery],
  );
  const editingPayment = useMemo(
    () => payments.find((item) => item.id === editingId),
    [payments, editingId],
  );
  const filteredClients = useMemo(
    () =>
      paymentClients.filter((item) =>
        `${item.name} ${item.email}`
          .toLocaleLowerCase("pt-BR")
          .includes(clientQuery.trim().toLocaleLowerCase("pt-BR")),
      ),
    [clientQuery, paymentClients],
  );
  const clientPageSize = 10;
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
  const monthOptions = [
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
  const yearOptions = useMemo(
    () =>
      Array.from(
        new Set([
          String(new Date().getFullYear()),
          ...payments.map((item) => item.dueDate.slice(6, 10)),
        ]),
      ).sort((a, b) => b.localeCompare(a)),
    [payments],
  );
  const receivedTotal = paymentSummary.receivedTotalCents / 100;
  const pendingTotal = paymentSummary.pendingTotalCents / 100;
  const pendingCount = paymentSummary.pendingCount;
  const periodLabel =
    periodFilter.length === 4
      ? periodFilter
      : `${periodFilter.slice(5, 7)}/${periodFilter.slice(0, 4)}`;
  const paymentPageSize = wide ? 10 : 5;
  const paymentTotalPages = serverTotalPages;
  const visiblePayments = payments;

  const formattedValue =
    valueCents > 0
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(valueCents / 100)
      : "R$ 0,00";

  const mapPaymentRecord = useCallback((item: Awaited<ReturnType<typeof paymentService.listPayments>>["items"][number]): PaymentRecord => {
    return {
      id: item.id,
      clientId: item.clientId,
      clientName: item.clientName ?? "Cliente removido",
      service: item.origin,
      value: item.valueCents / 100,
      balance: item.balanceCents / 100,
      dueDate: isoToBrazilian(item.dueDate),
      status: domainToStatus[item.status],
      notes: item.notes ?? "",
      receivedAt: item.receivedAt,
      kind: item.kind ?? "charge",
      parentPaymentId: item.parentPaymentId,
      hasReceipt: item.hasReceipt,
    };
  }, []);

  const loadPaymentClients = useCallback(async () => {
    setLoadingClients(true);
    setClientLoadError("");
    try {
      const clients = await loadAllClients(clientPortfolioService);
      setPaymentClients(
        clients.map((client) => ({
          id: client.id,
          name: client.name,
          email: client.email,
          primaryServiceId: client.primaryServiceId ?? null,
          serviceValueCents: client.serviceValueCents,
        })),
      );
    } catch {
      setPaymentClients([]);
      setClientLoadError("Não foi possível carregar os clientes.");
    } finally {
      setLoadingClients(false);
    }
  }, []);

  // Catálogo de serviços ativos do tenant (ver `resolveClientService`) —
  // mesma fonte usada em `app/agenda.tsx`, sem paginação (RN-SRV-010).
  const loadServiceOptions = useCallback(async () => {
    setLoadingServiceOptions(true);
    try {
      const services = await serviceCatalogService.listServices({ status: "active" });
      setServiceOptions(services);
    } catch {
      // Falha silenciosa (ex.: offline): o formulário continua funcional
      // com o campo de texto livre como fallback, em vez de travar o
      // cadastro de pagamento por causa do catálogo de serviços.
      setServiceOptions([]);
    } finally {
      setLoadingServiceOptions(false);
    }
  }, []);

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    setHistoryError("");
    try {
      const result = await paymentService.listPayments({
        page: paymentPage,
        pageSize: paymentPageSize,
        period: periodFilter,
        status:
          paymentFilter === "Todos" ? undefined : statusToDomain[paymentFilter],
        query: paymentQuery,
      });
      setServerTotalItems(result.totalItems);
      setServerTotalPages(Math.max(1, result.totalPages));
      setPaymentSummary(result.summary);
      setPayments(result.items.map(mapPaymentRecord));
    } catch (caught) {
      setHistoryError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível carregar os pagamentos.",
      );
    } finally {
      setLoadingPayments(false);
      setInitialLoading(false);
    }
  }, [mapPaymentRecord, paymentFilter, paymentPage, paymentPageSize, paymentQuery, periodFilter]);

  function hasReceipt(item: PaymentRecord) {
    return item.hasReceipt ?? payments.some(
      (candidate) =>
        candidate.kind === "receipt" && candidate.parentPaymentId === item.id,
    );
  }

  function disabledStatusReason(nextStatus: PaymentStatus) {
    if (!editingPayment || nextStatus === editingPayment.status) return "";
    if (editingPayment.status === "Cancelado")
      return "Pagamentos cancelados não podem ser reabertos. Registre um novo lançamento.";
    if (
      editingPayment.status === "Recebido" &&
      (nextStatus === "Atrasado" || nextStatus === "Cancelado")
    )
      return `Não é possível marcar um pagamento recebido como ${nextStatus.toLocaleLowerCase("pt-BR")}.`;
    if (nextStatus === "Cancelado" && hasReceipt(editingPayment))
      return "Não é possível cancelar: este pagamento já possui recibo de quitação.";
    return "";
  }

  async function confirmStatusAction() {
    if (!statusAction) return;
    setUpdatingStatus(true);
    setHistoryError("");
    try {
      await paymentService.updatePayment(statusAction.id, {
        status: statusToDomain[statusAction.status],
      });
      setStatusAction(null);
      await loadPayments();
    } catch (caught) {
      setStatusAction(null);
      setHistoryError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível alterar o status do pagamento.",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        void loadPayments();
        void loadPaymentClients();
        void loadServiceOptions();
      }, 250);
      return () => clearTimeout(timer);
    }, [loadPaymentClients, loadPayments, loadServiceOptions]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void loadPayments();
        void loadPaymentClients();
        void loadServiceOptions();
      }
    });
    return () => subscription.remove();
  }, [loadPaymentClients, loadPayments, loadServiceOptions]);

  // Auto-preenchimento do serviço ao selecionar um cliente num pagamento
  // NOVO (item 3 do handoff de serviços): resolve o serviço vinculado ao
  // cliente (`primaryServiceId`) ou cai no serviço padrão ("Atendimento",
  // `resolveClientService`) sem exigir nenhuma ação extra do usuário. Só
  // roda em criação (nunca sobrescreve um pagamento existente em edição) e
  // no máximo uma vez por cliente selecionado — depois disso o prestador
  // pode trocar o serviço livremente sem ser sobrescrito de novo quando o
  // catálogo recarrega em foco.
  useEffect(() => {
    if (!paymentFormVisible || editingId) return;
    if (!clientId) {
      autoFilledServiceClientIdRef.current = null;
      return;
    }
    if (autoFilledServiceClientIdRef.current === clientId) return;
    if (serviceOptions.length === 0) return;
    const client = paymentClients.find((item) => item.id === clientId);
    if (!client) return;

    const resolved = resolveClientService(serviceOptions, client);
    if (!resolved) return;

    autoFilledServiceClientIdRef.current = clientId;
    setSelectedServiceId(resolved.id);
    setServiceManualMode(false);
    setService(resolved.name);
    setValueCents(
      client.primaryServiceId && client.serviceValueCents > 0
        ? client.serviceValueCents
        : resolved.referenceValueCents,
    );
    setFieldErrors((current) => ({ ...current, service: undefined, value: undefined }));
  }, [clientId, paymentFormVisible, editingId, paymentClients, serviceOptions]);

  useEffect(() => {
    if (openCreate !== "1" || openCreateHandledRef.current || initialLoading || loadingClients) return;
    openCreateHandledRef.current = true;
    openNewPayment();
    // Remove o parâmetro para não reabrir o modal em focos futuros da tela.
    router.setParams({ openCreate: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate, initialLoading, loadingClients]);

  // Causa raiz do bug de busca/filtros não atualizarem a tabela: a busca de
  // pagamentos é resolvida no servidor via RPC (`list_manual_payments`), e
  // não filtrando uma lista já carregada em memória (como Clientes, Serviços,
  // Agenda e Usuários). Sem este efeito, alterar `paymentQuery`,
  // `paymentFilter`, `periodFilter` ou `paymentPage` só atualizava o estado
  // local — a nova query só chegava ao Supabase por acaso, ao focar a tela de
  // novo (`useFocusEffect`) ou ao voltar o app ao primeiro plano. Debounce de
  // 300ms evita uma requisição por tecla digitada na busca; `loadPayments` já
  // lista esses quatro valores em suas dependências (ver definição acima),
  // então este efeito dispara sempre que qualquer um deles muda.
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadPayments();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadPayments]);

  function openNewPayment() {
    setEditingId(null);
    setClientId("");
    setService("");
    setSelectedServiceId(null);
    setServiceManualMode(false);
    autoFilledServiceClientIdRef.current = null;
    setValueCents(0);
    setReceivedValueCents(0);
    setDueDate("");
    setStatus("Pendente");
    setReceivedDate(todayBr());
    setNotes("");
    setError("");
    setFieldErrors({});
    setPaymentFormVisible(true);
  }
  function openEditForm(item: PaymentRecord) {
    setEditingId(item.id);
    setClientId(item.clientId);
    setService(item.service);
    // Edição não passa pelo auto-preenchimento (é só para criação): tenta
    // reconciliar o texto já salvo com o catálogo (mesmo item = mesmo nome,
    // ignorando maiúsculas/espaços) só para a UI do seletor refletir a
    // seleção corrente; sem correspondência, cai no modo de texto livre em
    // vez de aparentar um serviço selecionado que não existe.
    const matchingService = serviceOptions.find(
      (option) => option.name.trim().toLocaleLowerCase("pt-BR") === item.service.trim().toLocaleLowerCase("pt-BR"),
    );
    setSelectedServiceId(matchingService?.id ?? null);
    setServiceManualMode(!matchingService);
    autoFilledServiceClientIdRef.current = item.clientId;
    setValueCents(Math.round(item.value * 100));
    setReceivedValueCents(0);
    setDueDate(item.dueDate);
    setStatus(item.status);
    // Preserva a data de recebimento já registrada (evita que reabrir e
    // salvar uma edição sem relação — ex.: só a observação — empurre
    // silenciosamente um recebimento antigo para "hoje").
    setReceivedDate(item.receivedAt ? isoToBrazilian(item.receivedAt.slice(0, 10)) : todayBr());
    setNotes(item.notes);
    setError("");
    setFieldErrors({});
    setPaymentFormVisible(true);
  }
  // "Recebimento" numa cobrança pendente OU atrasada abre o modal dedicado
  // (total/parcial); em qualquer outro caso (já recebido/cancelado),
  // continua abrindo o formulário geral de edição, como antes.
  function openPayment(item: PaymentRecord) {
    if ((item.status === "Pendente" || item.status === "Atrasado") && item.kind !== "receipt") {
      openReceiptModal(item);
      return;
    }
    openEditForm(item);
  }

  function openReceiptModal(item: PaymentRecord) {
    setReceiptItem(item);
    setReceiptMode(null);
    setReceiptAmountCents(0);
    setReceiptError("");
    setReceiptFieldError("");
    setReceiptSuccessVisible(false);
    setReceiptBalanceCents(null);
    setReceiptDate(todayBr());
    setReceiptDateError("");

    // Busca o saldo real (pode já ter parciais registrados antes desta
    // abertura — o valor total da cobrança não muda mais com pagamentos
    // parciais) para o modal mostrar a informação certa em cada etapa.
    setLoadingReceiptBalance(true);
    paymentService
      .getPaymentHistory(item.id)
      .then((history) => setReceiptBalanceCents(history.balanceCents))
      .catch(() => setReceiptBalanceCents(null))
      .finally(() => setLoadingReceiptBalance(false));
  }

  function closeReceiptModal() {
    setReceiptItem(null);
    setReceiptMode(null);
    setReceiptAmountCents(0);
    setReceiptError("");
    setReceiptFieldError("");
    setReceiptBalanceCents(null);
    setReceiptDate("");
    setReceiptDateError("");
  }

  async function confirmReceipt() {
    if (!receiptItem) return;
    if (receiptMode === "partial" && receiptAmountCents <= 0) {
      setReceiptFieldError("Informe o valor recebido.");
      return;
    }
    if (!isValidBrazilianDate(receiptDate)) {
      setReceiptDateError("Informe uma data válida (DD/MM/AAAA).");
      return;
    }
    setReceiptFieldError("");
    setReceiptDateError("");
    setSavingReceipt(true);
    setReceiptError("");
    try {
      const receivedAt = brazilianToReceivedAtIso(receiptDate);
      if (receiptMode === "total") {
        await paymentService.updatePayment(receiptItem.id, { status: "received", receivedAt });
      } else {
        await paymentService.registerPartialPayment(receiptItem.id, receiptAmountCents, receivedAt);
      }
      await loadPayments();
      setPaymentPage(1);
      setReceiptSuccessVisible(true);
    } catch (caught) {
      setReceiptError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível registrar o recebimento. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setSavingReceipt(false);
    }
  }

  function finishReceipt() {
    setReceiptSuccessVisible(false);
    closeReceiptModal();
  }

  function openDueDateModal(item: PaymentRecord) {
    setDueDateItem(item);
    setDueDateValue(item.dueDate);
    setDueDateError("");
  }

  function closeDueDateModal() {
    setDueDateItem(null);
    setDueDateValue("");
    setDueDateError("");
  }

  async function saveDueDate() {
    if (!dueDateItem) return;
    if (!isValidBrazilianDate(dueDateValue)) {
      setDueDateError("Informe uma data válida (DD/MM/AAAA).");
      return;
    }
    setSavingDueDate(true);
    setDueDateError("");
    try {
      await paymentService.updatePayment(dueDateItem.id, { dueDate: brazilianToIso(dueDateValue) });
      await loadPayments();
      closeDueDateModal();
    } catch (caught) {
      setDueDateError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível atualizar o vencimento. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setSavingDueDate(false);
    }
  }

  async function savePayment() {
    const nextFieldErrors: typeof fieldErrors = {};
    if (!clientId) nextFieldErrors.clientId = "Selecione o cliente.";
    if (!service.trim()) nextFieldErrors.service = "Selecione um serviço do catálogo ou informe manualmente.";
    if (valueCents <= 0) nextFieldErrors.value = "Informe um valor maior que zero.";
    if (!isValidBrazilianDate(dueDate)) nextFieldErrors.dueDate = "Informe uma data válida (DD/MM/AAAA).";
    if (status === "Recebido" && !isValidBrazilianDate(receivedDate)) {
      nextFieldErrors.receivedDate = "Informe uma data de recebimento válida (DD/MM/AAAA).";
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setError("Confira os campos destacados abaixo.");
      return;
    }
    const isFullSettlement =
      editingId &&
      (status === "Recebido" ||
        (receivedValueCents > 0 && receivedValueCents >= valueCents));

    const isPartialSettlement =
      editingId &&
      receivedValueCents > 0 &&
      receivedValueCents < valueCents &&
      status !== "Recebido";

    setSavingPayment(true);
    setError("");
    try {
      const input = {
        clientId,
        origin: service.trim(),
        valueCents,
        dueDate: brazilianToIso(dueDate),
        status: isFullSettlement
          ? ("received" as const)
          : isPartialSettlement
            ? ("pending" as const)
            : statusToDomain[status],
        notes: notes.trim() || null,
        ...((isFullSettlement || status === "Recebido")
          ? { receivedAt: brazilianToReceivedAtIso(receivedDate) }
          : {}),
      };
      if (editingId) {
        await paymentService.updatePayment(editingId, input);
        if (isPartialSettlement) {
          await paymentService.registerPartialPayment(
            editingId,
            receivedValueCents,
          );
        }
      } else {
        await paymentService.createPayment(input);
      }
      await loadPayments();
      setPaymentPage(1);
      setSuccessVisible(true);
    } catch (caught) {
      setError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível registrar. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setSavingPayment(false);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setDeletingPayment(true);
    setDeleteError("");
    try {
      await paymentService.deletePayment(deleteId);
      // Reflete a exclusão na tabela imediatamente, sem exigir recarregar a
      // página manualmente (a mesma fonte de verdade — `list_manual_payments`
      // — já reflete o registro removido).
      await loadPayments();
      setDeleteId(null);
      setPaymentFormVisible(false);
    } catch (caught) {
      // Mantém o modal de confirmação aberto (em vez de fechá-lo e perder o
      // erro num estado que não é renderizado nesse contexto): o usuário
      // precisa ver POR QUE a exclusão falhou (ex.: "já possui recibo de
      // quitação") para decidir o próximo passo, em vez de a ação
      // simplesmente não ter efeito nenhum aparente.
      setDeleteError(
        caught instanceof PaymentError
          ? caught.message
          : "Não foi possível excluir o pagamento. Verifique sua conexão e tente novamente.",
      );
    } finally {
      setDeletingPayment(false);
    }
  }

  async function retryLoadPayments() {
    setRetryingHistory(true);
    try {
      await loadPayments();
    } finally {
      setRetryingHistory(false);
    }
  }

  async function retryLoadPaymentClients() {
    setRetryingClients(true);
    try {
      await loadPaymentClients();
    } finally {
      setRetryingClients(false);
    }
  }

  function finish() {
    setSuccessVisible(false);
    setPaymentFormVisible(false);
    setClientId("");
    setService("");
    setSelectedServiceId(null);
    setServiceManualMode(false);
    autoFilledServiceClientIdRef.current = null;
    setValueCents(0);
    setReceivedValueCents(0);
    setDueDate("");
    setStatus("Pendente");
    setNotes("");
  }

  const paymentForm = (
    <>
      <View style={styles.clientModalHeader}>
        <View style={styles.clientModalHeaderCopy}>
          <Text accessibilityRole="header" style={styles.clientModalTitle}>
            {editingId ? "Editar pagamento" : "Novo pagamento"}
          </Text>
          <Text style={styles.clientModalSubtitle}>
            {editingId
              ? "Atualize os dados deste pagamento."
              : "Registre um valor a cobrar ou já recebido."}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Fechar cadastro"
          onPress={() => setPaymentFormVisible(false)}
          style={styles.closeButton}
        >
          <AppIcon name="error" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <View style={styles.form}>
        {/* Grupo 1 — Cliente e serviço (quem + o quê) */}
        <View style={styles.formSection}>
          <Text style={styles.formSectionLabel}>CLIENTE E SERVIÇO</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Cliente<Text style={styles.requiredMark}> *</Text></Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selectedClient
                  ? `Cliente selecionado: ${selectedClient.name}`
                  : "Selecionar cliente"
              }
              onPress={() => {
                setClientQuery("");
                setClientPage(1);
                setClientPickerVisible(true);
              }}
              style={[styles.clientSelector, !!fieldErrors.clientId && styles.fieldInputError]}
            >
              <View style={styles.clientSelectorCopy}>
                {selectedClient ? (
                  <>
                    <Text style={styles.clientSelectorName}>
                      {selectedClient.name}
                    </Text>
                    <Text style={styles.clientSelectorEmail}>
                      {selectedClient.email}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.clientSelectorPlaceholder}>
                    Selecione um cliente
                  </Text>
                )}
              </View>
              <AppIcon name="forward" size={16} color={colors.mutedSoft} />
            </Pressable>
            {!!fieldErrors.clientId && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.clientId}</Text>}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Serviço<Text style={styles.requiredMark}> *</Text></Text>
            {serviceManualMode ? (
              <>
                <TextInput
                  accessibilityLabel="Serviço ou origem do pagamento (texto livre)"
                  value={service}
                  onChangeText={(text) => { setService(text); setFieldErrors((current) => ({ ...current, service: undefined })); }}
                  placeholder="Ex.: Pacote promocional"
                  placeholderTextColor={colors.mutedSoft}
                  style={[styles.fieldInput, !!fieldErrors.service && styles.fieldInputError]}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setServiceManualMode(false);
                    setServiceQuery("");
                    setServicePickerVisible(true);
                  }}
                  style={styles.serviceManualToggle}
                >
                  <Text style={styles.serviceManualToggleText}>Selecionar do catálogo de serviços</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={service ? `Serviço selecionado: ${service}` : "Selecionar serviço"}
                  onPress={() => {
                    setServiceQuery("");
                    setServicePickerVisible(true);
                  }}
                  style={[styles.clientSelector, !!fieldErrors.service && styles.fieldInputError]}
                >
                  <View style={styles.clientSelectorCopy}>
                    {service ? (
                      <>
                        <Text style={styles.clientSelectorName}>{service}</Text>
                        {selectedServiceObj && (
                          <Text style={styles.clientSelectorEmail}>
                            {formatCurrency(selectedServiceObj.referenceValueCents)} de tabela · {selectedServiceObj.durationMinutes} min
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text style={styles.clientSelectorPlaceholder}>
                        {loadingServiceOptions ? "Carregando serviços..." : "Selecione um serviço"}
                      </Text>
                    )}
                  </View>
                  <AppIcon name="forward" size={16} color={colors.mutedSoft} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setServiceManualMode(true);
                    setSelectedServiceId(null);
                    setFieldErrors((current) => ({ ...current, service: undefined }));
                  }}
                  style={styles.serviceManualToggle}
                >
                  <Text style={styles.serviceManualToggleText}>Não encontrou? Digitar manualmente</Text>
                </Pressable>
              </>
            )}
            {!!fieldErrors.service && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.service}</Text>}
          </View>
        </View>

        {/* Grupo 2 — Valor e vencimento (quanto + quando) */}
        <View style={[styles.formSection, styles.formSectionSpaced]}>
          <Text style={styles.formSectionLabel}>VALOR E VENCIMENTO</Text>
          <View style={[styles.formRow, !wide && styles.formRowMobile]}>
            <View style={styles.rowField}>
              <Text style={styles.fieldLabel}>Valor<Text style={styles.requiredMark}> *</Text></Text>
              <CurrencyInput
                accessibilityLabel="Valor do pagamento"
                valueCents={valueCents}
                onChangeValueCents={(cents) => { setValueCents(cents); setFieldErrors((current) => ({ ...current, value: undefined })); }}
                invalid={!!fieldErrors.value}
              />
              {!!fieldErrors.value && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.value}</Text>}
            </View>
            <View style={styles.rowField}>
              <Text style={styles.fieldLabel}>Vencimento<Text style={styles.requiredMark}> *</Text></Text>
              <DatePickerField
                label="Vencimento"
                accessibilityLabel="Data de vencimento no formato dia mês e ano"
                value={dueDate}
                onChangeText={(text) => { setDueDate(formatDateInput(text)); setFieldErrors((current) => ({ ...current, dueDate: undefined })); }}
                keyboardType="number-pad"
                maxLength={10}
                placeholder="DD/MM/AAAA"
                invalid={!!fieldErrors.dueDate}
              />
              {!!fieldErrors.dueDate && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.dueDate}</Text>}
            </View>
          </View>
        </View>

        {/* Grupo 3 — Situação do pagamento (o que muda de estado) */}
        <View style={[styles.formSection, styles.formSectionSpaced]}>
          <Text style={styles.formSectionLabel}>SITUAÇÃO DO PAGAMENTO</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Situação do pagamento</Text>
            <View style={styles.statusSelector}>
              {(["Pendente", "Recebido", "Atrasado", "Cancelado"] as PaymentStatus[]).map((item) => {
                const disabledReason = disabledStatusReason(item);
                const disabled = Boolean(disabledReason);
                const icon =
                  item === "Recebido"
                    ? "success"
                    : item === "Atrasado"
                      ? "warning"
                      : item === "Cancelado"
                        ? "error"
                        : "schedule";
                return <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: status === item, disabled }}
                  onPress={() => {
                    if (disabledReason) {
                      setError(disabledReason);
                      return;
                    }
                    setError("");
                    setStatus(item);
                  }}
                  key={item}
                  style={[
                    styles.statusOption,
                    status === item && styles.statusOptionActive,
                    disabled && styles.statusOptionDisabled,
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
                </Pressable>;
              })}
            </View>
          </View>
          {status === "Recebido" && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Data do recebimento</Text>
              <DatePickerField
                label="Data do recebimento"
                accessibilityLabel="Data em que o valor foi recebido, no formato dia mês e ano"
                title="Data do recebimento"
                value={receivedDate}
                onChangeText={(text) => { setReceivedDate(formatDateInput(text)); setFieldErrors((current) => ({ ...current, receivedDate: undefined })); }}
                keyboardType="number-pad"
                maxLength={10}
                placeholder="DD/MM/AAAA"
                maxDate={todayUtc()}
                invalid={!!fieldErrors.receivedDate}
              />
              <Text style={styles.receiptDateHint}>
                Define em qual mês este recebimento aparece no histórico financeiro. Vem preenchida com hoje; ajuste se o cliente pagou em outra data.
              </Text>
              {!!fieldErrors.receivedDate && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.receivedDate}</Text>}
            </View>
          )}
        </View>

        {/* Grupo 4 — Observações (opcional, secundária) */}
        <View style={[styles.formSection, styles.formSectionSpaced]}>
          <Text style={styles.formSectionLabel}>OBSERVAÇÕES (OPCIONAL)</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>
              Observação <Text style={styles.optional}>(opcional)</Text>
            </Text>
            <TextInput
              accessibilityLabel="Observação do pagamento"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              placeholder="Adicione uma informação útil para seu controle"
              placeholderTextColor={colors.mutedSoft}
              style={[styles.fieldInput, styles.notesInput]}
            />
          </View>
        </View>
        {error ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <AppIcon name="warning" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <View style={styles.formActions}>
          <Pressable
            accessibilityRole="button"
            disabled={savingPayment}
            onPress={() => setPaymentFormVisible(false)}
            style={[styles.cancelButton, styles.formActionButton, savingPayment && { opacity: opacity.disabled }]}
          >
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: savingPayment, busy: savingPayment }}
            disabled={savingPayment}
            onPress={() => void savePayment()}
            style={({ pressed }) => [
              styles.saveButton,
              styles.formActionButton,
              pressed && !savingPayment && { opacity: opacity.pressed },
            ]}
          >
            {savingPayment && <ActivityIndicator size="small" color={colors.onBrand} />}
            <Text style={styles.saveText}>
              {editingId ? "Salvar" : "Registrar"}
            </Text>
          </Pressable>
        </View>
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {initialLoading && <PageLoadingOverlay />}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View
            style={[
              styles.heading,
              wide ? styles.headingDesktop : styles.headingMobile,
            ]}
          >
            <View style={styles.headingCopy}>
              <Text style={styles.eyebrow}>FINANCEIRO</Text>
              <Text accessibilityRole="header" style={styles.title}>
                Pagamentos
              </Text>
              <Text style={styles.description}>
                Registre valores manualmente para acompanhar seus serviços. O
                Rotinaê não processa a transação financeira.
              </Text>
            </View>
            <View style={[styles.headingActions, !wide && styles.headingActionsMobile]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir histórico financeiro mensal"
                onPress={() => router.push("/payments/history" as never)}
                style={[styles.historyButton, !wide && styles.headingActionButtonMobile]}
              >
                <AppIcon name="analytics" size={20} color={colors.brand} />
                <Text style={styles.historyButtonText}>Histórico mensal</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={openNewPayment}
                style={[styles.newPaymentButton, !wide && styles.headingActionButtonMobile]}
              >
                <AppIcon name="add" size={20} color={colors.onBrand} />
                <Text style={styles.newPaymentButtonText}>Novo pagamento</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView
            horizontal={!wide}
            showsHorizontalScrollIndicator={false}
            snapToInterval={272}
            decelerationRate="fast"
            onMomentumScrollEnd={(
              event: NativeSyntheticEvent<NativeScrollEvent>,
            ) =>
              setKpiCarouselIndex(
                Math.max(
                  0,
                  Math.min(
                    2,
                    Math.round(event.nativeEvent.contentOffset.x / 272),
                  ),
                ),
              )
            }
            style={styles.financialKpiScroller}
            contentContainerStyle={[
              styles.financialKpis,
              wide && styles.financialKpisWide,
            ]}
          >
            <View style={styles.financialKpi}>
              <View style={[styles.financialKpiIcon, styles.receivedKpiIcon]}>
                <AppIcon name="success" size={20} color={colors.success} />
              </View>
              <Text style={styles.financialKpiLabel}>Valores recebidos</Text>
              <Text style={styles.financialKpiValue}>
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(receivedTotal)}
              </Text>
              <Text style={styles.financialKpiPeriod}>{periodLabel}</Text>
            </View>
            <View style={styles.financialKpi}>
              <View style={[styles.financialKpiIcon, styles.pendingKpiIcon]}>
                <AppIcon name="financial" size={20} color={colors.warning} />
              </View>
              <Text style={styles.financialKpiLabel}>Valores a receber</Text>
              <Text style={styles.financialKpiValue}>
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(pendingTotal)}
              </Text>
              <Text style={styles.financialKpiPeriod}>{periodLabel}</Text>
            </View>
            <View style={styles.financialKpi}>
              <View style={[styles.financialKpiIcon, styles.pendingKpiIcon]}>
                <AppIcon name="schedule" size={20} color={colors.warning} />
              </View>
              <Text style={styles.financialKpiLabel}>Total de pendentes</Text>
              <Text style={styles.financialKpiValue}>
                {pendingCount}
              </Text>
              <Text style={styles.financialKpiPeriod}>
                {pendingCount === 1 ? "lançamento" : "lançamentos"} no período
              </Text>
            </View>
          </ScrollView>
          {!wide && (
            <View
              accessibilityLabel={`Indicador do carrossel: item ${kpiCarouselIndex + 1} de 3`}
              style={styles.kpiDots}
            >
              {[0, 1, 2].map((index) => (
                <View
                  key={index}
                  style={[
                    styles.kpiDot,
                    index === kpiCarouselIndex && styles.kpiDotActive,
                  ]}
                />
              ))}
            </View>
          )}
          {historyError && (
            <View style={[styles.stateBanner, styles.stateBannerError]}>
              <View style={styles.stateBannerCopy}>
                <AppIcon name="warning" size={20} color={colors.danger} />
                <Text style={styles.errorText}>{historyError}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: retryingHistory, busy: retryingHistory }}
                disabled={retryingHistory}
                onPress={() => void retryLoadPayments()}
                style={({ pressed }) => [
                  styles.retryButton,
                  styles.confirmButtonSpinnerRow,
                  pressed && !retryingHistory && { opacity: opacity.pressed },
                ]}
              >
                {retryingHistory && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.retryButtonText}>Tentar novamente</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.historyCard}>
            <View
              style={[
                styles.historyHeader,
                !wide && styles.historyHeaderMobile,
              ]}
            >
              <View>
                <Text style={styles.historyEyebrow}>HISTÓRICO</Text>
                <Text accessibilityRole="header" style={styles.historyTitle}>
                  Pagamentos registrados
                </Text>
                <Text style={styles.historySubtitle}>
                  {serverTotalItems} lançamento
                  {serverTotalItems === 1 ? "" : "s"} encontrado
                  {serverTotalItems === 1 ? "" : "s"}
                </Text>
              </View>
              <View
                style={[
                  styles.historyTools,
                  !wide && styles.historyToolsMobile,
                ]}
              >
                <View
                  style={[
                    styles.historyToolsTop,
                    !wide && styles.historyToolsTopMobile,
                  ]}
                >
                  <View style={[styles.historySearch, !wide && styles.historySearchMobile]}>
                    <AppIcon name="search" size={20} color={colors.mutedSoft} />
                    <TextInput
                      accessibilityLabel="Buscar pagamentos"
                      value={paymentQuery}
                      onChangeText={(text) => {
                        setPaymentQuery(text);
                        setPaymentPage(1);
                      }}
                      placeholder="Buscar cliente ou serviço"
                      placeholderTextColor={colors.mutedSoft}
                      style={styles.historySearchInput}
                    />
                  </View>
                  <View style={[styles.periodPickerRow, !wide && styles.periodPickerRowMobile]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Selecionar mês e ano"
                      onPress={() => {
                        setPickerYear(
                          periodFilter
                            ? periodFilter.slice(0, 4)
                            : yearOptions[0],
                        );
                        setPeriodPickerVisible(true);
                      }}
                      style={[
                        styles.periodPickerInput,
                        !wide && styles.periodPickerInputMobile,
                      ]}
                    >
                      <View style={styles.tableFilterCopy}>
                        <Text style={styles.tableFilterLabel}>Data</Text>
                        <Text numberOfLines={1} style={styles.periodPickerValue}>{periodLabel}</Text>
                      </View>
                      <AppIcon name="forward" size={16} color={colors.mutedSoft} />
                    </Pressable>
                  </View>
                </View>
                <View style={styles.historyFilters}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Selecionar status"
                    onPress={() => setTableStatusPickerVisible(true)}
                    style={[styles.periodPickerInput, !wide && styles.periodPickerInputMobile]}
                  >
                    <View style={styles.tableFilterCopy}>
                      <Text style={styles.tableFilterLabel}>Status</Text>
                      <Text style={styles.periodPickerValue}>{paymentFilter}</Text>
                    </View>
                    <AppIcon name="forward" size={16} color={colors.mutedSoft} />
                  </Pressable>
                </View>
              </View>
            </View>
            {visiblePayments.length ? (
              <View style={[styles.paymentList, !paymentTableWide && styles.paymentListMobile]}>
                {paymentTableWide && (
                  <View style={styles.paymentTableHeader}>
                    <Text
                      style={[styles.tableLabel, styles.paymentClientColumn]}
                    >
                      CLIENTE
                    </Text>
                    <Text
                      style={[styles.tableLabel, styles.paymentServiceColumn]}
                    >
                      SERVIÇO
                    </Text>
                    <Text
                      style={[styles.tableLabel, styles.paymentValueColumn]}
                    >
                      VALOR
                    </Text>
                    <Text style={[styles.tableLabel, styles.paymentDateColumn]}>
                      VENCIMENTO
                    </Text>
                    <Text
                      style={[styles.tableLabel, styles.paymentStatusColumn]}
                    >
                      SITUAÇÃO
                    </Text>
                    <View style={styles.paymentActionColumn} />
                  </View>
                )}
                {visiblePayments.map((item) =>
                  paymentTableWide ? (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Abrir histórico de pagamento de ${item.clientName}`}
                      onPress={() => router.push(`/payments/${item.id}` as never)}
                      style={styles.paymentRow}
                    >
                      <View style={styles.paymentClientColumn}>
                        <Text style={styles.paymentClientName}>
                          {item.clientName}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.paymentCell,
                          styles.paymentServiceColumn,
                        ]}
                      >
                        {item.service}
                      </Text>
                      <Text
                        style={[styles.paymentValue, styles.paymentValueColumn]}
                      >
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(displayValue(item))}
                      </Text>
                      <Text
                        style={[styles.paymentCell, styles.paymentDateColumn]}
                      >
                        {item.dueDate}
                      </Text>
                      <View style={styles.paymentStatusColumn}>
                        <View
                          style={[
                            styles.listStatus,
                            item.status === "Recebido"
                              ? styles.listStatusReceived
                              : item.status === "Atrasado"
                                ? styles.listStatusOverdue
                                : item.status === "Cancelado"
                                  ? styles.listStatusCancelled
                                  : styles.listStatusPending,
                          ]}
                        >
                          <AppIcon
                            name={item.status === "Recebido" ? "success" : item.status === "Atrasado" ? "warning" : item.status === "Cancelado" ? "error" : "schedule"}
                            size={14}
                            color={item.status === "Recebido" ? colors.success : item.status === "Atrasado" ? colors.danger : item.status === "Cancelado" ? colors.muted : colors.warning}
                          />
                          <Text
                            style={[
                              styles.listStatusText,
                              item.status === "Recebido"
                                ? styles.receivedText
                                : item.status === "Atrasado"
                                  ? styles.overdueText
                                  : item.status === "Cancelado"
                                    ? styles.cancelledText
                                    : styles.pendingText,
                            ]}
                          >
                            {item.status}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.paymentActionColumn}>
                        {/* Mesmas opções do menu do mobile, só que como o
                            painel flutuante do desktop (igual ao menu de
                            perfil/notificações do cabeçalho) — mobile
                            continua com seu próprio bottom-sheet, inalterado. */}
                        <Pressable
                          accessibilityLabel={`Opções de pagamento de ${item.clientName}`}
                          onPress={(event) => {
                            event.stopPropagation();
                            rowActionsMenu.open(item, event);
                          }}
                          style={styles.dotsButton}
                        >
                          <AppIcon name="dots" size={18} color={colors.muted} />
                        </Pressable>
                      </View>
                    </Pressable>
                  ) : (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Abrir histórico de pagamento de ${item.clientName}`}
                      onPress={() => router.push(`/payments/${item.id}` as never)}
                      style={styles.paymentCard}
                    >
                      <View style={styles.paymentCardTop}>
                        <View style={styles.paymentCardAvatar}>
                          <AppIcon name="user" size={20} color={colors.brand} />
                        </View>
                        <View style={styles.paymentCardCopy}>
                          <Text style={styles.paymentClientName}>
                            {item.clientName}
                          </Text>
                          <Text style={styles.paymentCell}>{item.service}</Text>
                        </View>
                        <Pressable
                          accessibilityLabel={`Opções de pagamento de ${item.clientName}`}
                          onPress={(event) => {
                            event.stopPropagation();
                            setMobileActionPayment(item);
                          }}
                          style={styles.dotsButton}
                        >
                          <AppIcon name="dots" size={18} color={colors.muted} />
                        </Pressable>
                      </View>
                      <View style={styles.paymentCardMeta}>
                        <View>
                          <Text style={styles.metaLabel}>Valor</Text>
                          <Text style={styles.paymentValue}>
                            {new Intl.NumberFormat("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            }).format(displayValue(item))}
                          </Text>
                        </View>
                        <View>
                          <Text style={styles.metaLabel}>Vencimento</Text>
                          <Text style={styles.paymentCell}>{item.dueDate}</Text>
                        </View>
                      </View>
                      {/* Status abaixo de título/descrição, com dots no canto direito */}
                      <View style={styles.paymentCardStatusDotsRow}>
                        <View
                          style={[
                            styles.listStatus,
                            item.status === "Recebido"
                              ? styles.listStatusReceived
                              : item.status === "Atrasado"
                                ? styles.listStatusOverdue
                                : item.status === "Cancelado"
                                  ? styles.listStatusCancelled
                                  : styles.listStatusPending,
                          ]}
                        >
                          <AppIcon
                            name={item.status === "Recebido" ? "success" : item.status === "Atrasado" ? "warning" : item.status === "Cancelado" ? "error" : "schedule"}
                            size={14}
                            color={item.status === "Recebido" ? colors.success : item.status === "Atrasado" ? colors.danger : item.status === "Cancelado" ? colors.muted : colors.warning}
                          />
                          <Text
                            style={[
                              styles.listStatusText,
                              item.status === "Recebido"
                                ? styles.receivedText
                                : item.status === "Atrasado"
                                  ? styles.overdueText
                                  : item.status === "Cancelado"
                                    ? styles.cancelledText
                                    : styles.pendingText,
                            ]}
                          >
                            {item.status}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ),
                )}
              </View>
            ) : (
              <View style={styles.historyEmpty}>
                <AppIcon name="financial" size={32} color={colors.mutedSoft} />
                <Text style={styles.historyEmptyTitle}>
                  Nenhum pagamento encontrado
                </Text>
                <Text style={styles.historyEmptyText}>
                  Altere os filtros ou registre um novo pagamento.
                </Text>
              </View>
            )}
            <View
              style={[
                styles.historyPagination,
                !wide && styles.historyPaginationMobile,
              ]}
            >
              <Text style={styles.paginationInfo}>
                {serverTotalItems
                  ? `${(paymentPage - 1) * paymentPageSize + 1}–${Math.min(paymentPage * paymentPageSize, serverTotalItems)} de ${serverTotalItems}`
                  : "0 pagamentos"}
              </Text>
              <View style={styles.paginationActions}>
                <Pressable
                  accessibilityLabel="Página anterior"
                  disabled={paymentPage === 1}
                  onPress={() =>
                    setPaymentPage((page) => Math.max(1, page - 1))
                  }
                  style={[
                    styles.pageButton,
                    paymentPage === 1 && styles.pageButtonDisabled,
                  ]}
                >
                  <AppIcon
                    name="back"
                    size={16}
                    color={paymentPage === 1 ? colors.mutedSoft : colors.brand}
                  />
                </Pressable>
                <Text style={styles.pageText}>
                  {paymentPage} de {paymentTotalPages}
                </Text>
                <Pressable
                  accessibilityLabel="Próxima página"
                  disabled={paymentPage === paymentTotalPages}
                  onPress={() =>
                    setPaymentPage((page) =>
                      Math.min(paymentTotalPages, page + 1),
                    )
                  }
                  style={[
                    styles.pageButton,
                    paymentPage === paymentTotalPages &&
                      styles.pageButtonDisabled,
                  ]}
                >
                  <AppIcon
                    name="forward"
                    size={16}
                    color={
                      paymentPage === paymentTotalPages
                        ? colors.mutedSoft
                        : colors.brand
                    }
                  />
                </Pressable>
              </View>
            </View>
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
        visible={tableStatusPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTableStatusPickerVisible(false)}
      >
        <Pressable onPress={() => setTableStatusPickerVisible(false)} style={styles.modalBackdrop}>
          <Pressable onPress={() => undefined} style={styles.periodPickerModal}>
            <View style={styles.clientModalHeader}>
              <View style={styles.clientModalHeaderCopy}>
                <Text style={styles.clientModalTitle}>Filtrar por status</Text>
                <Text style={styles.clientModalSubtitle}>Selecione quais pagamentos deseja visualizar.</Text>
              </View>
              <Pressable accessibilityLabel="Fechar seletor de status" onPress={() => setTableStatusPickerVisible(false)} style={styles.closeButton}>
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.tableStatusOptions}>
              {(["Todos", "Pendente", "Recebido"] as const).map((item) => (
                <Pressable key={item} onPress={() => { setPaymentFilter(item); setPaymentPage(1); setTableStatusPickerVisible(false); }} style={[styles.tableStatusOption, paymentFilter === item && styles.tableStatusOptionActive]}>
                  <Text style={[styles.tableStatusOptionText, paymentFilter === item && styles.tableStatusOptionTextActive]}>{item}</Text>
                  {paymentFilter === item && <AppIcon name="success" size={20} color={colors.onBrand} />}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={periodPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPeriodPickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.periodPickerModal}>
            <View style={styles.clientModalHeader}>
              <View style={styles.clientModalHeaderCopy}>
                <Text style={styles.clientModalTitle}>Selecionar período</Text>
                <Text style={styles.clientModalSubtitle}>
                  Escolha o ano inteiro ou um mês específico.
                </Text>
              </View>
              <Pressable
                onPress={() => setPeriodPickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <Text style={styles.pickerSectionLabel}>Ano</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pickerYears}
            >
              {yearOptions.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setPickerYear(item)}
                  style={[
                    styles.periodOption,
                    pickerYear === item && styles.periodOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.periodOptionText,
                      pickerYear === item && styles.periodOptionTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => {
                setPeriodFilter(pickerYear);
                setPaymentPage(1);
                setPeriodPickerVisible(false);
              }}
              style={[
                styles.fullYearOption,
                periodFilter === pickerYear && styles.periodOptionActive,
              ]}
            >
              <AppIcon
                name="calendar"
                size={20}
                color={
                  periodFilter === pickerYear ? colors.onBrand : colors.brand
                }
              />
              <View style={styles.fullYearOptionCopy}>
                <Text
                  style={[
                    styles.fullYearOptionTitle,
                    periodFilter === pickerYear &&
                      styles.periodOptionTextActive,
                  ]}
                >
                  Todo o ano de {pickerYear}
                </Text>
                <Text
                  style={[
                    styles.fullYearOptionText,
                    periodFilter === pickerYear &&
                      styles.periodOptionTextActive,
                  ]}
                >
                  Consolidar os doze meses
                </Text>
              </View>
              {periodFilter === pickerYear && (
                <AppIcon name="success" size={20} color={colors.onBrand} />
              )}
            </Pressable>
            <Text style={styles.pickerSectionLabel}>Mês</Text>
            <View style={styles.pickerMonths}>
              {monthOptions.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => {
                    setPeriodFilter(`${pickerYear}-${item}`);
                    setPaymentPage(1);
                    setPeriodPickerVisible(false);
                  }}
                  style={[
                    styles.pickerMonth,
                    periodFilter === `${pickerYear}-${item}` &&
                      styles.periodOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.periodOptionText,
                      periodFilter === `${pickerYear}-${item}` &&
                        styles.periodOptionTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={paymentFormVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPaymentFormVisible(false)}
      >
        <KeyboardAvoidingView
          style={[styles.modalBackdrop, !wide && styles.modalBackdropMobile]}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <View accessibilityViewIsModal style={[styles.paymentFormModal, !wide && styles.paymentFormModalMobile]}>
            <ScrollView
              style={styles.paymentFormModalScroll}
              contentContainerStyle={[styles.paymentFormModalContent, !wide && styles.paymentFormModalContentMobile]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {paymentForm}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={statusAction !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusAction(null)}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.confirmModal}>
            <View style={styles.confirmIcon}>
              <AppIcon name={statusAction?.status === "Atrasado" ? "warning" : "error"} size={24} color={colors.danger} />
            </View>
            <Text style={styles.successTitle}>
              {statusAction?.status === "Atrasado" ? "Marcar como atrasado?" : "Cancelar cobrança?"}
            </Text>
            <Text style={styles.successDescription}>
              {statusAction?.status === "Atrasado"
                ? "Esta cobrança será marcada como atrasada. Você pode alterar o status novamente a qualquer momento."
                : "Esta cobrança será cancelada e não poderá receber pagamentos nem ser reaberta. Se precisar cobrar de novo, registre um novo lançamento."}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={updatingStatus}
                onPress={() => setStatusAction(null)}
                style={[styles.cancelButton, styles.formActionButton, updatingStatus && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelText}>Voltar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: updatingStatus, busy: updatingStatus }}
                disabled={updatingStatus}
                onPress={() => void confirmStatusAction()}
                style={({ pressed }) => [
                  statusAction?.status === "Atrasado"
                    ? styles.confirmStatusButton
                    : styles.confirmDeleteButton,
                  styles.formActionButton,
                  styles.confirmButtonSpinnerRow,
                  pressed && !updatingStatus && { opacity: opacity.pressed },
                ]}
              >
                {updatingStatus && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.confirmDeleteText}>
                  {statusAction?.status === "Atrasado" ? "Atrasar" : "Cancelar"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={deleteId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { setDeleteId(null); setDeleteError(""); }}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.confirmModal}>
            <View style={styles.confirmIcon}>
              <AppIcon name="delete" size={24} color={colors.danger} />
            </View>
            <Text style={styles.successTitle}>Excluir pagamento?</Text>
            <Text style={styles.successDescription}>
              O registro será removido permanentemente. Essa ação não pode ser
              desfeita.
            </Text>
            {/* Feedback visível de falha (Nielsen — visibilidade do status do
                sistema): sem isto, uma exclusão bloqueada (ex.: pagamento com
                recibo de quitação) fechava o modal sem qualquer indicação ao
                usuário de que nada foi excluído. */}
            {deleteError ? (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <AppIcon name="warning" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{deleteError}</Text>
              </View>
            ) : null}
            <View style={styles.confirmActions}>
              <Pressable
                disabled={deletingPayment}
                onPress={() => { setDeleteId(null); setDeleteError(""); }}
                style={[styles.cancelButton, styles.formActionButton, deletingPayment && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelText}>
                  {deleteError ? "Fechar" : "Cancelar"}
                </Text>
              </Pressable>
              {!deleteError && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: deletingPayment, busy: deletingPayment }}
                  disabled={deletingPayment}
                  onPress={() => void confirmDelete()}
                  style={({ pressed }) => [
                    styles.confirmDeleteButton,
                    styles.formActionButton,
                    styles.confirmButtonSpinnerRow,
                    pressed && !deletingPayment && { opacity: opacity.pressed },
                  ]}
                >
                  {deletingPayment && <ActivityIndicator size="small" color={colors.onBrand} />}
                  <Text style={styles.confirmDeleteText}>Excluir</Text>
                </Pressable>
              )}
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
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.clientModal}>
            <View style={styles.clientModalHeader}>
              <View style={styles.clientModalHeaderCopy}>
                <Text
                  accessibilityRole="header"
                  style={styles.clientModalTitle}
                >
                  Selecionar cliente
                </Text>
                <Text style={styles.clientModalSubtitle}>
                  {filteredClients.length} clientes encontrados
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar seleção"
                onPress={() => setClientPickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.clientSearch}>
              <AppIcon name="search" size={20} color={colors.mutedSoft} />
              <TextInput
                accessibilityLabel="Buscar cliente por nome ou e-mail"
                value={clientQuery}
                onChangeText={(text) => {
                  setClientQuery(text);
                  setClientPage(1);
                }}
                placeholder="Buscar por nome ou e-mail"
                placeholderTextColor={colors.mutedSoft}
                style={styles.clientSearchInput}
              />
            </View>
            <ScrollView
              style={styles.clientModalList}
              contentContainerStyle={styles.clientList}
            >
              {loadingClients && (
                <View style={styles.clientEmpty}>
                  <Text style={styles.clientEmptyText}>Carregando clientes...</Text>
                </View>
              )}
              {!loadingClients && clientLoadError && (
                <View style={styles.clientEmpty}>
                  <AppIcon name="warning" size={24} color={colors.danger} />
                  <Text style={styles.clientEmptyText}>{clientLoadError}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: retryingClients, busy: retryingClients }}
                    disabled={retryingClients}
                    onPress={() => void retryLoadPaymentClients()}
                    style={({ pressed }) => [
                      styles.retryButton,
                      styles.confirmButtonSpinnerRow,
                      pressed && !retryingClients && { opacity: opacity.pressed },
                    ]}
                  >
                    {retryingClients && <ActivityIndicator size="small" color={colors.onBrand} />}
                    <Text style={styles.retryButtonText}>Tentar novamente</Text>
                  </Pressable>
                </View>
              )}
              {!loadingClients && !clientLoadError && visibleClients.map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: clientId === item.id }}
                  onPress={() => {
                    setClientId(item.id);
                    setClientPickerVisible(false);
                    setError("");
                    setFieldErrors((current) => ({ ...current, clientId: undefined }));
                  }}
                  key={item.id}
                  style={[
                    styles.clientRow,
                    clientId === item.id && styles.clientRowActive,
                  ]}
                >
                  <View
                    style={[
                      styles.clientRowAvatar,
                      clientId === item.id && styles.clientRowAvatarActive,
                    ]}
                  >
                    <AppIcon
                      name="user"
                      size={16}
                      color={
                        clientId === item.id ? colors.onBrand : colors.brand
                      }
                    />
                  </View>
                  <View style={styles.clientRowCopy}>
                    <Text style={styles.clientRowName}>{item.name}</Text>
                    <Text style={styles.clientRowEmail}>{item.email}</Text>
                  </View>
                  {clientId === item.id && (
                    <AppIcon name="success" size={20} color={colors.success} />
                  )}
                </Pressable>
              ))}
              {!loadingClients && !clientLoadError && visibleClients.length === 0 && (
                <View style={styles.clientEmpty}>
                  <AppIcon name="search" size={24} color={colors.mutedSoft} />
                  <Text style={styles.clientEmptyText}>
                    {paymentClients.length === 0
                      ? "Você ainda não cadastrou clientes."
                      : "Nenhum cliente encontrado para esta busca."}
                  </Text>
                </View>
              )}
            </ScrollView>
            <View style={styles.clientPagination}>
              <Text style={styles.clientPaginationInfo}>
                {filteredClients.length
                  ? `${(clientPage - 1) * clientPageSize + 1}–${Math.min(clientPage * clientPageSize, filteredClients.length)} de ${filteredClients.length}`
                  : "0 clientes"}
              </Text>
              <View style={styles.clientPaginationActions}>
                <Pressable
                  disabled={clientPage === 1}
                  onPress={() => setClientPage((page) => Math.max(1, page - 1))}
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
                    setClientPage((page) =>
                      Math.min(clientTotalPages, page + 1),
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
      <Modal
        visible={servicePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setServicePickerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.clientModal}>
            <View style={styles.clientModalHeader}>
              <View style={styles.clientModalHeaderCopy}>
                <Text accessibilityRole="header" style={styles.clientModalTitle}>
                  Selecionar serviço
                </Text>
                <Text style={styles.clientModalSubtitle}>
                  {filteredServiceOptions.length} serviço(s) disponível(is)
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar seleção de serviço"
                onPress={() => setServicePickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.clientSearch}>
              <AppIcon name="search" size={20} color={colors.mutedSoft} />
              <TextInput
                accessibilityLabel="Buscar serviço por nome"
                value={serviceQuery}
                onChangeText={setServiceQuery}
                placeholder="Buscar por nome"
                placeholderTextColor={colors.mutedSoft}
                style={styles.clientSearchInput}
              />
            </View>
            <ScrollView style={styles.clientModalList} contentContainerStyle={styles.clientList}>
              {loadingServiceOptions && (
                <View style={styles.clientEmpty}>
                  <Text style={styles.clientEmptyText}>Carregando serviços...</Text>
                </View>
              )}
              {!loadingServiceOptions &&
                filteredServiceOptions.map((item) => {
                  const isSelected = selectedServiceId === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => {
                        setSelectedServiceId(item.id);
                        setService(item.name);
                        setValueCents(item.referenceValueCents);
                        setServiceManualMode(false);
                        setFieldErrors((current) => ({ ...current, service: undefined, value: undefined }));
                        setServicePickerVisible(false);
                      }}
                      style={[styles.clientRow, isSelected && styles.clientRowActive]}
                    >
                      <View style={[styles.clientRowAvatar, isSelected && styles.clientRowAvatarActive]}>
                        <AppIcon name="services" size={16} color={isSelected ? colors.onBrand : colors.brand} />
                      </View>
                      <View style={styles.clientRowCopy}>
                        <Text style={styles.clientRowName}>
                          {item.name}
                          {item.isDefault ? "  ·  Padrão" : ""}
                        </Text>
                        <Text style={styles.clientRowEmail}>
                          {item.durationMinutes} min · {formatCurrency(item.referenceValueCents)} de tabela
                        </Text>
                      </View>
                      {isSelected && <AppIcon name="success" size={20} color={colors.success} />}
                    </Pressable>
                  );
                })}
              {!loadingServiceOptions && filteredServiceOptions.length === 0 && (
                <View style={styles.clientEmpty}>
                  <AppIcon name="search" size={24} color={colors.mutedSoft} />
                  <Text style={styles.clientEmptyText}>
                    {serviceOptions.length === 0
                      ? "Nenhum serviço ativo no catálogo."
                      : "Nenhum serviço encontrado para esta busca."}
                  </Text>
                </View>
              )}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setServicePickerVisible(false);
                router.push("/services" as never);
              }}
              style={styles.serviceManualToggle}
            >
              <AppIcon name="add" size={16} color={colors.brand} />
              <Text style={styles.serviceManualToggleText}>Gerenciar catálogo de serviços</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={successVisible}
        transparent
        animationType="fade"
        onRequestClose={finish}
      >
        <View style={styles.modalBackdrop}>
          <View
            accessibilityViewIsModal
            accessibilityRole="alert"
            style={styles.successModal}
          >
            <View style={styles.successIcon}>
              <AppIcon name="success" size={32} color={colors.success} />
            </View>
            <Text accessibilityRole="header" style={styles.successTitle}>
              Pagamento registrado!
            </Text>
            <Text style={styles.successDescription}>
              {formattedValue} foi registrado para {selectedClient?.name} como{" "}
              {`${status.toLocaleLowerCase("pt-BR")}.`}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={finish}
              style={styles.successButton}
            >
              <Text style={styles.successButtonText}>Entendi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ─── Modal dedicado: registrar recebimento (total ou parcial) ─── */}
      <Modal
        visible={receiptItem !== null}
        transparent
        animationType="slide"
        onRequestClose={closeReceiptModal}
      >
        <KeyboardAvoidingView
          style={[styles.modalBackdrop, !wide && styles.modalBackdropMobile]}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <View accessibilityViewIsModal style={[styles.receiptModal, !wide && styles.receiptModalMobile]}>
            <View style={styles.clientModalHeader}>
              <View style={styles.clientModalHeaderCopy}>
                <Text accessibilityRole="header" style={styles.clientModalTitle}>
                  Registrar recebimento
                </Text>
                <Text style={styles.clientModalSubtitle}>
                  {receiptItem?.clientName} ·{" "}
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(receiptItem?.value ?? 0)}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Fechar"
                onPress={closeReceiptModal}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {receiptMode === null ? (
              <View style={styles.receiptModeOptions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReceiptMode("total")}
                  style={styles.receiptModeOption}
                >
                  <View style={[styles.receiptModeIcon, styles.receiptModeIconSuccess]}>
                    <AppIcon name="success" size={20} color={colors.success} />
                  </View>
                  <Text style={styles.receiptModeTitle}>Recebimento total</Text>
                  <Text style={styles.receiptModeHint}>
                    {loadingReceiptBalance
                      ? "Calculando saldo…"
                      : `Quita o saldo de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((receiptBalanceCents ?? (receiptItem?.value ?? 0) * 100) / 100)}.`}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReceiptMode("partial")}
                  style={styles.receiptModeOption}
                >
                  <View style={[styles.receiptModeIcon, styles.receiptModeIconBrand]}>
                    <AppIcon name="financial" size={20} color={colors.brand} />
                  </View>
                  <Text style={styles.receiptModeTitle}>Recebimento parcial</Text>
                  <Text style={styles.receiptModeHint}>
                    Registra parte do valor. O restante fica pendente.
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.form}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReceiptMode(null)}
                  style={styles.receiptModeBack}
                >
                  <AppIcon name="back" size={14} color={colors.brand} />
                  <Text style={styles.receiptModeBackText}>Escolher outra opção</Text>
                </Pressable>
                {receiptMode === "total" ? (
                  <View style={styles.partialPaymentBox}>
                    <View style={styles.partialPaymentHeader}>
                      <View style={styles.partialPaymentIcon}>
                        <AppIcon name="success" size={20} color={colors.success} />
                      </View>
                      <View style={styles.partialPaymentCopy}>
                        <Text style={styles.fieldLabel}>Recebimento total</Text>
                        <Text style={styles.partialPaymentHint}>
                          {loadingReceiptBalance
                            ? "Calculando saldo…"
                            : `Confirma o recebimento de ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((receiptBalanceCents ?? (receiptItem?.value ?? 0) * 100) / 100)}? A cobrança será marcada como Recebido.`}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={styles.partialPaymentBox}>
                    <View style={styles.partialPaymentHeader}>
                      <View style={styles.partialPaymentIcon}>
                        <AppIcon name="financial" size={20} color={colors.brand} />
                      </View>
                      <View style={styles.partialPaymentCopy}>
                        <Text style={styles.fieldLabel}>Valor recebido agora</Text>
                        <Text style={styles.partialPaymentHint}>
                          Registre uma quitação parcial. O saldo pendente será
                          recalculado e o valor quitado aparecerá no histórico
                          deste pagamento.
                        </Text>
                      </View>
                    </View>
                    <CurrencyInput
                      accessibilityLabel="Valor recebido agora"
                      valueCents={receiptAmountCents}
                      onChangeValueCents={(cents) => { setReceiptAmountCents(cents); setReceiptFieldError(""); }}
                      invalid={!!receiptFieldError}
                    />
                    {!!receiptFieldError && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{receiptFieldError}</Text>}
                    <View style={styles.partialBalanceRow}>
                      <Text style={styles.partialBalanceLabel}>Saldo após este pagamento</Text>
                      <Text style={styles.partialBalanceValue}>
                        {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                          Math.max(0, (receiptBalanceCents ?? (receiptItem?.value ?? 0) * 100) - receiptAmountCents) / 100,
                        )}
                      </Text>
                    </View>
                  </View>
                )}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Data do recebimento</Text>
                  <DatePickerField
                    label="Data do recebimento"
                    accessibilityLabel="Data em que o valor foi recebido, no formato dia mês e ano"
                    title="Data do recebimento"
                    value={receiptDate}
                    onChangeText={(text) => { setReceiptDate(formatDateInput(text)); setReceiptDateError(""); }}
                    keyboardType="number-pad"
                    maxLength={10}
                    placeholder="DD/MM/AAAA"
                    maxDate={todayUtc()}
                    invalid={!!receiptDateError}
                  />
                  <Text style={styles.receiptDateHint}>
                    Define em qual mês este recebimento aparece no histórico financeiro. Vem preenchida com hoje; ajuste se o cliente pagou em outra data.
                  </Text>
                  {!!receiptDateError && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{receiptDateError}</Text>}
                </View>
                {!!receiptError && (
                  <View accessibilityRole="alert" style={styles.errorBox}>
                    <AppIcon name="warning" size={16} color={colors.danger} />
                    <Text style={styles.errorText}>{receiptError}</Text>
                  </View>
                )}
                <View style={styles.formActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={savingReceipt}
                    onPress={closeReceiptModal}
                    style={[styles.cancelButton, styles.formActionButton, savingReceipt && { opacity: opacity.disabled }]}
                  >
                    <Text style={styles.cancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: savingReceipt, busy: savingReceipt }}
                    disabled={savingReceipt}
                    onPress={() => void confirmReceipt()}
                    style={({ pressed }) => [
                      styles.saveButton,
                      styles.formActionButton,
                      pressed && !savingReceipt && { opacity: opacity.pressed },
                    ]}
                  >
                    {savingReceipt && <ActivityIndicator size="small" color={colors.onBrand} />}
                    <Text style={styles.saveText}>Salvar</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={receiptSuccessVisible}
        transparent
        animationType="fade"
        onRequestClose={finishReceipt}
      >
        <View style={styles.modalBackdrop}>
          <View
            accessibilityViewIsModal
            accessibilityRole="alert"
            style={styles.successModal}
          >
            <View style={styles.successIcon}>
              <AppIcon name="success" size={32} color={colors.success} />
            </View>
            <Text accessibilityRole="header" style={styles.successTitle}>
              Recebimento registrado!
            </Text>
            <Text style={styles.successDescription}>
              {receiptMode === "total" ? "O recebimento total" : "O recebimento parcial"} de{" "}
              {receiptItem?.clientName} foi registrado com sucesso.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={finishReceipt}
              style={styles.successButton}
            >
              <Text style={styles.successButtonText}>Entendi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {/* ─── Modal dedicado: alterar vencimento (cobranças atrasadas) ─── */}
      <Modal
        visible={dueDateItem !== null}
        transparent
        animationType="fade"
        onRequestClose={closeDueDateModal}
      >
        <KeyboardAvoidingView
          style={[styles.modalBackdrop, !wide && styles.modalBackdropMobile]}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <View accessibilityViewIsModal style={[styles.receiptModal, !wide && styles.receiptModalMobile]}>
            <View style={styles.clientModalHeader}>
              <View style={styles.clientModalHeaderCopy}>
                <Text accessibilityRole="header" style={styles.clientModalTitle}>
                  Alterar vencimento
                </Text>
                <Text style={styles.clientModalSubtitle}>{dueDateItem?.clientName}</Text>
              </View>
              <Pressable
                accessibilityLabel="Fechar"
                onPress={closeDueDateModal}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.form}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Novo vencimento<Text style={styles.requiredMark}> *</Text></Text>
                <DatePickerField
                  label="Novo vencimento"
                  value={dueDateValue}
                  onChangeText={(text) => { setDueDateValue(formatDateInput(text)); setDueDateError(""); }}
                  keyboardType="number-pad"
                  maxLength={10}
                  placeholder="DD/MM/AAAA"
                  invalid={!!dueDateError}
                />
                {!!dueDateError && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{dueDateError}</Text>}
              </View>
              <View style={styles.formActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={savingDueDate}
                  onPress={closeDueDateModal}
                  style={[styles.cancelButton, styles.formActionButton, savingDueDate && { opacity: opacity.disabled }]}
                >
                  <Text style={styles.cancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: savingDueDate, busy: savingDueDate }}
                  disabled={savingDueDate}
                  onPress={() => void saveDueDate()}
                  style={({ pressed }) => [
                    styles.saveButton,
                    styles.formActionButton,
                    pressed && !savingDueDate && { opacity: opacity.pressed },
                  ]}
                >
                  {savingDueDate && <ActivityIndicator size="small" color={colors.onBrand} />}
                  <Text style={styles.saveText}>Salvar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Menu de ações do desktop (painel flutuante) ─── */}
      <RowActionsMenu
        position={rowActionsMenu.position}
        onRequestClose={rowActionsMenu.close}
        items={
          rowActionsMenu.item
            ? [
                {
                  key: "details",
                  label: "Ver detalhes do pagamento",
                  icon: "forward",
                  onPress: () => router.push(`/payments/${rowActionsMenu.item!.id}` as never),
                },
                // BLG-XXX: rótulo condicional ao status (`resolveReceiptActionLabel`)
                // — "Registrar recebimento" só faz sentido para pendente/atrasado;
                // recebido vira "Editar status" (mesmo `openPayment`, que já roteia
                // para `openEditForm` nesse caso); cancelado é terminal e não
                // oferece a ação (null omite o item, mantendo apenas "Ver
                // detalhes" e "Excluir lançamento").
                ...(resolveReceiptActionLabel(rowActionsMenu.item.status)
                  ? [
                      {
                        key: "receipt",
                        label: resolveReceiptActionLabel(rowActionsMenu.item.status)!,
                        icon: "edit" as const,
                        onPress: () => openPayment(rowActionsMenu.item!),
                      },
                    ]
                  : []),
                ...(rowActionsMenu.item.status === "Atrasado" && rowActionsMenu.item.kind !== "receipt"
                  ? [
                      {
                        key: "due-date",
                        label: "Alterar vencimento",
                        icon: "schedule" as const,
                        onPress: () => openDueDateModal(rowActionsMenu.item!),
                      },
                    ]
                  : []),
                ...(rowActionsMenu.item.status === "Pendente" && rowActionsMenu.item.kind !== "receipt"
                  ? [
                      {
                        key: "overdue",
                        label: "Marcar como atrasado",
                        icon: "warning" as const,
                        iconBackgroundColor: colors.warningSoft,
                        iconColor: colors.warning,
                        onPress: () => setStatusAction({ id: rowActionsMenu.item!.id, status: "Atrasado" }),
                      },
                    ]
                  : []),
                ...((rowActionsMenu.item.status === "Pendente" || rowActionsMenu.item.status === "Atrasado") &&
                rowActionsMenu.item.kind !== "receipt" &&
                !hasReceipt(rowActionsMenu.item)
                  ? [
                      {
                        key: "cancel",
                        label: "Cancelar cobrança",
                        icon: "error" as const,
                        iconBackgroundColor: colors.dangerSoft,
                        iconColor: colors.danger,
                        labelColor: colors.danger,
                        onPress: () => setStatusAction({ id: rowActionsMenu.item!.id, status: "Cancelado" }),
                      },
                    ]
                  : []),
                {
                  key: "delete",
                  label: "Excluir lançamento",
                  icon: "delete",
                  iconBackgroundColor: colors.dangerSoft,
                  iconColor: colors.danger,
                  labelColor: colors.danger,
                  onPress: () => {
                    setDeleteError("");
                    setDeleteId(rowActionsMenu.item!.id);
                  },
                },
              ]
            : []
        }
      />

      {/* ─── Modal de ações rápidas (mobile bottom-sheet) ─── */}
      {mobileActionPayment !== null && (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() => setMobileActionPayment(null)}
      >
        <Pressable
          style={styles.mobileActionsBackdrop}
          onPress={() => setMobileActionPayment(null)}
        >
          <Pressable style={styles.mobileActionsSheet} onPress={() => {}}>
            <View style={styles.mobileActionsHandle} />
            <Text style={styles.mobileActionsTitle} numberOfLines={1}>
              {mobileActionPayment?.clientName ?? ""}
            </Text>

            {/* Ver detalhes do pagamento — mesma página do botão de seta da linha */}
            <Pressable
              style={styles.mobileActionRow}
              onPress={() => {
                const payment = mobileActionPayment;
                setMobileActionPayment(null);
                if (payment) router.push(`/payments/${payment.id}` as never);
              }}
            >
              <View style={[styles.mobileActionIcon, { backgroundColor: colors.brandSoft }]}>
                <AppIcon name="forward" size={18} color={colors.brand} />
              </View>
              <Text style={styles.mobileActionLabel}>Ver detalhes do pagamento</Text>
            </Pressable>

            {/* Recebimento/edição de status — rótulo condicional ao status
                (`resolveReceiptActionLabel`), mesma regra do menu desktop:
                cancelado é terminal e não mostra este item. */}
            {mobileActionPayment && resolveReceiptActionLabel(mobileActionPayment.status) && (
              <Pressable
                style={styles.mobileActionRow}
                onPress={() => {
                  const payment = mobileActionPayment;
                  setMobileActionPayment(null);
                  if (payment) openPayment(payment);
                }}
              >
                <View style={[styles.mobileActionIcon, { backgroundColor: colors.brandSoft }]}>
                  <AppIcon name="edit" size={18} color={colors.brand} />
                </View>
                <Text style={styles.mobileActionLabel}>
                  {resolveReceiptActionLabel(mobileActionPayment.status)}
                </Text>
              </Pressable>
            )}

            {/* Alterar vencimento — só cobranças atrasadas */}
            {mobileActionPayment?.status === "Atrasado" && mobileActionPayment.kind !== "receipt" && (
              <Pressable
                style={styles.mobileActionRow}
                onPress={() => {
                  const payment = mobileActionPayment;
                  setMobileActionPayment(null);
                  if (payment) openDueDateModal(payment);
                }}
              >
                <View style={[styles.mobileActionIcon, { backgroundColor: colors.brandSoft }]}>
                  <AppIcon name="schedule" size={18} color={colors.brand} />
                </View>
                <Text style={styles.mobileActionLabel}>Alterar vencimento</Text>
              </Pressable>
            )}

            {/* Marcar como atrasado */}
            {mobileActionPayment?.status === "Pendente" && mobileActionPayment.kind !== "receipt" && (
              <Pressable
                style={styles.mobileActionRow}
                onPress={() => {
                  const payment = mobileActionPayment;
                  setMobileActionPayment(null);
                  setStatusAction({ id: payment.id, status: "Atrasado" });
                }}
              >
                <View style={[styles.mobileActionIcon, { backgroundColor: colors.warningSoft }]}>
                  <AppIcon name="warning" size={18} color={colors.warning} />
                </View>
                <Text style={styles.mobileActionLabel}>Marcar como atrasado</Text>
              </Pressable>
            )}

            {/* Cancelar cobrança */}
            {(mobileActionPayment?.status === "Pendente" || mobileActionPayment?.status === "Atrasado") && mobileActionPayment.kind !== "receipt" && !hasReceipt(mobileActionPayment) && (
              <Pressable
                style={styles.mobileActionRow}
                onPress={() => {
                  const payment = mobileActionPayment;
                  setMobileActionPayment(null);
                  setStatusAction({ id: payment.id, status: "Cancelado" });
                }}
              >
                <View style={[styles.mobileActionIcon, { backgroundColor: colors.dangerSoft }]}>
                  <AppIcon name="error" size={18} color={colors.danger} />
                </View>
                <Text style={[styles.mobileActionLabel, { color: colors.danger }]}>Cancelar cobrança</Text>
              </Pressable>
            )}

            {/* Excluir lançamento */}
            <Pressable
              style={styles.mobileActionRow}
              onPress={() => {
                const payment = mobileActionPayment;
                setMobileActionPayment(null);
                if (payment) {
                  setDeleteError("");
                  setDeleteId(payment.id);
                }
              }}
            >
              <View style={[styles.mobileActionIcon, { backgroundColor: colors.dangerSoft }]}>
                <AppIcon name="delete" size={18} color={colors.danger} />
              </View>
              <Text style={[styles.mobileActionLabel, { color: colors.danger }]}>Excluir lançamento</Text>
            </Pressable>

            {/* Fechar */}
            <Pressable
              style={[styles.mobileActionRow, styles.mobileActionClose]}
              onPress={() => setMobileActionPayment(null)}
            >
              <Text style={styles.mobileActionCloseLabel}>Fechar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      )}

      <MobileTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: { minHeight: 72, justifyContent: "center" },
  headerInner: {
    width: "100%",
    maxWidth: layout.contentMax,
    minHeight: 72,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 28,
  },
  accent: { color: colors.brand },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
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
  heading: { gap: spacing.xs },
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
  },
  description: {
    maxWidth: 720,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
    lineHeight: typography.lineHeight.bodyLarge,
  },
  financialKpiScroller: {
    marginHorizontal: -12,
    marginVertical: -20,
  },
  financialKpis: {
    gap: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 20,
  },
  financialKpisWide: { flexDirection: "row", flexGrow: 1 },
  financialKpi: {
    width: 256,
    minHeight: 168,
    flex: 1,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  financialKpiIcon: {
    width: 44,
    height: 44,
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  receivedKpiIcon: { backgroundColor: colors.successSoft },
  pendingKpiIcon: { backgroundColor: colors.warningSoft },
  financialKpiLabel: {
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
  },
  financialKpiValue: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 28,
    lineHeight: 34,
  },
  financialKpiPeriod: {
    marginTop: spacing.xs,
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  kpiDots: {
    marginTop: -spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  kpiDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
  },
  kpiDotActive: { width: 18, backgroundColor: colors.brand },
  mainGrid: { gap: spacing.md },
  mainGridWide: { flexDirection: "row", alignItems: "flex-start" },
  formCard: {
    flex: 2,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  sectionIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  form: { marginTop: spacing.lg },
  formSection: { gap: spacing.md },
  formSectionSpaced: { marginTop: spacing.xl },
  formSectionLabel: {
    color: colors.muted,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  fieldGroup: { gap: 6 },
  receiptModeOptions: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  receiptModeOption: {
    flexGrow: 1,
    flexBasis: 180,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  receiptModeIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  receiptModeIconSuccess: { backgroundColor: colors.successSoft },
  receiptModeIconBrand: { backgroundColor: colors.brandSoft },
  receiptModeTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  receiptModeHint: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  receiptModeBack: {
    alignSelf: "flex-start",
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  receiptModeBackText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  partialPaymentBox: {
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  partialPaymentHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  partialPaymentIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  partialPaymentCopy: { flex: 1, gap: spacing.xs },
  partialPaymentHint: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  receiptDateHint: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  partialBalanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  partialBalanceLabel: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  partialBalanceValue: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  fieldLabel: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  optional: { color: colors.mutedSoft, fontFamily: typography.family.regular },
  fieldInput: {
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
  fieldInputError: { borderColor: colors.danger },
  requiredMark: { color: colors.danger },
  fieldErrorText: {
    color: colors.danger,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
    marginTop: 4,
  },
  clientOptions: { gap: spacing.sm, paddingBottom: spacing.xs },
  clientOption: {
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  clientOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  clientAvatar: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  clientAvatarActive: { backgroundColor: colors.brand },
  clientOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  clientOptionTextActive: { color: colors.brandDark },
  formRow: { flexDirection: "row", gap: spacing.md },
  formRowMobile: { flexDirection: "column", gap: spacing.md },
  rowField: { flex: 1, width: "100%", gap: 6 },
  statusSelector: {
    padding: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  statusOption: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: "46%",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.xs,
  },
  statusOptionActive: { backgroundColor: colors.brand },
  statusOptionDisabled: { opacity: opacity.disabled },
  statusOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  statusOptionTextActive: { color: colors.onBrand },
  notesInput: {
    minHeight: 90,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  errorBox: {
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
  cancelText: { color: colors.muted, fontFamily: typography.family.semibold },
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
  saveText: { color: colors.onBrand, fontFamily: typography.family.bold },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  summaryCard: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandDark,
    ...elevation.card,
  },
  summaryEyebrow: {
    color: colors.accentSoft,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  summaryValueBox: { marginTop: spacing.lg },
  summaryLabel: {
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  summaryValue: {
    marginTop: spacing.xs,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 34,
  },
  summaryRows: { marginTop: spacing.lg, gap: spacing.md },
  summaryRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  summaryRowLabel: {
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  summaryRowValue: {
    flex: 1,
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    textAlign: "right",
  },
  summaryStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  summaryPending: { backgroundColor: colors.warningSoft },
  summaryReceived: { backgroundColor: colors.successSoft },
  summaryStatusText: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  pendingText: { color: colors.warning },
  receivedText: { color: colors.success },
  infoBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  infoText: {
    flex: 1,
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  modalBackdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  modalBackdropMobile: {
    padding: spacing.md,
  },
  successModal: {
    width: "100%",
    maxWidth: 400,
    padding: spacing.lg,
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  successIcon: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  successTitle: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    textAlign: "center",
  },
  successDescription: {
    marginTop: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
    lineHeight: typography.lineHeight.bodyLarge,
    textAlign: "center",
  },
  successButton: {
    width: "100%",
    minHeight: 48,
    marginTop: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  successButtonText: {
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
  bottomPrimary: {
    width: 46,
    height: 46,
    marginTop: -24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    borderWidth: 4,
    borderColor: colors.canvas,
  },
  bottomLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.medium,
    fontSize: 10,
  },
  bottomLabelActive: {
    color: colors.brand,
    fontFamily: typography.family.bold,
  },
  clientSelector: {
    minHeight: 58,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  clientSelectorCopy: { flex: 1, minWidth: 0 },
  clientSelectorName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  clientSelectorEmail: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  clientSelectorPlaceholder: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  serviceManualToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  serviceManualToggleText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  clientModal: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "88%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  clientModalHeader: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  clientModalHeaderCopy: { flex: 1, minWidth: 0 },
  clientModalTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  clientModalSubtitle: {
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
  clientModalList: { flexShrink: 1, marginTop: spacing.md },
  clientList: { gap: spacing.sm },
  clientRow: {
    minHeight: 62,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  clientRowActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  clientRowAvatar: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  clientRowAvatarActive: { backgroundColor: colors.brand },
  clientRowCopy: { flex: 1, minWidth: 0 },
  clientRowName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  clientRowEmail: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  clientEmpty: {
    minHeight: 120,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  clientEmptyText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    textAlign: "center",
  },
  clientPagination: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clientPaginationInfo: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  clientPaginationActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
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
  pageButtonDisabled: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    opacity: 0.6,
  },
  pageText: {
    minWidth: 48,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  historyCard: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  historyHeader: {
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyHeaderMobile: { padding: spacing.md, alignItems: "stretch", flexDirection: "column" },
  historyEyebrow: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  historyTitle: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  historySubtitle: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  historyTools: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.md,
  },
  historyToolsMobile: {
    width: "100%",
    maxWidth: "100%",
    alignItems: "stretch",
    flexDirection: "column",
    gap: spacing.md,
  },
  historyToolsTop: {
    flex: 1,
    minWidth: 280,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  historyToolsTopMobile: {
    width: "100%",
    minWidth: "100%",
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  historySearch: {
    flex: 1,
    minWidth: 180,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  historySearchMobile: {
    width: "100%",
    minWidth: "100%",
    flex: 0,
    alignSelf: "stretch",
  },
  historySearchInput: {
    flex: 1,
    height: "100%",
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    padding: 0,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  historyFilters: {
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xs,
  },
  historyFilter: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  historyFilterActive: { backgroundColor: colors.brandSoft },
  historyFilterText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  historyFilterTextActive: { color: colors.brand },
  paymentTableHeader: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  tableLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 0.5,
  },
  paymentRow: {
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  paymentClientColumn: { flex: 1.5, minWidth: 0 },
  paymentServiceColumn: { flex: 1.4, minWidth: 0 },
  paymentValueColumn: { flex: 0.9 },
  paymentDateColumn: { flex: 0.9 },
  paymentStatusColumn: { flex: 0.8, alignItems: "flex-start" },
  paymentClientName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  paymentCell: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  paymentValue: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  listStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
  },
  listStatusPending: { backgroundColor: colors.warningSoft },
  listStatusReceived: { backgroundColor: colors.successSoft },
  listStatusOverdue: { backgroundColor: colors.dangerSoft },
  listStatusCancelled: { backgroundColor: colors.surfaceSubtle },
  listStatusText: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  overdueText: { color: colors.danger },
  cancelledText: { color: colors.muted },
  paymentCard: {
    margin: 0,
    padding: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    borderWidth: 0,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderRadius: 0,
    backgroundColor: colors.surface,
  },
  paymentList: {},
  paymentListMobile: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 0,
  },
  paymentCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  paymentCardAvatar: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  paymentCardCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  paymentCardMeta: {
    paddingTop: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0,
  },
  paymentCardStatusDotsRow: {
    paddingTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 0,
  },
  metaLabel: {
    marginBottom: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  historyEmpty: {
    minHeight: 180,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  historyEmptyTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
    textAlign: "center",
  },
  historyEmptyText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    textAlign: "center",
  },
  historyPagination: {
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyPaginationMobile: {
    marginTop: spacing.md,
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
  headingMobile: { gap: spacing.lg },
  headingCopy: { flex: 1, gap: spacing.xs },
  headingActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headingActionsMobile: { width: "100%", flexDirection: "column" },
  headingActionButtonMobile: { width: "100%" },
  historyButton: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  historyButtonText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  newPaymentButton: {
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
  newPaymentButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  paymentFormModal: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "92%",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  paymentFormModalMobile: { borderRadius: radius.md },
  receiptModal: {
    width: "100%",
    maxWidth: 480,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  receiptModalMobile: { padding: spacing.md, borderRadius: radius.md },
  paymentFormModalContent: { padding: spacing.lg },
  paymentFormModalContentMobile: { padding: spacing.md },
  paymentFormModalScroll: { flexShrink: 1 },
  headingDesktop: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  buttonDisabled: { opacity: 0.55 },
  stateBanner: {
    minHeight: 64,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  stateBannerError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  stateBannerCopy: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  retryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  retryButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  formActionSpacer: { flex: 1 },
  deleteButton: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  deleteButtonText: {
    color: colors.danger,
    fontFamily: typography.family.semibold,
  },
  manageRow: { flexDirection: "row", justifyContent: "flex-end" },
  manageButton: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  manageButtonText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  manageModal: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "82%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  manageList: { marginTop: spacing.md },
  manageItem: {
    minHeight: 64,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
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
  confirmActions: {
    width: "100%",
    marginTop: spacing.lg,
    flexDirection: "column-reverse",
    justifyContent: "center",
    gap: spacing.sm,
  },
  // Layout auxiliar aplicado inline aos botões de confirmação de modal para
  // acomodar o `ActivityIndicator` de loading ao lado do texto, sem alterar
  // a altura/estrutura do botão.
  confirmButtonSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  confirmDeleteButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.danger,
  },
  confirmStatusButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  confirmDeleteText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  periodFilters: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  periodFilterGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  periodFilterLabel: {
    width: 34,
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  periodOptions: { gap: spacing.xs },
  periodOption: {
    minHeight: 34,
    minWidth: 42,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  periodOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  periodOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  periodOptionTextActive: { color: colors.onBrand },
  rowDeleteButton: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  rowDeleteText: {
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  rowDangerButton: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  rowDangerText: {
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  periodPickerLabel: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  periodPickerRow: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  periodPickerRowMobile: {
    width: "100%",
    minWidth: "100%",
    flex: 0,
    alignSelf: "stretch",
  },
  periodPickerInput: {
    minWidth: 140,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  periodPickerInputMobile: {
    width: "100%",
    minWidth: "100%",
    flex: 1,
    alignSelf: "stretch",
  },
  periodPickerValue: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  tableFilterCopy: { flex: 1, minWidth: 0 },
  tableFilterLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: 10,
  },
  tableStatusOptions: { marginTop: spacing.lg, gap: spacing.sm },
  tableStatusOption: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  tableStatusOptionActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  tableStatusOptionText: { color: colors.ink, fontFamily: typography.family.semibold },
  tableStatusOptionTextActive: { color: colors.onBrand },
  periodPickerPlaceholder: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
  },
  clearPeriodButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  periodPickerModal: {
    width: "100%",
    maxWidth: 440,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  pickerSectionLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  pickerYears: { gap: spacing.xs },
  fullYearOption: {
    minHeight: 60,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  fullYearOptionCopy: { flex: 1 },
  fullYearOptionTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  fullYearOptionText: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  pickerMonths: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pickerMonth: {
    width: "22%",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  clearPickerButton: {
    minHeight: 44,
    marginTop: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  clearPickerText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  rowEditButton: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  rowEditText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  paymentActionColumn: {
    minWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  mobileStatusActions: { alignItems: "flex-end", gap: spacing.sm },
  mobileActionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dotsButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  // Modal de ações mobile padrão bottom-sheet
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
});
