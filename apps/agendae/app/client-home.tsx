import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  AppState,
  Modal,
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
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { ClientMobileTabBar } from "@/src/components/layout/client-mobile-tab-bar";
import { AppIcon } from "@/src/components/ui/app-icon";
import { supabaseAuthService as authService } from "@/src/infra/auth/supabase-auth-adapter";
import { clientPortfolioService } from "@/src/infra/clients/supabase-client-portfolio-adapter";
import { appointmentService } from "@/src/infra/agenda/supabase-appointment-adapter";
import { AppointmentError } from "@/src/domain/agenda/types";
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

type Provider = {
  id: string;
  name: string;
  specialty: string;
  initials: string;
  status: "active" | "pending";
};

type HomeAppointment = {
  id: string;
  providerId: string;
  day: string;
  month: string;
  time: string;
  title: string;
  detail: string;
  status: string;
  // RN-CAN-009/015/016 (DEC-150, BLG-092): instante bruto de `starts_at`
  // (ISO), copiado diretamente de `AppointmentRecord.startsAt` — sem ele não
  // há como calcular, no cliente, quantas horas faltam para o atendimento e
  // decidir entre "Cancelar" e "Contatar prestador" (seção 13.1 do handoff
  // de UX). Nenhuma chamada de rede nova.
  startsAtIso: string;
};

// RF-PAC (pacotes de sessões pré-pagas) não tem schema/backend real ainda —
// decisão explícita do usuário, 13/08/2026 (BLG-088): manter esta seção
// exibindo o estado vazio por ora, sem remover a UI nem implementar RF-PAC
// nesta rodada. Ver BACKLOG.md.
const packages: { providerId: string; name: string; balance: string; validity: string; progress: number }[] = [];

const MONTH_LABELS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

// Iniciais a partir do nome (ex.: "Dra. Ana Ribeiro" -> "AR"), mesmo padrão
// visual já usado no avatar de `app/client-booking.tsx` (carrossel de
// prestadores) e `app/clients.tsx`.
function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const CONFIRMATION_STATUS_LABEL: Record<string, string> = {
  pending: "A confirmar",
  confirmed: "Confirmado",
};

// RN-CAN-009 (revisada por DEC-150)/RN-CAN-015/RN-CAN-016 (BLG-092): janela
// mínima de 24 horas CORRIDAS (instante absoluto, sem fuso nem dia útil —
// diferente de `minimum_bookable_instant`/RN-AGD-004/008/009) para
// cancelamento pelo cliente. Reaproveitada tanto para decidir o rótulo do
// botão do card quanto, de novo, no instante do toque em
// `openCancelModal`/`openContactProviderModal` — nunca depende de o card ter
// sido renderizado há pouco tempo. Cálculo client-side é só para feedback
// imediato (Nielsen #1/#5); quem efetivamente impede a operação é o servidor
// (`cancel_appointment`, DEC-154).
function isCancelBlockedByAdvanceNotice(startsAtIso: string, now: Date): boolean {
  return new Date(startsAtIso).getTime() - now.getTime() < 24 * 60 * 60 * 1000;
}

