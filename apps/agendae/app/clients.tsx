import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
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

import { AppIcon } from "@/src/components/ui/app-icon";
import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { RowActionsMenu, useRowActionsMenu } from "@/src/components/ui/row-actions-menu";
import { ClientEditModal } from "@/src/components/clients/client-edit-modal";
import type { Client as DomainClient, LinkRequest as DomainLinkRequest } from "@/src/domain/clients/types";
import { isLongLinkCode } from "@/src/domain/clients/link-code-display";
import { isoToBrazilian } from "@/src/domain/clients/client-form-utils";
import { loadAllClients } from "@/src/domain/clients/load-all-clients";
import { useClientEditForm } from "@/src/hooks/use-client-edit-form";
import { useProviderPlan } from "@/src/hooks/use-provider-plan";
import { clientPortfolioService } from "@/src/infra/clients/supabase-client-portfolio-adapter";
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

type TipPressProps = React.ComponentProps<typeof Pressable> & { title?: string };
const TipPress = Pressable as React.ComponentType<TipPressProps>;

type ClientStatus = "Ativo" | "Inativo";
type Filter = "Todos" | ClientStatus;
type BookingPolicy = {
  totalLimit: number | null;
  dailyLimit: number | null;
  requestFrom: string | null;
  requestUntil: string | null;
};
type Client = {
  id: string;
  name: string;
  initials: string;
  contact: string;
  phone?: string;
  whatsappAppointmentConfirmation?: boolean;
  whatsappAppointmentReminder?: boolean;
  service: string;
  serviceValueCents: number;
  bookingPolicy: BookingPolicy;
  date: string;
  status: ClientStatus;
};
const toUiClient = (client: DomainClient): Client => ({
  id: client.id,
  name: client.name,
  initials: client.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
  contact: client.email,
  phone: client.phone ?? undefined,
  whatsappAppointmentConfirmation: client.communicationPreferences.whatsappAppointmentConfirmation,
  whatsappAppointmentReminder: client.communicationPreferences.whatsappAppointmentReminder,
  service: client.primaryService ?? "Sem serviço informado",
  serviceValueCents: client.serviceValueCents,
  bookingPolicy: {
    totalLimit: client.bookingPolicy.totalBookingLimit,
    dailyLimit: client.bookingPolicy.dailyBookingLimit,
    requestFrom: client.bookingPolicy.requestWindowStart,
    requestUntil: client.bookingPolicy.requestWindowEnd,
  },
  date: client.lastServiceAt ? new Intl.DateTimeFormat("pt-BR").format(new Date(client.lastServiceAt)) : "Sem atendimento",
  status: client.status === "active" ? "Ativo" : "Inativo",
});
type Feedback = {
  tone: "success" | "error" | "warning";
  message: string;
} | null;

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );

