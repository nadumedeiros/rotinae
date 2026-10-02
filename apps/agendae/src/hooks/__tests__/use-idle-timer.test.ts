import { act, renderHook } from '@testing-library/react-native';

import { useIdleTimer } from '../use-idle-timer';

describe('useIdleTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dispara onIdle depois de timeoutMs sem nenhuma atividade', async () => {
    const onIdle = jest.fn();
    await renderHook(() => useIdleTimer({ timeoutMs: 3000, enabled: true, onIdle }));

    await act(async () => {
      jest.advanceTimersByTime(2999);
    });
    expect(onIdle).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('registerActivity reinicia a contagem a partir do momento em que foi chamado', async () => {
    const onIdle = jest.fn();
    const { result } = await renderHook(() => useIdleTimer({ timeoutMs: 3000, enabled: true, onIdle }));

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    await act(async () => {
      result.current.registerActivity();
    });
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    // 2500ms depois de registerActivity, ainda não completou os 3000ms.
    expect(onIdle).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('nunca dispara onIdle quando enabled é false, mesmo após avançar bastante o tempo', async () => {
    const onIdle = jest.fn();
    await renderHook(() => useIdleTimer({ timeoutMs: 3000, enabled: false, onIdle }));

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('para o timer agendado quando enabled passa de true para false (ex.: logout já ocorreu)', async () => {
    const onIdle = jest.fn();
    const { rerender } = await renderHook(({ enabled }: { enabled: boolean }) => useIdleTimer({ timeoutMs: 3000, enabled, onIdle }), {
      initialProps: { enabled: true },
    });

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await act(async () => {
      await rerender({ enabled: false });
    });

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('checkNow dispara onIdle imediatamente se o tempo já esgotou (ex.: app voltou do segundo plano depois do limite)', async () => {
    const onIdle = jest.fn();
    const { result } = await renderHook(() => useIdleTimer({ timeoutMs: 3000, enabled: true, onIdle }));

    await act(async () => {
      result.current.registerActivity();
    });
    // Simula o app suspenso em segundo plano por tempo suficiente para
    // ultrapassar o limite (o setTimeout do RN fica suspenso nesse período —
    // BLG-073/DEC-127 — mas o relógio real seguiu andando).
    await act(async () => {
      jest.advanceTimersByTime(3500);
    });
    // Aqui o próprio setTimeout, ao "acordar", já teria disparado.
    expect(onIdle).toHaveBeenCalledTimes(1);

    // O cenário relevante é chamar checkNow ao voltar ao primeiro plano,
    // antes de qualquer nova atividade real do usuário: não deve esperar
    // mais timeoutMs para reconfirmar algo que já expirou.
    onIdle.mockClear();
    await act(async () => {
      result.current.registerActivity();
    });
    await act(async () => {
      jest.advanceTimersByTime(3500);
    });
    onIdle.mockClear();
    await act(async () => {
      result.current.checkNow();
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('checkNow não dispara onIdle se ainda houver tempo restante', async () => {
    const onIdle = jest.fn();
    const { result } = await renderHook(() => useIdleTimer({ timeoutMs: 3000, enabled: true, onIdle }));

    await act(async () => {
      result.current.registerActivity();
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await act(async () => {
      result.current.checkNow();
    });
    expect(onIdle).not.toHaveBeenCalled();
  });
});
