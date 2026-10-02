import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Platform,
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
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { AppIcon } from "@/src/components/ui/app-icon";
import { ActionsBottomSheet, type ActionsBottomSheetItem } from "@/src/components/ui/actions-bottom-sheet";
import { ClientEditModal } from "@/src/components/clients/client-edit-modal";
import { ClientRenewModal } from "@/src/components/clients/client-renew-modal";
import { AppointmentStatusActionModals } from "@/src/components/agenda/appointment-status-action-modals";
import { getAppointmentStatusLabel } from "@/src/domain/agenda/appointment-status-label";
import type { AppointmentRecord } from "@/src/domain/agenda/types";
import type { Client, ClientNote, ClientPolicyRenewal } from "@/src/domain/clients/types";
import { loadAllClients } from "@/src/domain/clients/load-all-clients";
import { useProviderPlan } from "@/src/hooks/use-provider-plan";
import { useClientEditForm } from "@/src/hooks/use-client-edit-form";
import { useClientRenewForm } from "@/src/hooks/use-client-renew-form";
import { useAppointmentStatusActions } from "@/src/hooks/use-appointment-status-actions";
import { clientPortfolioService } from "@/src/infra/clients/supabase-client-portfolio-adapter";
import { appointmentService } from "@/src/infra/agenda/supabase-appointment-adapter";
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

/**
 * Busca todas as páginas de agendamentos de um cliente.
 *
 * Extraído do `useEffect` de montagem original para ser reaproveitado também
 * na re-busca disparada por `useFocusEffect` e pelas mutações de
 * concluir/cancelar (`useAppointmentStatusActions`) — evita repetir a lógica
 * de paginação em três lugares diferentes.
 */
async function fetchClientAppointments(clientId: string): Promise<AppointmentRecord[]> {
  const firstPage = await appointmentService.listAppointments({ clientId, page: 1, pageSize: 10 });
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(0, firstPage.totalPages - 1) }, (_, index) =>
      appointmentService.listAppointments({ clientId, page: index + 2, pageSize: 10 }),
    ),
  );
  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}

type PolicyFieldKey = "totalLimit" | "dailyLimit" | "period";

const policyFieldTitles: Record<PolicyFieldKey, string> = {
  totalLimit: "Limite total de aulas por cliente",
  dailyLimit: "Por dia",
  period: "Período",
};

