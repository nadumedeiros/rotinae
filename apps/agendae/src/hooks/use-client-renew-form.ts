import { useState } from "react";

import type { Client as DomainClient } from "@/src/domain/clients/types";
import {
  brazilianToIso,
  isoToBrazilian,
  isValidBrazilianDate,
} from "@/src/domain/clients/client-form-utils";
import { clientPortfolioService } from "@/src/infra/clients/supabase-client-portfolio-adapter";
import { paymentService } from "@/src/infra/payments/supabase-payment-adapter";

export type ClientRenewFormStep = 1 | 2;

export type ClientRenewFormFieldErrors = {
  totalLimit?: string;
  requestFrom?: string;
  requestUntil?: string;
};

/**
 * Estado, validação e persistência do fluxo de renovação de pacote do
 * cliente (`renewClientPolicy` + cobrança automática no Financeiro quando
 * há valor de serviço), usado pelo botão "Renovar" do Perfil do Cliente
 * (`app/clients/[id].tsx`).
 *
 * Fluxo em duas etapas: 1) informativo/confirmação com os valores atuais
 * (que serão arquivados) e 2) formulário com os novos valores — mesma regra
 * de validação client-side já espelhada pelo backend em
 * `SupabaseClientPortfolioAdapter.renewClientPolicy`
 * (`validateRenewClientPolicyInput`, 20260823150000_client_policy_renewal.sql).
 */
export function useClientRenewForm(options: {
  onRenewed: () => void | Promise<void>;
}) {
  const { onRenewed } = options;

  const [client, setClient] = useState<DomainClient | null>(null);
  const [step, setStep] = useState<ClientRenewFormStep>(1);
  const [serviceValueCents, setServiceValueCents] = useState(0);
  const [totalLimitFree, setTotalLimitFree] = useState(true);
  const [totalLimit, setTotalLimit] = useState("");
  const [periodFree, setPeriodFree] = useState(true);
  const [requestFrom, setRequestFrom] = useState("");
  const [requestUntil, setRequestUntil] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ClientRenewFormFieldErrors>({});
  // Feedback visual de clique (padrão Nero): estado de pendência setado de
  // forma síncrona antes do `await` e sempre resetado em `finally`.
  const [saving, setSaving] = useState(false);

  function openForClient(target: DomainClient) {
    setClient(target);
    setStep(1);
    setServiceValueCents(target.serviceValueCents);
    setTotalLimitFree(target.bookingPolicy.totalBookingLimit === null);
    setTotalLimit(target.bookingPolicy.totalBookingLimit?.toString() ?? "");
    setPeriodFree(
      target.bookingPolicy.requestWindowStart === null &&
        target.bookingPolicy.requestWindowEnd === null,
    );
    setRequestFrom(isoToBrazilian(target.bookingPolicy.requestWindowStart));
    setRequestUntil(isoToBrazilian(target.bookingPolicy.requestWindowEnd));
    setFormError("");
    setFieldErrors({});
  }

  function goToStep2() {
    setStep(2);
  }

  function goToStep1() {
    setStep(1);
  }

  async function submit() {
    if (!client) return;
    const nextFieldErrors: ClientRenewFormFieldErrors = {};
    if (!totalLimitFree && (!Number.isInteger(Number(totalLimit)) || Number(totalLimit) < 1)) {
      nextFieldErrors.totalLimit = "Informe um número inteiro a partir de 1.";
    }
    if (!periodFree && !isValidBrazilianDate(requestFrom)) {
      nextFieldErrors.requestFrom = "Informe uma data válida (DD/MM/AAAA).";
    }
    if (!periodFree && !isValidBrazilianDate(requestUntil)) {
      nextFieldErrors.requestUntil = "Informe uma data válida (DD/MM/AAAA).";
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFormError("Confira os campos destacados abaixo.");
      return;
    }
    if (!periodFree && brazilianToIso(requestFrom) > brazilianToIso(requestUntil)) {
      setFormError("A data inicial não pode ser posterior à data final.");
      setFieldErrors((current) => ({
        ...current,
        requestFrom: "Data inicial posterior à final.",
        requestUntil: "Data final anterior à inicial.",
      }));
      return;
    }

    const parsedTotal = Number(totalLimit);
    setSaving(true);
    try {
      await clientPortfolioService.renewClientPolicy({
        clientId: client.id,
        totalBookingLimit: totalLimitFree ? null : parsedTotal,
        serviceValueCents,
        requestWindowStart: periodFree ? null : brazilianToIso(requestFrom),
        requestWindowEnd: periodFree ? null : brazilianToIso(requestUntil),
      });

      // BLG: mesmo padrão de `onCreated` em `app/clients.tsx` (cadastro
      // novo) — os valores novos entram automaticamente no Financeiro como
      // uma cobrança pendente, sem travar o fluxo principal se a criação da
      // cobrança falhar (a renovação em si já foi bem-sucedida neste ponto).
      if (serviceValueCents > 0) {
        try {
          await paymentService.createPayment({
            clientId: client.id,
            origin: client.primaryService || "Atendimento",
            valueCents: serviceValueCents,
            dueDate: new Date().toISOString().slice(0, 10),
            status: "pending",
            notes: `Cobrança vinculada à renovação de ${client.name}`,
          });
        } catch (paymentError) {
          console.warn("[client-renew-form] createPayment pendente automático falhou", paymentError);
        }
      }

      setFormError("");
      await onRenewed();
    } catch (renewError) {
      // BLG-073: mesmo padrão de instrumentação já usado nas demais
      // mutações de cliente (`useClientEditForm`).
      console.error("[client-renew-form] submit falhou", renewError);
      setFormError(renewError instanceof Error ? renewError.message : "Não foi possível renovar o cliente.");
    } finally {
      setSaving(false);
    }
  }

  return {
    client,
    step,
    serviceValueCents,
    setServiceValueCents,
    totalLimitFree,
    setTotalLimitFree,
    totalLimit,
    setTotalLimit,
    periodFree,
    setPeriodFree,
    requestFrom,
    setRequestFrom,
    requestUntil,
    setRequestUntil,
    formError,
    setFormError,
    fieldErrors,
    setFieldErrors,
    saving,
    openForClient,
    goToStep2,
    goToStep1,
    submit,
  };
}

export type ClientRenewForm = ReturnType<typeof useClientRenewForm>;
