import * as Notifications from "expo-notifications";

import type { AppointmentRecord } from "@/src/domain/agenda/types";
import {
    handleReminderAction,
    scheduleAppointmentReminders,
} from "../local-reminders.native";

jest.mock("expo-notifications", () => ({
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    setNotificationCategoryAsync: jest.fn(),
    getAllScheduledNotificationsAsync: jest.fn(),
    scheduleNotificationAsync: jest.fn(),
    cancelScheduledNotificationAsync: jest.fn(),
    dismissNotificationAsync: jest.fn(),
    SchedulableTriggerInputTypes: { DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const agendar = Notifications.scheduleNotificationAsync as jest.Mock;
const cancelar = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const agendados = Notifications.getAllScheduledNotificationsAsync as jest.Mock;


const daquiDuasHoras = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

function atendimento(extra: Partial<AppointmentRecord>): AppointmentRecord {
    return { id: "a1", state: "scheduled", startsAt: daquiDuasHoras, ...extra } as AppointmentRecord;
}

function lembreteJaAgendado(startsAt: string) {
    return { identifier: "n1", content: { data: { appointmentId: "a1", startsAt } } };
}

describe("lembretes locais", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: "granted" });
        agendados.mockResolvedValue([]);
    });

    it("agenda o lembrete de um atendimento novo", async () => {
        await scheduleAppointmentReminders([atendimento({})]);
        expect(agendar).toHaveBeenCalledTimes(1);
    });

    it("não duplica o lembrete de um atendimento que já tem", async () => {
        agendados.mockResolvedValue([lembreteJaAgendado(daquiDuasHoras)]);
        await scheduleAppointmentReminders([atendimento({})]);
        expect(agendar).not.toHaveBeenCalled();
        expect(cancelar).not.toHaveBeenCalled();
    });

    it("cancela o lembrete quando o atendimento é cancelado", async () => {
        agendados.mockResolvedValue([lembreteJaAgendado(daquiDuasHoras)]);
        await scheduleAppointmentReminders([atendimento({ state: "cancelled" })]);
        expect(cancelar).toHaveBeenCalledWith("n1");
        expect(agendar).not.toHaveBeenCalled();
    });

    it("troca o lembrete quando o atendimento é remarcado", async () => {
        const horarioAntigo = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
        agendados.mockResolvedValue([lembreteJaAgendado(horarioAntigo)]);
        await scheduleAppointmentReminders([atendimento({})]);
        expect(cancelar).toHaveBeenCalledWith("n1");
        expect(agendar).toHaveBeenCalledTimes(1);
    });

    it("botão Adiar agenda o lembrete de novo em 10 minutos", async () => {
        await handleReminderAction({
            actionIdentifier: "adiar",
            notification: { request: { identifier: "n1", content: { data: { appointmentId: "a1", startsAt: daquiDuasHoras } } } },
        } as unknown as Notifications.NotificationResponse);
        expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("n1");
        expect(agendar).toHaveBeenCalledWith(
            expect.objectContaining({ trigger: { type: "timeInterval", seconds: 600 } }),
        );
    });

    it("botão Ok só fecha a notificação", async () => {
        await handleReminderAction({
            actionIdentifier: "ok",
            notification: { request: { identifier: "n1", content: { data: { appointmentId: "a1", startsAt: daquiDuasHoras } } } },
        } as unknown as Notifications.NotificationResponse);
        expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("n1");
        expect(agendar).not.toHaveBeenCalled();
    });
});