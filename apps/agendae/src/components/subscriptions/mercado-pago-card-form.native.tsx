import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import { buildMercadoPagoCardFormHtml } from "./mercado-pago-card-form-html";
import { parseMercadoPagoCardMessage, type MercadoPagoCardFormProps } from "./mercado-pago-card-form.types";

export function MercadoPagoCardForm(props: MercadoPagoCardFormProps) {
  const { amount, publicKey, submitLabel } = props;
  const html = useMemo(
    () => buildMercadoPagoCardFormHtml({ amount, publicKey, submitLabel }),
    [amount, publicKey, submitLabel],
  );
  return (
    <View pointerEvents={props.disabled ? "none" : "auto"} style={[styles.container, props.disabled && styles.disabled]}>
      <WebView
        incognito
        javaScriptEnabled
        domStorageEnabled={false}
        originWhitelist={["https://*", "about:blank"]}
        source={{ html, baseUrl: "https://rotinae.com.br" }}
        onMessage={(event) => {
          const message = parseMercadoPagoCardMessage(event.nativeEvent.data);
          if (!message) return;
          if (message.type === "ready") props.onReady?.();
          if (message.type === "loading") props.onLoadingChange?.(message.loading);
          if (message.type === "token") props.onToken(message.cardTokenId);
          if (message.type === "error") props.onError(message.message);
        }}
        onShouldStartLoadWithRequest={(request) =>
          request.url === "about:blank" || request.url.startsWith("https://rotinae.com.br")
        }
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", height: 620, overflow: "hidden" },
  webView: { flex: 1, backgroundColor: "transparent" },
  disabled: { opacity: 0.65 },
});
