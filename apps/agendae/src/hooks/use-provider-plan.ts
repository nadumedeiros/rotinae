import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { ler, salvar } from "@/src/infra/storage/async-storage";

export type ProviderPlan = "free" | "premium";
export type ProviderPlanState = {
  plan: ProviderPlan;
  source: "trial" | "manual" | "subscription";
  trialEndsAt?: string;
  trialEndsAtIso?: string;
  cancelAtPeriodEnd?: boolean;
};
export const providerPlanStorageKey = "agendae:provider-plan:v1";
export const providerPlanUpdatedEvent = "agendae:provider-plan-updated";
const defaultPlanState: ProviderPlanState = {
  plan: "premium",
  source: "trial",
  trialEndsAt: "01/09/2026 às 18:00",
  trialEndsAtIso: "2026-09-01T21:00:00.000Z",
  cancelAtPeriodEnd: false,
};

function resolveExpiredTrial(state: ProviderPlanState): ProviderPlanState {
  if (
    state.source === "trial" &&
    state.trialEndsAtIso &&
    Date.now() >= new Date(state.trialEndsAtIso).getTime()
  )
    return { plan: "free", source: "manual" };
  return state;
}

/**
 * Compatibilidade para consumidores que consultam o direito Premium por
 * data. A data do agendamento não encerra benefícios durante um teste ativo:
 * somente o estado atual do plano determina o acesso.
 */
export function hasPremiumForAppointmentDate(
  state: ProviderPlanState,
  _appointmentDate: string,
) {
  return state.plan === "premium";
}

export function useProviderPlanState() {
  const [planState, setPlanState] = useState<ProviderPlanState>(defaultPlanState);

  useEffect(() => {
    let active = true;

    async function sync() {
      // O plano só é guardado pela tela de planos na web (app/plans.tsx).
      // Mantemos a mesma regra de antes para o app se comportar igual.
      if (Platform.OS !== "web") return;
      try {
        const stored = await ler(providerPlanStorageKey);
        if (!active) return;
        const parsed = stored
          ? ({ ...defaultPlanState, ...JSON.parse(stored) } as ProviderPlanState)
          : defaultPlanState;
        const next = resolveExpiredTrial(parsed);
        setPlanState(next);
        if (next !== parsed) await salvar(providerPlanStorageKey, JSON.stringify(next));
      } catch {
        if (active) setPlanState(defaultPlanState);
      }
    }
    const runSync = () => void sync();
    runSync();
    if (Platform.OS === "web") window.addEventListener(providerPlanUpdatedEvent, runSync);
    const timer = setInterval(runSync, 60_000);
    return () => {
      active = false;
      if (Platform.OS === "web") window.removeEventListener(providerPlanUpdatedEvent, runSync);
      clearInterval(timer);
    };
  }, []);

  return planState;
}

export function useProviderPlan() {
  return useProviderPlanState().plan;
}

// ----------------------------------------------------------------------------
// RN-PLN-018/019/020 (20260819100000_provider_plan_horizon_limit.sql):
// horizonte de agendamento do plano do prestador — Premium (ativo ou trial
// vigente) agenda sem nenhum teto de meses; Gratuito fica limitado a
// `maxAllowedDate` (~1 mês à frente, já resolvido no fuso do prestador pelo
// servidor). Lido via `get_provider_appointment_horizon` (RPC de LEITURA):
// serve só para o seletor de datas desabilitar/evitar submissões fadadas a
// falhar — a barreira de segurança real é sempre o servidor, dentro de
// `_create_appointment_row`/`update_appointment` (`PLAN_LIMIT_REACHED`).
// ----------------------------------------------------------------------------

export type AppointmentHorizonState = {
  /** `true` enquanto a primeira resposta da RPC ainda não chegou. */
  loading: boolean;
  unrestricted: boolean;
  maxAllowedDate: Date | null;
};

// Otimista por padrão (nunca bloqueia a UI antes da resposta do servidor;
// RF-PLN-010): enquanto carrega, ou se a leitura falhar por rede/sessão, o
// seletor não aplica nenhum teto — o servidor sempre revalida no envio.
const optimisticHorizonState: AppointmentHorizonState = {
  loading: true,
  unrestricted: true,
  maxAllowedDate: null,
};

/** Interpreta `YYYY-MM-DD` (coluna `date` do Postgres) como `Date` normalizada em UTC. */
function parseIsoDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

// Import dinâmico evita carregar o cliente Supabase até que um dos hooks de
// horizonte seja realmente montado. Isso mantém os hooks de plano simples
// utilizáveis também em testes que não configuram credenciais do Supabase.
function loadAppointmentService() {
  return import("@/src/infra/agenda/supabase-appointment-adapter").then(
    (module) => module.appointmentService,
  );
}

/**
 * Horizonte de agendamento do PRÓPRIO prestador logado (uso em
 * `app/agenda.tsx`, formulário de agendamento do prestador). Não recebe
 * `tenantId`: o servidor resolve o tenant do chamador a partir da sessão.
 */
export function useProviderAppointmentHorizon(): AppointmentHorizonState {
  const [state, setState] = useState<AppointmentHorizonState>(optimisticHorizonState);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    loadAppointmentService()
      .then((appointmentService) => appointmentService.getAppointmentHorizon())
      .then((horizon) => {
        if (cancelled) return;
        setState({
          loading: false,
          unrestricted: horizon.unrestricted,
          maxAllowedDate: horizon.maxAllowedDate ? parseIsoDateOnly(horizon.maxAllowedDate) : null,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, unrestricted: true, maxAllowedDate: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Mesma regra (RN-PLN-018/019), mas para o autoatendimento do CLIENTE
 * vinculado (uso em `app/client-booking.tsx`): o horizonte consultado é
 * sempre o do PRESTADOR selecionado (`tenantId`) — o cliente não tem plano
 * próprio. `tenantId` nulo (nenhum prestador escolhido ainda) não dispara
 * nenhuma chamada de rede e mantém o seletor sem teto.
 */
export function useClientAppointmentHorizon(tenantId: string | null): AppointmentHorizonState {
  const [state, setState] = useState<AppointmentHorizonState>(optimisticHorizonState);

  useEffect(() => {
    if (!tenantId) {
      setState({ loading: false, unrestricted: true, maxAllowedDate: null });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    loadAppointmentService()
      .then((appointmentService) => appointmentService.getAppointmentHorizon(tenantId))
      .then((horizon) => {
        if (cancelled) return;
        setState({
          loading: false,
          unrestricted: horizon.unrestricted,
          maxAllowedDate: horizon.maxAllowedDate ? parseIsoDateOnly(horizon.maxAllowedDate) : null,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, unrestricted: true, maxAllowedDate: null });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return state;
}
