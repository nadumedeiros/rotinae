import { useCallback, useEffect, useRef } from 'react';

type UseIdleTimerArgs = {
  /** Tempo de inatividade, em ms, até `onIdle` ser disparado. */
  timeoutMs: number;
  /** Quando `false`, nenhum timer roda (ex.: usuário não autenticado). */
  enabled: boolean;
  /** Disparado quando o tempo de inatividade é atingido. */
  onIdle: () => void;
};

/**
 * Hook de inatividade genérico, sem nenhuma dependência de plataforma
 * (não sabe o que é "atividade" — quem decide isso é quem consome o hook,
 * via `registerActivity`).
 *
 * BLG-073/DEC-127 (ver `src/infra/supabase/client.ts`): no React Native,
 * timers de JS ficam suspensos enquanto o app está em segundo plano — um
 * `setTimeout` agendado para daqui a alguns minutos simplesmente não dispara
 * durante esse período. Por isso o tempo restante é sempre recalculado a
 * partir do relógio (`Date.now()`), nunca assumido apenas pelo disparo do
 * `setTimeout`: `checkNow` (chamado quando o app volta ao primeiro plano)
 * recalcula quanto tempo realmente se passou desde a última atividade e, se
 * o limite já foi ultrapassado enquanto o app estava em segundo plano,
 * dispara `onIdle` imediatamente em vez de esperar mais `timeoutMs`.
 */
export function useIdleTimer({ timeoutMs, enabled, onIdle }: UseIdleTimerArgs) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityAtRef = useRef<number>(Date.now());
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleFrom = useCallback(
    (referenceTimestamp: number) => {
      clear();
      if (!enabled) return;
      const elapsed = Date.now() - referenceTimestamp;
      const remaining = Math.max(0, timeoutMs - elapsed);
      if (remaining === 0) {
        onIdleRef.current();
        return;
      }
      timeoutRef.current = setTimeout(() => onIdleRef.current(), remaining);
    },
    [clear, enabled, timeoutMs],
  );

  const registerActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    scheduleFrom(lastActivityAtRef.current);
  }, [scheduleFrom]);

  /** Reavalia o prazo pelo relógio real, sem tratar a chamada em si como atividade nova. */
  const checkNow = useCallback(() => {
    scheduleFrom(lastActivityAtRef.current);
  }, [scheduleFrom]);

  useEffect(() => {
    if (enabled) {
      lastActivityAtRef.current = Date.now();
      scheduleFrom(lastActivityAtRef.current);
    } else {
      clear();
    }
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { registerActivity, checkNow };
}
