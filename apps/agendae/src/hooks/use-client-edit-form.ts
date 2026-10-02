import { useState } from "react";

import type { Client as DomainClient } from "@/src/domain/clients/types";
import {
  brazilianToIso,
  formatPhoneInput,
  isoToBrazilian,
  isValidBrazilianDate,
  isValidEmail,
} from "@/src/domain/clients/client-form-utils";
import type { ProviderPlan } from "@/src/hooks/use-provider-plan";
import { clientPortfolioService } from "@/src/infra/clients/supabase-client-portfolio-adapter";

export type ClientEditFormFieldErrors = {
  name?: string;
  email?: string;
  phone?: string;
  serviceValue?: string;
  totalLimit?: string;
  dailyLimit?: string;
  requestFrom?: string;
  requestUntil?: string;
};

export type ClientEditFormStatus = "Ativo" | "Inativo";

export type ClientEditFormResult =
  | { mode: "create"; client: DomainClient }
  | { mode: "edit"; client: DomainClient };

/**
 * Estado, validação e persistência do formulário de cadastro/edição de
 * cliente (dados básicos + política de agendamento).
 *
 * Extraído de `app/clients.tsx` (fluxo original de `openNewClient` /
 * `editClient` / `saveClient`) para ser reaproveitado também pelo botão
 * "Editar perfil" e pelos menus de edição inline do Perfil do Cliente
 * (`app/clients/[id].tsx`) — a regra de validação (limites, período, e-mail
 * duplicado) é a mesma nas duas telas e não deve divergir.
 */
