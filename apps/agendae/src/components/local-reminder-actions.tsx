import { useEffect } from "react";

import { subscribeToReminderActions } from "@/src/infra/notifications/local-reminders";

// não vai desenhar nada na tela, só deixa os botões "Adiar" e "Ok" funcionando.
export function LocalReminderActions() {
  useEffect(() => subscribeToReminderActions(), []);
  return null;
}
