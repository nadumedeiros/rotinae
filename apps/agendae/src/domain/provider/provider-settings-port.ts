import type { ProviderSettings, UpdateProviderSettingsInput } from "./types";
export interface ProviderSettingsPort {
  getSettings(): Promise<ProviderSettings>;
  updateSettings(input: UpdateProviderSettingsInput): Promise<ProviderSettings>;
}
