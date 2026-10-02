import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { Alert, Platform } from "react-native";

import { compareVersions } from "@/src/domain/app-update/version";

type UpdateManifest = {
  version: string;
  minimumVersion?: string;
  apkUrl: string;
  message?: string;
};

const manifestUrl = process.env.EXPO_PUBLIC_APP_UPDATE_MANIFEST_URL ?? "https://rotinae.com.br/app-version.json";
const dismissedVersionKey = "rotinae:dismissed-app-version";

function isManifest(value: unknown): value is UpdateManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<UpdateManifest>;
  return typeof manifest.version === "string" && typeof manifest.apkUrl === "string" && /^https:\/\//i.test(manifest.apkUrl);
}

export function AppUpdateChecker() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let active = true;

    async function checkForUpdate() {
      try {
        const response = await fetch(manifestUrl, { headers: { Accept: "application/json" } });
        if (!response.ok || !active) return;
        const manifest: unknown = await response.json();
        if (!isManifest(manifest) || !active) return;

        const installedVersion = Constants.expoConfig?.version ?? "0.0.0";
        if (compareVersions(manifest.version, installedVersion) <= 0) return;

        const required = typeof manifest.minimumVersion === "string" && compareVersions(installedVersion, manifest.minimumVersion) < 0;
        const dismissedVersion = await SecureStore.getItemAsync(dismissedVersionKey);
        if (!required && dismissedVersion === manifest.version) return;

        const update = () => void Linking.openURL(manifest.apkUrl);
        const later = () => void SecureStore.setItemAsync(dismissedVersionKey, manifest.version);
        Alert.alert(
          required ? "Atualização necessária" : "Atualização disponível",
          manifest.message ?? `A versão ${manifest.version} do Rotinaê está disponível.`,
          required
            ? [{ text: "Baixar atualização", onPress: update }]
            : [
                { text: "Depois", style: "cancel", onPress: later },
                { text: "Baixar atualização", onPress: update },
              ],
          { cancelable: !required },
        );
      } catch {
        // Falhas de rede não impedem o uso do aplicativo.
      }
    }

    void checkForUpdate();
    return () => { active = false; };
  }, []);
  return null;
}
