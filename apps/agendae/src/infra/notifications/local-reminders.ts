import type { AppointmentRecord } from "@/src/domain/agenda/types";

// Versão da Web: o navegador não agenda lembretes locais.
export async function scheduleAppointmentReminders(
  appointments: AppointmentRecord[],
): Promise<void> {
  void appointments;
}

export function subscribeToReminderActions(): () => void {
  return () => undefined;
}

export async function cancelAllReminders(): Promise<void> { }
