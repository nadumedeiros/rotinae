import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
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

import { AppIcon } from "@/src/components/ui/app-icon";
import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { PageLoadingOverlay } from "@/src/components/ui/page-loading-overlay";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { RowActionsMenu, useRowActionsMenu } from "@/src/components/ui/row-actions-menu";
import {
  resolveServiceErrorPresentation,
  type ServiceErrorContext,
} from "@/src/domain/services/service-error-presentation";
import { selectVisibleServices, type ServiceStatusFilter } from "@/src/domain/services/service-catalog-view";
import { validateServiceForm } from "@/src/domain/services/service-form-validation";
import { ServiceError, type Service } from "@/src/domain/services/types";
import { serviceCatalogService } from "@/src/infra/services/supabase-service-catalog-adapter";
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

type Feedback = {
  tone: "success" | "warning" | "error";
  message: string;
  action?: { label: string; onPress: () => void };
} | null;

const STATUS_FILTERS: ServiceStatusFilter[] = ["Todos", "Ativos", "Inativos"];
const DURATION_CHIPS = [15, 30, 45, 60, 90, 120];

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export default function ServicesScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ServiceStatusFilter>("Todos");
  const [statusPickerVisible, setStatusPickerVisible] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [page, setPage] = useState(1);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [durationInput, setDurationInput] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; duration?: string; value?: string }>({});
  const [formError, setFormError] = useState("");

  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmDeactivateTarget, setConfirmDeactivateTarget] = useState<Service | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  // Feedback visual de clique (padrão Nero): cada ação assíncrona expõe seu
  // próprio estado de pendência, setado de forma síncrona antes do `await` e
  // sempre resetado em `finally` — nunca deixa o botão preso em loading.
  const [savingService, setSavingService] = useState(false);
  const [mobileActionService, setMobileActionService] = useState<Service | null>(null);
  const rowActionsMenu = useRowActionsMenu<Service>();

  // BLG-075/BLG-076: mesma trava já usada em `app/clients.tsx` para evitar
  // que `useFocusEffect` e o listener de `AppState` disparem `loadServices`
  // simultaneamente e amplifiquem uma falha persistente do backend.
  const loadingServicesRef = useRef(false);
  const [initialLoading, setInitialLoading] = useState(true);
  // Suporta abertura automática do modal de novo serviço quando a tela é
  // acessada pelo botão "Novo serviço" do menu rápido da tab bar mobile
  // (`/services?openCreate=1`) — sem esse parâmetro o comportamento de
  // navegação permanece inalterado.
  const { openCreate } = useLocalSearchParams<{ openCreate?: string }>();
  const openCreateHandledRef = useRef(false);

  const loadServices = useCallback(async () => {
    if (loadingServicesRef.current) return;
    loadingServicesRef.current = true;
    try {
      let loaded = await serviceCatalogService.listServices();
      if (loaded.length === 0) {
        try {
          const autoCreated = await serviceCatalogService.createService({
            name: "Atendimento",
            durationMinutes: 60,
            referenceValueCents: 0,
          });
          loaded = [autoCreated];
        } catch {
          // Segue com array vazio se falhar
        }
      }
      setServices(loaded);
    } catch (loadError) {
      console.error("[services] loadServices falhou", loadError);
      setFeedback({ tone: "error", message: "Não foi possível carregar os serviços." });
    } finally {
      loadingServicesRef.current = false;
      setInitialLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadServices();
    }, [loadServices]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void loadServices();
    });
    return () => subscription.remove();
  }, [loadServices]);

  useEffect(() => {
    if (openCreate !== "1" || openCreateHandledRef.current || initialLoading) return;
    openCreateHandledRef.current = true;
    openNewService();
    // Remove o parâmetro para não reabrir o modal em focos futuros da tela.
    router.setParams({ openCreate: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate, initialLoading]);

  const visibleServices = useMemo(() => selectVisibleServices(services, filter, query), [services, filter, query]);
  const pageSize = wide ? 10 : 5;
  const totalPages = Math.max(1, Math.ceil(visibleServices.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedServices = useMemo(
    () => visibleServices.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, pageSize, visibleServices],
  );

  useEffect(() => setPage(1), [filter, query, pageSize]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const activeServices = useMemo(() => services.filter((service) => service.status === "active"), [services]);
  const editingService = useMemo(
    () => (editingId ? (services.find((service) => service.id === editingId) ?? null) : null),
    [services, editingId],
  );

  function openNewService() {
    setEditingId(null);
    setName("");
    setDurationInput("");
    setValueInput("");
    setFieldErrors({});
    setFormError("");
    setModalVisible(true);
  }

  function editService(service: Service) {
    setEditingId(service.id);
    setName(service.name);
    setDurationInput(String(service.durationMinutes));
    setValueInput((service.referenceValueCents / 100).toFixed(2).replace(".", ","));
    setFieldErrors({});
    setFormError("");
    setModalVisible(true);
  }

  function handleServiceError(error: unknown, context: ServiceErrorContext, targetService?: Service) {
    const code = error instanceof ServiceError ? error.code : "UNKNOWN";
    const message = error instanceof Error ? error.message : "Não foi possível concluir agora. Tente novamente.";

    // Edge case (Dante, seção 3.5): conflito de nome ao REATIVAR — o único
    // caminho de recuperação é renomear o próprio serviço; oferecer o atalho
    // direto para o modal de edição em vez de um erro sem saída (Nielsen #9).
    if (context === "inline-action" && code === "SERVICE_NAME_CONFLICT" && targetService) {
      setFeedback({
        tone: "warning",
        message: `Já existe um serviço ativo chamado "${targetService.name}". Renomeie este serviço antes de reativá-lo.`,
        action: {
          label: "Renomear agora",
          onPress: () => {
            setFeedback(null);
            editService(targetService);
          },
        },
      });
      return;
    }

    const presentation = resolveServiceErrorPresentation(code, message, context);
    if (presentation.kind === "field") {
      setFieldErrors((current) => ({ ...current, [presentation.field]: presentation.message }));
      setFormError("Confira os campos destacados abaixo.");
      return;
    }
    if (presentation.kind === "banner") {
      setFormError(presentation.message);
      return;
    }
    setFeedback({ tone: presentation.tone, message: presentation.message });
    if (presentation.reload) {
      setModalVisible(false);
      void loadServices();
    }
  }

  async function saveService() {
    const result = validateServiceForm(
      { name, durationMinutesInput: durationInput, valueInput },
      activeServices,
      editingId ?? undefined,
    );
    if (!result.valid) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
      return;
    }
    setFieldErrors({});
    setFormError("");
    setSavingService(true);
    try {
      if (editingId) {
        await serviceCatalogService.updateService({ id: editingId, ...result.payload });
      } else {
        await serviceCatalogService.createService(result.payload);
      }
      await loadServices();
      setModalVisible(false);
      setFeedback({
        tone: "success",
        message: editingId ? "Serviço atualizado com sucesso." : "Serviço cadastrado com sucesso.",
      });
    } catch (saveError) {
      console.error("[services] saveService falhou", saveError);
      handleServiceError(saveError, "form");
    } finally {
      setSavingService(false);
    }
  }

  async function handleActivate(service: Service) {
    setSavingStatusId(service.id);
    try {
      await serviceCatalogService.activateService(service.id);
      await loadServices();
      setFeedback({ tone: "success", message: `${service.name} reativado com sucesso.` });
    } catch (activateError) {
      console.error("[services] activateService falhou", activateError);
      handleServiceError(activateError, "inline-action", service);
    } finally {
      setSavingStatusId(null);
    }
  }

  async function confirmDeactivate() {
    if (!confirmDeactivateTarget) return;
    const target = confirmDeactivateTarget;
    setSavingStatusId(target.id);
    try {
      await serviceCatalogService.deactivateService(target.id);
      await loadServices();
      setConfirmDeactivateTarget(null);
      setModalVisible(false);
      setFeedback({ tone: "success", message: `${target.name} desativado com sucesso.` });
    } catch (deactivateError) {
      console.error("[services] deactivateService falhou", deactivateError);
      setConfirmDeactivateTarget(null);
      handleServiceError(deactivateError, "inline-action", target);
    } finally {
      setSavingStatusId(null);
    }
  }

  function toggleStatus(service: Service) {
    if (service.status === "active") {
      setConfirmDeactivateTarget(service);
    } else {
      void handleActivate(service);
    }
  }

  const catalogIsEmpty = services.length === 0;
  const filteredIsEmpty = visibleServices.length === 0;

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {initialLoading && <PageLoadingOverlay />}

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View style={[styles.pageHeading, wide && styles.pageHeadingWide]}>
            <View style={styles.headingCopy}>
              <Text style={styles.eyebrow}>CATÁLOGO</Text>
              <Text accessibilityRole="header" style={[styles.title, !wide && styles.titleMobile]}>
                Serviços
              </Text>
              <Text style={styles.description}>
                Cadastre os serviços que você oferece e mantenha valores e durações sempre atualizados.
              </Text>
            </View>
            {!catalogIsEmpty && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cadastrar novo serviço"
                onPress={openNewService}
                style={styles.primaryButton}
              >
                <AppIcon name="add" size={20} color={colors.onBrand} />
                <Text style={styles.primaryButtonText}>Novo serviço</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.directory}>
            <View style={[styles.toolbar, !wide && styles.toolbarMobile]}>
              <View style={styles.searchBox}>
                <AppIcon name="search" size={20} color={colors.mutedSoft} />
                <TextInput
                  accessibilityLabel="Buscar serviço por nome"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar serviço por nome"
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
                  <Text style={styles.statusFilterValue}>
                    {filter === "Ativos" ? "Ativo" : filter === "Inativos" ? "Inativo" : "Todos"}
                  </Text>
                </View>
                <AppIcon name="forward" size={16} color={colors.mutedSoft} />
              </Pressable>
            </View>

            {wide && !catalogIsEmpty && (
              <View style={styles.tableHeader}>
                <Text style={[styles.columnTitle, styles.serviceNameColumn]}>SERVIÇO</Text>
                <Text style={[styles.columnTitle, styles.durationColumn]}>DURAÇÃO</Text>
                <Text style={[styles.columnTitle, styles.statusColumn]}>STATUS</Text>
                <View style={styles.actionColumn} />
              </View>
            )}

            {!catalogIsEmpty && (
              <View style={[styles.serviceList, !wide && styles.serviceListMobile]}>
                {paginatedServices.map((service) => (
                  <View key={service.id} style={[styles.serviceRow, !wide && styles.serviceCard]}>
                    {wide ? (
                      <>
                        <View style={styles.serviceNameColumn}>
                          <Text style={styles.serviceName}>{service.name}</Text>
                        </View>
                        <Text style={[styles.cellText, styles.durationColumn]}>{service.durationMinutes} min</Text>
                        <View style={styles.statusColumn}>
                          <StatusBadge status={service.status} />
                        </View>
                        <View style={styles.actionColumn}>
                          {/* Mesmas opções do menu do mobile, só que como o
                              painel flutuante do desktop (igual ao menu de
                              perfil/notificações do cabeçalho) — mobile
                              continua com seu próprio bottom-sheet, inalterado. */}
                          <Pressable
                            accessibilityLabel={`Opções de ${service.name}`}
                            onPress={(event) => rowActionsMenu.open(service, event)}
                            style={styles.dotsButton}
                          >
                            <AppIcon name="dots" size={18} color={colors.muted} />
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <>
                        <View style={styles.mobileCardTop}>
                          <View style={styles.mobileCardTopCopy}>
                            <Text style={styles.serviceName}>{service.name}</Text>
                            <Text style={[styles.metaValue, { marginTop: spacing.xxs }]}>
                              {service.durationMinutes} min
                            </Text>
                          </View>
                          <Pressable
                            accessibilityLabel={`Opções de ${service.name}`}
                            onPress={() => setMobileActionService(service)}
                            style={styles.dotsButton}
                          >
                            <AppIcon name="dots" size={18} color={colors.muted} />
                          </Pressable>
                        </View>
                        <View style={styles.cardDivider} />
                        <View style={styles.cardStatusDotsRow}>
                          <StatusBadge status={service.status} />
                        </View>
                      </>
                    )}
                  </View>
                ))}
                {filteredIsEmpty && (
                  <View style={styles.empty}>
                    <AppIcon name="search" size={32} color={colors.mutedSoft} />
                    <Text style={styles.emptyTitle}>Nenhum serviço encontrado</Text>
                    <Text style={styles.emptyText}>Tente alterar a busca ou o filtro selecionado.</Text>
                  </View>
                )}
              </View>
            )}

            {!catalogIsEmpty && !filteredIsEmpty && (
              <View style={[styles.pagination, !wide && styles.paginationMobile]}>
                <Text style={styles.paginationInfo}>
                  {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, visibleServices.length)} de {visibleServices.length}
                </Text>
                <View style={styles.paginationActions}>
                  <Pressable
                    accessibilityLabel="Página anterior"
                    disabled={currentPage === 1}
                    onPress={() => setPage((value) => Math.max(1, value - 1))}
                    style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
                  >
                    <AppIcon name="back" size={16} color={currentPage === 1 ? colors.mutedSoft : colors.brand} />
                  </Pressable>
                  <Text style={styles.pageText}>{currentPage} de {totalPages}</Text>
                  <Pressable
                    accessibilityLabel="Próxima página"
                    disabled={currentPage === totalPages}
                    onPress={() => setPage((value) => Math.min(totalPages, value + 1))}
                    style={[styles.pageButton, currentPage === totalPages && styles.pageButtonDisabled]}
                  >
                    <AppIcon name="forward" size={16} color={currentPage === totalPages ? colors.mutedSoft : colors.brand} />
                  </Pressable>
                </View>
              </View>
            )}

            {catalogIsEmpty && (
              <View style={styles.criticalEmpty}>
                <AppIcon name="services" size={32} color={colors.brand} />
                <Text style={styles.emptyTitle}>Nenhum serviço cadastrado ainda</Text>
                <Text style={[styles.emptyText, styles.criticalEmptyText]}>
                  Cadastre pelo menos um serviço para poder criar agendamentos — sem um serviço ativo, você e seus
                  clientes não conseguem agendar.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cadastrar primeiro serviço"
                  onPress={openNewService}
                  style={styles.primaryButton}
                >
                  <AppIcon name="add" size={20} color={colors.onBrand} />
                  <Text style={styles.primaryButtonText}>Cadastrar primeiro serviço</Text>
                </Pressable>
              </View>
            )}
          </View>

          {Platform.OS === "web" && (
            <View style={[styles.footer, !wide && styles.footerMobile]}>
              <Text style={styles.footerBrand}>
                rotina<Text style={styles.accent}>ê</Text>
              </Text>
              <Text style={styles.footerText}>
                © {new Date().getFullYear()} Rotinaê. Todos os direitos reservados.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={statusPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusPickerVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setStatusPickerVisible(false)}>
          <Pressable accessibilityViewIsModal style={styles.statusPickerModal} onPress={() => undefined}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text accessibilityRole="header" style={styles.modalTitle}>Filtrar por status</Text>
                <Text style={styles.modalSubtitle}>Escolha quais serviços deseja visualizar.</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar filtro de status"
                onPress={() => setStatusPickerVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.statusPickerOptions}>
              {STATUS_FILTERS.map((item) => {
                const selected = filter === item;
                const label = item === "Ativos" ? "Ativo" : item === "Inativos" ? "Inativo" : item;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={item}
                    onPress={() => {
                      setFilter(item);
                      setStatusPickerVisible(false);
                    }}
                    style={[styles.statusPickerOption, selected && styles.statusPickerOptionActive]}
                  >
                    <Text style={[styles.statusPickerOptionText, selected && styles.statusPickerOptionTextActive]}>
                      {label}
                    </Text>
                    {selected && <AppIcon name="success" size={18} color={colors.onBrand} />}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        >
          <View accessibilityViewIsModal style={[styles.modalCard, !wide && styles.modalCardMobile]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text accessibilityRole="header" style={styles.modalTitle}>
                  {editingId ? "Editar serviço" : "Novo serviço"}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {editingId ? "Atualize os dados deste serviço." : "Preencha os dados do serviço que você oferece."}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar formulário"
                onPress={() => setModalVisible(false)}
                style={styles.closeButton}
              >
                <AppIcon name="error" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {editingId && editingService && (
              <View style={styles.statusInfoRow}>
                <Text style={styles.fieldLabel}>Status atual:</Text>
                <StatusBadge status={editingService.status} />
              </View>
            )}

            <ScrollView
              style={styles.formScroll}
              contentContainerStyle={styles.form}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Nome do serviço<Text style={styles.requiredMark}> *</Text>
                </Text>
                <TextInput
                  accessibilityLabel="Nome do serviço"
                  autoFocus
                  value={name}
                  maxLength={60}
                  onChangeText={(value) => {
                    setName(value);
                    setFieldErrors((current) => ({ ...current, name: undefined }));
                  }}
                  placeholder="Ex.: Sessão avulsa 50min"
                  placeholderTextColor={colors.mutedSoft}
                  style={[styles.fieldInput, !!fieldErrors.name && styles.fieldInputError]}
                />
                {!!fieldErrors.name && (
                  <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                    {fieldErrors.name}
                  </Text>
                )}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Duração<Text style={styles.requiredMark}> *</Text>
                </Text>
                <View style={[styles.currencyField, !!fieldErrors.duration && styles.fieldInputError]}>
                  <TextInput
                    accessibilityLabel="Duração em minutos"
                    value={durationInput}
                    onChangeText={(value) => {
                      setDurationInput(value.replace(/[^\d]/g, ""));
                      setFieldErrors((current) => ({ ...current, duration: undefined }));
                    }}
                    keyboardType="number-pad"
                    placeholder="45"
                    placeholderTextColor={colors.mutedSoft}
                    style={styles.currencyInput}
                  />
                  <Text style={styles.currencyPrefix}>min</Text>
                </View>
                <View style={styles.serviceOptions}>
                  {DURATION_CHIPS.map((minutes) => (
                    <Pressable
                      key={minutes}
                      onPress={() => {
                        setDurationInput(String(minutes));
                        setFieldErrors((current) => ({ ...current, duration: undefined }));
                      }}
                      style={[
                        styles.serviceOption,
                        durationInput === String(minutes) && styles.serviceOptionActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.serviceOptionText,
                          durationInput === String(minutes) && styles.serviceOptionTextActive,
                        ]}
                      >
                        {minutes} min
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {!!fieldErrors.duration && (
                  <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                    {fieldErrors.duration}
                  </Text>
                )}
              </View>

              {formError ? (
                <View accessibilityRole="alert" style={styles.formError}>
                  <AppIcon name="warning" size={16} color={colors.danger} />
                  <Text style={styles.formErrorText}>{formError}</Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={[styles.modalActions, !wide && styles.modalActionsMobile]}>
              {editingId && editingService ? (
                editingService.status === "active" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Desativar serviço"
                    disabled={savingService}
                    onPress={() => setConfirmDeactivateTarget(editingService)}
                    style={[styles.deleteButton, savingService && { opacity: opacity.disabled }]}
                  >
                    <AppIcon name="warning" size={16} color={colors.danger} />
                    <Text style={styles.deleteButtonText}>Desativar serviço</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Reativar serviço"
                    accessibilityState={{ disabled: savingStatusId === editingService.id || savingService, busy: savingStatusId === editingService.id }}
                    disabled={savingStatusId === editingService.id || savingService}
                    onPress={() => void handleActivate(editingService)}
                    style={({ pressed }) => [
                      styles.reactivateButton,
                      savingService && { opacity: opacity.disabled },
                      pressed && savingStatusId !== editingService.id && !savingService && { opacity: opacity.pressed },
                    ]}
                  >
                    {savingStatusId === editingService.id ? (
                      <ActivityIndicator size="small" color={colors.success} />
                    ) : (
                      <AppIcon name="success" size={16} color={colors.success} />
                    )}
                    <Text style={styles.reactivateButtonText}>Reativar serviço</Text>
                  </Pressable>
                )
              ) : (
                <View />
              )}
              <View style={styles.modalActionGroup}>
                <Pressable
                  accessibilityRole="button"
                  disabled={savingService}
                  onPress={() => setModalVisible(false)}
                  style={[styles.cancelButton, styles.formActionButton, savingService && { opacity: opacity.disabled }]}
                >
                  <Text style={styles.cancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: savingService, busy: savingService }}
                  disabled={savingService}
                  onPress={() => void saveService()}
                  style={({ pressed }) => [styles.saveButton, styles.formActionButton, pressed && !savingService && { opacity: opacity.pressed }]}
                >
                  {savingService && <ActivityIndicator size="small" color={colors.onBrand} />}
                  <Text style={styles.saveButtonText}>Salvar</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!confirmDeactivateTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDeactivateTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.confirmCard}>
            <View style={styles.confirmIcon}>
              <AppIcon name="warning" size={24} color={colors.danger} />
            </View>
            <Text accessibilityRole="header" style={styles.confirmTitle}>
              Desativar {confirmDeactivateTarget?.name}?
            </Text>
            <Text style={styles.confirmText}>
              Ele deixará de aparecer para novos agendamentos — seus e de clientes. Agendamentos já criados com este
              serviço não são afetados.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                disabled={savingStatusId === confirmDeactivateTarget?.id}
                onPress={() => setConfirmDeactivateTarget(null)}
                style={[
                  styles.cancelButton,
                  styles.formActionButton,
                  savingStatusId === confirmDeactivateTarget?.id && { opacity: opacity.disabled },
                ]}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: savingStatusId === confirmDeactivateTarget?.id,
                  busy: savingStatusId === confirmDeactivateTarget?.id,
                }}
                disabled={savingStatusId === confirmDeactivateTarget?.id}
                onPress={() => void confirmDeactivate()}
                style={({ pressed }) => [
                  styles.confirmDeleteButton,
                  styles.formActionButton,
                  pressed && savingStatusId !== confirmDeactivateTarget?.id && { opacity: opacity.pressed },
                ]}
              >
                {savingStatusId === confirmDeactivateTarget?.id && (
                  <ActivityIndicator size="small" color={colors.onBrand} />
                )}
                <Text style={styles.confirmDeleteText}>Desativar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!feedback} transparent animationType="fade" onRequestClose={() => setFeedback(null)}>
        <View style={styles.modalBackdrop}>
          {feedback && (
            <View accessibilityViewIsModal accessibilityRole="alert" style={styles.feedbackModal}>
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
                  name={feedback.tone === "success" ? "success" : feedback.tone === "warning" ? "warning" : "error"}
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
              <Text accessibilityRole="header" style={styles.feedbackModalTitle}>
                {feedback.tone === "success" ? "Tudo certo!" : feedback.tone === "warning" ? "Atenção" : "Não foi possível concluir"}
              </Text>
              <Text style={styles.feedbackModalText}>{feedback.message}</Text>
              {feedback.action && (
                <Pressable accessibilityRole="button" onPress={feedback.action.onPress}>
                  <Text style={styles.feedbackModalLink}>{feedback.action.label}</Text>
                </Pressable>
              )}
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
                  key: "edit",
                  label: "Editar serviço",
                  icon: "edit",
                  disabled: savingStatusId === rowActionsMenu.item.id,
                  onPress: () => editService(rowActionsMenu.item!),
                },
                {
                  key: "toggle",
                  label:
                    rowActionsMenu.item.status === "active"
                      ? "Desativar serviço"
                      : "Ativar serviço",
                  icon: rowActionsMenu.item.status === "active" ? "warning" : "success",
                  iconBackgroundColor:
                    rowActionsMenu.item.status === "active" ? colors.dangerSoft : colors.successSoft,
                  iconColor: rowActionsMenu.item.status === "active" ? colors.danger : colors.success,
                  labelColor: rowActionsMenu.item.status === "active" ? colors.danger : undefined,
                  disabled: savingStatusId === rowActionsMenu.item.id,
                  onPress: () => toggleStatus(rowActionsMenu.item!),
                },
              ]
            : []
        }
      />

      {/* ─── Modal de ações rápidas (mobile bottom-sheet) ─── */}
      {mobileActionService !== null && (
      <Modal
        visible
        transparent
        animationType="slide"
        onRequestClose={() => setMobileActionService(null)}
      >
        <Pressable
          style={styles.mobileActionsBackdrop}
          onPress={() => setMobileActionService(null)}
        >
          <Pressable style={styles.mobileActionsSheet} onPress={() => {}}>
            <View style={styles.mobileActionsHandle} />
            <Text style={styles.mobileActionsTitle} numberOfLines={1}>
              {mobileActionService?.name ?? ""}
            </Text>

            {/* Editar serviço */}
            <Pressable
              style={styles.mobileActionRow}
              onPress={() => {
                const service = mobileActionService;
                setMobileActionService(null);
                if (service) editService(service);
              }}
            >
              <View style={[styles.mobileActionIcon, { backgroundColor: colors.brandSoft }]}>
                <AppIcon name="edit" size={18} color={colors.brand} />
              </View>
              <Text style={styles.mobileActionLabel}>Editar serviço</Text>
            </Pressable>

            {/* Ativar / Desativar */}
            {mobileActionService && (
              <Pressable
                style={styles.mobileActionRow}
                disabled={savingStatusId === mobileActionService.id}
                onPress={() => {
                  const service = mobileActionService;
                  setMobileActionService(null);
                  toggleStatus(service);
                }}
              >
                <View
                  style={[
                    styles.mobileActionIcon,
                    {
                      backgroundColor:
                        mobileActionService.status === "active"
                          ? colors.dangerSoft
                          : colors.successSoft,
                    },
                  ]}
                >
                  <AppIcon
                    name={mobileActionService.status === "active" ? "warning" : "success"}
                    size={18}
                    color={mobileActionService.status === "active" ? colors.danger : colors.success}
                  />
                </View>
                <Text
                  style={[
                    styles.mobileActionLabel,
                    mobileActionService.status === "active" && { color: colors.danger },
                  ]}
                >
                  {mobileActionService.status === "active" ? "Desativar serviço" : "Ativar serviço"}
                </Text>
              </Pressable>
            )}

            {/* Fechar */}
            <Pressable
              style={[styles.mobileActionRow, styles.mobileActionClose]}
              onPress={() => setMobileActionService(null)}
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

function StatusBadge({ status }: { status: Service["status"] }) {
  const active = status === "active";
  return (
    <View style={[styles.status, active ? styles.statusActive : styles.statusInactive]}>
      <Text style={[styles.statusText, active ? styles.statusTextActive : styles.statusTextInactive]}>
        {active ? "Ativo" : "Inativo"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
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
    maxWidth: 480,
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
    minWidth: 152,
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
  statusFilterLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
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
  serviceList: {},
  serviceListMobile: { gap: 0 },
  serviceNameColumn: { flex: 2.2 },
  durationColumn: { flex: 1 },
  valueColumn: { flex: 1.1 },
  statusColumn: { flex: 0.9 },
  actionColumn: {
    minWidth: 190,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  serviceRow: {
    minHeight: 80,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  serviceCard: {
    minHeight: 116,
    margin: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: "stretch",
    flexDirection: "column",
    borderWidth: 0,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderRadius: 0,
    backgroundColor: colors.surface,
  },
  serviceName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.bodyLarge,
  },
  cellText: {
    color: colors.muted,
    fontFamily: typography.family.regular,
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
  rowToggleButton: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.sm,
  },
  rowToggleText: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  // Nomeado pela ação disponibilizada ao usuário, não pelo status atual do
  // serviço: um serviço ATIVO oferece a ação de DESATIVAR (fundo de aviso) e
  // um serviço INATIVO oferece a ação de ATIVAR (fundo de sucesso).
  rowToggleButtonDeactivate: { backgroundColor: colors.dangerSoft },
  rowToggleButtonActivate: { backgroundColor: colors.successSoft },
  rowToggleTextDeactivate: { color: colors.danger },
  rowToggleTextActivate: { color: colors.success },
  dotsButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  mobileCardTop: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  mobileCardTopCopy: { flex: 1, minWidth: 0 },
  cardDivider: {
    height: 0,
    marginVertical: spacing.xs,
    backgroundColor: "transparent",
  },
  metaValue: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  cardStatusDotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardActionsRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
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
    minHeight: 0,
    padding: spacing.sm,
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
  pageButtonDisabled: {
    borderColor: colors.border,
    opacity: 0.6,
  },
  pageText: {
    minWidth: 56,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
    textAlign: "center",
  },
  empty: {
    padding: spacing.xxl,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
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
  criticalEmpty: {
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
  criticalEmptyText: { maxWidth: 420, marginTop: spacing.xs, marginBottom: spacing.sm },
  footer: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerMobile: { flexDirection: "column", alignItems: "flex-start", gap: spacing.xs },
  footerBrand: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  accent: { color: colors.brand },
  footerText: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
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
  statusPickerOptions: { marginTop: spacing.lg, gap: spacing.sm },
  statusPickerOption: {
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
  statusPickerOptionActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  statusPickerOptionText: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
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
  statusInfoRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  formScroll: { flexShrink: 1 },
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
  fieldHelper: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  currencyField: {
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
  currencyPrefix: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
    flexShrink: 0,
  },
  currencyInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    outlineStyle: "none",
  } as never,
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
    flexShrink: 1,
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
  reactivateButton: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.successSoft,
  },
  reactivateButtonText: {
    color: colors.success,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
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
  feedbackModalLink: {
    marginTop: spacing.sm,
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
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
  statusText: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  statusTextActive: { color: colors.success },
  statusTextInactive: { color: colors.muted },
});
