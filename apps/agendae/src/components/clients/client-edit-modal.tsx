import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "@/src/components/ui/app-icon";
import { CurrencyInput } from "@/src/components/ui/currency-input";
import { DatePickerField } from "@/src/components/ui/date-picker-field";
import { formatDateInput, formatPhoneInput } from "@/src/domain/clients/client-form-utils";
import type { Service } from "@/src/domain/services/types";
import type { ClientEditForm, ClientEditFormStatus } from "@/src/hooks/use-client-edit-form";
import { serviceCatalogService } from "@/src/infra/services/supabase-service-catalog-adapter";
import { colors, elevation, opacity, radius, spacing, typography } from "@/src/theme/tokens";

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

/**
 * Modal de cadastro/edição de cliente (dados básicos + política de
 * agendamento).
 *
 * Extraído de `app/clients.tsx` para ser reaproveitado também pelo botão
 * "Editar perfil" e pelos menus de edição inline do Perfil do Cliente
 * (`app/clients/[id].tsx`) — mesmo visual e mesma lógica de validação
 * (`useClientEditForm`) nas duas telas.
 */
export function ClientEditModal({
  visible,
  wide,
  form,
  onClose,
  onRequestDelete,
}: {
  visible: boolean;
  wide: boolean;
  form: ClientEditForm;
  onClose: () => void;
  /** Quando informado, exibe o botão "Excluir cliente" (só faz sentido em edição). */
  onRequestDelete?: () => void;
}) {
  // Catálogo de serviços ativos do tenant (RN-SRV-010: sem paginação, mesma
  // fonte usada em `app/agenda.tsx`/`app/payments.tsx`). Recarrega sempre que
  // o modal abre — o Stack de navegação não desmonta a tela por trás ao ir
  // para `/services` e voltar, então o catálogo pode ter mudado desde a
  // última abertura.
  const [services, setServices] = useState<Service[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [servicePickerVisible, setServicePickerVisible] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");

  useEffect(() => {
    if (!visible) {
      // Evita reabrir o picker de serviço "fantasma" (aberto quando o
      // formulário de cliente foi fechado, ex.: botão voltar do Android)
      // na próxima vez que este modal for exibido.
      setServicePickerVisible(false);
      return;
    }
    let cancelled = false;
    setLoadingServices(true);
    serviceCatalogService
      .listServices({ status: "active" })
      .then((loaded) => {
        if (!cancelled) setServices(loaded);
      })
      .catch(() => {
        // Falha silenciosa (ex.: offline): o formulário de cliente não pode
        // travar por causa do catálogo — o prestador ainda consegue salvar
        // os demais campos; o seletor só fica temporariamente vazio.
        if (!cancelled) setServices([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingServices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const filteredServices = useMemo(
    () =>
      services.filter((item) =>
        item.name.toLocaleLowerCase("pt-BR").includes(serviceQuery.trim().toLocaleLowerCase("pt-BR")),
      ),
    [services, serviceQuery],
  );

  // Resolve o serviço selecionado por id (fonte principal) e, na ausência
  // dele, por correspondência de nome — cobre cadastros anteriores ao
  // catálogo existir, cujo `primaryService` é texto livre sem
  // `primaryServiceId` equivalente ainda.
  const selectedService = useMemo(() => {
    const byId = services.find((item) => item.id === form.primaryServiceId);
    if (byId) return byId;
    if (!form.service.trim()) return undefined;
    return services.find(
      (item) => item.name.trim().toLocaleLowerCase("pt-BR") === form.service.trim().toLocaleLowerCase("pt-BR"),
    );
  }, [services, form.primaryServiceId, form.service]);

  function selectService(item: Service) {
    form.setService(item.name);
    form.setPrimaryServiceId(item.id);
    form.setServiceValueCents(item.referenceValueCents);
    form.setFieldErrors((current) => ({ ...current, serviceValue: undefined }));
    setServicePickerVisible(false);
  }

  return (
    <>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
      >
        <View accessibilityViewIsModal style={[styles.modalCard, !wide && styles.modalCardMobile]}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                {form.editingId ? "Editar cliente" : "Novo cliente"}
              </Text>
              <Text style={styles.modalSubtitle}>
                {form.editingId ? "Atualize os dados do cadastro." : "Preencha os dados essenciais do cliente."}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar formulário"
              onPress={onClose}
              style={styles.closeButton}
            >
              <AppIcon name="error" size={20} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.formScroll}
            contentContainerStyle={styles.form}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                Nome<Text style={styles.requiredMark}> *</Text>
              </Text>
              <TextInput
                accessibilityLabel="Nome do cliente"
                autoFocus
                value={form.name}
                onChangeText={(value) => {
                  form.setName(value);
                  form.setFieldErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder="Ex.: Ana Souza"
                placeholderTextColor={colors.mutedSoft}
                style={[styles.fieldInput, !!form.fieldErrors.name && styles.fieldInputError]}
              />
              {!!form.fieldErrors.name && (
                <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                  {form.fieldErrors.name}
                </Text>
              )}
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>E-mail</Text>
              <TextInput
                accessibilityLabel="E-mail"
                value={form.email}
                onChangeText={(value) => {
                  form.setEmail(value);
                  form.setFieldErrors((current) => ({ ...current, email: undefined }));
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="cliente@email.com (opcional)"
                placeholderTextColor={colors.mutedSoft}
                style={[styles.fieldInput, !!form.fieldErrors.email && styles.fieldInputError]}
              />
              {!!form.fieldErrors.email && (
                <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                  {form.fieldErrors.email}
                </Text>
              )}
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Telefone com DDD</Text>
              <TextInput
                accessibilityLabel="Telefone do cliente com DDD"
                value={form.phone}
                onChangeText={(value) => {
                  form.setPhone(formatPhoneInput(value));
                  form.setFieldErrors((current) => ({ ...current, phone: undefined }));
                }}
                keyboardType="phone-pad"
                maxLength={15}
                placeholder="(11) 99999-9999"
                placeholderTextColor={colors.mutedSoft}
                style={[styles.fieldInput, !!form.fieldErrors.phone && styles.fieldInputError]}
              />
              {!!form.fieldErrors.phone && (
                <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                  {form.fieldErrors.phone}
                </Text>
              )}
              <Text style={styles.formSectionDescription}>
                Será preparado no padrão internacional (+55) para futuras integrações.
              </Text>
            </View>
            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>Serviço e cobrança</Text>
              <Text style={styles.formSectionDescription}>
                Essas informações serão usadas nos agendamentos deste cliente.
              </Text>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Serviço principal</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  form.service ? `Serviço selecionado: ${form.service}` : "Selecionar serviço principal"
                }
                onPress={() => {
                  setServiceQuery("");
                  setServicePickerVisible(true);
                }}
                style={styles.serviceSelector}
              >
                <View style={styles.serviceSelectorCopy}>
                  {form.service ? (
                    <>
                      <Text style={styles.serviceSelectorName}>
                        {form.service}
                        {selectedService?.isDefault ? "  ·  Padrão" : ""}
                      </Text>
                      {selectedService && (
                        <Text style={styles.serviceSelectorMeta}>
                          {selectedService.durationMinutes} min · {formatCurrency(selectedService.referenceValueCents)} de tabela
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={styles.serviceSelectorPlaceholder}>Selecionar serviço (opcional)</Text>
                  )}
                </View>
                <AppIcon name="forward" size={16} color={colors.mutedSoft} />
              </Pressable>
              <Text style={styles.fieldHelper}>
                O valor de referência do serviço escolhido preenche o campo abaixo — você ainda pode ajustá-lo para este cliente.
              </Text>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Valor do serviço</Text>
              <CurrencyInput
                accessibilityLabel="Valor do serviço em reais"
                valueCents={form.serviceValueCents}
                onChangeValueCents={(cents) => {
                  form.setServiceValueCents(cents);
                  form.setFieldErrors((current) => ({ ...current, serviceValue: undefined }));
                }}
                invalid={!!form.fieldErrors.serviceValue}
                prefixStyle={styles.currencyPrefix}
              />
              {!!form.fieldErrors.serviceValue && (
                <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                  {form.fieldErrors.serviceValue}
                </Text>
              )}
              <Text style={styles.fieldHelper}>O cliente verá esse valor antes de solicitar o agendamento.</Text>
            </View>
            <View style={styles.formSection}>
              <Text style={styles.formSectionTitle}>Regras de agendamento do cliente</Text>
              <Text style={styles.formSectionDescription}>
                Defina os limites que serão aplicados às solicitações. &quot;Livre&quot; remove o limite correspondente.
              </Text>
            </View>
            <View style={styles.policyField}>
              <View style={styles.policyFieldHeader}>
                <View style={styles.policyFieldCopy}>
                  <Text style={styles.fieldLabel}>Quantidade total de agendamentos</Text>
                  <Text style={styles.fieldHelper}>Limite acumulado de marcações permitidas.</Text>
                </View>
                <View style={styles.modeToggle}>
                  <Pressable
                    onPress={() => form.setTotalLimitFree(true)}
                    style={[styles.modeOption, form.totalLimitFree && styles.modeOptionActive]}
                  >
                    <Text style={[styles.modeOptionText, form.totalLimitFree && styles.modeOptionTextActive]}>
                      Livre
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => form.setTotalLimitFree(false)}
                    style={[styles.modeOption, !form.totalLimitFree && styles.modeOptionActive]}
                  >
                    <Text style={[styles.modeOptionText, !form.totalLimitFree && styles.modeOptionTextActive]}>
                      Limitado
                    </Text>
                  </Pressable>
                </View>
              </View>
              {!form.totalLimitFree && (
                <TextInput
                  accessibilityLabel="Quantidade total permitida"
                  value={form.totalLimit}
                  onChangeText={(value) => {
                    form.setTotalLimit(value);
                    form.setFieldErrors((current) => ({ ...current, totalLimit: undefined }));
                  }}
                  keyboardType="number-pad"
                  placeholder="Ex.: 8"
                  placeholderTextColor={colors.mutedSoft}
                  style={[styles.fieldInput, !!form.fieldErrors.totalLimit && styles.fieldInputError]}
                />
              )}
              {!!form.fieldErrors.totalLimit && (
                <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                  {form.fieldErrors.totalLimit}
                </Text>
              )}
            </View>
            <View style={styles.policyField}>
              <View style={styles.policyFieldHeader}>
                <View style={styles.policyFieldCopy}>
                  <Text style={styles.fieldLabel}>Quantidade por dia</Text>
                  <Text style={styles.fieldHelper}>
                    Com limite 1, o cliente só pode marcar uma vez no mesmo dia.
                  </Text>
                </View>
                <View style={styles.modeToggle}>
                  <Pressable
                    onPress={() => form.setDailyLimitFree(true)}
                    style={[styles.modeOption, form.dailyLimitFree && styles.modeOptionActive]}
                  >
                    <Text style={[styles.modeOptionText, form.dailyLimitFree && styles.modeOptionTextActive]}>
                      Livre
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => form.setDailyLimitFree(false)}
                    style={[styles.modeOption, !form.dailyLimitFree && styles.modeOptionActive]}
                  >
                    <Text style={[styles.modeOptionText, !form.dailyLimitFree && styles.modeOptionTextActive]}>
                      Limitado
                    </Text>
                  </Pressable>
                </View>
              </View>
              {!form.dailyLimitFree && (
                <TextInput
                  accessibilityLabel="Quantidade permitida por dia"
                  value={form.dailyLimit}
                  onChangeText={(value) => {
                    form.setDailyLimit(value);
                    form.setFieldErrors((current) => ({ ...current, dailyLimit: undefined }));
                  }}
                  keyboardType="number-pad"
                  placeholder="Ex.: 1"
                  placeholderTextColor={colors.mutedSoft}
                  style={[styles.fieldInput, !!form.fieldErrors.dailyLimit && styles.fieldInputError]}
                />
              )}
              {!!form.fieldErrors.dailyLimit && (
                <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                  {form.fieldErrors.dailyLimit}
                </Text>
              )}
            </View>
            <View style={styles.policyField}>
              <View style={styles.policyFieldHeader}>
                <View style={styles.policyFieldCopy}>
                  <Text style={styles.fieldLabel}>Período para solicitar</Text>
                  <Text style={styles.fieldHelper}>
                    Fora desse intervalo, novas solicitações serão bloqueadas.
                  </Text>
                </View>
                <View style={styles.modeToggle}>
                  <Pressable
                    onPress={() => form.setPeriodFree(true)}
                    style={[styles.modeOption, form.periodFree && styles.modeOptionActive]}
                  >
                    <Text style={[styles.modeOptionText, form.periodFree && styles.modeOptionTextActive]}>
                      Livre
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => form.setPeriodFree(false)}
                    style={[styles.modeOption, !form.periodFree && styles.modeOptionActive]}
                  >
                    <Text style={[styles.modeOptionText, !form.periodFree && styles.modeOptionTextActive]}>
                      Definido
                    </Text>
                  </Pressable>
                </View>
              </View>
              {!form.periodFree && (
                <View style={[styles.periodFields, !wide && styles.periodFieldsMobile]}>
                  <View style={styles.periodField}>
                    <Text style={styles.miniLabel}>Data inicial</Text>
                    <DatePickerField
                      label="Data inicial"
                      accessibilityLabel="Data inicial no formato dia mês e ano"
                      value={form.requestFrom}
                      onChangeText={(text) => {
                        form.setRequestFrom(formatDateInput(text));
                        form.setFieldErrors((current) => ({ ...current, requestFrom: undefined }));
                      }}
                      keyboardType="number-pad"
                      maxLength={10}
                      placeholder="DD/MM/AAAA"
                      invalid={!!form.fieldErrors.requestFrom}
                    />
                    {!!form.fieldErrors.requestFrom && (
                      <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                        {form.fieldErrors.requestFrom}
                      </Text>
                    )}
                  </View>
                  <View style={styles.periodField}>
                    <Text style={styles.miniLabel}>Data final</Text>
                    <DatePickerField
                      label="Data final"
                      accessibilityLabel="Data final no formato dia mês e ano"
                      value={form.requestUntil}
                      onChangeText={(text) => {
                        form.setRequestUntil(formatDateInput(text));
                        form.setFieldErrors((current) => ({ ...current, requestUntil: undefined }));
                      }}
                      keyboardType="number-pad"
                      maxLength={10}
                      placeholder="DD/MM/AAAA"
                      invalid={!!form.fieldErrors.requestUntil}
                    />
                    {!!form.fieldErrors.requestUntil && (
                      <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                        {form.fieldErrors.requestUntil}
                      </Text>
                    )}
                  </View>
                </View>
              )}
            </View>
            <View style={styles.policyField}>
              <View style={styles.policyFieldHeader}>
                <View style={styles.policyFieldCopy}>
                  <Text style={styles.fieldLabel}>Status</Text>
                  <Text style={styles.fieldHelper}>Clientes inativos não conseguem solicitar agendamentos.</Text>
                </View>
                <View style={styles.modeToggle}>
                  {(["Ativo", "Inativo"] as ClientEditFormStatus[]).map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: form.status === item }}
                      key={item}
                      onPress={() => form.setStatus(item)}
                      style={[styles.modeOption, form.status === item && styles.modeOptionActive]}
                    >
                      <Text style={[styles.modeOptionText, form.status === item && styles.modeOptionTextActive]}>
                        {item}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
            {form.editingId && onRequestDelete && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Excluir cliente"
                onPress={onRequestDelete}
                style={[styles.deleteButton, { marginTop: spacing.md }]}
              >
                <AppIcon name="delete" size={16} color={colors.danger} />
                <Text style={styles.deleteButtonText}>Excluir cliente</Text>
              </Pressable>
            )}
            {form.formError ? (
              <View accessibilityRole="alert" style={styles.formError}>
                <AppIcon name="warning" size={16} color={colors.danger} />
                <Text style={styles.formErrorText}>{form.formError}</Text>
              </View>
            ) : null}
          </ScrollView>
          <View style={[styles.modalActions, !wide && styles.modalActionsMobile]}>
            <View style={[styles.modalActionGroup, { flex: 1, width: "100%" }]}>
              <Pressable
                accessibilityRole="button"
                disabled={form.saving}
                onPress={onClose}
                style={[styles.cancelButton, styles.formActionButton, form.saving && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: form.saving, busy: form.saving }}
                disabled={form.saving}
                onPress={() => void form.submit()}
                style={({ pressed }) => [
                  styles.saveButton,
                  styles.formActionButton,
                  pressed && !form.saving && { opacity: opacity.pressed },
                ]}
              >
                {form.saving && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.saveButtonText}>Salvar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <Modal
      visible={servicePickerVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setServicePickerVisible(false)}
    >
      <View style={styles.pickerBackdrop}>
        <View accessibilityViewIsModal style={styles.pickerModal}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              <Text accessibilityRole="header" style={styles.modalTitle}>
                Selecionar serviço
              </Text>
              <Text style={styles.modalSubtitle}>{filteredServices.length} serviço(s) disponível(is)</Text>
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
          <View style={styles.pickerSearch}>
            <AppIcon name="search" size={20} color={colors.mutedSoft} />
            <TextInput
              accessibilityLabel="Buscar serviço por nome"
              value={serviceQuery}
              onChangeText={setServiceQuery}
              placeholder="Buscar por nome"
              placeholderTextColor={colors.mutedSoft}
              style={styles.pickerSearchInput}
            />
          </View>
          <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remover serviço principal"
              onPress={() => {
                form.setService("");
                form.setPrimaryServiceId(null);
                setServicePickerVisible(false);
              }}
              style={[styles.pickerItem, !form.service && styles.pickerItemActive]}
            >
              <View style={styles.pickerItemAvatar}>
                <AppIcon name="services" size={16} color={colors.brand} />
              </View>
              <View style={styles.pickerItemCopy}>
                <Text style={styles.pickerItemName}>Sem serviço principal</Text>
                <Text style={styles.pickerItemMeta}>O cliente fica sem serviço vinculado por padrão</Text>
              </View>
              {!form.service && <AppIcon name="success" size={20} color={colors.success} />}
            </Pressable>
            {loadingServices && (
              <View style={styles.pickerEmpty}>
                <Text style={styles.pickerEmptyText}>Carregando serviços...</Text>
              </View>
            )}
            {!loadingServices &&
              filteredServices.map((item) => {
                const isSelected = selectedService?.id === item.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => selectService(item)}
                    style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                  >
                    <View style={[styles.pickerItemAvatar, isSelected && styles.pickerItemAvatarActive]}>
                      <AppIcon name="services" size={16} color={isSelected ? colors.onBrand : colors.brand} />
                    </View>
                    <View style={styles.pickerItemCopy}>
                      <Text style={[styles.pickerItemName, isSelected && styles.pickerItemNameActive]}>
                        {item.name}
                        {item.isDefault ? "  ·  Padrão" : ""}
                      </Text>
                      <Text style={styles.pickerItemMeta}>
                        {item.durationMinutes} min · {formatCurrency(item.referenceValueCents)} de tabela
                      </Text>
                    </View>
                    {isSelected && <AppIcon name="success" size={20} color={colors.success} />}
                  </Pressable>
                );
              })}
            {!loadingServices && filteredServices.length === 0 && (
              <View style={styles.pickerEmpty}>
                <AppIcon name="search" size={24} color={colors.mutedSoft} />
                <Text style={styles.pickerEmptyText}>
                  {services.length === 0 ? "Nenhum serviço ativo no catálogo." : "Nenhum serviço encontrado para esta busca."}
                </Text>
              </View>
            )}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setServicePickerVisible(false);
              onClose();
              router.push("/services" as never);
            }}
            style={styles.pickerFooterLink}
          >
            <AppIcon name="add" size={16} color={colors.brand} />
            <Text style={styles.pickerFooterLinkText}>Gerenciar catálogo de serviços</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
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
  formActionButton: { width: "100%", flex: 0, minWidth: 0, paddingHorizontal: spacing.md },
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
  serviceSelector: {
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
  serviceSelectorCopy: { flex: 1, minWidth: 0 },
  serviceSelectorName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  serviceSelectorMeta: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  serviceSelectorPlaceholder: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  pickerBackdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  pickerModal: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "88%",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  pickerSearch: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  pickerSearchInput: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  pickerList: { marginTop: spacing.sm, maxHeight: 360 },
  pickerListContent: { gap: spacing.xs, paddingBottom: spacing.sm },
  pickerEmpty: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  pickerEmptyText: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    textAlign: "center",
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  pickerItemActive: { backgroundColor: colors.brandSoft },
  pickerItemAvatar: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  pickerItemAvatarActive: { backgroundColor: colors.brand },
  pickerItemCopy: { flex: 1, minWidth: 0 },
  pickerItemName: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  pickerItemNameActive: { color: colors.brand },
  pickerItemMeta: {
    marginTop: spacing.xs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  pickerFooterLink: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  pickerFooterLinkText: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
});
