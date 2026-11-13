import * as Notifications from "expo-notifications";

// Limpa o que o app deixou guardado no celular quando a pessoa sai da conta.
// O token de login o próprio Supabase apaga do SecureStore no signOut.
export async function limparDadosLocais(): Promise<void> {
  // Notificações da conta anterior que ficaram na central do celular
  // (elas podem mostrar nome de cliente e horário de atendimento).
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
}