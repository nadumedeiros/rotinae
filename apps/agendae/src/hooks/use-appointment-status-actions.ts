import { useState } from "react";

import { appointmentService } from "@/src/infra/agenda/supabase-appointment-adapter";

/**
 * Estado e mutações de "concluir"/"cancelar" um agendamento.
 *
 * Compartilhado entre a tela de Agenda (`app/agenda.tsx`) e o Perfil do
 * Cliente (`app/clients/[id].tsx`): as duas telas operam sobre a mesma
 * tabela/serviço (`appointmentService`), então a mutação de status não pode
 * divergir entre elas — daqui vem a garantia de que uma alteração feita em
 * qualquer uma das duas telas reflete na outra ao focar a rota novamente.
 *
 * `onChanged` deve re-buscar os dados da tela que usa o hook (ex.:
 * `reloadAgenda` na Agenda, recarregar os agendamentos do cliente no Perfil).
 */
export function useAppointmentStatusActions(options: {
  onChanged: () => void | Promise<void>;
  onError?: (message: string) => void;
}) {
  const { onChanged, onError } = options;
  const [finalizeId, setFinalizeId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [revertId, setRevertId] = useState<string | null>(null);
  // Feedback visual de clique (padrão Nero): estado de pendência setado de
  // forma síncrona antes do `await` e sempre resetado em `finally`.
  const [finalizing, setFinalizing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [internalError, setInternalError] = useState("");

  function reportError(message: string) {
    if (onError) onError(message);
    else setInternalError(message);
  }

  function openCancel(appointmentId: string) {
    setCancellationReason("");
    setCancelId(appointmentId);
  }

  function closeCancel() {
    setCancelId(null);
    setCancellationReason("");
  }

  function closeFinalize() {
    setFinalizeId(null);
  }

  function closeRevert() {
    setRevertId(null);
  }

  async function finalizeAppointment() {
    if (!finalizeId) return;
    setFinalizing(true);
    try {
      await appointmentService.updateAppointment(finalizeId, { state: "completed" });
      await onChanged();
      setFinalizeId(null);
    } catch (finalizeError) {
      reportError(
        finalizeError instanceof Error
          ? finalizeError.message
          : "Não foi possível marcar o agendamento como concluído.",
      );
    } finally {
      setFinalizing(false);
    }
  }

  async function cancelAppointment() {
    if (!cancelId) return;
    setCancelling(true);
    try {
      await appointmentService.cancelAppointment(cancelId, {
        reason: cancellationReason.trim() || null,
      });
      await onChanged();
      closeCancel();
    } catch (cancelError) {
      reportError(
        cancelError instanceof Error
          ? cancelError.message
          : "Não foi possível cancelar o agendamento.",
      );
    } finally {
      setCancelling(false);
    }
  }

  // Reversão de estado terminal (Cancelado/Concluído/Não compareceu) de
  // volta para "Agendado" — mesmo padrão de `finalizeAppointment`: sem
  // estado extra de formulário, só o id do agendamento em ação.
  async function revertAppointment() {
    if (!revertId) return;
    setReverting(true);
    try {
      await appointmentService.revertToScheduled(revertId);
      await onChanged();
      setRevertId(null);
    } catch (revertError) {
      reportError(
        revertError instanceof Error
          ? revertError.message
          : "Não foi possível reverter o agendamento para agendado.",
      );
    } finally {
      setReverting(false);
    }
  }

  return {
    finalizeId,
    setFinalizeId,
    closeFinalize,
    cancelId,
    openCancel,
    closeCancel,
    cancellationReason,
    setCancellationReason,
    revertId,
    setRevertId,
    closeRevert,
    finalizing,
    cancelling,
    reverting,
    internalError,
    finalizeAppointment,
    cancelAppointment,
    revertAppointment,
  };
}

export type AppointmentStatusActions = ReturnType<typeof useAppointmentStatusActions>;