export default function ClientsScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const linkCardWidth = Math.max(280, width - 56);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("Todos");
  const [statusPickerVisible, setStatusPickerVisible] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const providerPlan = useProviderPlan();
  const [modalVisible, setModalVisible] = useState(false);
  // Cópia bruta (não achatada para `Client` de UI) dos clientes carregados —
  // usada só para `editClient` conseguir alimentar `useClientEditForm` com o
  // `DomainClient` completo (ex.: `clientUserId`, `primaryServiceId`) sem
  // duplicar a lógica de mapeamento aqui.
  const [domainClients, setDomainClients] = useState<DomainClient[]>([]);
  const [linkCode, setLinkCode] = useState("");
  const [codeFeedback, setCodeFeedback] = useState("");
  const [linkRequests, setLinkRequests] = useState<
    { id: string; name: string; contact: string }[]
  >([]);
  const [linkRequestsError, setLinkRequestsError] = useState("");
  const [page, setPage] = useState(1);
  const [linkCarouselIndex, setLinkCarouselIndex] = useState(0);
  const [metricCarouselIndex, setMetricCarouselIndex] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [mobileActionClient, setMobileActionClient] = useState<Client | null>(null);
  const rowActionsMenu = useRowActionsMenu<Client>();
  const [copyingCode, setCopyingCode] = useState(false);
  // Feedback visual de clique (padrão Nero): cada ação assíncrona expõe seu
  // próprio estado de pendência, setado de forma síncrona antes do `await` e
  // sempre resetado em `finally` — nunca deixa o botão preso em loading.
  const [archivingClient, setArchivingClient] = useState(false);
  const [regeneratingCode, setRegeneratingCode] = useState(false);
  // Aprovação/rejeição agem sobre uma solicitação específica da lista — por
  // isso rastreadas por id (nunca por flag global), com a ação (aprovar ou
  // rejeitar) para saber qual dos dois botões irmãos exibe o spinner.
  const [resolvingRequest, setResolvingRequest] = useState<{ id: string; approved: boolean } | null>(null);
  const [requestsModalVisible, setRequestsModalVisible] = useState(false);
  const [requestPage, setRequestPage] = useState(1);
  const pageSize = wide ? 10 : 5;
  // BLG-075: `loadPortfolio` é acionado por duas fontes independentes
  // (`useFocusEffect` a cada foco da rota e o listener de `AppState` a cada
  // volta a "active"), que podem disparar quase simultaneamente — por
  // exemplo, ao trocar de aba do navegador e voltar. Sem esta trava, uma
  // falha persistente do backend (ex.: erro de política RLS, não transitório)
  // combinada com chamadas sobrepostas gera múltiplas requisições e múltiplos
  // `console.error`/modais de erro em sequência rápida, que no console do
  // navegador pode ser confundido com um loop de render infinito do React.
  // Esta trava não corrige nenhuma causa de erro do backend: apenas impede
  // que o frontend amplifique uma falha já existente com chamadas repetidas
  // e sobrepostas sem necessidade.
  const loadingPortfolioRef = useRef(false);
  const [initialLoading, setInitialLoading] = useState(true);
  // Suporta abertura automática do modal de novo cliente quando a tela é
  // acessada pelo botão "Novo cliente" do menu rápido da tab bar mobile
  // (`/clients?openCreate=1`) — sem esse parâmetro o comportamento de
  // navegação permanece inalterado.
  const { openCreate } = useLocalSearchParams<{ openCreate?: string }>();
  const openCreateHandledRef = useRef(false);

  const loadPortfolio = useCallback(async () => {
    if (loadingPortfolioRef.current) return;
    loadingPortfolioRef.current = true;
    try {
      try {
        const loadedClients = await loadAllClients(clientPortfolioService);
        setDomainClients(loadedClients);
        setClients(loadedClients.map(toUiClient));
      } catch (loadError) {
        // BLG-073: loga o erro capturado aqui (código/mensagem de domínio já
        // mapeados) somado ao erro bruto do Supabase, já logado em
        // `mapClientDomainError`, para permitir diagnosticar futuras
        // ocorrências deste catch a partir do console/observabilidade do app.
        console.error("[clients] loadPortfolio falhou", loadError);
        setFeedback({ tone: "error", message: "Não foi possível carregar os clientes." });
        return;
      }

      setCodeFeedback("");
      setLinkRequestsError("");
      const [codeResult, requestsResult] = await Promise.allSettled([
        clientPortfolioService.getLinkCodeSummary(),
        clientPortfolioService.listPendingLinkRequests({ page: 1, pageSize: 10 }),
      ]);

      if (codeResult.status === "fulfilled") {
        const code = codeResult.value;
        setLinkCode("");
        if (code) setCodeFeedback(`Existe um código ativo iniciado por ${code.displayPrefix}. Gere um novo para exibir o valor completo.`);
      } else {
        setLinkCode("");
        setCodeFeedback("Não foi possível consultar o código de vínculo.");
      }

      if (requestsResult.status === "fulfilled") {
        setLinkRequests(requestsResult.value.items.map((request: DomainLinkRequest) => ({
          id: request.id,
          name: request.clientName,
          contact: request.clientEmail,
        })));
      } else {
        setLinkRequests([]);
        setLinkRequestsError("Não foi possível consultar as solicitações de vínculo.");
      }
    } finally {
      loadingPortfolioRef.current = false;
      setInitialLoading(false);
    }
  }, []);

  // Estado/validação/persistência do formulário de cliente compartilhados
  // com o Perfil do Cliente (`app/clients/[id].tsx`) via `useClientEditForm`
  // — a mesma regra de validação (limites, período, e-mail duplicado) não
  // pode divergir entre as duas telas.
  const clientEditForm = useClientEditForm({
    providerPlan,
    existingClients: useMemo(
      () => domainClients.map((client) => ({ id: client.id, email: client.email })),
      [domainClients],
    ),
    onSaved: async (result) => {
      await loadPortfolio();
      setModalVisible(false);
      setFeedback({
        tone: "success",
        message: result.mode === "edit" ? "Cliente atualizado com sucesso." : "Cliente cadastrado com sucesso.",
      });
    },
    // DEC-164 (`supabase/migrations/20260825140000_client_service_auto_charge.sql`):
    // o lançamento financeiro automático ao vincular serviço + valor a um
    // cliente agora nasce por trigger de banco (`sync_client_service_charge`),
    // não mais por orquestração aqui — cobre criação E edição do vínculo, na
    // mesma transação do `INSERT`/`UPDATE` de `clients` (atomicidade que este
    // `onCreated` client-side nunca teve). Removido para não duplicar o
    // lançamento (o trigger já dispara sozinho a cada `createClient`).
  });

  useFocusEffect(
    useCallback(() => {
      void loadPortfolio();
    }, [loadPortfolio]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void loadPortfolio();
    });
    return () => subscription.remove();
  }, [loadPortfolio]);

  useEffect(() => {
    if (openCreate !== "1" || openCreateHandledRef.current || initialLoading) return;
    openCreateHandledRef.current = true;
    openNewClient();
    // Remove o parâmetro para não reabrir o modal em focos futuros da tela.
    router.setParams({ openCreate: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate, initialLoading]);

  const visibleClients = useMemo(
    () =>
      clients.filter((client) => {
        const matchesQuery = `${client.name} ${client.contact} ${client.phone ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.trim().toLocaleLowerCase("pt-BR"));
        return matchesQuery && (filter === "Todos" || client.status === filter);
      }),
    [clients, filter, query],
  );
  const activeClientsCount = useMemo(
    () => clients.filter((client) => client.status === "Ativo").length,
    [clients],
  );
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(visibleClients.length / pageSize)),
    [visibleClients.length, pageSize],
  );
  const paginatedClients = useMemo(
    () => visibleClients.slice((page - 1) * pageSize, page * pageSize),
    [visibleClients, page, pageSize],
  );
  const requestPageSize = wide ? 10 : 5;
  const requestTotalPages = useMemo(
    () => Math.max(1, Math.ceil(linkRequests.length / requestPageSize)),
    [linkRequests.length],
  );
  const paginatedRequests = useMemo(
    () =>
      linkRequests.slice(
        (requestPage - 1) * requestPageSize,
        requestPage * requestPageSize,
      ),
    [linkRequests, requestPage],
  );

  useEffect(() => {
    setPage(1);
  }, [clients, filter, query]);
  useEffect(() => {
    setRequestPage((current) =>
      Math.min(
        current,
        Math.max(1, Math.ceil(linkRequests.length / requestPageSize)),
      ),
    );
  }, [linkRequests]);

  function openNewClient() {
    if (providerPlan === "free" && clients.length >= 5) {
      setFeedback({
        tone: "warning",
        message: "O Plano Gratuito permite até 5 clientes. Mude para o Premium para cadastrar mais.",
      });
      return;
    }
    clientEditForm.resetForCreate();
    setModalVisible(true);
  }

  function editClient(client: Client) {
    const domainClient = domainClients.find((item) => item.id === client.id);
    if (!domainClient) return;
    clientEditForm.loadForEdit(domainClient);
    setModalVisible(true);
  }

  async function deleteClient() {
    const editingId = clientEditForm.editingId;
    if (!editingId) return;
    setArchivingClient(true);
    try {
      await clientPortfolioService.archiveClient(editingId);
      await loadPortfolio();
      setConfirmDeleteVisible(false);
      setModalVisible(false);
      setFeedback({ tone: "success", message: "Cliente arquivado com sucesso." });
    } catch {
      setFeedback({ tone: "error", message: "Não foi possível arquivar o cliente." });
    } finally {
      setArchivingClient(false);
    }
  }

  async function copyCode() {
    if (!linkCode) {
      setFeedback({ tone: "warning", message: "Gere um novo código para poder copiá-lo." });
      return;
    }
    setCopyingCode(true);
    try {
      await Clipboard.setStringAsync(linkCode);
      setCodeFeedback("Código copiado para a área de transferência.");
      setFeedback({ tone: "success", message: "Código copiado com sucesso." });
    } catch {
      setFeedback({
        tone: "error",
        message: "Não foi possível copiar o código. Tente novamente.",
      });
    } finally {
      setCopyingCode(false);
    }
  }

  async function regenerateCode() {
    setRegeneratingCode(true);
    try {
      const rotated = await clientPortfolioService.rotateLinkCode();
      setLinkCode(rotated.fullCode);
      setCodeFeedback("Novo código gerado. O código anterior foi invalidado.");
      setFeedback({ tone: "warning", message: "Código renovado. Compartilhe o novo código com seus clientes." });
    } catch {
      setFeedback({ tone: "error", message: "Não foi possível renovar o código." });
    } finally {
      setRegeneratingCode(false);
    }
  }

  async function resolveRequest(id: string, approved: boolean) {
    const request = linkRequests.find((item) => item.id === id);
    if (!request) {
      setFeedback({
        tone: "error",
        message: "Solicitação não encontrada ou já processada.",
      });
      return;
    }
    setResolvingRequest({ id, approved });
    try {
      let targetClientId: string | undefined;
      if (approved) {
        const preview = await clientPortfolioService.previewLinkReconciliation(id);
        if (preview.recommendedAction === "manual_review" || preview.recommendedAction === "reject_conflict") {
          setFeedback({ tone: "warning", message: "O vínculo exige revisão manual dos cadastros correspondentes." });
          return;
        }
        targetClientId = preview.recommendedAction === "attach_existing" ? preview.candidates[0]?.clientId : undefined;
      }
      await clientPortfolioService.decideLinkRequest({ requestId: id, decision: approved ? "approve" : "reject", targetClientId });
      await loadPortfolio();
      setFeedback({ tone: "success", message: approved ? `Vínculo de ${request.name} aprovado.` : `Solicitação de ${request.name} rejeitada.` });
    } catch (decisionError) {
      setFeedback({ tone: "error", message: decisionError instanceof Error ? decisionError.message : "Não foi possível processar a solicitação." });
    } finally {
      setResolvingRequest(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {initialLoading && <PageLoadingOverlay />}

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View style={[styles.pageHeading, wide && styles.pageHeadingWide]}>
            <View style={styles.headingCopy}>
              <Text style={styles.eyebrow}>RELACIONAMENTO</Text>
              <Text
                accessibilityRole="header"
                style={[styles.title, !wide && styles.titleMobile]}
              >
                Clientes
              </Text>
              <Text style={styles.description}>
                Gerencie seus clientes e acompanhe o histórico de atendimentos.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cadastrar novo cliente"
              onPress={openNewClient}
              style={styles.primaryButton}
            >
              <AppIcon name="add" size={20} color={colors.onBrand} />
              <Text style={styles.primaryButtonText}>Novo cliente</Text>
            </Pressable>
          </View>
          {providerPlan === "free" && (
            <View style={[styles.planLimitNotice, !wide && styles.planLimitNoticeMobile]}>
              <View style={styles.planLimitBody}>
                <AppIcon name="packages" size={20} color={colors.brand} />
                <Text style={styles.planLimitText}>
                  Plano Gratuito: {clients.length} de 5 clientes cadastrados.
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/plans")}
                style={!wide && styles.planLimitLinkContainerMobile}
              >
                <Text style={styles.planLimitLink}>Ver planos</Text>
              </Pressable>
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
                    2,
                    Math.round(event.nativeEvent.contentOffset.x / 272),
                  ),
                ),
              )
            }
            contentContainerStyle={[styles.metrics, wide && styles.metricsWide]}
          >
            {[
              {
                label: "Total de clientes",
                value: String(clients.length),
                detail: "cadastrados",
                icon: "clients" as const,
                tone: "brand" as const,
              },
              {
                label: "Clientes ativos",
                value: String(activeClientsCount),
                detail: `${clients.length ? Math.round((activeClientsCount / clients.length) * 100) : 0}% da base`,
                icon: "success" as const,
                tone: "success" as const,
              },
              {
                label: "Novos neste mês",
                value: "3",
                detail: "em agosto",
                icon: "analytics" as const,
                tone: "brand" as const,
              },
            ].map((item) => (
              <View
                key={item.label}
                style={[styles.metricCard, wide && styles.metricCardWide]}
              >
                <View
                  style={[
                    styles.metricIcon,
                    item.tone === "success"
                      ? styles.successMetricIcon
                      : styles.brandMetricIcon,
                  ]}
                >
                  <AppIcon
                    name={item.icon}
                    size={24}
                    color={
                      item.tone === "success" ? colors.success : colors.brand
                    }
                  />
                </View>
                <Text style={styles.metricLabel}>{item.label}</Text>
                <Text style={styles.metricValue}>{item.value}</Text>
                <Text
                  style={[
                    styles.metricDetail,
                    item.tone === "success"
                      ? styles.successMetricDetail
                      : styles.brandMetricDetail,
                  ]}
                >
                  {item.detail}
                </Text>
              </View>
            ))}
          </ScrollView>
          {!wide && (
            <View
              accessibilityLabel={`Indicador do carrossel: item ${metricCarouselIndex + 1} de 3`}
              style={styles.carouselDots}
            >
              {[0, 1, 2].map((index) => (
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

          <ScrollView
            style={!wide ? styles.linkViewportMobile : undefined}
            horizontal={!wide}
            showsHorizontalScrollIndicator={false}
            snapToInterval={linkCardWidth + spacing.md}
            decelerationRate="fast"
            onMomentumScrollEnd={(
              event: NativeSyntheticEvent<NativeScrollEvent>,
            ) =>
              setLinkCarouselIndex(
                Math.max(
                  0,
                  Math.min(
                    1,
                    Math.round(
                      event.nativeEvent.contentOffset.x /
                        (linkCardWidth + spacing.md),
                    ),
                  ),
                ),
              )
            }
            contentContainerStyle={[
              styles.linkGrid,
              !wide && styles.linkGridMobile,
              wide && styles.linkGridWide,
            ]}
          >
            <View
              style={[
                styles.linkCard,
                styles.codeCard,
                !wide && {
                  width: linkCardWidth,
                  flexBasis: "auto",
                  flexGrow: 0,
                  flexShrink: 0,
                },
              ]}
            >
              <View style={styles.linkCardHeader}>
                <View style={styles.linkIcon}>
                  <AppIcon name="security" size={20} color={colors.brand} />
                </View>
                <View style={styles.linkHeading}>
                  <Text style={[styles.linkTitle, styles.codeCardTitle]}>
                    Código de vínculo
                  </Text>
                  <Text
                    style={[styles.linkDescription, styles.codeCardDescription]}
                  >
                    Envie este código para o cliente solicitar acesso. Válido
                    apenas para contas Cliente — solicitações de outra conta
                    Prestador são recusadas automaticamente.
                  </Text>
                </View>
              </View>
              <View style={styles.codeBox}>
                <Text
                  selectable
                  accessibilityLabel={
                    linkCode
                      ? `Código de vínculo ${linkCode}`
                      : "Nenhum código gerado. Gere um novo código."
                  }
                  style={[
                    styles.codeText,
                    isLongLinkCode(linkCode) && styles.codeTextLong,
                    !linkCode && styles.codeTextPlaceholder,
                  ]}
                >
                  {linkCode || "Gere um novo código"}
                </Text>
              </View>
              <Text style={styles.codeNotice}>
                O código não libera acesso automaticamente. Toda solicitação
                precisa da sua aprovação.
              </Text>
              {codeFeedback ? (
                <Text accessibilityRole="alert" style={styles.codeFeedback}>
                  {codeFeedback}
                </Text>
              ) : null}
              <View
                style={[styles.codeActions, !wide && styles.codeActionsMobile]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copiar código de vínculo"
                  accessibilityState={{ disabled: copyingCode || regeneratingCode || !linkCode, busy: copyingCode }}
                  disabled={copyingCode || regeneratingCode || !linkCode}
                  onPress={() => void copyCode()}
                  style={({ pressed }) => [
                    styles.shareButton,
                    (regeneratingCode || !linkCode) && styles.buttonDisabled,
                    pressed && !copyingCode && !regeneratingCode && !!linkCode && { opacity: opacity.pressed },
                  ]}
                >
                  {copyingCode ? (
                    <ActivityIndicator size="small" color={colors.onBrand} />
                  ) : (
                    <AppIcon name="file" size={16} color={colors.onBrand} />
                  )}
                  <Text style={styles.shareButtonText}>Copiar código</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: regeneratingCode || copyingCode, busy: regeneratingCode }}
                  disabled={regeneratingCode || copyingCode}
                  onPress={() => void regenerateCode()}
                  style={({ pressed }) => [
                    styles.regenerateButton,
                    copyingCode && styles.buttonDisabled,
                    pressed && !regeneratingCode && !copyingCode && { opacity: opacity.pressed },
                  ]}
                >
                  {regeneratingCode ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <AppIcon name="schedule" size={16} color={colors.brand} />
                  )}
                  <Text style={styles.regenerateButtonText}>Gerar novo</Text>
                </Pressable>
              </View>
            </View>

            <View
              style={[
                styles.linkCard,
                !wide && {
                  width: linkCardWidth,
                  flexBasis: "auto",
                  flexGrow: 0,
                  flexShrink: 0,
                },
              ]}
            >
              <View style={styles.requestTitleRow}>
                <View>
                  <Text style={styles.linkTitle}>Solicitações de vínculo</Text>
                  <Text style={styles.linkDescription}>
                    {linkRequestsError
                      ? linkRequestsError
                      : linkRequests.length
                      ? `${linkRequests.length} aguardando sua aprovação`
                      : "Nenhuma solicitação pendente"}
                  </Text>
                </View>
                {linkRequests.length > 0 && (
                  <View style={styles.requestCount}>
                    <Text style={styles.requestCountText}>
                      {linkRequests.length}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.requestList}>
                {linkRequests.slice(0, 2).map((request) => (
                  <View key={request.id} style={styles.requestItem}>
                    <View style={styles.requestAvatar}>
                      <AppIcon name="user" size={16} color={colors.brand} />
                    </View>
                    <View style={styles.requestCopy}>
                      <Text style={styles.requestName}>{request.name}</Text>
                      <Text style={styles.requestContact}>
                        {request.contact}
                      </Text>
                    </View>
                    <View style={styles.requestActions}>
                      {(() => {
                        const isThisRequest = resolvingRequest?.id === request.id;
                        const rejecting = isThisRequest && !resolvingRequest?.approved;
                        const approving = isThisRequest && !!resolvingRequest?.approved;
                        return (
                          <>
                            <TipPress
                              accessibilityRole="button"
                              accessibilityLabel={`Rejeitar vínculo de ${request.name}`}
                              accessibilityState={{ disabled: isThisRequest, busy: rejecting }}
                              title={`Rejeitar vínculo de ${request.name}`}
                              disabled={isThisRequest}
                              onPress={() => void resolveRequest(request.id, false)}
                              style={({ pressed }: { pressed: boolean }) => [
                                styles.rejectRequest,
                                isThisRequest && styles.buttonDisabled,
                                pressed && !isThisRequest && { opacity: opacity.pressed },
                              ]}
                            >
                              {rejecting ? (
                                <ActivityIndicator size="small" color={colors.danger} />
                              ) : (
                                <AppIcon name="error" size={14} color={colors.danger} />
                              )}
                              <Text style={styles.rejectRequestText}>Recusar</Text>
                            </TipPress>
                            <TipPress
                              accessibilityRole="button"
                              accessibilityLabel={`Aprovar vínculo de ${request.name}`}
                              accessibilityState={{ disabled: isThisRequest, busy: approving }}
                              title={`Aprovar vínculo de ${request.name}`}
                              disabled={isThisRequest}
                              onPress={() => void resolveRequest(request.id, true)}
                              style={({ pressed }: { pressed: boolean }) => [
                                styles.approveRequest,
                                isThisRequest && styles.buttonDisabled,
                                pressed && !isThisRequest && { opacity: opacity.pressed },
                              ]}
                            >
                              {approving ? (
                                <ActivityIndicator size="small" color={colors.onBrand} />
                              ) : (
                                <AppIcon
                                  name="success"
                                  size={14}
                                  color={colors.onBrand}
                                />
                              )}
                              <Text style={styles.approveRequestText}>Aprovar</Text>
                            </TipPress>
                          </>
                        );
                      })()}
                    </View>
                  </View>
                ))}
                {linkRequests.length > 2 && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setRequestPage(1);
                      setRequestsModalVisible(true);
                    }}
                    style={styles.viewAllRequests}
                  >
                    <Text style={styles.viewAllRequestsText}>
                      Ver todas as {linkRequests.length} solicitações
                    </Text>
                    <AppIcon name="forward" size={16} color={colors.brand} />
                  </Pressable>
                )}
                {linkRequests.length === 0 && !linkRequestsError && (
                  <View style={styles.requestsEmpty}>
                    <AppIcon name="success" size={24} color={colors.success} />
                    <Text style={styles.requestsEmptyText}>
                      Tudo certo por aqui.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
          {!wide && (
            <View
              accessibilityLabel={`Indicador do carrossel: item ${linkCarouselIndex + 1} de 2`}
              style={styles.carouselDots}
            >
              {[0, 1].map((index) => (
                <View
                  key={index}
                  style={[
                    styles.carouselDot,
                    index === linkCarouselIndex && styles.carouselDotActive,
                  ]}
                />
              ))}
            </View>
          )}

          <View style={styles.directory}>
            <View style={[styles.toolbar, !wide && styles.toolbarMobile]}>
              <View style={styles.searchBox}>
                <AppIcon name="search" size={20} color={colors.mutedSoft} />
                <TextInput
                  accessibilityLabel="Buscar clientes por nome ou e-mail"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar por nome ou e-mail"
                  placeholderTextColor={colors.mutedSoft}
                  style={styles.searchInput}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Selecionar status"
                accessibilityState={{ expanded: statusPickerVisible }}
                onPress={() => setStatusPickerVisible(true)}
                style={[styles.statusFilter, !wide && styles.statusFilterMobile]}
              >
                <View style={styles.statusFilterCopy}>
                  <Text style={styles.statusFilterLabel}>Status</Text>
                  <Text style={styles.statusFilterValue}>{filter}</Text>
                </View>
                <AppIcon name="forward" size={16} color={colors.mutedSoft} />
              </Pressable>
            </View>

            {wide && (
              <View style={styles.tableHeader}>
                <Text style={[styles.columnTitle, styles.clientColumn]}>
                  CLIENTE
                </Text>
                <Text style={[styles.columnTitle, styles.serviceColumn]}>
                  ÚLTIMO SERVIÇO
                </Text>
                <Text style={[styles.columnTitle, styles.dateColumn]}>
                  DATA
                </Text>
                <Text style={[styles.columnTitle, styles.statusColumn]}>
                  STATUS
                </Text>
                <View style={styles.actionColumn} />
              </View>
            )}

            <View style={[styles.clientList, !wide && styles.clientListMobile]}>
              {paginatedClients.map((client) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir cliente ${client.name}`}
                  onPress={() => router.push(`/clients/${client.id}` as never)}
                  key={client.id}
                  style={[styles.clientRow, !wide && styles.clientCard]}
                >
                  <View
                    style={[styles.clientIdentity, wide && styles.clientColumn]}
                  >
                    <View style={styles.clientAvatar}>
                      <Text style={styles.clientInitials}>
                        {client.initials}
                      </Text>
                    </View>
                    <View style={styles.clientText}>
                      <Text style={styles.clientName}>{client.name}</Text>
                      <Text style={styles.clientContact}>{client.contact}</Text>
                    </View>
                    {!wide && (
                      <Pressable
                        accessibilityLabel={`Opções de ${client.name}`}
                        onPress={(event) => {
                          event.stopPropagation();
                          setMobileActionClient(client);
                        }}
                        style={styles.dotsButton}
                      >
                        <AppIcon name="dots" size={18} color={colors.muted} />
                      </Pressable>
                    )}
                  </View>
                  {wide ? (
                    <>
                      <View style={styles.serviceColumn}>
                        <Text numberOfLines={1} style={styles.cellText}>
                          {client.service}
                        </Text>
                        <Text style={styles.cellSecondary}>
                          {formatCurrency(client.serviceValueCents)}
                        </Text>
                      </View>
                      <Text style={[styles.cellText, styles.dateColumn]}>
                        {client.date}
                      </Text>
                      <View style={styles.statusColumn}>
                        <Status status={client.status} />
                      </View>
                      <View style={styles.actionColumn}>
                        {/* Mesmas opções do menu do mobile, só que como o
                            painel flutuante do desktop (igual ao menu de
                            perfil/notificações do cabeçalho) — mobile
                            continua com seu próprio bottom-sheet, inalterado. */}
                        <Pressable
                          accessibilityLabel={`Opções de ${client.name}`}
                          onPress={(event) => {
                            event.stopPropagation();
                            rowActionsMenu.open(client, event);
                          }}
                          style={styles.dotsButton}
                        >
                          <AppIcon name="dots" size={18} color={colors.muted} />
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.cardDivider} />
                      <View style={styles.metaCopy}>
                        <Text style={styles.metaLabel}>Serviço e valor</Text>
                        <Text style={styles.metaValue} numberOfLines={1}>
                          {client.service} ·{" "}
                          {formatCurrency(client.serviceValueCents)}
                        </Text>
                      </View>
                      <View style={styles.policySummary}>
                        <View style={styles.policyChip}>
                          <Text style={styles.policyChipLabel}>Total</Text>
                          <Text style={styles.policyChipValue}>
                            {client.bookingPolicy.totalLimit ?? "Livre"}
                          </Text>
                        </View>
                        <View style={styles.policyChip}>
                          <Text style={styles.policyChipLabel}>Por dia</Text>
                          <Text style={styles.policyChipValue}>
                            {client.bookingPolicy.dailyLimit ?? "Livre"}
                          </Text>
                        </View>
                        <View style={styles.policyChip}>
                          <Text style={styles.policyChipLabel}>Período</Text>
                          <Text
                            numberOfLines={1}
                            style={styles.policyChipValue}
                          >
                            {client.bookingPolicy.requestFrom
                              ? `${isoToBrazilian(client.bookingPolicy.requestFrom)} a ${isoToBrazilian(client.bookingPolicy.requestUntil)}`
                              : "Livre"}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.cardDate}>
                        <AppIcon
                          name="calendar"
                          size={16}
                          color={colors.mutedSoft}
                        />
                        <Text style={styles.clientContact}>{client.date}</Text>
                      </View>
                      {/* Status abaixo de título/descrição */}
                      <View style={styles.cardStatusDotsRow}>
                        <Status status={client.status} />
                      </View>
                    </>
                  )}
                </Pressable>
              ))}
              {visibleClients.length === 0 && (
                <View style={styles.empty}>
                  <AppIcon name="search" size={32} color={colors.mutedSoft} />
                  <Text style={styles.emptyTitle}>
                    Nenhum cliente encontrado
                  </Text>
                  <Text style={styles.emptyText}>
                    {clients.length === 0 && !query.trim() && filter === "Todos"
                      ? "Você ainda não cadastrou clientes. Use “Novo cliente” para começar."
                      : "Tente alterar a busca ou o filtro selecionado."}
                  </Text>
                </View>
              )}
            </View>
            {visibleClients.length > 0 && (
              <View
                style={[styles.pagination, !wide && styles.paginationMobile]}
              >
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.paginationInfo}
                >
                  Exibindo {(page - 1) * pageSize + 1}–
                  {Math.min(page * pageSize, visibleClients.length)} de{" "}
                  {visibleClients.length} clientes
                </Text>
                <View style={styles.paginationActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Página anterior"
                    accessibilityState={{ disabled: page === 1 }}
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
                    accessibilityRole="button"
                    accessibilityLabel="Próxima página"
                    accessibilityState={{ disabled: page === totalPages }}
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

      <Modal visible={statusPickerVisible} transparent animationType="fade" onRequestClose={() => setStatusPickerVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setStatusPickerVisible(false)}>
          <Pressable accessibilityViewIsModal style={styles.statusPickerModal} onPress={() => undefined}>
            <View style={styles.statusPickerHeader}>
              <View style={styles.statusFilterCopy}>
                <Text accessibilityRole="header" style={styles.statusPickerTitle}>Filtrar por status</Text>
                <Text style={styles.statusPickerSubtitle}>Escolha quais clientes deseja visualizar.</Text>
              </View>
              <Pressable accessibilityLabel="Fechar filtro de status" onPress={() => setStatusPickerVisible(false)} style={styles.statusPickerClose}>
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.statusPickerOptions}>
              {(["Todos", "Ativo", "Inativo"] as Filter[]).map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === item }}
                  key={item}
                  onPress={() => { setFilter(item); setStatusPickerVisible(false); }}
                  style={[styles.statusPickerOption, filter === item && styles.statusPickerOptionActive]}
                >
                  <Text style={[styles.statusPickerOptionText, filter === item && styles.statusPickerOptionTextActive]}>{item}</Text>
                  {filter === item && <AppIcon name="success" size={18} color={colors.onBrand} />}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ClientEditModal
        visible={modalVisible}
        wide={wide}
        form={clientEditForm}
        onClose={() => setModalVisible(false)}
        onRequestDelete={() => setConfirmDeleteVisible(true)}
      />

      <Modal
        visible={requestsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRequestsModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            accessibilityViewIsModal
            style={[styles.requestsModal, !wide && styles.modalCardMobile]}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text accessibilityRole="header" style={styles.modalTitle}>
                  Solicitações de vínculo
                </Text>
                <Text style={styles.modalSubtitle}>
                  {linkRequests.length} solicitações aguardando análise.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar solicitações"
                onPress={() => setRequestsModalVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.requestsModalList}
              contentContainerStyle={styles.requestList}
              showsVerticalScrollIndicator={false}
            >
              {paginatedRequests.map((request) => (
                <View key={request.id} style={styles.requestItem}>
                  <View style={styles.requestAvatar}>
                    <AppIcon name="user" size={16} color={colors.brand} />
                  </View>
                  <View style={styles.requestCopy}>
                    <Text style={styles.requestName}>{request.name}</Text>
                    <Text style={styles.requestContact}>{request.contact}</Text>
                  </View>
                  <View style={styles.requestActions}>
                    {(() => {
                      const isThisRequest = resolvingRequest?.id === request.id;
                      const rejecting = isThisRequest && !resolvingRequest?.approved;
                      const approving = isThisRequest && !!resolvingRequest?.approved;
                      return (
                        <>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Rejeitar vínculo de ${request.name}`}
                            accessibilityState={{ disabled: isThisRequest, busy: rejecting }}
                            disabled={isThisRequest}
                            onPress={() => void resolveRequest(request.id, false)}
                            style={({ pressed }) => [
                              styles.rejectRequest,
                              isThisRequest && styles.buttonDisabled,
                              pressed && !isThisRequest && { opacity: opacity.pressed },
                            ]}
                          >
                            {rejecting ? (
                              <ActivityIndicator size="small" color={colors.danger} />
                            ) : (
                              <AppIcon name="error" size={16} color={colors.danger} />
                            )}
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Aprovar vínculo de ${request.name}`}
                            accessibilityState={{ disabled: isThisRequest, busy: approving }}
                            disabled={isThisRequest}
                            onPress={() => void resolveRequest(request.id, true)}
                            style={({ pressed }) => [
                              styles.approveRequest,
                              isThisRequest && styles.buttonDisabled,
                              pressed && !isThisRequest && { opacity: opacity.pressed },
                            ]}
                          >
                            {approving ? (
                              <ActivityIndicator size="small" color={colors.onBrand} />
                            ) : (
                              <AppIcon
                                name="success"
                                size={16}
                                color={colors.onBrand}
                              />
                            )}
                          </Pressable>
                        </>
                      );
                    })()}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={styles.requestPagination}>
              <Text style={styles.paginationInfo}>
                {Math.min(
                  (requestPage - 1) * requestPageSize + 1,
                  linkRequests.length,
                )}
                –{Math.min(requestPage * requestPageSize, linkRequests.length)}{" "}
                de {linkRequests.length}
              </Text>
              <View style={styles.paginationActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Página anterior de solicitações"
                  disabled={requestPage === 1}
                  onPress={() =>
                    setRequestPage((current) => Math.max(1, current - 1))
                  }
                  style={[
                    styles.pageButton,
                    requestPage === 1 && styles.pageButtonDisabled,
                  ]}
                >
                  <AppIcon
                    name="back"
                    size={16}
                    color={requestPage === 1 ? colors.mutedSoft : colors.brand}
                  />
                </Pressable>
                <Text style={styles.pageText}>
                  {requestPage} de {requestTotalPages}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Próxima página de solicitações"
                  disabled={requestPage === requestTotalPages}
                  onPress={() =>
                    setRequestPage((current) =>
                      Math.min(requestTotalPages, current + 1),
                    )
                  }
                  style={[
                    styles.pageButton,
                    requestPage === requestTotalPages &&
                      styles.pageButtonDisabled,
                  ]}
                >
                  <AppIcon
                    name="forward"
                    size={16}
                    color={
                      requestPage === requestTotalPages
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
        visible={confirmDeleteVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDeleteVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.confirmCard}>
            <View style={styles.confirmIcon}>
              <AppIcon name="warning" size={24} color={colors.danger} />
            </View>
            <Text accessibilityRole="header" style={styles.confirmTitle}>
              Excluir este cliente?
            </Text>
            <Text style={styles.confirmText}>
              Esta ação remove o cadastro da lista local. O histórico deverá ser
              preservado pelo backend quando a integração estiver disponível.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                disabled={archivingClient}
                onPress={() => setConfirmDeleteVisible(false)}
                style={[styles.cancelButton, styles.formActionButton, archivingClient && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: archivingClient, busy: archivingClient }}
                disabled={archivingClient}
                onPress={() => void deleteClient()}
                style={({ pressed }) => [styles.confirmDeleteButton, styles.formActionButton, pressed && !archivingClient && { opacity: opacity.pressed }]}
              >
                {archivingClient && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.confirmDeleteText}>Excluir</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!feedback}
        transparent
        animationType="fade"
        onRequestClose={() => setFeedback(null)}
      >
        <View style={styles.modalBackdrop}>
          {feedback && (
            <View
              accessibilityViewIsModal
              accessibilityRole="alert"
              style={styles.feedbackModal}
            >
              <View
                style={[
                  styles.feedbackModalIcon,
                  feedback.tone === "success"
                    ? styles.feedbackModalSuccess
                    : feedback.tone === "warning"
                      ? styles.feedbackModalWarning
                      : styles.feedbackModalError,
                ]}
              >
                <AppIcon
                  name={
                    feedback.tone === "success"
                      ? "success"
                      : feedback.tone === "warning"
                        ? "warning"
                        : "error"
                  }
                  size={32}
                  color={
                    feedback.tone === "success"
                      ? colors.success
                      : feedback.tone === "warning"
                        ? colors.warning
                        : colors.danger
                  }
                />
              </View>
              <Text
                accessibilityRole="header"
                style={styles.feedbackModalTitle}
              >
                {feedback.tone === "success"
                  ? "Tudo certo!"
                  : feedback.tone === "warning"
                    ? "Atenção"
                    : "Não foi possível concluir"}
              </Text>
              <Text style={styles.feedbackModalText}>{feedback.message}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar mensagem"
                onPress={() => setFeedback(null)}
                style={styles.feedbackModalButton}
              >
                <Text style={styles.feedbackModalButtonText}>Entendi</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/* ─── Menu de ações do desktop (painel flutuante) ─── */}
      <RowActionsMenu
        position={rowActionsMenu.position}
        onRequestClose={rowActionsMenu.close}
        items={
          rowActionsMenu.item
            ? [
                {
                  key: "profile",
                  label: "Ver perfil completo",
                  icon: "user",
                  onPress: () => router.push(`/clients/${rowActionsMenu.item!.id}` as never),
                },
                {
                  key: "edit",
                  label: "Editar cadastro",
                  icon: "edit",
                  onPress: () => editClient(rowActionsMenu.item!),
                },
              ]
            : []
        }
      />

      {/* ─── Modal de ações rápidas (mobile bottom-sheet) ─── */}
      {mobileActionClient !== null && (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() => setMobileActionClient(null)}
      >
        <Pressable
          style={styles.mobileActionsBackdrop}
          onPress={() => setMobileActionClient(null)}
        >
          <Pressable style={styles.mobileActionsSheet} onPress={() => {}}>
            <View style={styles.mobileActionsHandle} />
            <Text style={styles.mobileActionsTitle} numberOfLines={1}>
              {mobileActionClient?.name ?? ""}
            </Text>

            {/* Ver perfil completo */}
            <Pressable
              style={styles.mobileActionRow}
              onPress={() => {
                const client = mobileActionClient;
                setMobileActionClient(null);
                if (client) router.push(`/clients/${client.id}` as never);
              }}
            >
              <View style={[styles.mobileActionIcon, { backgroundColor: colors.brandSoft }]}>
                <AppIcon name="user" size={18} color={colors.brand} />
              </View>
              <Text style={styles.mobileActionLabel}>Ver perfil completo</Text>
            </Pressable>

            {/* Editar cadastro */}
            <Pressable
              style={styles.mobileActionRow}
              onPress={() => {
                const client = mobileActionClient;
                setMobileActionClient(null);
                if (client) editClient(client);
              }}
            >
              <View style={[styles.mobileActionIcon, { backgroundColor: colors.brandSoft }]}>
                <AppIcon name="edit" size={18} color={colors.brand} />
              </View>
              <Text style={styles.mobileActionLabel}>Editar cadastro</Text>
            </Pressable>

            {/* Fechar */}
            <Pressable
              style={[styles.mobileActionRow, styles.mobileActionClose]}
              onPress={() => setMobileActionClient(null)}
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

function Status({ status }: { status: ClientStatus }) {
  return (
    <View
      style={[
        styles.status,
        status === "Ativo" ? styles.statusActive : styles.statusInactive,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          status === "Ativo"
            ? styles.statusTextActive
            : styles.statusTextInactive,
        ]}
      >
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
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
  brandBlock: { justifyContent: "center" },
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
  notificationButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  notificationDot: {
    position: "absolute",
    right: 8,
    top: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.danger,
    borderWidth: 1,
    borderColor: colors.surface,
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
  pageHeading: { gap: spacing.md },
  pageHeadingWide: {
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
  planLimitNotice: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  planLimitNoticeMobile: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.xs,
  },
  planLimitBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  planLimitText: { color: colors.brandDark, fontFamily: typography.family.medium },
  planLimitLink: { color: colors.brand, fontFamily: typography.family.bold },
  planLimitLinkContainerMobile: {
    paddingLeft: 28,
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
    fontSize: typography.size.body,
  },
  feedbackModal: {
    width: "100%",
    maxWidth: 400,
    padding: spacing.lg,
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  feedbackModalIcon: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  feedbackModalSuccess: { backgroundColor: colors.successSoft },
  feedbackModalWarning: { backgroundColor: colors.warningSoft },
  feedbackModalError: { backgroundColor: colors.dangerSoft },
  feedbackModalTitle: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    textAlign: "center",
  },
  feedbackModalText: {
    marginTop: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
    lineHeight: typography.lineHeight.bodyLarge,
    textAlign: "center",
  },
  feedbackModalButton: {
    width: "100%",
    minHeight: 48,
    marginTop: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  feedbackModalButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  metricsViewport: { marginHorizontal: -12, marginVertical: -20 },
  metrics: { gap: spacing.md, paddingHorizontal: 12, paddingVertical: 20 },
  metricsWide: { flexDirection: "row", flexGrow: 1 },
  metricCard: {
    width: 256,
    minHeight: 168,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  metricCardWide: { flex: 1, width: "auto" },
  metricIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  brandMetricIcon: { backgroundColor: colors.brandSoft },
  successMetricIcon: { backgroundColor: colors.successSoft },
  metricLabel: {
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
  },
  metricDetail: {
    marginTop: spacing.xs,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  metricValue: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 28,
    lineHeight: 34,
  },
  brandMetricDetail: { color: colors.brand },
  successMetricDetail: { color: colors.success },
  linkViewportMobile: { marginHorizontal: -12, marginVertical: -20 },
  linkGrid: { gap: spacing.md },
  linkGridMobile: {
    paddingHorizontal: 12,
    paddingVertical: 20,
    flexDirection: "row",
    alignItems: "stretch",
    flexWrap: "nowrap",
  },
  linkGridWide: { flexDirection: "row", alignItems: "stretch" },
  linkCard: {
    flex: 1,
    minWidth: 0,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  codeCard: {
    backgroundColor: colors.brandDark,
    borderColor: colors.brandDark,
  },
  linkCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  linkIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  linkHeading: { flex: 1 },
  linkTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  codeCardTitle: { color: colors.onBrand },
  linkDescription: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  codeCardDescription: { color: colors.accentSoft },
  codeBox: {
    marginTop: spacing.lg,
    minHeight: 66,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  // O código completo retornado pelo backend (`rotate_provider_link_code`)
  // tem 32 caracteres hexadecimais — bem mais longo que o mock usado durante
  // o desenvolvimento da UI ("AG-M4R8-K2Q7", 12 caracteres). Com
  // `numberOfLines={1}` + `adjustsFontSizeToFit` + `letterSpacing`, o texto
  // excede o container mesmo no piso de `minimumFontScale`, o que no Android
  // pode fazer o RN renderizar o Text sem glifos visíveis (autosize falha
  // silenciosamente) embora o valor continue correto no estado — por isso o
  // botão "Copiar código" sempre funcionava. Corrigido permitindo quebra de
  // linha (sem numberOfLines/adjustsFontSizeToFit) e reduzindo fonte/
  // letterSpacing para códigos longos.
  codeText: {
    width: "100%",
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 20,
    letterSpacing: 1,
    textAlign: "center",
    flexWrap: "wrap",
  },
  codeTextLong: {
    fontSize: 15,
    letterSpacing: 0.3,
    lineHeight: 20,
  },
  codeTextPlaceholder: {
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    letterSpacing: 0,
  },
  codeNotice: {
    marginTop: spacing.md,
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  codeFeedback: {
    marginTop: spacing.sm,
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  codeActions: { marginTop: spacing.lg, flexDirection: "row", gap: spacing.sm },
  codeActionsMobile: { flexDirection: "column" },
  shareButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  shareButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  regenerateButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  regenerateButtonText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  requestTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  requestCount: {
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
  },
  requestCountText: {
    color: colors.warning,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  requestList: { marginTop: spacing.md, gap: spacing.sm },
  requestItem: {
    minHeight: 64,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  requestAvatar: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  requestCopy: { flex: 1, minWidth: 0 },
  requestName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  requestContact: {
    marginTop: spacing.xxs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  requestActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rejectRequest: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xs,
    backgroundColor: colors.dangerSoft,
  },
  rejectRequestText: {
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  approveRequest: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.xs,
    backgroundColor: colors.success,
  },
  approveRequestText: {
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  requestsEmpty: {
    minHeight: 104,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  requestsEmptyText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    textAlign: "center",
  },
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
  viewAllRequests: {
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  viewAllRequestsText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  requestsModal: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "88%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  requestsModalList: { flexShrink: 1, marginTop: spacing.md },
  requestPagination: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  directory: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  toolbar: {
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarMobile: {
    padding: spacing.md,
    alignItems: "stretch",
    flexDirection: "column",
  },
  searchBox: {
    flex: 1,
    minWidth: 220,
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
  searchInput: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    outlineStyle: "none",
  } as never,
  statusFilter: {
    minWidth: 150,
    minHeight: 48,
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
  statusFilterMobile: { width: "100%", minWidth: 0 },
  statusFilterCopy: { flex: 1, minWidth: 0 },
  statusFilterLabel: { color: colors.mutedSoft, fontFamily: typography.family.regular, fontSize: 10 },
  statusFilterValue: {
    marginTop: 1,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  tableHeader: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  columnTitle: {
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 0.6,
  },
  clientList: {
    marginBottom: spacing.md,
  },
  clientListMobile: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 0,
  },
  clientRow: {
    minHeight: 80,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clientCard: {
    minHeight: 238,
    margin: 0,
    padding: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: "stretch",
    flexDirection: "column",
    borderWidth: 0,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderRadius: 0,
    backgroundColor: colors.surface,
  },
  clientIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  clientColumn: { flex: 2.2 },
  serviceColumn: { flex: 1.5 },
  dateColumn: { flex: 1.1 },
  statusColumn: { flex: 0.9 },
  actionColumn: {
    minWidth: 180,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
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
  cardStatusDotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 0,
  },
  cardActionIcons: {
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
  clientAvatar: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  clientInitials: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  clientText: { flex: 1, minWidth: 0 },
  clientName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.bodyLarge,
  },
  clientContact: {
    marginTop: spacing.xxs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  cellText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  cellSecondary: {
    marginTop: spacing.xs,
    color: colors.brand,
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
    backgroundColor: colors.surface,
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
  pageButtonDisabled: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    opacity: 0.6,
  },
  pageText: {
    minWidth: 56,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    textAlign: "center",
  },
  status: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
  },
  statusActive: { backgroundColor: colors.successSoft },
  statusInactive: { backgroundColor: colors.surfaceSubtle },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotActive: { backgroundColor: colors.success },
  statusDotInactive: { backgroundColor: colors.mutedSoft },
  statusText: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  statusTextActive: { color: colors.success },
  statusTextInactive: { color: colors.muted },
  cardDivider: {
    height: 0,
    marginVertical: spacing.sm,
    backgroundColor: "transparent",
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  metaCopy: {
    flex: 1,
    minWidth: 0,
  },
  metaLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  metaValue: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  policySummary: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.xs,
  },
  policyChip: {
    flex: 1,
    minWidth: 0,
    padding: spacing.sm,
    borderRadius: radius.xs,
    backgroundColor: colors.brandSoft,
  },
  policyChipLabel: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: 10,
  },
  policyChipValue: {
    marginTop: spacing.xs,
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  cardDate: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardArrow: { marginLeft: "auto" },
  empty: {
    padding: spacing.xxl,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  statusPickerModal: {
    width: "100%",
    maxWidth: 440,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  statusPickerHeader: { width: "100%", flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  statusPickerTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title },
  statusPickerSubtitle: { marginTop: spacing.xs, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.body },
  statusPickerClose: { width: 40, height: 40, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  statusPickerOptions: { marginTop: spacing.lg, gap: spacing.sm },
  statusPickerOption: { minHeight: 48, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  statusPickerOptionActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  statusPickerOptionText: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  statusPickerOptionTextActive: { color: colors.onBrand },
  modalCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "92%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  modalCardMobile: { padding: spacing.md, borderRadius: radius.md },
  modalHeader: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
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
  form: { marginTop: spacing.lg, gap: 20, paddingBottom: spacing.md },
  fieldGroup: { gap: 6 },
  fieldLabel: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  requiredMark: { color: colors.danger },
  fieldErrorText: {
    color: colors.danger,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
    marginTop: 4,
  },
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

  formError: {
    flexShrink: 0,
    marginVertical: spacing.xs,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  formErrorText: {
    flex: 1,
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  modalActions: {
    flexShrink: 0,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    flexDirection: "column-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalActionsMobile: {
    alignItems: "stretch",
    flexDirection: "column-reverse",
  },
  modalActionGroup: {
    width: "100%",
    flexDirection: "column-reverse",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  cancelButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  cancelButtonText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  saveButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
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
    fontSize: typography.size.body,
  },
  deleteButton: {
    minHeight: 44,
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
    fontSize: typography.size.body,
  },
  buttonDisabled: { opacity: 0.55 },
  confirmCard: {
    width: "100%",
    maxWidth: 440,
    padding: spacing.lg,
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  confirmIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  confirmTitle: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
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
  confirmActions: {
    width: "100%",
    marginTop: spacing.lg,
    flexDirection: "column-reverse",
    justifyContent: "center",
    gap: spacing.sm,
  },
  confirmDeleteButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.danger,
  },
  confirmDeleteText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  formScroll: { flexShrink: 1 },
  formSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  formSectionTitle: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  formSectionDescription: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  fieldHelper: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  currencyPrefix: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  policyField: {
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  policyFieldHeader: { gap: spacing.md },
  policyFieldCopy: { flex: 1, gap: spacing.xs },
  modeToggle: {
    padding: spacing.xs,
    flexDirection: "row",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  modeOption: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xs,
  },
  modeOptionActive: { backgroundColor: colors.brand },
  modeOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  modeOptionTextActive: { color: colors.onBrand },
  periodFields: { flexDirection: "row", gap: spacing.sm },
  periodFieldsMobile: { flexDirection: "column" },
  periodField: { flex: 1, gap: spacing.xs },
  miniLabel: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  footer: {
    minHeight: 72,
    paddingTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
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
});
