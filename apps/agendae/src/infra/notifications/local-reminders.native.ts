import * as Notifications from "expo-notifications";
import type { AppointmentRecord } from "@/src/domain/agenda/types";

const REMINDER_MINUTES = 30;
const SNOOZE_MINUTES = 10;

// essa categoria faz o "tipo" de notificação que tem os botões "Adiar" e "Ok".
const CATEGORY_ID = "lembrete-atendimento";
const ACTION_SNOOZE = "adiar";
const ACTION_OK = "ok";

type ReminderData = { appointmentId?: unknown; startsAt?: unknown };
async function registerReminderCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
    { identifier: ACTION_SNOOZE, buttonTitle: `Adiar ${SNOOZE_MINUTES} min`, options: { opensAppToForeground: true } },
    { identifier: ACTION_OK, buttonTitle: "Ok", options: { opensAppToForeground: true } },
  ]);
}

function buildContent(appointmentId: string, startsAt: string, body: string): Notifications.NotificationContentInput {
  return {
    title: "Lembrete de atendimento",
    body,
    data: { appointmentId, startsAt },
    sound: true,
    categoryIdentifier: CATEGORY_ID,
  };
}
async function scheduleReminder(appointment: AppointmentRecord): Promise<void> {
  const appointmentDate = new Date(appointment.startsAt);

  if (Number.isNaN(appointmentDate.getTime())) {
    return;
  }

  const reminderDate = new Date(
    appointmentDate.getTime() - REMINDER_MINUTES * 60 * 1000,
  );

  if (reminderDate.getTime() <= Date.now()) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: buildContent(
      appointment.id,
      appointment.startsAt,
      `Você tem um atendimento em ${REMINDER_MINUTES} minutos.`,
    ),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
    },
  });
}

// Chamada toda vez que a agenda carrega: deixa os lembretes iguais à agenda.
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

  await registerReminderCategory();

  // lembretes que já estão agendados no celular por atendimento.
  const scheduledNotifications =
    await Notifications.getAllScheduledNotificationsAsync();

  const existing = new Map<string, { identifier: string; startsAt: unknown }>();

  for (const notification of scheduledNotifications) {
    const data = notification.content.data as ReminderData | undefined;

    if (typeof data?.appointmentId === "string") {
      existing.set(data.appointmentId, {
        identifier: notification.identifier,
        startsAt: data.startsAt,
      });
    }
  }

  for (const appointment of appointments) {
    const current = existing.get(appointment.id);

    // Condições aqui
    // aqui trata cancelado, concluído ou falta: o lembrete sai.
    if (appointment.state !== "scheduled") {
      if (current) {
        await Notifications.cancelScheduledNotificationAsync(current.identifier);
      }
      continue;
    }
    // se já existe lembrete para esse mesmo horário: nada a fazer.
    if (current && current.startsAt === appointment.startsAt) {
      continue;
    }

    // se remarcado: tira o lembrete do horário antigo antes de criar o novo.
    if (current) {
      await Notifications.cancelScheduledNotificationAsync(current.identifier);
    }

    await scheduleReminder(appointment);
  }
}

// O que acontece quando a pessoa toca em "Adiar" ou "Ok" na notificação:
export async function handleReminderAction(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const { actionIdentifier, notification } = response;

  if (actionIdentifier !== ACTION_SNOOZE && actionIdentifier !== ACTION_OK) {
    return;
  }

  await Notifications.dismissNotificationAsync(notification.request.identifier);

  if (actionIdentifier !== ACTION_SNOOZE) {
    return;
  }

  const data = notification.request.content.data as ReminderData | undefined;

  if (typeof data?.appointmentId !== "string" || typeof data.startsAt !== "string") {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: buildContent(
      data.appointmentId,
      data.startsAt,
      "Lembrete adiado: seu atendimento está chegando.",
    ),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: SNOOZE_MINUTES * 60,
    },
  });
}

// Liga os botões da notificação. Chamada uma vez, quando o app abre.
export function subscribeToReminderActions(): () => void {
  void registerReminderCategory().catch(() => undefined);

  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      void handleReminderAction(response).catch(() => undefined);
    },
  );

  return () => subscription.remove();
}

// Usada no logout: nenhum lembrete da conta anterior fica agendado.
export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

