import type { GestureResponderEvent } from "react-native";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "@/src/components/ui/app-icon";
import { TableLoadingState } from "@/src/components/ui/table-loading-state";
import { getAppointmentStatusLabel } from "@/src/domain/agenda/appointment-status-label";
import type { AppointmentRecord } from "@/src/domain/agenda/types";
import {
  colors,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";

export type AppointmentStatus =
  "Confirmado" | "A confirmar" | "Concluído" | "Cancelado";

export type Appointment = {
  id: string;
  clientId: string | null;
  serviceId: string | null;
  title: string | null;
  client: string;
  service: string;
  date: string;
  time: string;
  value: number;
  status: AppointmentStatus;
  state: AppointmentRecord["state"];
  // Alimenta só o selo visual de status (via `getAppointmentStatusLabel`),
  // nunca o formulário de criação/edição — que continua usando `status`
  // acima (4 valores editáveis pelo prestador). É o que permite ao selo
  // distinguir "Não compareceu" de "Concluído" sem os dois colapsarem no
  // mesmo rótulo/cor, como `status` faz propositalmente.
  confirmationStatus: AppointmentRecord["confirmationStatus"];
  notes?: string;
  clientMessage?: string;
  internalNotes?: string;
  cancellationReason?: string;
  cancelledBy?: "client" | "provider";
  confirmedManually?: boolean;
  recurrenceGroupId?: string;
  recurrenceIndex?: number;
  recurrenceCount?: number;
  durationMinutes: number;
  timezone: string;
};

/**
 * Tooltip nativo do navegador (`title`), exibido só na Web — em nativo o
 * `accessibilityLabel` de cada elemento já cumpre esse papel.
 */
export const webTooltip = (label: string) =>
  Platform.OS === "web" ? ({ title: label } as { title: string }) : {};

/**
 * Lista de compromissos de um dia, com ações rápidas (confirmar
 * manualmente, concluir, cancelar, reverter, editar, excluir).
 *
 * Extraído de `app/agenda.tsx` para ser reaproveitado nas duas visões da
 * tela de Agenda — Lista e Calendário (abaixo do grid do mês, para o dia
 * selecionado) — sem duplicar o JSX de renderização de item nem divergir o
 * conjunto de ações disponível entre as duas visões.
 */
export function AppointmentDayList({
  items,
  loading,
  wide,
  onMobileActions,
  onDesktopActions,
  onCreateNew,
}: {
  items: Appointment[];
  loading: boolean;
  wide: boolean;
  onMobileActions: (item: Appointment) => void;
  onDesktopActions: (item: Appointment, event: GestureResponderEvent) => void;
  onCreateNew: () => void;
}) {
  return (
    <View style={[styles.list, !wide && styles.listMobile]}>
      {loading ? (
        <TableLoadingState rows={3} compact={!wide} />
      ) : (
        items.map((item) => {
          // Selo visual de status: sempre a partir de `state`/`confirmationStatus`
          // via `getAppointmentStatusLabel` — a mesma fonte de verdade do
          // Perfil do Cliente e da Home —, nunca de `item.status` (que serve só
          // ao formulário de edição e colapsa "Não compareceu" em "Concluído").
          const statusPresentation = getAppointmentStatusLabel(
            item.state,
            item.confirmationStatus,
          );
          return wide ? (
            <View key={item.id} style={styles.appointment}>
              <View style={styles.timeBox}>
                <Text style={styles.time}>{item.time}</Text>
              </View>
              <View style={styles.appointmentCopy}>
                <Text style={styles.client}>
                  {item.title?.trim() || item.service || "Compromisso"}
                </Text>
                {item.clientId ? <Text style={styles.service}>{item.client}</Text> : null}
                {item.confirmedManually && (
                  <Text style={styles.manualLabel}>
                    Confirmado manualmente pelo prestador
                  </Text>
                )}
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: statusPresentation.bg },
                ]}
              >
                <Text
                  style={[styles.statusText, { color: statusPresentation.color }]}
                >
                  {statusPresentation.label}
                </Text>
              </View>
              <View style={styles.actions}>
                {/* Mesmas opções do menu do mobile, só que como o painel
                    flutuante do desktop (igual ao menu de perfil/
                    notificações do cabeçalho) — mobile continua com seu
                    próprio bottom-sheet, inalterado. */}
                <Pressable
                  accessibilityLabel={`Ações para ${item.client}`}
                  onPress={(event) => onDesktopActions(item, event)}
                  style={styles.dotsButton}
                >
                  <AppIcon name="dots" size={18} color={colors.muted} />
                </Pressable>
              </View>
            </View>
          ) : (
            <View key={item.id} style={[styles.appointment, styles.appointmentMobile]}>
              {/* Linha superior: horário e duração */}
              <View style={styles.mobileCardHeader}>
                <View style={styles.mobileTimeChip}>
                  <AppIcon name="schedule" size={14} color={colors.brand} />
                  <Text style={styles.mobileTimeText}>{item.time}</Text>
                  <Text style={styles.mobileDurationText}>{item.durationMinutes} min</Text>
                </View>
                <Pressable
                  accessibilityLabel={`Ações para ${item.client}`}
                  onPress={() => onMobileActions(item)}
                  style={styles.dotsButton}
                >
                  <AppIcon name="dots" size={18} color={colors.muted} />
                </Pressable>
              </View>

              {/* Corpo: título do compromisso e cliente, quando houver */}
              <View style={styles.mobileCardBody}>
                <Text style={styles.mobileClientTitle}>
                  {item.title?.trim() || item.service || "Compromisso"}
                </Text>
                {item.clientId ? (
                  <Text style={styles.mobileServiceText}>{item.client}</Text>
                ) : null}
                {item.confirmedManually && (
                  <View style={styles.manualConfirmBadge}>
                    <AppIcon name="success" size={12} color={colors.success} />
                    <Text style={styles.manualConfirmBadgeText}>
                      Confirmado manualmente pelo prestador
                    </Text>
                  </View>
                )}
              </View>

              {/* Rodapé: Status à esquerda e Dots no canto direito */}
              <View style={styles.mobileStatusDotsRow}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: statusPresentation.bg },
                  ]}
                >
                  <Text
                    style={[styles.statusText, { color: statusPresentation.color }]}
                  >
                    {statusPresentation.label}
                  </Text>
                </View>
              </View>
            </View>
          );
        })
      )}
      {!loading && !items.length && (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <AppIcon name="calendar" size={32} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>Nenhum compromisso encontrado</Text>
          <Text style={styles.emptyText}>
            Escolha outra data, altere os filtros ou crie um novo agendamento.
          </Text>
          <Pressable onPress={onCreateNew} style={styles.emptyButton}>
            <Text style={styles.emptyButtonText}>Novo agendamento</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {},
  listMobile: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 0,
  },
  appointment: {
    minHeight: 82,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  appointmentMobile: {
    margin: 0,
    padding: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.sm,
    borderWidth: 0,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderRadius: 0,
    backgroundColor: colors.surface,
  },
  timeBox: {
    width: 72,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  time: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  appointmentCopy: { flex: 1, minWidth: 0 },
  client: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  service: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  manualLabel: {
    marginTop: spacing.xs,
    color: colors.success,
    fontFamily: typography.family.semibold,
    fontSize: 10,
  },
  statusBadge: {
    minWidth: 88,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    alignItems: "center",
    borderRadius: radius.pill,
  },
  statusText: {
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  actions: { flexDirection: "row", gap: spacing.xs },
  mobileCardHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  mobileTimeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  mobileTimeText: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  mobileDurationText: {
    color: colors.brand,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  mobileCardBody: {
    width: "100%",
    gap: 4,
  },
  mobileClientTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
    lineHeight: 24,
  },
  mobileServiceText: {
    color: colors.muted,
    fontFamily: typography.family.medium,
    fontSize: typography.size.body,
  },
  manualConfirmBadge: {
    marginTop: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  manualConfirmBadgeText: {
    color: colors.success,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  mobileStatusDotsRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 0,
  },
  dotsButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  empty: {
    minHeight: 300,
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  emptyTitle: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
    textAlign: "center",
  },
  emptyText: {
    maxWidth: 420,
    marginTop: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.regular,
    textAlign: "center",
  },
  emptyButton: {
    minHeight: 44,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  emptyButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
});
