import { router } from 'expo-router';
import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Modal, Platform, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/src/components/ui/app-icon';
import { Button } from '@/src/components/ui/button';
import {
  INACTIVITY_ACTIVITY_THROTTLE_MS,
  INACTIVITY_LOGOUT_TIMEOUT_MS,
} from '@/src/domain/auth/inactivity-constants';
import { useIdleTimer } from '@/src/hooks/use-idle-timer';
import { supabase } from '@/src/infra/supabase/client';
import { colors, elevation, radius, spacing, typography } from '@/src/theme/tokens';

// Eventos padrão de atividade do usuário na Web (mouse, teclado, toque e
// rolagem). `scroll` não borbulha (bubble) nativamente até `window` quando
// disparado num elemento rolável interno — por isso o listener é registrado
// com `capture: true` para todos os eventos (a fase de captura alcança
// qualquer elemento da árvore, inclusive os que não borbulham de volta).
const WEB_ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * Guarda global de sessão por inatividade.
 *
 * Decisão de arquitetura: este app (Expo Router, Web + Android) não possui
 * um `AuthProvider`/contexto global de sessão hoje — cada tela chama
 * `authService.getSession()` de forma independente (ver `app/dashboard.tsx`,
 * `app/index.tsx` etc.). Em vez de introduzir esse contexto só para este
 * requisito, este componente observa a sessão diretamente via
 * `supabase.auth.onAuthStateChange`, que já é a fonte de verdade única e
 * global do SDK — funciona em qualquer tela, sem exigir integração
 * individual por página (requisito: o timer só deve rodar quando há sessão
 * autenticada).
 *
 * Precisa envolver a árvore (em vez de ser um componente "solo" como
 * `AppUpdateChecker`/`PushNotificationManager`) porque, no nativo, a única
 * forma confiável de detectar "qualquer toque/rolagem em qualquer tela" sem
 * instrumentar cada uma delas é capturar os eventos de toque num `View`
 * ancestral de todas as rotas (mesma técnica usada por bibliotecas como
 * `react-native-user-inactivity`: `onTouchStart`/`onTouchMove` num wrapper
 * no topo da árvore).
 */
export function InactivityLogoutGuard({ children }: PropsWithChildren) {
  const [authenticated, setAuthenticated] = useState(false);
  const [expiredModalVisible, setExpiredModalVisible] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setAuthenticated(!!data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuthenticated(!!session);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleIdle = useCallback(() => {
    // Logout real (invalida o refresh token no servidor via GoTrue, escopo
    // `global` — comportamento padrão do SDK), não um mero "lock" de tela.
    void supabase.auth.signOut().finally(() => {
      // O modal só tem efeito visível se o app estiver em primeiro plano
      // (`app em foreground`, requisito do produto). Se o timeout foi
      // detectado com o app em segundo plano (ver `checkNow`/AppState
      // abaixo), o `setExpiredModalVisible(true)` ainda roda, mas só será
      // percebido pelo usuário quando ele voltar ao app — o que já é o
      // comportamento desejado (avisar assim que a tela reabrir).
      setExpiredModalVisible(true);
    });
  }, []);

  const { registerActivity, checkNow } = useIdleTimer({
    timeoutMs: INACTIVITY_LOGOUT_TIMEOUT_MS,
    enabled: authenticated,
    onIdle: handleIdle,
  });

  // --- Web: mousemove/mousedown/keydown/touchstart/scroll globais ---
  useEffect(() => {
    if (Platform.OS !== 'web' || !authenticated) return;
    if (typeof window === 'undefined') return;

    let lastRegisteredAt = 0;
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastRegisteredAt < INACTIVITY_ACTIVITY_THROTTLE_MS) return;
      lastRegisteredAt = now;
      registerActivity();
    };

    WEB_ACTIVITY_EVENTS.forEach((eventName) =>
      window.addEventListener(eventName, handleActivity, { capture: true, passive: true }),
    );
    // Reavalia pelo relógio real ao voltar a ficar visível/focada (aba em
    // segundo plano por muito tempo, notebook que dormiu com a aba em foco
    // etc. — mesmo racional de `client.ts`, BLG-077/DEC-138).
    document.addEventListener('visibilitychange', checkNow);
    window.addEventListener('focus', checkNow);

    return () => {
      WEB_ACTIVITY_EVENTS.forEach((eventName) =>
        window.removeEventListener(eventName, handleActivity, { capture: true } as EventListenerOptions),
      );
      document.removeEventListener('visibilitychange', checkNow);
      window.removeEventListener('focus', checkNow);
    };
  }, [authenticated, registerActivity, checkNow]);

  // --- Nativo (Android/iOS): o app pode ir para segundo plano ---
  // Decisão de produto (sem como confirmar com o usuário agora): o timer NÃO
  // pausa em segundo plano — o tempo de inatividade é contado em relógio
  // real, incluindo o tempo em background. É o comportamento mais seguro:
  // deixar o app em segundo plano (troca de app, tela bloqueada) não deve
  // funcionar como uma forma de "pausar" o timeout de sessão indefinidamente.
  // Voltar ao primeiro plano, por si só, NÃO conta como atividade (não reseta
  // o timer) — só confirma/computa se o limite já estourou enquanto o app
  // estava em segundo plano (`checkNow`); ver comentário do hook
  // `useIdleTimer` sobre a suspensão de timers de JS em background no RN
  // (mesma causa raiz de BLG-073/DEC-127).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState.match(/inactive|background/) && nextState === 'active') {
        checkNow();
      }
    });
    return () => subscription.remove();
  }, [checkNow]);

  const handleNativeTouchActivity = useCallback(() => {
    if (Platform.OS === 'web') return;
    registerActivity();
  }, [registerActivity]);

  function goToLogin() {
    setExpiredModalVisible(false);
    router.replace('/login');
  }

  return (
    <View style={styles.root} onTouchStart={handleNativeTouchActivity} onTouchMove={handleNativeTouchActivity}>
      {children}
      <Modal visible={expiredModalVisible} transparent animationType="fade" onRequestClose={goToLogin}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.icon}>
              <AppIcon name="warning" size={32} color={colors.danger} />
            </View>
            <Text style={styles.title}>Sessão expirada</Text>
            <Text style={styles.text}>
              Sua sessão expirou por inatividade. Faça login novamente para continuar.
            </Text>
            <Button onPress={goToLogin}>Ir para o login</Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    padding: spacing.lg,
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  icon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  title: {
    marginTop: spacing.md,
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    textAlign: 'center',
  },
  text: {
    marginVertical: spacing.md,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: 'center',
  },
});
