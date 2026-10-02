/**
 * Tempo máximo de inatividade do usuário autenticado antes do logout
 * automático (encerramento real da sessão via Supabase Auth, não apenas um
 * "lock" de tela).
 *
 * Único ponto de configuração deste valor no app — qualquer ajuste futuro
 * (ex.: diferenciar tempo por perfil, ou tornar configurável por ambiente)
 * deve alterar apenas esta constante.
 */
export const INACTIVITY_LOGOUT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Intervalo mínimo entre dois registros de atividade consecutivos.
 * Eventos de alta frequência (mousemove, scroll, onTouchMove) disparam
 * dezenas de vezes por segundo; sem este limite, cada disparo cancelaria e
 * recriaria o timer de inatividade à toa, desperdiçando ciclos de CPU sem
 * nenhum ganho de precisão perceptível (a folga de até 1s é irrelevante
 * diante de um timeout de 30 minutos).
 */
export const INACTIVITY_ACTIVITY_THROTTLE_MS = 1000;
