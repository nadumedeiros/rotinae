import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AppIcon } from "@/src/components/ui/app-icon";
import type { AppointmentStatusActions } from "@/src/hooks/use-appointment-status-actions";
import { colors, elevation, opacity, radius, spacing, typography } from "@/src/theme/tokens";

/**
 * Modais de confirmação de "Marcar como concluído", "Cancelar agendamento"
 * e "Reverter para agendado".
 *
 * Extraído de `app/agenda.tsx` para ser reaproveitado também pelo Perfil do
 * Cliente (`app/clients/[id].tsx`) — mesmo visual e mesma lógica de mutação
 * (via `useAppointmentStatusActions`) nas duas telas, sem reimplementação
 * paralela.
 */
export function AppointmentStatusActionModals({ actions }: { actions: AppointmentStatusActions }) {
  return (
    <>
      <Modal
        visible={actions.finalizeId !== null}
        transparent
        animationType="fade"
        onRequestClose={actions.closeFinalize}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.finalizeIcon}>
              <AppIcon name="success" size={24} color={colors.brand} />
            </View>
            <Text style={styles.confirmTitle}>Marcar como concluído?</Text>
            <Text style={styles.confirmText}>
              O agendamento será marcado como concluído e não poderá mais ser
              editado ou cancelado.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={actions.finalizing}
                onPress={actions.closeFinalize}
                style={[styles.cancelButton, actions.finalizing && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Voltar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: actions.finalizing, busy: actions.finalizing }}
                disabled={actions.finalizing}
                onPress={() => void actions.finalizeAppointment()}
                style={({ pressed }) => [
                  styles.finalizeConfirmButton,
                  styles.confirmButtonSpinnerRow,
                  pressed && !actions.finalizing && { opacity: opacity.pressed },
                ]}
              >
                {actions.finalizing && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.finalizeConfirmButtonText}>Marcar como concluído</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={actions.cancelId !== null}
        transparent
        animationType="fade"
        onRequestClose={actions.closeCancel}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.confirmIcon}>
              <AppIcon name="error" size={24} color={colors.danger} />
            </View>
            <Text style={styles.confirmTitle}>Cancelar agendamento?</Text>
            <Text style={styles.confirmText}>
              O compromisso continuará no histórico com o status Cancelado e o
              horário voltará a ficar disponível para novos agendamentos.
            </Text>
            <View style={styles.cancellationReasonField}>
              <Text style={styles.label}>
                Motivo para o cliente <Text style={styles.optional}>(opcional)</Text>
              </Text>
              <TextInput
                accessibilityLabel="Motivo do cancelamento para o cliente"
                value={actions.cancellationReason}
                onChangeText={actions.setCancellationReason}
                placeholder="Ex.: Preciso reorganizar minha agenda"
                placeholderTextColor={colors.mutedSoft}
                multiline
                maxLength={500}
                style={[styles.input, styles.cancellationReasonInput]}
              />
              <Text style={styles.helperText}>
                Esta mensagem será enviada e ficará visível para o cliente.
              </Text>
            </View>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={actions.cancelling}
                onPress={actions.closeCancel}
                style={[styles.cancelButton, actions.cancelling && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Voltar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: actions.cancelling, busy: actions.cancelling }}
                disabled={actions.cancelling}
                onPress={() => void actions.cancelAppointment()}
                style={({ pressed }) => [
                  styles.confirmDelete,
                  styles.confirmButtonSpinnerRow,
                  pressed && !actions.cancelling && { opacity: opacity.pressed },
                ]}
              >
                {actions.cancelling && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.confirmDeleteText}>Confirmar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={actions.revertId !== null}
        transparent
        animationType="fade"
        onRequestClose={actions.closeRevert}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmModal}>
            <View style={styles.revertIcon}>
              <AppIcon name="schedule" size={24} color={colors.warning} />
            </View>
            <Text style={styles.confirmTitle}>Reverter para Agendado?</Text>
            <Text style={styles.confirmText}>
              O agendamento voltará ao status Agendado. Se o horário já
              estiver ocupado por outro compromisso, a reversão será
              bloqueada.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={actions.reverting}
                onPress={actions.closeRevert}
                style={[styles.cancelButton, actions.reverting && { opacity: opacity.disabled }]}
              >
                <Text style={styles.cancelButtonText}>Voltar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: actions.reverting, busy: actions.reverting }}
                disabled={actions.reverting}
                onPress={() => void actions.revertAppointment()}
                style={({ pressed }) => [
                  styles.revertConfirmButton,
                  styles.confirmButtonSpinnerRow,
                  pressed && !actions.reverting && { opacity: opacity.pressed },
                ]}
              >
                {actions.reverting && <ActivityIndicator size="small" color={colors.onBrand} />}
                <Text style={styles.revertConfirmButtonText}>Reverter para agendado</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  finalizeIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  revertIcon: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
  },
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
  label: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  optional: { color: colors.mutedSoft, fontFamily: typography.family.regular },
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
  confirmButtonSpinnerRow: {
    flexDirection: "row",
    alignItems: "center",
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
    textAlign: "center",
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
  revertConfirmButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    flexShrink: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.warning,
  },
  revertConfirmButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
});