export default function ClientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedFromBrowserReload] = useState(() => {
    if (Platform.OS !== "web" || typeof performance === "undefined") return false;
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return navigation?.type === "reload";
  });
  const providerPlan = useProviderPlan();
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [renewals, setRenewals] = useState<ClientPolicyRenewal[]>([]);
  // Carteira completa de clientes, usada apenas para alimentar a validação de
  // e-mail duplicado do formulário compartilhado (`useClientEditForm`) — a
  // mesma regra de `app/clients.tsx`.
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [serviceDetailsExpanded, setServiceDetailsExpanded] = useState(false);
  // Estado de expandir/recolher independente do card "Todos os dados" — o
  // bloco "Datas agendadas" agora é um card próprio (RN: não compartilha
  // `serviceDetailsExpanded`).
  const [appointmentsExpanded, setAppointmentsExpanded] = useState(false);
  // Estado de expandir/recolher independente dos demais blocos (mesma regra
  // de "Datas agendadas" acima) — o bloco "Renovações" tem seu próprio
  // estado, não compartilha `appointmentsExpanded`/`serviceDetailsExpanded`.
  const [renewalsExpanded, setRenewalsExpanded] = useState(false);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [appointmentActionError, setAppointmentActionError] = useState("");
  const [contentInvalid, setContentInvalid] = useState(false);
  // Feedback visual de clique (padrão Nero): cada ação assíncrona expõe seu
  // próprio estado de pendência, setado de forma síncrona antes do `await` e
  // sempre resetado em `finally` — nunca deixa o botão preso em loading.
  const [addingNote, setAddingNote] = useState(false);
  // Exclusão em lista (anotações): rastreada por id, não por flag global.
  const [removingNoteId, setRemovingNoteId] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [renewModalVisible, setRenewModalVisible] = useState(false);
  const [renewSuccess, setRenewSuccess] = useState(false);
  const [policyFieldMenu, setPolicyFieldMenu] = useState<PolicyFieldKey | null>(null);
  const [appointmentMenuId, setAppointmentMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const [loadedClient, loadedNotes, loadedAppointments, loadedAllClients, loadedRenewals] = await Promise.all([
        clientPortfolioService.getClient(id),
        clientPortfolioService.listClientNotes(id),
        fetchClientAppointments(id),
        loadAllClients(clientPortfolioService),
        clientPortfolioService.listClientPolicyRenewals(id),
      ]);
      setClient(loadedClient);
      setNotes(loadedNotes);
      setAppointments(loadedAppointments);
      setAllClients(loadedAllClients);
      setRenewals(loadedRenewals);
    } catch {
      setError("Não foi possível carregar as anotações deste cliente.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Re-busca a cada foco da rota (não só na montagem): sem isto, uma mudança
  // de status feita na Agenda (concluir/cancelar) não aparecia aqui até
  // recarregar a página inteira, e vice-versa — Agenda e Perfil do Cliente
  // usam a mesma tabela/serviço (`appointmentService`), então só falta manter
  // as duas telas re-buscando ao focar.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function reloadAppointments() {
    if (!id) return;
    try {
      setAppointments(await fetchClientAppointments(id));
    } catch {
      setAppointmentActionError("Não foi possível atualizar a lista de agendamentos.");
    }
  }

  const statusActions = useAppointmentStatusActions({
    onChanged: reloadAppointments,
    onError: setAppointmentActionError,
  });

  const clientEditForm = useClientEditForm({
    providerPlan,
    existingClients: useMemo(() => allClients.map((item) => ({ id: item.id, email: item.email })), [allClients]),
    onSaved: async () => {
      setEditModalVisible(false);
      await load();
    },
  });

  function openEditModal() {
    if (!client) return;
    clientEditForm.loadForEdit(client);
    setEditModalVisible(true);
  }

  const clientRenewForm = useClientRenewForm({
    onRenewed: async () => {
      setRenewModalVisible(false);
      await load();
      setRenewSuccess(true);
    },
  });

  function openRenewModal() {
    if (!client) return;
    clientRenewForm.openForClient(client);
    setRenewModalVisible(true);
  }

  const sorted = useMemo(
    () => [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notes],
  );
  const sortedAppointments = useMemo(
    () => [...appointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [appointments],
  );
  // `listClientPolicyRenewals` já devolve mais recente primeiro
  // (`order("renewed_at", { ascending: false })`), mas ordena de novo aqui
  // por defesa — mesmo padrão de `sortedAppointments`/`sorted` (notas) desta
  // tela, que nunca confiam apenas na ordem devolvida pelo backend.
  const sortedRenewals = useMemo(
    () => [...renewals].sort((a, b) => b.renewedAt.localeCompare(a.renewedAt)),
    [renewals],
  );
  const appointmentsSummary = useMemo(() => {
    let completed = 0;
    let cancelled = 0;
    for (const appointment of sortedAppointments) {
      if (appointment.state === "completed") completed += 1;
      else if (appointment.state === "cancelled") cancelled += 1;
    }
    const total = sortedAppointments.length;
    return { total, completed, cancelled, remaining: total - completed };
  }, [sortedAppointments]);
  const menuAppointment = useMemo(
    () => sortedAppointments.find((appointment) => appointment.id === appointmentMenuId) ?? null,
    [sortedAppointments, appointmentMenuId],
  );
  async function add() {
    if (providerPlan === "free")
      return setError("Adicionar anotações está disponível no Plano Premium.");
    const clean = content.trim();
    if (clean.length < 3) {
      setContentInvalid(true);
      return setError("Escreva uma anotação com pelo menos 3 caracteres.");
    }
    if (clean.length > 2000) {
      setContentInvalid(true);
      return setError("A anotação deve ter no máximo 2.000 caracteres.");
    }
    setContentInvalid(false);
    setAddingNote(true);
    try {
      if (!id) return;
      const created = await clientPortfolioService.createClientNote({ clientId: id, content: clean });
      setNotes((current) => [created, ...current]);
      setContent("");
      setError("");
    } catch {
      setError("Não foi possível salvar a anotação. Tente novamente.");
    } finally {
      setAddingNote(false);
    }
  }
  async function removeNote(noteId: string) {
    setRemovingNoteId(noteId);
    try {
      await clientPortfolioService.deleteClientNote(noteId);
      setNotes((current) => current.filter((item) => item.id !== noteId));
    } catch {
      setError("Não foi possível excluir a anotação. Tente novamente.");
    } finally {
      setRemovingNoteId(null);
    }
  }
  if (!client)
    return (
      <SafeAreaView style={styles.safe}>
        <AuthenticatedHeader />
        {loading && <PageLoadingOverlay coverHeader={loadedFromBrowserReload} />}
        <View style={styles.notFound}>
          <AppIcon name="warning" size={40} color={colors.warning} />
          <Text style={styles.notFoundTitle}>{loading ? "Carregando cliente…" : "Cliente não encontrado"}</Text>
          {!loading && <Pressable
            onPress={() => router.replace("/clients")}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>Voltar para clientes</Text>
          </Pressable>}
        </View>
        <MobileTabBar />
      </SafeAreaView>
    );

  const policyRows: { key: PolicyFieldKey; label: string; value: string }[] = [
    { key: "totalLimit", label: "Limite total de aulas por cliente", value: client.bookingPolicy.totalBookingLimit?.toString() ?? "Livre" },
    { key: "dailyLimit", label: "Por dia", value: client.bookingPolicy.dailyBookingLimit?.toString() ?? "Livre" },
    {
      key: "period",
      label: "Período",
      value: client.bookingPolicy.requestWindowStart && client.bookingPolicy.requestWindowEnd
        ? `${client.bookingPolicy.requestWindowStart} a ${client.bookingPolicy.requestWindowEnd}`
        : "Livre",
    },
  ];

  const appointmentMenuItems: ActionsBottomSheetItem[] = !menuAppointment
    ? []
    : menuAppointment.state !== "cancelled" && menuAppointment.state !== "completed" && menuAppointment.state !== "no_show"
      ? [
          {
            key: "finalize",
            label: "Concluir",
            icon: "success",
            iconBackgroundColor: colors.brandSoft,
            iconColor: colors.brand,
            onPress: () => {
              statusActions.setFinalizeId(menuAppointment.id);
              setAppointmentMenuId(null);
            },
          },
          {
            key: "cancel",
            label: "Cancelar",
            icon: "error",
            iconBackgroundColor: colors.dangerSoft,
            iconColor: colors.danger,
            labelColor: colors.danger,
            onPress: () => {
              statusActions.openCancel(menuAppointment.id);
              setAppointmentMenuId(null);
            },
          },
        ]
      : [
          {
            key: "revert",
            label: "Reverter para agendado",
            icon: "schedule",
            iconBackgroundColor: colors.warningSoft,
            iconColor: colors.warning,
            onPress: () => {
              statusActions.setRevertId(menuAppointment.id);
              setAppointmentMenuId(null);
            },
          },
        ];

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <AppIcon name="back" size={16} color={colors.brand} />
            <Text style={styles.backText}>Clientes</Text>
          </Pressable>
          <View style={[styles.hero, !wide && styles.heroMobile]}>
            <View style={styles.avatar}>
              <AppIcon name="user" size={32} color={colors.brand} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>CLIENTE</Text>
              <Text style={styles.title}>{client.name}</Text>
              <Text style={styles.description}>
                {client.email} · {client.status === "active" ? "Ativo" : "Inativo"}
              </Text>
            </View>
            <View style={[styles.heroActions, !wide && styles.heroActionsMobile]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Editar perfil do cliente"
                onPress={openEditModal}
                style={[styles.secondary, !wide && styles.secondaryMobile]}
              >
                <AppIcon name="edit" size={16} color={colors.brand} />
                <Text style={styles.secondaryText}>Editar perfil</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Renovar pacote do cliente"
                onPress={openRenewModal}
                style={[styles.secondary, !wide && styles.secondaryMobile]}
              >
                <AppIcon name="renew" size={16} color={colors.brand} />
                <Text style={styles.secondaryText}>Renovar</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push("/clients")}
                style={[styles.secondary, !wide && styles.secondaryMobile]}
              >
                <AppIcon name="clients" size={16} color={colors.brand} />
                <Text style={styles.secondaryText}>Ver todos os clientes</Text>
              </Pressable>
            </View>
          </View>
          <View style={[styles.grid, wide && styles.gridWide]}>
            <View style={[styles.column, wide && styles.columnWide]}>
              <View style={[styles.card, wide ? styles.cardWide : styles.cardMobile]}>
                <Text style={styles.cardEyebrow}>SERVIÇO</Text>
                <Text style={styles.cardTitle}>{client.primaryService ?? "Sem serviço informado"}</Text>
                <Text style={styles.value}>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(client.serviceValueCents / 100)}</Text>
                {!wide && (
                  <Pressable
                    accessibilityLabel={serviceDetailsExpanded ? "Recolher dados do serviço" : "Mostrar dados do serviço"}
                    accessibilityState={{ expanded: serviceDetailsExpanded }}
                    onPress={() => setServiceDetailsExpanded((current) => !current)}
                    style={styles.serviceExpandButton}
                  >
                    <Text style={styles.serviceExpandButtonText}>
                      {serviceDetailsExpanded ? "Recolher" : "Mostrar dados"}
                    </Text>
                    <AppIcon
                      name={serviceDetailsExpanded ? "chevronUp" : "chevronDown"}
                      size={18}
                      color={colors.onBrand}
                    />
                  </Pressable>
                )}
                {(wide || serviceDetailsExpanded) && (
                  <View style={styles.infoRows}>
                    {policyRows.map((row) => (
                      <View key={row.key} style={styles.infoRow}>
                        <View style={[styles.infoRowCopy, !wide && styles.infoRowCopyMobile]}>
                          <Text style={styles.infoLabel}>{row.label}</Text>
                          <Text style={[styles.infoValue, !wide && styles.infoValueMobile]}>{row.value}</Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Mais ações para ${row.label}`}
                          onPress={() => setPolicyFieldMenu(row.key)}
                          style={styles.dotsButton}
                        >
                          <AppIcon name="dots" size={16} color={colors.muted} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={[styles.card, wide ? styles.cardWide : styles.cardMobile]}>
                <View style={styles.appointmentsHeader}>
                  <View>
                    <Text style={styles.cardEyebrow}>DATAS AGENDADAS</Text>
                    <Text style={styles.appointmentsTitle}>Agenda do cliente</Text>
                  </View>
                  <View style={styles.appointmentsHeaderActions}>
                    <View style={styles.count}>
                      <Text style={styles.countText}>{sortedAppointments.length}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryGridRow}>
                    <View style={styles.summaryChip}>
                      <Text style={styles.summaryChipValue}>{appointmentsSummary.total}</Text>
                      <Text style={styles.summaryChipLabel}>Total</Text>
                    </View>
                    <View style={styles.summaryChip}>
                      <Text style={styles.summaryChipValue}>{appointmentsSummary.completed}</Text>
                      <Text style={styles.summaryChipLabel}>Concluídos</Text>
                    </View>
                  </View>
                  <View style={styles.summaryGridRow}>
                    <View style={styles.summaryChip}>
                      <Text style={styles.summaryChipValue}>{appointmentsSummary.remaining}</Text>
                      <Text style={styles.summaryChipLabel}>Restantes</Text>
                    </View>
                    <View style={styles.summaryChip}>
                      <Text style={styles.summaryChipValue}>{appointmentsSummary.cancelled}</Text>
                      <Text style={styles.summaryChipLabel}>Cancelados</Text>
                    </View>
                  </View>
                </View>
                {!wide && (
                  <Pressable
                    accessibilityLabel={appointmentsExpanded ? "Recolher datas agendadas" : "Mostrar datas agendadas"}
                    accessibilityState={{ expanded: appointmentsExpanded }}
                    onPress={() => setAppointmentsExpanded((current) => !current)}
                    style={styles.serviceExpandButton}
                  >
                    <Text style={styles.serviceExpandButtonText}>
                      {appointmentsExpanded ? "Recolher" : "Mostrar agendamentos"}
                    </Text>
                    <AppIcon
                      name={appointmentsExpanded ? "chevronUp" : "chevronDown"}
                      size={18}
                      color={colors.onBrand}
                    />
                  </Pressable>
                )}
                {!!appointmentActionError && (
                  <View style={styles.error}>
                    <AppIcon name="warning" size={16} color={colors.danger} />
                    <Text style={styles.errorText}>{appointmentActionError}</Text>
                  </View>
                )}
                {(wide || appointmentsExpanded) && (
                  <View style={styles.appointmentsList}>
                    {sortedAppointments.map((appointment) => {
                      const startDate = new Date(appointment.startsAt);
                      const durationMs = (appointment.durationMinutes ?? 0) * 60 * 1000;
                      const endDate = durationMs > 0 ? new Date(startDate.getTime() + durationMs) : null;
                      const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: appointment.timezone }).format(startDate);
                      const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: appointment.timezone }).format(startDate).replace(".", "").toUpperCase();
                      const startTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: appointment.timezone }).format(startDate);
                      const time = endDate
                        ? `${startTime} às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: appointment.timezone }).format(endDate)}`
                        : startTime;

                      const { label: statusLabel, bg: statusBg, color: statusColor } =
                        getAppointmentStatusLabel(appointment.state, appointment.confirmationStatus);

                      return (
                        <View key={appointment.id} style={styles.appointmentItem}>
                          <View style={styles.appointmentDateBox}>
                            <Text style={styles.appointmentDateDay}>{day}</Text>
                            <Text style={styles.appointmentDateMonth}>{month}</Text>
                          </View>
                          <View style={styles.appointmentCopy}>
                            <Text style={styles.appointmentTime}>{time}</Text>
                            <Text style={styles.appointmentSubject} numberOfLines={2}>
                              {appointment.title?.trim() || appointment.serviceNameSnapshot || client.primaryService || "Atendimento"}
                            </Text>
                            <View style={[styles.appointmentStatusBadge, { backgroundColor: statusBg }]}>
                              <Text style={[styles.appointmentStatusText, { color: statusColor }]}>{statusLabel}</Text>
                            </View>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Mais ações para este agendamento"
                            onPress={() => setAppointmentMenuId(appointment.id)}
                            style={styles.dotsButton}
                          >
                            <AppIcon name="dots" size={16} color={colors.muted} />
                          </Pressable>
                        </View>
                      );
                    })}
                    {!sortedAppointments.length && (
                      <View style={styles.emptyAppointments}>
                        <AppIcon name="calendar" size={28} color={colors.mutedSoft} />
                        <Text style={styles.infoLabel}>Nenhuma data agendada para este cliente.</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
            <View style={[styles.notesColumn, wide && styles.notesColumnWide]}>
            <View style={[styles.notesCard, wide ? styles.notesCardWide : styles.cardMobile]}>
              <View style={styles.notesHeader}>
                <View>
                  <Text style={styles.cardEyebrow}>CASO E ANOTAÇÕES</Text>
                  <Text style={styles.cardTitle}>Histórico interno</Text>
                </View>
                <View style={styles.count}>
                  <Text style={styles.countText}>{notes.length}</Text>
                </View>
              </View>
              <Text style={styles.privateNotice}>
                Visível somente para o prestador. O cliente não recebe estas
                anotações.
              </Text>
              {providerPlan === "free" ? (
                <View style={styles.planNotice}>
                  <AppIcon name="lock" size={20} color={colors.brand} />
                  <View style={styles.planNoticeCopy}>
                    <Text style={[styles.planNoticeTitle, { textAlign: "center" }]}>Recurso Premium</Text>
                    <Text style={[styles.privateNotice, { textAlign: "center" }]}>
                      No Plano Gratuito, as anotações existentes continuam visíveis, mas não é possível adicionar novas.
                    </Text>
                  </View>
                  <Pressable onPress={() => router.push("/plans")} style={styles.upgradeButton}>
                    <Text style={styles.upgradeButtonText}>Ver planos</Text>
                  </Pressable>
                </View>
              ) : <>
              <TextInput
                value={content}
                onChangeText={(value) => { setContent(value); setContentInvalid(false); }}
                multiline
                numberOfLines={4}
                maxLength={2000}
                placeholder="Registre contexto, evolução ou informações importantes do caso"
                placeholderTextColor={colors.mutedSoft}
                style={[styles.notesInput, contentInvalid && styles.notesInputError]}
              />
              <View style={[styles.noteActions, !wide && styles.noteActionsMobile]}>
                <Text style={styles.counter}>{content.length}/2000</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: addingNote, busy: addingNote }}
                  disabled={addingNote}
                  onPress={() => void add()}
                  style={({ pressed }) => [
                    styles.primary,
                    !wide && styles.primaryMobile,
                    pressed && !addingNote && { opacity: opacity.pressed },
                  ]}
                >
                  {addingNote ? (
                    <ActivityIndicator size="small" color={colors.onBrand} />
                  ) : (
                    <AppIcon name="add" size={16} color={colors.onBrand} />
                  )}
                  <Text style={styles.primaryText}>Adicionar anotação</Text>
                </Pressable>
              </View>
              </>}
              {error ? (
                <View style={styles.error}>
                  <AppIcon name="warning" size={16} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
              <View style={styles.notes}>
                {sorted.map((note) => (
                  <View key={note.id} style={styles.note}>
                    <View style={styles.noteTop}>
                      <Text style={styles.noteAuthor}>{note.authorName} · Prestador</Text>
                      <Pressable
                        accessibilityLabel="Excluir anotação"
                        accessibilityState={{ disabled: removingNoteId === note.id, busy: removingNoteId === note.id }}
                        disabled={removingNoteId === note.id}
                        onPress={() => void removeNote(note.id)}
                        style={({ pressed }) => [
                          styles.delete,
                          pressed && removingNoteId !== note.id && { opacity: opacity.pressed },
                        ]}
                      >
                        {removingNoteId === note.id ? (
                          <ActivityIndicator size="small" color={colors.danger} />
                        ) : (
                          <AppIcon
                            name="delete"
                            size={16}
                            color={colors.danger}
                          />
                        )}
                      </Pressable>
                    </View>
                    <Text style={styles.noteContent}>{note.content}</Text>
                    <Text style={styles.noteDate}>
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(note.createdAt))}
                    </Text>
                  </View>
                ))}
                {!notes.length && (
                  <View style={styles.empty}>
                    <AppIcon name="file" size={32} color={colors.mutedSoft} />
                    <Text style={[styles.infoLabel, { textAlign: "center" }]}>
                      Nenhuma anotação registrada.
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <View style={[styles.card, wide ? styles.cardWide : styles.cardMobile]}>
              <View style={styles.notesHeader}>
                <View style={styles.notesHeaderTitle}>
                  <Text style={styles.cardEyebrow}>RENOVAÇÕES</Text>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    Histórico de renovações
                  </Text>
                </View>
                <View style={styles.count}>
                  <Text style={styles.countText}>{sortedRenewals.length}</Text>
                </View>
              </View>
              {!wide && (
                <Pressable
                  accessibilityLabel={renewalsExpanded ? "Recolher renovações" : "Mostrar renovações"}
                  accessibilityState={{ expanded: renewalsExpanded }}
                  onPress={() => setRenewalsExpanded((current) => !current)}
                  style={styles.serviceExpandButton}
                >
                  <Text style={styles.serviceExpandButtonText}>
                    {renewalsExpanded ? "Recolher" : "Mostrar renovações"}
                  </Text>
                  <AppIcon
                    name={renewalsExpanded ? "chevronUp" : "chevronDown"}
                    size={18}
                    color={colors.onBrand}
                  />
                </Pressable>
              )}
              {(wide || renewalsExpanded) && (
                <View style={styles.renewalsList}>
                  {sortedRenewals.map((renewal) => (
                    <View key={renewal.id} style={styles.renewalItem}>
                      <Text style={styles.renewalDate}>
                        Renovado em{" "}
                        {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(renewal.renewedAt))}
                      </Text>
                      <View style={styles.renewalRow}>
                        <Text style={styles.renewalLabel}>Quantidade de aulas</Text>
                        <Text style={styles.renewalValue}>
                          {renewal.totalBookingLimit?.toString() ?? "Livre"}
                        </Text>
                      </View>
                      <View style={styles.renewalRow}>
                        <Text style={styles.renewalLabel}>Valor do serviço</Text>
                        <Text style={styles.renewalValue}>
                          {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                            renewal.serviceValueCents / 100,
                          )}
                        </Text>
                      </View>
                      <View style={styles.renewalRow}>
                        <Text style={styles.renewalLabel}>Período</Text>
                        <Text style={styles.renewalValue}>
                          {renewal.requestWindowStart && renewal.requestWindowEnd
                            ? `${renewal.requestWindowStart} a ${renewal.requestWindowEnd}`
                            : "Livre"}
                        </Text>
                      </View>
                      <View style={[styles.renewalRow, styles.renewalRowLast]}>
                        <Text style={styles.renewalLabel}>Agendamentos do ciclo</Text>
                        <Text style={styles.renewalValue}>
                          {renewal.totalBookingLimit !== null
                            ? `${renewal.appointmentsUsed} de ${renewal.totalBookingLimit} usados`
                            : `${renewal.appointmentsUsed} agendamentos`}
                        </Text>
                      </View>
                    </View>
                  ))}
                  {!sortedRenewals.length && (
                    <View style={styles.empty}>
                      <AppIcon name="file" size={32} color={colors.mutedSoft} />
                      <Text style={[styles.infoLabel, { textAlign: "center" }]}>
                        Nenhuma renovação registrada ainda.
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
            </View>
          </View>
        </View>
      </ScrollView>
      <MobileTabBar />
      <ClientEditModal
        visible={editModalVisible}
        wide={wide}
        form={clientEditForm}
        onClose={() => setEditModalVisible(false)}
      />
      <ClientRenewModal
        visible={renewModalVisible}
        wide={wide}
        form={clientRenewForm}
        onClose={() => setRenewModalVisible(false)}
      />
      <Modal visible={renewSuccess} transparent animationType="fade" onRequestClose={() => setRenewSuccess(false)}>
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal accessibilityRole="alert" style={styles.feedbackModal}>
            <View style={[styles.feedbackModalIcon, styles.feedbackModalSuccess]}>
              <AppIcon name="success" size={32} color={colors.success} />
            </View>
            <Text accessibilityRole="header" style={styles.feedbackModalTitle}>
              Tudo certo!
            </Text>
            <Text style={styles.feedbackModalText}>
              Pacote renovado com sucesso. Os valores antigos foram arquivados no histórico e o contador de
              agendamentos foi zerado.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar mensagem"
              onPress={() => setRenewSuccess(false)}
              style={styles.feedbackModalButton}
            >
              <Text style={styles.feedbackModalButtonText}>Entendi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <AppointmentStatusActionModals actions={statusActions} />
      <ActionsBottomSheet
        visible={policyFieldMenu !== null}
        title={policyFieldMenu ? policyFieldTitles[policyFieldMenu] : undefined}
        onClose={() => setPolicyFieldMenu(null)}
        items={[
          {
            key: "edit",
            label: "Editar",
            icon: "edit",
            onPress: () => {
              setPolicyFieldMenu(null);
              openEditModal();
            },
          },
        ]}
      />
      <ActionsBottomSheet
        visible={appointmentMenuId !== null}
        title={menuAppointment?.title?.trim() || menuAppointment?.serviceNameSnapshot || client.primaryService || "Agendamento"}
        onClose={() => setAppointmentMenuId(null)}
        items={appointmentMenuItems}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1 },
  content: {
    width: "100%",
    maxWidth: layout.contentMax,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  contentMobile: { padding: spacing.md, paddingBottom: 96 },
  back: {
    alignSelf: "flex-start",
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  backText: { color: colors.brand, fontFamily: typography.family.semibold },
  hero: {
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandDark,
    ...elevation.card,
  },
  heroMobile: { alignItems: "flex-start", flexWrap: "wrap" },
  avatar: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  heroCopy: { flex: 1, minWidth: 180 },
  heroActions: { gap: spacing.sm },
  heroActionsMobile: { width: "100%" },
  eyebrow: {
    color: colors.accentSoft,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  title: {
    marginTop: spacing.xs,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 32,
  },
  description: {
    marginTop: spacing.xs,
    color: colors.accentSoft,
    fontFamily: typography.family.regular,
  },
  grid: { gap: spacing.md },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  column: { gap: spacing.md, width: "100%" },
  columnWide: { flex: 1 },
  card: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  cardWide: { width: "100%" },
  cardMobile: { padding: spacing.md, width: "100%" },
  serviceExpandButton: {
    width: "100%",
    minHeight: 48,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  serviceExpandButtonText: {
    flex: 1,
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
  },
  notesCard: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  // A largura de tela é assumida pelo wrapper `notesColumn`/`notesColumnWide`
  // (que agora agrupa notas + renovações no lado direito do grid); o card em
  // si só precisa preencher 100% do wrapper, não mais competir por `flex`
  // com o card de renovações empilhado logo abaixo.
  notesCardWide: { width: "100%" },
  notesColumn: { gap: spacing.md, width: "100%" },
  notesColumnWide: { flex: 1 },
  cardEyebrow: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1,
  },
  cardTitle: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  value: {
    marginTop: spacing.md,
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 28,
  },
  infoRows: { marginTop: spacing.lg, gap: spacing.sm },
  infoRow: {
    paddingVertical: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoRowCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  infoRowCopyMobile: { alignItems: "flex-start", flexDirection: "column", gap: spacing.xs },
  infoLabel: { color: colors.muted, fontFamily: typography.family.regular },
  infoValue: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    textAlign: "right",
  },
  infoValueMobile: { textAlign: "left" },
  dotsButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    flexShrink: 0,
  },
  appointmentsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  appointmentsHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  appointmentsTitle: {
    marginTop: spacing.xs,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  summaryGrid: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  summaryGridRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  summaryChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    gap: spacing.xxs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  summaryChipValue: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
  },
  summaryChipLabel: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  appointmentsList: { marginTop: spacing.md, gap: spacing.sm },
  appointmentItem: {
    minHeight: 64,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appointmentDateBox: {
    width: 48,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    flexShrink: 0,
  },
  appointmentDateDay: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 18,
    lineHeight: 20,
  },
  appointmentDateMonth: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 10,
    lineHeight: 12,
  },
  appointmentCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  appointmentTime: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  appointmentSubject: {
    marginTop: spacing.xxs,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  appointmentStatusBadge: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  appointmentStatusText: {
    fontFamily: typography.family.bold,
    fontSize: 10,
  },
  emptyAppointments: {
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  notesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  notesHeaderTitle: {
    flexShrink: 1,
  },
  count: {
    minWidth: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  countText: { color: colors.brand, fontFamily: typography.family.bold },
  privateNotice: {
    marginTop: spacing.md,
    padding: spacing.sm,
    color: colors.brand,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  notesInput: {
    minHeight: 112,
    marginTop: spacing.md,
    padding: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.regular,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  notesInputError: { borderColor: colors.danger },
  noteActions: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  noteActionsMobile: { alignItems: "stretch", flexDirection: "column" },
  counter: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  primary: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  primaryMobile: { width: "100%" },
  primaryText: { color: colors.onBrand, fontFamily: typography.family.bold },
  secondary: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  secondaryMobile: { width: "100%", justifyContent: "center" },
  secondaryText: { color: colors.brand, fontFamily: typography.family.bold },
  error: {
    flexShrink: 0,
    marginTop: spacing.md,
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
  notes: { marginTop: spacing.lg, gap: spacing.md },
  planNotice: {
    marginTop: spacing.md,
    padding: spacing.md,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  planNoticeCopy: {
    alignItems: "center",
    gap: spacing.xs,
  },
  planNoticeTitle: { color: colors.brandDark, fontFamily: typography.family.bold },
  upgradeButton: { minHeight: 40, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.brand },
  upgradeButtonText: { color: colors.onBrand, fontFamily: typography.family.bold },
  note: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  noteTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  noteAuthor: { color: colors.ink, fontFamily: typography.family.semibold },
  delete: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  noteContent: {
    marginTop: spacing.sm,
    color: colors.ink,
    fontFamily: typography.family.regular,
    lineHeight: typography.lineHeight.body,
  },
  noteDate: {
    marginTop: spacing.sm,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  empty: {
    padding: spacing.xl,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  notFoundTitle: { color: colors.ink },
  renewalsList: { marginTop: spacing.md, gap: spacing.sm },
  renewalItem: {
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  renewalDate: {
    marginBottom: spacing.xs,
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  renewalRow: {
    paddingVertical: spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  renewalRowLast: { borderBottomWidth: 0 },
  renewalLabel: { color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.caption },
  renewalValue: { color: colors.ink, fontFamily: typography.family.semibold, fontSize: typography.size.body },
  modalBackdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
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
});
