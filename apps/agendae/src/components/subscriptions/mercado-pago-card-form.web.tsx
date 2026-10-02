import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";

import { buildMercadoPagoCardFormHtml } from "./mercado-pago-card-form-html";
import { parseMercadoPagoCardMessage, type MercadoPagoCardFormProps } from "./mercado-pago-card-form.types";

export function MercadoPagoCardForm(props: MercadoPagoCardFormProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const { amount, publicKey, submitLabel } = props;
  const html = useMemo(
    () => buildMercadoPagoCardFormHtml({ amount, publicKey, submitLabel }),
    [amount, publicKey, submitLabel],
  );

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = parseMercadoPagoCardMessage(event.data);
      if (!message) return;
      if (message.type === "ready") props.onReady?.();
      if (message.type === "loading") props.onLoadingChange?.(message.loading);
      if (message.type === "token") props.onToken(message.cardTokenId);
      if (message.type === "error") props.onError(message.message);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [props]);

  return (
    <View pointerEvents={props.disabled ? "none" : "auto"} style={[styles.container, props.disabled && styles.disabled]}>
      {React.createElement("iframe", {
        ref: frameRef,
        srcDoc: html,
        title: "Formulário seguro de cartão do Mercado Pago",
        sandbox: "allow-scripts allow-forms",
        style: { width: "100%", height: 570, border: 0, background: "transparent" },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", minHeight: 570 },
  disabled: { opacity: 0.65 },
});