export function useClientEditForm(options: {
  providerPlan: ProviderPlan;
  /** Clientes existentes (id + e-mail) para detectar e-mail duplicado; inclui o próprio cliente em edição (é excluído internamente pelo id). */
  existingClients: { id: string; email: string }[];
  onSaved: (result: ClientEditFormResult) => void | Promise<void>;
  /** Chamado após criar com sucesso — hoje usado só pela lista de clientes para gerar uma cobrança pendente automática quando há valor de serviço. */
  onCreated?: (created: DomainClient) => void | Promise<void>;
}) {
  const { providerPlan, existingClients, onSaved, onCreated } = options;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsappConfirmation, setWhatsappConfirmation] = useState(false);
  const [whatsappReminder, setWhatsappReminder] = useState(false);
  const [service, setService] = useState("");
  // Ver `Client.primaryServiceId`: referência opcional ao catálogo
  // (`ServiceCatalogPort`). Mantido em sincronia com `service` (nome) pelo
  // seletor em `ClientEditModal` — nunca digitado manualmente, então nunca
  // fica desatualizado em relação ao rótulo exibido.
  const [primaryServiceId, setPrimaryServiceId] = useState<string | null>(null);
  const [serviceValueCents, setServiceValueCents] = useState(0);
  const [totalLimitFree, setTotalLimitFree] = useState(true);
  const [totalLimit, setTotalLimit] = useState("");
  const [dailyLimitFree, setDailyLimitFree] = useState(true);
  const [dailyLimit, setDailyLimit] = useState("");
  const [periodFree, setPeriodFree] = useState(true);
  const [requestFrom, setRequestFrom] = useState("");
  const [requestUntil, setRequestUntil] = useState("");
  const [status, setStatus] = useState<ClientEditFormStatus>("Ativo");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ClientEditFormFieldErrors>({});
  // Feedback visual de clique (padrão Nero): estado de pendência setado de
  // forma síncrona antes do `await` e sempre resetado em `finally`.
  const [saving, setSaving] = useState(false);

  function resetForCreate() {
    setEditingId(null);
    setName("");
    setEmail("");
    setPhone("");
    setWhatsappConfirmation(false);
    setWhatsappReminder(false);
    setService("");
    setPrimaryServiceId(null);
    setServiceValueCents(0);
    setTotalLimitFree(true);
    setTotalLimit("");
    setDailyLimitFree(true);
    setDailyLimit("");
    setPeriodFree(true);
    setRequestFrom("");
    setRequestUntil("");
    setStatus("Ativo");
    setFormError("");
    setFieldErrors({});
  }

  function loadForEdit(client: DomainClient) {
    setEditingId(client.id);
    setName(client.name);
    setEmail(client.email);
    setPhone(formatPhoneInput(client.phone?.replace(/^\+55/, "") ?? ""));
    setWhatsappConfirmation(client.communicationPreferences.whatsappAppointmentConfirmation);
    setWhatsappReminder(client.communicationPreferences.whatsappAppointmentReminder);
    setService(client.primaryService ?? "");
    setPrimaryServiceId(client.primaryServiceId ?? null);
    setServiceValueCents(client.serviceValueCents);
    setTotalLimitFree(client.bookingPolicy.totalBookingLimit === null);
    setTotalLimit(client.bookingPolicy.totalBookingLimit?.toString() ?? "");
    setDailyLimitFree(client.bookingPolicy.dailyBookingLimit === null);
    setDailyLimit(client.bookingPolicy.dailyBookingLimit?.toString() ?? "");
    setPeriodFree(
      client.bookingPolicy.requestWindowStart === null &&
        client.bookingPolicy.requestWindowEnd === null,
    );
    setRequestFrom(isoToBrazilian(client.bookingPolicy.requestWindowStart));
    setRequestUntil(isoToBrazilian(client.bookingPolicy.requestWindowEnd));
    setStatus(client.status === "active" ? "Ativo" : "Inativo");
    setFormError("");
    setFieldErrors({});
  }

  async function submit() {
    if (!editingId && providerPlan === "free" && existingClients.length >= 5) {
      setFormError("O Plano Gratuito permite até 5 clientes cadastrados.");
      return;
    }
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const phoneDigits = phone.replace(/\D/g, "");
    const nextFieldErrors: ClientEditFormFieldErrors = {};
    if (!cleanName) nextFieldErrors.name = "Informe o nome do cliente.";
    if (cleanEmail && !isValidEmail(cleanEmail)) nextFieldErrors.email = "Informe um e-mail válido.";
    if (phoneDigits && !/^\d{10,11}$/.test(phoneDigits)) nextFieldErrors.phone = "Informe um telefone com DDD válido.";
    if (!totalLimitFree && (!Number.isInteger(Number(totalLimit)) || Number(totalLimit) < 1)) nextFieldErrors.totalLimit = "Informe um número inteiro a partir de 1.";
    if (!dailyLimitFree && (!Number.isInteger(Number(dailyLimit)) || Number(dailyLimit) < 1)) nextFieldErrors.dailyLimit = "Informe um número inteiro a partir de 1.";
    if (!periodFree && !isValidBrazilianDate(requestFrom)) nextFieldErrors.requestFrom = "Informe uma data válida (DD/MM/AAAA).";
    if (!periodFree && !isValidBrazilianDate(requestUntil)) nextFieldErrors.requestUntil = "Informe uma data válida (DD/MM/AAAA).";
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFormError("Confira os campos destacados abaixo.");
      return;
    }
    if (
      cleanEmail &&
      existingClients.some(
        (client) =>
          client.email &&
          client.email.toLocaleLowerCase("pt-BR") === cleanEmail.toLocaleLowerCase("pt-BR") &&
          client.id !== editingId,
      )
    ) {
      setFormError("Já existe um cliente cadastrado com este e-mail.");
      setFieldErrors((current) => ({ ...current, email: "Já existe um cliente com este e-mail." }));
      return;
    }
    const parsedTotal = Number(totalLimit);
    const parsedDaily = Number(dailyLimit);
    if (!totalLimitFree && !dailyLimitFree && parsedDaily > parsedTotal) {
      setFormError("O limite diário não pode ser maior que o limite total.");
      setFieldErrors((current) => ({ ...current, dailyLimit: "Não pode ser maior que o limite total." }));
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
    const payload = {
      name: cleanName,
      email: cleanEmail,
      phone: phoneDigits ? `+55${phoneDigits}` : null,
      communicationPreferences: {
        whatsappAppointmentConfirmation: whatsappConfirmation,
        whatsappAppointmentReminder: whatsappReminder,
      },
      linkInvitationDelivery: "none" as const,
      status: status === "Ativo" ? ("active" as const) : ("inactive" as const),
      primaryService: service.trim() || null,
      primaryServiceId,
      serviceValueCents,
      bookingPolicy: {
        totalBookingLimit: totalLimitFree ? null : parsedTotal,
        dailyBookingLimit: dailyLimitFree ? null : parsedDaily,
        requestWindowStart: periodFree ? null : brazilianToIso(requestFrom),
        requestWindowEnd: periodFree ? null : brazilianToIso(requestUntil),
      },
    };
    setSaving(true);
    try {
      if (editingId) {
        const updated = await clientPortfolioService.updateClient({ id: editingId, ...payload });
        setFormError("");
        await onSaved({ mode: "edit", client: updated });
      } else {
        const created = await clientPortfolioService.createClient(payload);
        if (onCreated) await onCreated(created);
        setFormError("");
        await onSaved({ mode: "create", client: created });
      }
    } catch (saveError) {
      // BLG-073: mesmo padrão de instrumentação já usado nas demais mutações
      // de cliente — sem isto, qualquer causa de falha além da validação de
      // e-mail (rede, sessão expirada, RLS) fica sem rastro no console.
      console.error("[client-edit-form] submit falhou", saveError);
      setFormError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o cliente.");
    } finally {
      setSaving(false);
    }
  }

  return {
    editingId,
    name,
    setName,
    email,
    setEmail,
    phone,
    setPhone,
    whatsappConfirmation,
    setWhatsappConfirmation,
    whatsappReminder,
    setWhatsappReminder,
    service,
    setService,
    primaryServiceId,
    setPrimaryServiceId,
    serviceValueCents,
    setServiceValueCents,
    totalLimitFree,
    setTotalLimitFree,
    totalLimit,
    setTotalLimit,
    dailyLimitFree,
    setDailyLimitFree,
    dailyLimit,
    setDailyLimit,
    periodFree,
    setPeriodFree,
    requestFrom,
    setRequestFrom,
    requestUntil,
    setRequestUntil,
    status,
    setStatus,
    formError,
    setFormError,
    fieldErrors,
    setFieldErrors,
    saving,
    resetForCreate,
    loadForEdit,
    submit,
  };
}

export type ClientEditForm = ReturnType<typeof useClientEditForm>;