export default function ClientHomeScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [appointments, setAppointments] = useState<HomeAppointment[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [homeLoading, setHomeLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [homeError, setHomeError] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeFeedback, setCodeFeedback] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [codeSubmitting, setCodeSubmitting] = useState(false);
  // RF-CAN-005, BLG-090 (DEC-146/DEC-148): cancelamento do próprio
  // agendamento pelo cliente — item alvo do modal de confirmação, motivo
  // opcional (RN-CAN-008), estado de envio e erro inline (sem fechar o
  // modal nem descartar o motivo já digitado), e modal de sucesso separado
  // que só então dispara `loadHome()` (seção 3.2/4.2 do handoff de UX).
  const [cancelTarget, setCancelTarget] = useState<HomeAppointment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelSuccessVisible, setCancelSuccessVisible] = useState(false);
  // RN-CAN-015 (BLG-092): erro de corrida — o cliente demorou a confirmar e
  // a janela de 24h fechou durante a espera. Uma nova tentativa está fadada
  // a falhar de novo (o tempo só avança), então o botão primário fica
  // desabilitado PERMANENTEMENTE para esta abertura do modal, diferente do
  // comportamento genérico de erro (que reabilita para nova tentativa) —
  // seção 13.4 do handoff de UX. Detectado por `error.code`, nunca por
  // texto.
  const [cancelBlockedByAdvanceNotice, setCancelBlockedByAdvanceNotice] = useState(false);
  // RN-CAN-009/RF-CAN-008 (BLG-092): destino do toque em "Contatar
  // prestador" (< 24h de antecedência) — modal informativo, sem campo de
  // motivo e sem nenhuma chamada de rede (seção 13.3 do handoff de UX).
  const [contactProviderTarget, setContactProviderTarget] = useState<HomeAppointment | null>(null);
  // Feedback visual de clique (padrão Nero): estado de pendência dedicado do
  // botão "Tentar novamente" do banner de erro — `loadHome` já zera
  // `homeError` de forma síncrona antes do primeiro `await`, então sem este
  // estado próprio o banner (e o botão) desmontariam antes de o loading
  // poder ser percebido.
  const [retryingHome, setRetryingHome] = useState(false);

  useEffect(() => { void authService.getSession().then((session) => setDisplayName(session?.user.displayName ?? "")); }, []);

  // BLG-089 — Home do cliente estava inteiramente desligada de dado real
  // (`providers`/`appointments` eram arrays fixos e vazios, sem nenhuma
  // chamada Supabase). Reaproveita os mesmos contratos já usados por
  // `app/client-providers.tsx` (`listClientProviderLinks`, inclui vínculos
  // `active` e `pending`) e por `app/agenda.tsx`/`app/clients.tsx`
  // (`appointmentService.listAppointments`, que já resolve para a view
  // `appointments_client_view` quando a sessão ativa é de cliente — ver
  // `appointmentsSource()` no adapter). Mesmo padrão de refetch em
  // foco/foreground de `app/dashboard.tsx`/`app/client-booking.tsx`
  // (`useFocusEffect` + `AppState`), pela mesma razão: esta tela é
  // igualmente suscetível a ficar presa a um dado antigo se a navegação/
  // background acontecer com a tela já montada.
  const loadHome = useCallback(async () => {
    setHomeLoading(true);
    setHomeError("");
    try {
      const links = await clientPortfolioService.listClientProviderLinks();
      const nextProviders: Provider[] = links.map((link) => ({
        id: link.tenantId,
        name: link.providerName ?? "Prestador",
        specialty: link.profession ?? "",
        initials: initialsFromName(link.providerName ?? "Prestador"),
        status: link.status,
      }));
      setProviders(nextProviders);
      setActiveProviderId((current) => {
        const activeIds = nextProviders.filter((item) => item.status === "active").map((item) => item.id);
        if (activeIds.includes(current)) return current;
        return activeIds[0] ?? "";
      });

      // `AppointmentListQuery.month` é obrigatório — busca mês atual e
      // próximo (o suficiente para uma prévia de "próximos atendimentos" na
      // Home; a agenda completa continua em `/client-booking`), filtra por
      // `startsAt` futuro e ordena.
      const now = new Date();
      const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const [currentMonthPage, nextMonthPage] = await Promise.all([
        appointmentService.listAppointments({ month: monthKey(now), state: "scheduled", page: 1, pageSize: 10 }),
        appointmentService.listAppointments({ month: monthKey(nextMonth), state: "scheduled", page: 1, pageSize: 10 }),
      ]);
      const nowIso = now.toISOString();
      const upcoming = [...currentMonthPage.items, ...nextMonthPage.items]
        .filter((item) => item.startsAt >= nowIso)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .map((item) => {
          const startDate = new Date(item.startsAt);
          return {
            id: item.id,
            providerId: item.tenantId,
            day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: item.timezone }).format(startDate),
            month: MONTH_LABELS[Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: item.timezone }).format(startDate)) - 1],
            time: (() => {
              const startFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: item.timezone }).format(startDate);
              const endDate = new Date(startDate.getTime() + item.durationMinutes * 60000);
              const endFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: item.timezone }).format(endDate);
              return `${startFmt} às ${endFmt}`;
            })(),
            title: item.serviceNameSnapshot ?? item.title ?? "Compromisso",
            detail: `${item.durationMinutes} min`,
            status: CONFIRMATION_STATUS_LABEL[item.confirmationStatus] ?? "Confirmado",
            startsAtIso: item.startsAt,
          };
        });
      setAppointments(upcoming);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : "Não foi possível carregar seus dados.");
    } finally {
      setHomeLoading(false);
      setInitialLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        void loadHome();
      }, 250);
      return () => clearTimeout(timer);
    }, [loadHome]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void loadHome();
    });
    return () => subscription.remove();
  }, [loadHome]);

  const activeProvider = useMemo(
    () =>
      providers.find(
        (provider) =>
          provider.id === activeProviderId && provider.status === "active",
      ),
    [providers, activeProviderId],
  );
  const activeAppointments = useMemo(
    () => appointments.filter((item) => item.providerId === activeProviderId),
    [appointments, activeProviderId],
  );
  const activePackage = useMemo(
    () => packages.find((item) => item.providerId === activeProviderId),
    [packages, activeProviderId],
  );

  async function requestLink() {
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 6) {
      setCodeInvalid(true);
      setCodeFeedback(
        "Confira o código. Ele deve ter pelo menos 6 caracteres.",
      );
      return;
    }
    setCodeSubmitting(true);
    setCodeInvalid(false);
    setCodeFeedback("");
    try {
      await clientPortfolioService.redeemProviderLinkCode(normalized);
      setCode("");
      setCodeFeedback("Solicitação enviada. Aguarde a aprovação do prestador.");
      void loadHome();
    } catch (error) {
      setCodeInvalid(true);
      setCodeFeedback(
        error instanceof Error ? error.message : "Não foi possível solicitar o vínculo.",
      );
    } finally {
      setCodeSubmitting(false);
    }
  }

  function openCancelModal(item: HomeAppointment) {
    setCancelTarget(item);
    setCancelReason("");
    setCancelError("");
    setCancelBlockedByAdvanceNotice(false);
  }
  function closeCancelModal() {
    if (cancelSubmitting) return;
    setCancelTarget(null);
    setCancelReason("");
    setCancelError("");
    setCancelBlockedByAdvanceNotice(false);
  }
  async function confirmCancelAppointment() {
    if (!cancelTarget) return;
    setCancelSubmitting(true);
    setCancelError("");
    try {
      await appointmentService.cancelAppointment(cancelTarget.id, {
        reason: cancelReason.trim() || null,
      });
      setCancelTarget(null);
      setCancelReason("");
      setCancelSuccessVisible(true);
    } catch (error) {
      // RN-CAN-015 (BLG-092): corrida de tempo — a janela de 24h fechou
      // enquanto o modal já estava aberto. Nunca detectar por texto da
      // mensagem, sempre pelo código do erro.
      if (error instanceof AppointmentError && error.code === "CANCELLATION_ADVANCE_NOTICE_INVALID") {
        setCancelBlockedByAdvanceNotice(true);
      }
      setCancelError(
        error instanceof Error
          ? error.message
          : "Não foi possível cancelar. Tente novamente.",
      );
    } finally {
      setCancelSubmitting(false);
    }
  }
  function closeCancelSuccess() {
    setCancelSuccessVisible(false);
    void loadHome();
  }
  function openContactProviderModal(item: HomeAppointment) {
    setContactProviderTarget(item);
  }
  function closeContactProviderModal() {
    setContactProviderTarget(null);
  }
  async function handleRetryHome() {
    setRetryingHome(true);
    try {
      await loadHome();
    } finally {
      setRetryingHome(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {initialLoading && <PageLoadingOverlay />}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View style={styles.hero}>
            <View pointerEvents="none" style={styles.heroGlow} />
            <View style={[styles.heroRow, wide && styles.heroRowWide]}>
              <View style={styles.heroCopy}>
                <Text style={styles.eyebrow}>SEU ESPAÇO</Text>
                <Text
                  accessibilityRole="header"
                  style={[styles.title, !wide && styles.titleMobile]}
                >
                  Olá{displayName ? `, ${displayName}` : ""}!
                </Text>
                <Text style={styles.description}>
                  Acompanhe seus atendimentos com clareza e agende quando
                  precisar.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/client-booking")}
                style={styles.primaryButton}
              >
                <AppIcon name="add" size={18} color={colors.brandDark} />
                <Text style={styles.primaryButtonText}>Novo agendamento</Text>
              </Pressable>
            </View>
          </View>

          {(retryingHome || !!homeError) && <View style={[styles.stateBanner, styles.stateBannerError]}><Text style={styles.errorText}>{homeError}</Text><Pressable accessibilityRole="button" accessibilityState={{ disabled: retryingHome, busy: retryingHome }} disabled={retryingHome} onPress={() => void handleRetryHome()} style={({ pressed }) => [styles.retryButton, styles.retryButtonContent, pressed && !retryingHome && { opacity: opacity.pressed }]}>{retryingHome && <ActivityIndicator size="small" color={colors.onBrand} />}<Text style={styles.primaryActionText}>Tentar novamente</Text></Pressable></View>}

          <View style={styles.contextPanel}>
            <View
              style={[
                styles.sectionHeading,
                !wide && styles.sectionHeadingMobile,
              ]}
            >
              <View style={styles.headingCopy}>
                <Text style={styles.sectionTitle}>Prestador em uso</Text>
                <Text style={styles.sectionSubtitle}>
                  Agenda, pacote e serviços abaixo pertencem somente a este
                  vínculo.
                </Text>
              </View>
              <View style={[styles.providerActions, !wide && styles.providerActionsMobile]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/client-providers")}
                  style={styles.outlineButton}
                >
                  <AppIcon name="clients" size={16} color={colors.brand} />
                  <Text style={styles.outlineButtonText}>Ver todos os prestadores</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setCodeOpen((open) => !open)}
                  style={styles.outlineButton}
                >
                  <AppIcon name="add" size={16} color={colors.brand} />
                  <Text style={styles.outlineButtonText}>Adicionar prestador</Text>
                </Pressable>
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.providerList}
            >
              {providers
                .filter((provider) => provider.status === "active")
                .map((provider) => {
                  const selected = provider.id === activeProviderId;
                  return (
                    <Pressable
                      key={provider.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setActiveProviderId(provider.id)}
                      style={[
                        styles.providerCard,
                        selected && styles.providerCardActive,
                      ]}
                    >
                      <View
                        style={[
                          styles.providerAvatar,
                          selected && styles.providerAvatarActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.providerInitials,
                            selected && styles.providerInitialsActive,
                          ]}
                        >
                          {provider.initials}
                        </Text>
                      </View>
                      <View style={styles.providerCopy}>
                        <Text style={styles.providerName}>{provider.name}</Text>
                        <Text style={styles.providerSpecialty}>
                          {provider.specialty}
                        </Text>
                      </View>
                      {selected ? (
                        <View style={styles.selectedBadge}>
                          <AppIcon
                            name="success"
                            size={16}
                            color={colors.success}
                          />
                          <Text style={styles.selectedText}>Em uso</Text>
                        </View>
                      ) : (
                        <AppIcon
                          name="forward"
                          size={16}
                          color={colors.mutedSoft}
                        />
                      )}
                    </Pressable>
                  );
                })}
            </ScrollView>

            {!homeLoading && !providers.some((provider) => provider.status === "active") && (
              <Text style={styles.emptyText}>
                Nenhum prestador vinculado ainda. Use &ldquo;Adicionar prestador&rdquo; com o código recebido.
              </Text>
            )}

            {codeOpen && (
              <View style={styles.codeBox}>
                <View style={styles.codeIcon}>
                  <AppIcon name="security" size={20} color={colors.brand} />
                </View>
                <View style={styles.codeContent}>
                  <Text style={styles.codeTitle}>Solicitar novo vínculo<Text style={styles.requiredMark}> *</Text></Text>
                  <Text style={styles.codeDescription}>
                    Digite o código enviado pelo prestador. A solicitação não
                    libera acesso automaticamente.
                  </Text>
                  <View
                    style={[styles.codeForm, !wide && styles.codeFormMobile]}
                  >
                    <TextInput
                      accessibilityLabel="Código do prestador"
                      autoCapitalize="characters"
                      editable={!codeSubmitting}
                      onChangeText={(value) => {
                        setCode(value);
                        setCodeFeedback("");
                        setCodeInvalid(false);
                      }}
                      placeholder="Ex.: AGENDA-8F2K"
                      placeholderTextColor={colors.mutedSoft}
                      value={code}
                      style={[styles.input, codeInvalid && styles.inputError]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: codeSubmitting, busy: codeSubmitting }}
                      disabled={codeSubmitting}
                      onPress={() => void requestLink()}
                      style={({ pressed }) => [
                        styles.sendButton,
                        styles.sendButtonContent,
                        pressed && !codeSubmitting && { opacity: opacity.pressed },
                        codeSubmitting && styles.sendButtonDisabled,
                      ]}
                    >
                      {codeSubmitting && <ActivityIndicator size="small" color={colors.onBrand} />}
                      <Text style={styles.sendButtonText}>Enviar solicitação</Text>
                    </Pressable>
                  </View>
                  {!!codeFeedback && (
                    <Text
                      accessibilityRole="alert"
                      style={[
                        styles.feedback,
                        codeFeedback.startsWith("Solicitação enviada") &&
                          styles.feedbackSuccess,
                      ]}
                    >
                      {codeFeedback}
                    </Text>
                  )}
                </View>
              </View>
            )}
          </View>

          <View
            style={[
              styles.mainGrid,
              wide ? styles.mainGridWide : styles.mainGridMobile,
            ]}
          >
            <View
              style={[
                styles.panel,
                styles.appointmentsPanel,
                !wide && styles.mobileNaturalBlock,
              ]}
            >
              <View style={styles.sectionHeading}>
                <View style={styles.headingCopy}>
                  <Text style={styles.sectionTitle}>Próximos atendimentos</Text>
                  <Text style={styles.sectionSubtitle}>
                    {activeProvider?.name ?? "Selecione um prestador"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/client-booking")}
                >
                  <Text style={styles.scheduleLink}>Ver agenda</Text>
                </Pressable>
              </View>
              <View style={styles.appointmentList}>
                {activeAppointments.map((item) => {
                  // RN-CAN-009/015/016 (DEC-150, BLG-092): dentro de 24h de
                  // `starts_at`, o botão nunca desaparece (mesmo princípio já
                  // usado para "Excluir" em `app/agenda.tsx`) — só troca de
                  // rótulo/ícone/destino (seção 13.2 do handoff de UX).
                  const blockedByAdvanceNotice = isCancelBlockedByAdvanceNotice(
                    item.startsAtIso,
                    new Date(),
                  );
                  const providerContactName = activeProvider?.name ?? "o prestador";
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.appointment,
                        !wide && styles.appointmentMobile,
                      ]}
                    >
                      <View style={styles.dateBox}>
                        <Text style={styles.dateDay}>{item.day}</Text>
                        <Text style={styles.dateMonth}>{item.month}</Text>
                      </View>
                      <View
                        style={[
                          styles.appointmentCopy,
                          !wide && styles.appointmentCopyMobile,
                        ]}
                      >
                        <Text style={styles.appointmentTime}>{item.time}</Text>
                        <Text style={styles.appointmentTitle}>{item.title}</Text>
                        <Text style={styles.appointmentDetail}>
                          {item.detail}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          !wide && styles.statusBadgeMobile,
                        ]}
                      >
                        <Text style={styles.statusText}>{item.status}</Text>
                      </View>
                      {blockedByAdvanceNotice ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Cancelamento indisponível a menos de 24 horas do atendimento — contatar ${providerContactName} em vez de cancelar por aqui`}
                          onPress={() => openContactProviderModal(item)}
                          style={[
                            styles.cancelAction,
                            styles.contactAction,
                            !wide && styles.cancelActionMobile,
                          ]}
                        >
                          <AppIcon name="warning" size={16} color={colors.warning} />
                          <Text style={[styles.cancelActionText, styles.contactActionText]}>
                            Contatar prestador
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Cancelar agendamento de ${item.title} em ${item.day}/${item.month} às ${item.time.split(" às ")[0]}`}
                          onPress={() => openCancelModal(item)}
                          style={[
                            styles.cancelAction,
                            !wide && styles.cancelActionMobile,
                          ]}
                        >
                          <AppIcon name="error" size={16} color={colors.danger} />
                          <Text style={styles.cancelActionText}>Cancelar</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
                {!activeAppointments.length && (
                  <View style={styles.empty}>
                    <AppIcon
                      name="calendar"
                      size={32}
                      color={colors.mutedSoft}
                    />
                    <Text style={styles.emptyTitle}>
                      Nenhum atendimento próximo
                    </Text>
                    <Text style={styles.emptyText}>
                      Você pode criar um agendamento com este prestador.
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <View
              style={[styles.sideColumn, !wide && styles.mobileNaturalBlock]}
            >


              <View style={styles.panel}>
                <View style={styles.sectionHeading}>
                  <View style={styles.headingCopy}>
                    <Text style={styles.sectionTitle}>Solicitações</Text>
                    <Text style={styles.sectionSubtitle}>
                      Aguardando resposta do prestador
                    </Text>
                  </View>
                </View>
                {providers
                  .filter((provider) => provider.status === "pending")
                  .slice(0, 2)
                  .map((provider) => (
                    <View key={provider.id} style={styles.pendingRow}>
                      <View style={styles.pendingIcon}>
                        <AppIcon
                          name="schedule"
                          size={18}
                          color={colors.warning}
                        />
                      </View>
                      <View style={styles.providerCopy}>
                        <Text style={styles.pendingName}>{provider.name}</Text>
                        <Text style={styles.pendingText}>
                          Solicitação pendente
                        </Text>
                      </View>
                      <View style={styles.waitingBadge}>
                        <Text style={styles.waitingText}>Em análise</Text>
                      </View>
                    </View>
                  ))}
              </View>
            </View>
          </View>

          {Platform.OS === "web" && <View style={styles.footer}>
            <Text style={styles.footerBrand}>
              rotina<Text style={styles.accent}>ê</Text>
            </Text>
            <Text style={styles.footerText}>Seu tempo, bem organizado.</Text>
          </View>}
        </View>
      </ScrollView>
      <Modal
        visible={cancelTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={closeCancelModal}
      >
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.confirmModal}>
            <View style={styles.confirmIcon}>
              <AppIcon name="error" size={24} color={colors.danger} />
            </View>
            <Text style={styles.confirmTitle}>Cancelar agendamento?</Text>
            <Text style={styles.confirmText}>
              O prestador será notificado do cancelamento. Este atendimento
              deixará de aparecer nos seus próximos agendamentos.
            </Text>
            <View style={styles.cancellationReasonField}>
              <Text style={styles.label}>
                Motivo para o prestador{" "}
                <Text style={styles.optional}>(opcional)</Text>
              </Text>
              <TextInput
                accessibilityLabel="Motivo do cancelamento para o prestador"
                value={cancelReason}
                onChangeText={setCancelReason}
                editable={!cancelSubmitting}
                placeholder="Ex.: Não vou poder comparecer"
                placeholderTextColor={colors.mutedSoft}
                multiline
                maxLength={500}
                style={[styles.input, styles.cancellationReasonInput]}
              />
              <Text style={styles.helperText}>
                Esta mensagem será enviada e ficará visível para o prestador.
              </Text>
            </View>
            {!!cancelError && (
              <View style={styles.errorBox}>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {cancelError}
                </Text>
              </View>
            )}
            <View style={styles.confirmActions}>
              <Pressable
                disabled={cancelSubmitting}
                onPress={closeCancelModal}
                style={[
                  styles.cancelButton,
                  styles.formActionButton,
                  cancelSubmitting && { opacity: opacity.disabled },
                ]}
              >
                <Text style={styles.cancelButtonText}>Voltar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: cancelSubmitting || cancelBlockedByAdvanceNotice,
                  busy: cancelSubmitting,
                }}
                disabled={cancelSubmitting || cancelBlockedByAdvanceNotice}
                onPress={() => void confirmCancelAppointment()}
                style={({ pressed }) => [
                  styles.confirmDelete,
                  styles.formActionButton,
                  styles.confirmButtonSpinnerRow,
                  pressed &&
                    !cancelSubmitting &&
                    !cancelBlockedByAdvanceNotice && { opacity: opacity.pressed },
                  (cancelSubmitting || cancelBlockedByAdvanceNotice) &&
                    styles.confirmDeleteDisabled,
                ]}
              >
                {cancelSubmitting && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.confirmDeleteText}>Confirmar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={cancelSuccessVisible}
        transparent
        animationType="fade"
        onRequestClose={closeCancelSuccess}
      >
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.modal}>
            <View style={[styles.modalIcon, styles.successModalIcon]}>
              <AppIcon name="success" size={24} color={colors.success} />
            </View>
            <Text style={styles.modalTitle}>Agendamento cancelado</Text>
            <Text style={styles.modalText}>
              O prestador foi notificado. Este atendimento não aparece mais na
              sua lista.
            </Text>
            <Pressable
              onPress={closeCancelSuccess}
              style={[styles.modalPrimary, styles.modalPrimaryStandalone]}
            >
              <Text style={styles.modalPrimaryText}>Entendi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {/* RN-CAN-009/RF-CAN-008 (BLG-092): modal informativo do toque em
          "Contatar prestador" (< 24h de antecedência) — reaproveita
          integralmente a mesma estrutura já catalogada do modal `exception`
          de `client-booking.tsx`/"Excluir indisponível" de `agenda.tsx`
          (ícone `warning`, botão único "Entendi"), nenhum componente visual
          novo (seção 13.3 do handoff de UX). Sem campo de motivo e sem
          nenhuma chamada de rede. */}
      <Modal
        visible={contactProviderTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={closeContactProviderModal}
      >
        <View style={styles.backdrop}>
          <View accessibilityViewIsModal style={styles.modal}>
            <View style={[styles.modalIcon, styles.modalIconWarning]}>
              <AppIcon name="warning" size={24} color={colors.warning} />
            </View>
            <Text style={styles.modalTitle}>Menos de 24h para o atendimento</Text>
            <Text style={styles.modalText}>
              Cancelamentos com menos de 24 horas de antecedência não podem
              ser feitos por aqui. Entre em contato diretamente com{" "}
              {activeProvider?.name ?? "o prestador"} — ele pode cancelar este
              atendimento a qualquer momento, sem essa restrição de prazo.
            </Text>
            <Pressable
              onPress={closeContactProviderModal}
              style={[styles.modalPrimary, styles.modalPrimaryStandalone]}
            >
              <Text style={styles.modalPrimaryText}>Entendi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <ClientMobileTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  mobileNaturalBlock: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    width: "100%",
    alignSelf: "stretch",
    overflow: "visible",
  },
  safe: { flex: 1, backgroundColor: colors.canvas },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
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
  hero: {
    minHeight: 210,
    padding: spacing.xl,
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.brandDark,
  },
  heroGlow: {
    position: "absolute",
    width: 420,
    height: 420,
    right: -110,
    top: -260,
    borderRadius: radius.pill,
    backgroundColor: colors.brandMid,
    opacity: 0.7,
  },
  heroRow: { gap: spacing.lg },
  heroRowWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroCopy: { maxWidth: 650, gap: spacing.xs },
  eyebrow: {
    color: colors.accentSoft,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  title: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 36,
    lineHeight: 42,
  },
  titleMobile: { fontSize: 30, lineHeight: 36 },
  description: {
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
    lineHeight: typography.lineHeight.bodyLarge,
  },
  primaryButton: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.onBrand,
  },
  primaryButtonText: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  contextPanel: {
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionHeadingMobile: { alignItems: "flex-start", flexDirection: "column" },
  headingCopy: { flex: 1, minWidth: 0 },
  sectionTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  sectionSubtitle: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  outlineButton: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  providerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  providerActionsMobile: { width: "100%", alignItems: "stretch", flexDirection: "column" },
  outlineButtonText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  providerList: { gap: spacing.md, paddingVertical: spacing.xs },
  providerCard: {
    width: 300,
    minHeight: 78,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  providerCardActive: {
    borderWidth: 2,
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  providerAvatar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  providerAvatarActive: { backgroundColor: colors.brand },
  providerInitials: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  providerInitialsActive: { color: colors.onBrand },
  providerCopy: { flex: 1, minWidth: 0 },
  providerName: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  providerSpecialty: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  selectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  selectedText: {
    color: colors.success,
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  codeBox: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  codeIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  codeContent: { flex: 1, minWidth: 0 },
  codeTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  codeDescription: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  codeForm: { marginTop: spacing.md, flexDirection: "row", gap: spacing.sm },
  codeFormMobile: { flexDirection: "column" },
  input: {
    minHeight: 48,
    flex: 1,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  inputError: { borderColor: colors.danger },
  requiredMark: { color: colors.danger },
  sendButton: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  // Layout auxiliar para acomodar o `ActivityIndicator` de loading ao lado
  // do texto, sem alterar a altura/estrutura do botão (mesmo padrão de
  // `app/agenda.tsx`/`app/dashboard.tsx`).
  sendButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  sendButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  feedback: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  feedbackSuccess: { color: colors.success },
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
  stateBannerError: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  errorText: { flex: 1, color: colors.danger, fontFamily: typography.family.semibold },
  retryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  retryButtonContent: { flexDirection: "row", gap: spacing.sm },
  primaryActionText: { color: colors.onBrand, fontFamily: typography.family.bold },
  mainGrid: { gap: spacing.lg },
  mainGridMobile: {
    width: "100%",
    alignSelf: "stretch",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    overflow: "visible",
  },
  mainGridWide: { flexDirection: "row", alignItems: "flex-start" },
  panel: {
    padding: spacing.lg,
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  appointmentsPanel: { flex: 1.45 },
  sideColumn: { flex: 0.85, gap: spacing.lg },
  scheduleLink: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  appointmentList: { gap: spacing.sm },
  appointment: {
    minHeight: 92,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  appointmentMobile: {
    minHeight: 0,
    width: "100%",
    padding: spacing.md,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    flexDirection: "column",
    alignItems: "stretch",
    flexWrap: "nowrap",
    overflow: "visible",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  dateBox: {
    width: 52,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  dateDay: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  dateMonth: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  appointmentCopy: { flex: 1, minWidth: 140 },
  appointmentCopyMobile: {
    minWidth: 0,
    width: "100%",
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    overflow: "visible",
  },
  appointmentTime: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  appointmentTitle: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  appointmentDetail: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  statusBadgeMobile: { alignSelf: "flex-start" },
  statusText: {
    color: colors.success,
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  empty: { paddingVertical: spacing.xl, alignItems: "center", gap: spacing.sm },
  emptyTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  emptyText: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  packageIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  packageContent: { gap: spacing.sm },
  packageName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  packageBalance: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  progressTrack: {
    height: 8,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  progressValue: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  packageFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  packageValidity: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: 10,
  },
  packagePercent: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  pendingRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pendingIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
  },
  pendingName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  pendingText: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  waitingBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
  },
  waitingText: {
    color: colors.warning,
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  securityNote: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  securityText: {
    flex: 1,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  footer: {
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
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
  },
  // RF-CAN-005, BLG-090 (DEC-146/DEC-148): botão "Cancelar" do cliente no
  // card de "Próximos atendimentos" — ícone + texto (Nielsen #6, o cliente
  // usa a tela com menor frequência que o prestador em `agenda.tsx`, que só
  // usa ícone isolado).
  cancelAction: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  cancelActionMobile: {
    marginTop: spacing.sm,
    minHeight: 44,
    width: "100%",
  },
  cancelActionText: {
    color: colors.danger,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  // RN-CAN-009/015/016 (DEC-150, BLG-092): variante do mesmo botão para o
  // estado "< 24h de antecedência" — nunca `error`/`colors.danger` neste
  // estado, porque a ação deixou de ser destrutiva (seção 13.2 do handoff).
  contactAction: { backgroundColor: colors.warningSoft },
  contactActionText: { color: colors.warning },
  // Estrutura replicada de `app/agenda.tsx` (modal de confirmação de
  // cancelamento do prestador) — mesma composição visual, textos adaptados
  // à perspectiva do cliente (seção 4.2/8 do handoff de UX). Cada tela
  // mantém seu próprio `StyleSheet`, sem importar estilos entre arquivos.
  backdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
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
  confirmTitle: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  confirmText: {
    marginTop: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.regular,
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
  label: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  optional: { color: colors.mutedSoft, fontFamily: typography.family.regular },
  helperText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  errorBox: {
    marginTop: spacing.sm,
    width: "100%",
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  confirmActions: {
    marginTop: spacing.lg,
    width: "100%",
    flexDirection: "column-reverse",
    justifyContent: "center",
    gap: spacing.sm,
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
  confirmDeleteDisabled: { opacity: 0.6 },
  confirmDeleteText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
  // Layout auxiliar aplicado ao botão "Confirmar" do modal de cancelamento
  // para acomodar o `ActivityIndicator` de loading ao lado do texto, sem
  // alterar a altura/estrutura do botão (mesmo padrão de `app/agenda.tsx`).
  confirmButtonSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  // Estrutura replicada de `app/client-booking.tsx` (modal de sucesso) para
  // "Agendamento cancelado" (seção 4.2/8 do handoff de UX).
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
  successModalIcon: { backgroundColor: colors.successSoft },
  // Mesma estrutura de `modalIconWarning` já usada em `client-booking.tsx`
  // para o modal "Revise o agendamento" — reaproveitada aqui (seção 13.3 do
  // handoff) para "Menos de 24h para o atendimento".
  modalIconWarning: { backgroundColor: colors.warningSoft },
  modalTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  modalText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
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
