import { colors, control, radius, spacing, typography } from "@/src/theme/tokens";

function scriptJson(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}

export function buildMercadoPagoCardFormHtml(input: {
  publicKey: string;
  amount: string;
  submitLabel: string;
}) {
  const publicKey = scriptJson(input.publicKey);
  const amount = scriptJson(input.amount);
  const submitLabel = scriptJson(input.submitLabel);
  const buttonText = input.submitLabel.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://sdk.mercadopago.com https://*.mlstatic.com; connect-src https://api.mercadopago.com https://*.mercadopago.com https://api.mercadolibre.com https://*.mlstatic.com; frame-src https://*.mercadopago.com; style-src 'unsafe-inline'; img-src data: https://*.mercadopago.com https://*.mlstatic.com;" />
  <style>
    :root{--surface:${colors.surface};--ink:${colors.ink};--muted:${colors.muted};--border:${colors.border};--brand:${colors.brand};--on-brand:${colors.onBrand};--danger:${colors.danger};--danger-soft:${colors.dangerSoft};--control-height:${control.heightMd}px;--radius:${radius.sm}px;--space-sm:${spacing.sm}px;--space-md:${spacing.md}px}
    *{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--ink);font-family:Arial,sans-serif;font-size:${typography.size.bodyLarge}px}
    form{display:grid;gap:var(--space-md)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md)}.field{display:grid;gap:var(--space-sm)}
    .full{grid-column:1/-1}label{font-weight:700;color:var(--ink);line-height:${typography.lineHeight.body}px}.control,input,select{width:100%;height:var(--control-height);border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);padding:0 var(--space-md);font:inherit;line-height:${typography.lineHeight.bodyLarge}px;color:var(--ink);transition:border-color 120ms ease,box-shadow 120ms ease}
    .control{display:flex;align-items:center;overflow:hidden}.control iframe{display:block;width:100%!important;height:46px!important;border:0!important;background:transparent!important}
    .control:focus-within,input:focus,select:focus{outline:0;border-color:var(--brand);box-shadow:0 0 0 1px var(--brand)}
    input::placeholder{color:var(--muted);opacity:1}.helper{margin:0;color:var(--muted);font-size:${typography.size.caption}px;line-height:${typography.lineHeight.caption}px}
    button{min-height:${control.heightMd}px;border:0;border-radius:var(--radius);background:var(--brand);color:var(--on-brand);font:700 ${typography.size.bodyLarge}px Arial,sans-serif;cursor:pointer}
    button:disabled{opacity:.55;cursor:default}.error{display:none;margin:0;padding:var(--space-md);border-radius:var(--radius);background:var(--danger-soft);color:var(--danger);line-height:${typography.lineHeight.body}px}
    @media(max-width:520px){.grid{grid-template-columns:1fr}.full{grid-column:auto}}
  </style>
</head>
<body>
  <form id="form-checkout" novalidate>
    <div class="field full"><label>Número do cartão</label><div id="form-checkout__cardNumber" class="control"></div></div>
    <div class="grid">
      <div class="field"><label>Validade</label><div id="form-checkout__expirationDate" class="control"></div></div>
      <div class="field"><label>Código de segurança</label><div id="form-checkout__securityCode" class="control"></div></div>
    </div>
    <div class="field full"><label for="form-checkout__cardholderName">Nome impresso no cartão</label><input id="form-checkout__cardholderName" autocomplete="cc-name" /></div>
    <div class="grid">
      <div class="field"><label for="form-checkout__identificationType">Documento</label><select id="form-checkout__identificationType"></select></div>
      <div class="field"><label for="form-checkout__identificationNumber">Número do documento</label><input id="form-checkout__identificationNumber" inputmode="numeric" autocomplete="off" /></div>
    </div>
    <div class="field full"><label for="form-checkout__cardholderEmail">E-mail</label><input id="form-checkout__cardholderEmail" type="email" inputmode="email" autocomplete="email" /></div>
    <select id="form-checkout__issuer" hidden></select><select id="form-checkout__installments" hidden></select>
    <p id="form-error" class="error" role="alert"></p>
    <p class="helper">Os dados do cartão são enviados diretamente ao Mercado Pago. O Rotinaê recebe apenas um token descartável.</p>
    <button id="form-checkout__submit" type="submit">${buttonText}</button>
  </form>
  <script src="https://sdk.mercadopago.com/js/v2"></script>
  <script>
    (() => {
      const send = (message) => {
        const payload = JSON.stringify({ source: "rotinae-mercado-pago", ...message });
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(payload);
        else window.parent.postMessage(payload, "*");
      };
      const showError = (message) => {
        const target = document.getElementById("form-error");
        target.textContent = message;
        target.style.display = "block";
        send({ type: "error", message });
      };
      try {
        let tokenDispatched = false;
        const mp = new MercadoPago(${publicKey}, { locale: "pt-BR" });
        const cardForm = mp.cardForm({
          amount: ${amount},
          iframe: true,
          form: {
            id: "form-checkout",
            cardNumber: { id: "form-checkout__cardNumber", placeholder: "Número do cartão" },
            expirationDate: { id: "form-checkout__expirationDate", placeholder: "MM/AA" },
            securityCode: { id: "form-checkout__securityCode", placeholder: "CVV" },
            cardholderName: { id: "form-checkout__cardholderName", placeholder: "Nome completo" },
            issuer: { id: "form-checkout__issuer", placeholder: "Banco emissor" },
            installments: { id: "form-checkout__installments", placeholder: "1" },
            identificationType: { id: "form-checkout__identificationType", placeholder: "CPF" },
            identificationNumber: { id: "form-checkout__identificationNumber", placeholder: "CPF" },
            cardholderEmail: { id: "form-checkout__cardholderEmail", placeholder: "E-mail" }
          },
          callbacks: {
            onFormMounted(error) {
              if (error) return showError("Não foi possível carregar o formulário seguro.");
              document.getElementById("form-checkout__submit").textContent = ${submitLabel};
              send({ type: "ready" });
            },
            onSubmit(event) {
              event.preventDefault();
              const button = document.getElementById("form-checkout__submit");
              const error = document.getElementById("form-error");
              error.style.display = "none";
              button.disabled = true;
              send({ type: "loading", loading: true });
              try {
                const data = cardForm.getCardFormData();
                if (!data.token) throw new Error("missing token");
                tokenDispatched = true;
                send({ type: "token", cardTokenId: data.token });
              } catch (_) {
                button.disabled = false;
                send({ type: "loading", loading: false });
                showError("Confira os dados do cartão e tente novamente.");
              }
            },
            onFetching() {
              const button = document.getElementById("form-checkout__submit");
              button.disabled = true;
              return () => { if (!tokenDispatched) button.disabled = false; };
            },
            onCardTokenReceived(error, token) {
              if (error || !token || !token.id) {
                const button = document.getElementById("form-checkout__submit");
                button.disabled = false;
                send({ type: "loading", loading: false });
                showError("Não foi possível validar o cartão. Confira os dados informados.");
              }
            }
          }
        });
      } catch (_) {
        showError("Não foi possível iniciar a conexão segura com o Mercado Pago.");
      }
    })();
  </script>
</body>
</html>`;
}
