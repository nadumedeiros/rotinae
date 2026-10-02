import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { AppIcon } from "@/src/components/ui/app-icon";
import { AdvanceHoursField } from "@/src/components/ui/advance-hours-field";
import { TimePickerField } from "@/src/components/ui/time-picker-field";
import type { UserRole } from "@/src/domain/auth/types";
import { ProviderError } from "@/src/domain/provider/types";
import { supabaseAuthService as authService } from "@/src/infra/auth/supabase-auth-adapter";
import { providerSettingsService } from "@/src/infra/provider/supabase-provider-settings-adapter";
import { pushRegistrationService } from "@/src/infra/notifications/push-registration";
import { supabase } from "@/src/infra/supabase/client";
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

const defaults = {
  name: "",
  email: "",
  phone: "",
  profession: "",
  // RN-AGD-029: mesmo default de 7 dias já aplicado no banco (tenants
  // existentes/novos nascem com todos os dias marcados).
  attendanceDays: [0, 1, 2, 3, 4, 5, 6] as number[],
  timezone: "America/Sao_Paulo",
  workdayStart: "08:00",
  workdayEnd: "18:00",
  advanceHours: "24",
  emailNotifications: true,
  pushNotifications: true,
};
// Atalhos de preenchimento (RN-PRF-002/12.2, docs/HANDOFF_UX_SERVICOS_DANTE.md):
// não é lista fechada, apenas exemplos de profissões comuns no domínio do
// produto — o campo continua aceitando qualquer texto livre digitado por
// cima.
const PROFESSION_SUGGESTIONS = [
  "Prestador(a)",
  "Personal Trainer",
  "Esteticista",
  "Barbeiro(a)",
  "Adestrador(a)",
  "Professor(a) particular",
  "Nutricionista",
  "Fisioterapeuta",
  "Técnico(a)",
];
// Dias de atendimento (RN-AGD-025/029, docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md
// seção 2.1) — convenção `Date.getDay()` (0=domingo, ..., 6=sábado), a mesma
// já usada por `ProviderSettings.attendanceDays`/`ClientBookingPolicy.
// allowedWeekdays`. Ordem de exibição começa no domingo e termina no sábado,
// mesma convenção visual já usada no calendário de `app/client-booking.tsx`
// (DEC-153). O `value` de cada item continua sendo o índice numérico da
// convenção `Date.getDay()` — não alterar.
const WEEKDAYS: { value: number; short: string; full: string }[] = [
  { value: 0, short: "DOM", full: "Domingo" },
  { value: 1, short: "SEG", full: "Segunda-feira" },
  { value: 2, short: "TER", full: "Terça-feira" },
  { value: 3, short: "QUA", full: "Quarta-feira" },
  { value: 4, short: "QUI", full: "Quinta-feira" },
  { value: 5, short: "SEX", full: "Sexta-feira" },
  { value: 6, short: "SÁB", full: "Sábado" },
];
const maskPhone = (text: string) => {
  const d = text.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const maskTime = (text: string) => {
  const d = text.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
};
const validTime = (text: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  return !!m && +m[1] < 24 && +m[2] < 60;
};

export default function SettingsScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [activeRole, setActiveRole] = useState<UserRole>("provider");
  const [form, setForm] = useState(defaults);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    phone?: string;
    profession?: string;
    attendanceDays?: string;
    workdayStart?: string;
    workdayEnd?: string;
    advanceHours?: string;
  }>({});
  const [feedback, setFeedback] = useState<"success" | "warning" | "error" | null>(null);
  const [saving, setSaving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const savingRef = useRef(false);
  const feedbackDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissFeedback = () => {
    // No web/mobile, o toque que desmonta um Modal pode alcançar o botão de
    // salvar que volta a ocupar a mesma área no frame seguinte. Mantemos a
    // trava por um instante para impedir esse segundo save involuntário.
    savingRef.current = true;
    setFeedback(null);
    if (feedbackDismissTimerRef.current) clearTimeout(feedbackDismissTimerRef.current);
    feedbackDismissTimerRef.current = setTimeout(() => {
      savingRef.current = false;
      feedbackDismissTimerRef.current = null;
    }, 450);
  };

  useEffect(
    () => () => {
      if (feedbackDismissTimerRef.current) clearTimeout(feedbackDismissTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await authService.getSession();
        if (!session) throw new Error("SESSION_EXPIRED");
        const role = session.user.activeRole ?? "provider";
        if (!active) return;
        setActiveRole(role);
        if (role === "provider") {
          const settings = await providerSettingsService.getSettings();
          if (!active) return;
          setForm({
            name: settings.displayName,
            email: settings.email,
            phone: maskPhone(settings.phone?.replace(/^\+55/, "") ?? ""),
            profession: settings.profession ?? "",
            attendanceDays: settings.attendanceDays ?? [0, 1, 2, 3, 4, 5, 6],
            timezone: settings.timezone,
            workdayStart: settings.workdayStart,
            workdayEnd: settings.workdayEnd,
            advanceHours: String(settings.minimumAdvanceHours),
            emailNotifications: settings.emailNotifications,
            pushNotifications: settings.pushNotifications,
          });
          return;
        }
        const { data, error: profileError } = await supabase
          .from("profiles")
          .select("display_name, phone, email_notifications, push_notifications")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (!active) return;
        setForm({
          ...defaults,
          name: data?.display_name ?? session.user.displayName ?? "",
          email: session.user.email,
          phone: maskPhone(data?.phone?.replace(/^\+55/, "") ?? ""),
          emailNotifications: data?.email_notifications ?? true,
          pushNotifications: data?.push_notifications ?? true,
        });
      } catch {
        if (!active) return;
        // Não abre modal invasivo ao carregar a tela — preenche com dados locais da sessão
      } finally {
        if (active) setInitialLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);
  const update = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };
  // RN-AGD-025: cada chip é um toggle independente — não bloqueia desmarcar o
  // último dia restante (a validação de "zero dias" só ocorre ao salvar,
  // docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md seção 2.4).
  const toggleAttendanceDay = (day: number) => {
    setForm((current) => ({
      ...current,
      attendanceDays: current.attendanceDays.includes(day)
        ? current.attendanceDays.filter((value) => value !== day)
        : [...current.attendanceDays, day],
    }));
    setFieldErrors((current) => ({ ...current, attendanceDays: undefined }));
  };
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setError("");
    const nextFieldErrors: typeof fieldErrors = {};
    if (form.name.trim().length < 2) nextFieldErrors.name = "Informe um nome com pelo menos 2 caracteres.";
    if (form.phone.replace(/\D/g, "").length < 10) nextFieldErrors.phone = "Informe um telefone válido com DDD.";
    const advance = Number(form.advanceHours);
    if (activeRole === "provider") {
      // RF-AGE-015 (docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md seção 2.4):
      // validação de grupo só ao salvar, nunca bloqueando a interação de
      // marcar/desmarcar durante a reconfiguração.
      if (form.attendanceDays.length === 0) {
        nextFieldErrors.attendanceDays = "Selecione pelo menos um dia de atendimento.";
      }
      if (!validTime(form.workdayStart)) nextFieldErrors.workdayStart = "Informe um horário válido.";
      if (!validTime(form.workdayEnd)) nextFieldErrors.workdayEnd = "Informe um horário válido.";
      if (
        validTime(form.workdayStart) &&
        validTime(form.workdayEnd) &&
        form.workdayStart >= form.workdayEnd
      ) {
        nextFieldErrors.workdayStart = "Deve ser anterior ao término.";
        nextFieldErrors.workdayEnd = "Deve ser posterior ao início.";
      }
      if (!Number.isInteger(advance) || advance < 0 || advance > 720) nextFieldErrors.advanceHours = "Deve ficar entre 0 e 720 horas.";
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      savingRef.current = false;
      setError("Confira os campos destacados abaixo.");
      return;
    }
    setSaving(true);
    try {
      const phoneDigits = form.phone.replace(/\D/g, "");
      const normalizedPhone = phoneDigits ? `+55${phoneDigits}` : null;
      if (activeRole === "provider") {
        await providerSettingsService.updateSettings({
          displayName: form.name.trim(),
          phone: normalizedPhone,
          profession: form.profession.trim(),
          attendanceDays: form.attendanceDays,
          timezone: form.timezone,
          workdayStart: form.workdayStart,
          workdayEnd: form.workdayEnd,
          minimumAdvanceHours: Number(form.advanceHours),
          emailNotifications: form.emailNotifications,
          pushNotifications: form.pushNotifications,
        });
      } else {
        const session = await authService.getSession();
        if (!session) throw new Error("SESSION_EXPIRED");
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            display_name: form.name.trim(),
            phone: normalizedPhone,
            email_notifications: form.emailNotifications,
            push_notifications: form.pushNotifications,
          })
          .eq("user_id", session.user.id);
        if (profileError) throw profileError;
      }
      if (Platform.OS !== "web") {
        const pushResult = await pushRegistrationService
          .sync({ requestPermission: form.pushNotifications })
          .catch(() => ({
            status: "unavailable" as const,
            message: "A preferência foi salva, mas não foi possível registrar este aparelho agora.",
          }));
        if (form.pushNotifications && pushResult.status !== "registered") {
          setError(
            pushResult.message ??
              "A preferência foi salva, mas este aparelho ainda não pode receber notificações.",
          );
          setFeedback("warning");
          return;
        }
      }
      setFeedback("success");
    } catch (saveError) {
      // PROFESSION_INVALID (RN-PRF-003) é erro de campo, não banner genérico
      // — só deveria ocorrer em corrida, já que `maxLength={60}` barra
      // client-side, mas o servidor continua sendo a autoridade final.
      if (saveError instanceof ProviderError && saveError.code === "PROFESSION_INVALID") {
        setFieldErrors((current) => ({ ...current, profession: saveError.message }));
        setError("Confira os campos destacados abaixo.");
        return;
      }
      // ATTENDANCE_DAYS_INVALID (RN-AGD-025) é defesa em profundidade — a
      // validação client-side acima já bloqueia zero dias antes de chamar a
      // rede; este bloco só é alcançado em corrida ou anomalia de dado.
      if (saveError instanceof ProviderError && saveError.code === "ATTENDANCE_DAYS_INVALID") {
        setFieldErrors((current) => ({ ...current, attendanceDays: saveError.message }));
        setError("Confira os campos destacados abaixo.");
        return;
      }
      setError("Não foi possível salvar. Tente novamente.");
      setFeedback("error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      {initialLoading && <PageLoadingOverlay />}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.content, !wide && styles.contentMobile]}>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>
              {activeRole === "provider" ? "PERFIL DO PRESTADOR" : "PERFIL DO CLIENTE"}
            </Text>
            <Text style={styles.title}>Configurar perfil</Text>
            <Text style={styles.description}>
              {activeRole === "provider"
                ? "Mantenha seus dados, agenda e preferências atualizados."
                : "Mantenha seus dados pessoais e preferências atualizados."}
            </Text>
          </View>
          <View style={[styles.grid, wide && styles.gridWide]}>
            <View style={[styles.card, wide ? styles.cardWide : styles.cardMobile]}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <AppIcon name="user" size={20} color={colors.brand} />
                </View>
                <View style={styles.sectionHeaderCopy}>
                  <Text style={styles.sectionTitle}>
                    {activeRole === "provider" ? "Dados profissionais" : "Dados pessoais"}
                  </Text>
                  <Text style={styles.sectionText}>
                    Informações usadas na sua conta.
                  </Text>
                </View>
              </View>
              <View style={styles.form}>
                <View style={styles.field}>
                  <Text style={styles.label}>
                    {activeRole === "provider" ? "Nome de exibição" : "Nome completo"}
                    <Text style={styles.requiredMark}> *</Text>
                  </Text>
                  <TextInput
                    value={form.name}
                    onChangeText={(v) => update("name", v)}
                    style={[styles.input, !!fieldErrors.name && styles.inputError]}
                  />
                  {!!fieldErrors.name && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.name}</Text>}
                </View>
                {activeRole === "provider" && <View style={styles.field}>
                  <Text style={styles.label}>Profissão/especialidade</Text>
                  <TextInput
                    value={form.profession}
                    onChangeText={(v) => update("profession", v)}
                    maxLength={60}
                    placeholder="Ex.: Personal Trainer"
                    placeholderTextColor={colors.mutedSoft}
                    style={[styles.input, !!fieldErrors.profession && styles.inputError]}
                  />
                  {!!fieldErrors.profession && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.profession}</Text>}
                  <Text style={styles.hint}>
                    Aparece para seus clientes ao lado do seu nome. Opcional.
                  </Text>
                  <View style={styles.professionOptions}>
                    {PROFESSION_SUGGESTIONS.map((option) => (
                      <Pressable
                        key={option}
                        onPress={() => update("profession", option)}
                        style={[
                          styles.professionOption,
                          form.profession === option && styles.professionOptionActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.professionOptionText,
                            form.profession === option && styles.professionOptionTextActive,
                          ]}
                        >
                          {option}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>}
                <View style={styles.field}>
                  <Text style={styles.label}>E-mail</Text>
                  <TextInput
                    value={form.email}
                    editable={false}
                    style={[styles.input, styles.disabled]}
                  />
                  <Text style={styles.hint}>
                    A alteração de e-mail exige confirmação de segurança.
                  </Text>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Telefone<Text style={styles.requiredMark}> *</Text></Text>
                  <TextInput
                    value={form.phone}
                    onChangeText={(v) => update("phone", maskPhone(v))}
                    keyboardType="phone-pad"
                    style={[styles.input, !!fieldErrors.phone && styles.inputError]}
                  />
                  {!!fieldErrors.phone && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.phone}</Text>}
                </View>
                {activeRole === "provider" && <View style={styles.field}>
                  <Text style={styles.label}>Fuso horário</Text>
                  <View style={styles.readonly}>
                    <AppIcon name="schedule" size={20} color={colors.brand} />
                    <Text style={styles.readonlyText}>
                      São Paulo — GMT-03:00
                    </Text>
                  </View>
                </View>}
              </View>
            </View>
            <View style={[styles.card, wide ? styles.cardWide : styles.cardMobile]}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionIcon}>
                  <AppIcon
                    name={activeRole === "provider" ? "calendar" : "notifications"}
                    size={20}
                    color={colors.brand}
                  />
                </View>
                <View style={styles.sectionHeaderCopy}>
                  <Text style={styles.sectionTitle}>
                    {activeRole === "provider" ? "Agenda e notificações" : "Notificações"}
                  </Text>
                  <Text style={styles.sectionText}>
                    {activeRole === "provider"
                      ? "Regras padrão da sua rotina."
                      : "Escolha como deseja receber atualizações dos seus agendamentos."}
                  </Text>
                </View>
              </View>
              <View style={styles.form}>
                {activeRole === "provider" && <>
                <View style={styles.field}>
                  <Text style={styles.label}>
                    Dias de atendimento<Text style={styles.requiredMark}> *</Text>
                  </Text>
                  <View
                    style={[
                      styles.weekdayList,
                      !!fieldErrors.attendanceDays && styles.weekdayListError,
                    ]}
                  >
                    {WEEKDAYS.map((weekday) => {
                      const checked = form.attendanceDays.includes(weekday.value);
                      return (
                        <Pressable
                          key={weekday.value}
                          onPress={() => toggleAttendanceDay(weekday.value)}
                          accessibilityRole="switch"
                          accessibilityState={{ checked }}
                          accessibilityLabel={`${weekday.full}, dia de atendimento ${checked ? "ativado" : "desativado"}`}
                          style={[styles.weekday, checked && styles.weekdayActive]}
                        >
                          <Text
                            style={[
                              styles.weekdayText,
                              checked && styles.weekdayTextActive,
                            ]}
                          >
                            {weekday.short}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {!!fieldErrors.attendanceDays && (
                    <Text accessibilityRole="alert" style={styles.fieldErrorText}>
                      {fieldErrors.attendanceDays}
                    </Text>
                  )}
                  <Text style={styles.hint}>
                    Nos dias marcados, clientes podem solicitar agendamento pelos horários abaixo.
                  </Text>
                </View>
                <View style={[styles.row, !wide && styles.rowMobile]}>
                  <View style={styles.rowField}>
                    <Text style={styles.label}>Início<Text style={styles.requiredMark}> *</Text></Text>
                    <TimePickerField
                      label="Início do expediente"
                      value={form.workdayStart}
                      onChangeText={(v) => update("workdayStart", maskTime(v))}
                      keyboardType="number-pad"
                      maxLength={5}
                      invalid={!!fieldErrors.workdayStart}
                    />
                    {!!fieldErrors.workdayStart && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.workdayStart}</Text>}
                  </View>
                  <View style={styles.rowField}>
                    <Text style={styles.label}>Término<Text style={styles.requiredMark}> *</Text></Text>
                    <TimePickerField
                      label="Término do expediente"
                      value={form.workdayEnd}
                      onChangeText={(v) => update("workdayEnd", maskTime(v))}
                      keyboardType="number-pad"
                      maxLength={5}
                      invalid={!!fieldErrors.workdayEnd}
                    />
                    {!!fieldErrors.workdayEnd && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.workdayEnd}</Text>}
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Antecedência mínima<Text style={styles.requiredMark}> *</Text></Text>
                  <AdvanceHoursField
                    label="Antecedência mínima"
                    value={form.advanceHours}
                    onChangeText={(v) => update("advanceHours", v)}
                    invalid={!!fieldErrors.advanceHours}
                  />
                  {!!fieldErrors.advanceHours && <Text accessibilityRole="alert" style={styles.fieldErrorText}>{fieldErrors.advanceHours}</Text>}
                  <Text style={styles.hint}>
                    Tempo mínimo de antecedência (em horas) para o cliente solicitar um agendamento.
                  </Text>
                </View>
                </>}
                {(
                  [
                    // ["emailNotifications", "Notificações por e-mail"],
                    ["pushNotifications", "Notificações push no celular"],
                  ] as const
                ).map(([key, label]) => (
                  <Pressable
                    key={key}
                    onPress={() => update(key, !form[key])}
                    style={styles.preference}
                  >
                    <View style={styles.preferenceCopy}>
                      <Text style={styles.preferenceTitle}>{label}</Text>
                      <Text style={styles.hint}>
                        {form[key] ? "Ativado" : "Desativado"}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.switchTrack,
                        form[key] && styles.switchTrackActive,
                      ]}
                    >
                      <View
                        style={[
                          styles.switchThumb,
                          form[key] && styles.switchThumbActive,
                        ]}
                      />
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          {error ? (
            <View style={styles.error}>
              <AppIcon name="warning" size={20} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <View style={[styles.actions, !wide && styles.actionsMobile]}>
            <Pressable
              disabled={saving}
              onPress={() => router.back()}
              style={[styles.cancel, !wide && styles.actionButtonMobile]}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
              disabled={saving}
              onPress={save}
              style={({ pressed }) => [
                styles.save,
                !wide && styles.actionButtonMobile,
                pressed && !saving && { opacity: opacity.pressed },
              ]}
            >
              {saving && <ActivityIndicator size="small" color={colors.onBrand} />}
              <Text style={styles.saveText}>Salvar configurações</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
      <Modal
        visible={feedback !== null}
        transparent
        animationType="none"
        onRequestClose={dismissFeedback}
      >
        <View style={styles.backdrop}>
          <View style={styles.feedback}>
            <View
              style={[
                styles.feedbackIcon,
                feedback !== "success" && styles.feedbackIconError,
              ]}
            >
              <AppIcon
                name={feedback === "success" ? "success" : "warning"}
                size={32}
                color={feedback === "success" ? colors.success : colors.danger}
              />
            </View>
            <Text style={styles.feedbackTitle}>
              {feedback === "error"
                ? "Não foi possível salvar"
                : feedback === "warning"
                  ? "Configurações salvas com aviso"
                  : "Configurações salvas"}
            </Text>
            <Text style={styles.feedbackText}>
              {feedback === "success"
                ? "Suas preferências foram atualizadas com sucesso."
                : error}
            </Text>
            <Pressable onPress={dismissFeedback} style={styles.save}>
              <Text style={styles.saveText}>Entendi</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {activeRole === "client" ? <ClientMobileTabBar /> : <MobileTabBar />}
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
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
  },
  grid: { gap: spacing.md },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  card: {
    width: "100%",
    minWidth: 0,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  cardWide: {
    flex: 1,
  },
  cardMobile: { padding: spacing.md },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  sectionHeaderCopy: { flex: 1, minWidth: 0 },
  sectionIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  sectionTitle: {
    flexShrink: 1,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  sectionText: {
    flexShrink: 1,
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
  },
  form: { marginTop: spacing.lg, gap: 20 },
  field: { width: "100%", minWidth: 0, gap: 6 },
  label: { color: colors.ink, fontFamily: typography.family.semibold },
  input: {
    width: "100%",
    minWidth: 0,
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
  disabled: { color: colors.mutedSoft, opacity: 0.75 },
  inputError: { borderColor: colors.danger },
  requiredMark: { color: colors.danger },
  fieldErrorText: {
    color: colors.danger,
    fontFamily: typography.family.medium,
    fontSize: typography.size.caption,
    marginTop: 4,
  },
  hint: {
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  professionOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  professionOption: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  professionOptionActive: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  professionOptionText: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  professionOptionTextActive: { color: colors.brandDark },
  readonly: {
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
  readonlyText: { flex: 1, minWidth: 0, color: colors.ink, fontFamily: typography.family.semibold },
  row: { flexDirection: "row", gap: spacing.md },
  rowMobile: { flexDirection: "column" },
  rowField: { flex: 1, width: "100%", minWidth: 0, gap: 6 },
  weekdayList: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  // Erro de grupo (RN-AGD-025, seção 2.3 do handoff): a borda envolve o
  // grupo inteiro de chips, sem alterar a cor de preenchimento de cada chip
  // individualmente — o erro é do grupo, não de um chip específico.
  weekdayListError: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    padding: spacing.xs,
  },
  weekday: {
    minWidth: 50,
    // Alvo mínimo de toque 44x44 (docs/DESIGN_SYSTEM_MVP.md seção 4.4,
    // recomendação de Dante na seção 2.1 do handoff).
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  weekdayActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  weekdayText: { color: colors.muted, fontFamily: typography.family.semibold },
  weekdayTextActive: { color: colors.onBrand },
  preference: {
    width: "100%",
    minWidth: 0,
    minHeight: 62,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  preferenceCopy: { flex: 1, minWidth: 0, paddingRight: spacing.sm },
  preferenceTitle: {
    flexShrink: 1,
    color: colors.ink,
    fontFamily: typography.family.semibold,
  },
  switchTrack: {
    flexShrink: 0,
    width: 46,
    height: 26,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  switchTrackActive: { backgroundColor: colors.brand },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  switchThumbActive: { alignSelf: "flex-end" },
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
  actions: {
    flexShrink: 0,
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  actionsMobile: { width: "100%", flexDirection: "column-reverse", alignItems: "stretch" },
  actionButtonMobile: { width: "100%", minWidth: 0, paddingHorizontal: spacing.md },
  cancel: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: colors.muted, fontFamily: typography.family.semibold },
  save: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  saveText: { color: colors.onBrand, fontFamily: typography.family.bold },
  backdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  feedback: {
    flexShrink: 0,
    width: "100%",
    maxWidth: 400,
    padding: spacing.lg,
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  feedbackIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  feedbackIconError: { backgroundColor: colors.dangerSoft },
  feedbackTitle: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    textAlign: "center",
  },
  feedbackText: {
    marginVertical: spacing.md,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
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
  bottomLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.medium,
    fontSize: 10,
  },
});
