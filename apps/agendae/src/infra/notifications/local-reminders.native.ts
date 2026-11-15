
import * as Notifications from "expo-notifications";
import type { AppointmentRecord } from "@/src/domain/agenda/types";

const REMINDER_MINUTES = 30;

export async function scheduleAppointmentReminders(
  appointments: AppointmentRecord[],
): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();

  let permissionStatus = status;

  if (permissionStatus !== "granted") {
    const permission = await Notifications.requestPermissionsAsync();
    permissionStatus = permission.status;
  }

  if (permissionStatus !== "granted") {
    return;
  }

  const scheduledNotifications =
    await Notifications.getAllScheduledNotificationsAsync();

  const scheduledAppointmentIds = new Set(
    scheduledNotifications
      .map((notification) => notification.content.data?.appointmentId)
      .filter((id): id is string => typeof id === "string"),
  );

  for (const appointment of appointments) {
    if (appointment.state !== "scheduled") {
      continue;
    }

    if (scheduledAppointmentIds.has(appointment.id)) {
      continue;
    }

    const appointmentDate = new Date(appointment.startsAt);

    if (Number.isNaN(appointmentDate.getTime())) {
      continue;
    }

    const reminderDate = new Date(
      appointmentDate.getTime() - REMINDER_MINUTES * 60 * 1000,
    );

    if (reminderDate.getTime() <= Date.now()) {
      continue;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Lembrete de atendimento",
        body: "Você tem um atendimento em 30 minutos.",
        data: {
          appointmentId: appointment.id,
        },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
      },
    });

    scheduledAppointmentIds.add(appointment.id);
  }
}
