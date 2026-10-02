const colors = Object.freeze({
  brand: "#5416FF",
  brandDark: "#21065F",
  brandSoft: "#EEE9FF",
  canvas: "#F7F5FF",
  surface: "#FFFFFF",
  ink: "#191725",
  muted: "#555264",
  mutedSoft: "#7B778B",
  border: "#E8E5EF",
  success: "#287A47",
  successSoft: "#DDF8E5",
  warning: "#C97000",
  warningSoft: "#FFF0CF",
  danger: "#B73545",
  dangerSoft: "#FDE4E8",
});

export const transactionalTemplateIds = Object.freeze([
  "client_link_invitation",
  "appointment_request_received",
  "appointment_confirmed",
  "appointment_reminder",
  "appointment_rescheduled",
  "appointment_cancelled",
  "trial_started",
  "trial_ending",
  "premium_activated",
  "subscription_payment_failed",
  "subscription_cancellation_scheduled",
  "subscription_downgraded",
]);

function rawText(data, key, optional = false) {
  const value = data?.[key];
  if (optional && (value === undefined || value === null || String(value).trim() === "")) return null;
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`Campo obrigatório ausente: ${key}`);
  }
  return String(value).trim();
}

function subjectText(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

export function escapeEmailHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlText(data, key, optional = false) {
  const value = rawText(data, key, optional);
  return value === null ? null : escapeEmailHtml(value).replaceAll("\n", "<br>");
}

function actionUrl(data, key = "actionUrl") {
  const value = rawText(data, key);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`URL inválida no campo: ${key}`);
  }
  const localDevelopment = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localDevelopment) {
    throw new Error(`O campo ${key} deve usar HTTPS (HTTP é aceito apenas em localhost)`);
  }
  return { raw: value, html: escapeEmailHtml(value) };
}

function paragraph(text) {
  return `<p style="margin:0 0 16px;color:${colors.muted};font-family:Arial,'Helvetica Neue',sans-serif;font-size:16px;line-height:24px;">${text}</p>`;
}

function details(rows) {
  const content = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:10px 0;color:${colors.mutedSoft};font-family:Arial,'Helvetica Neue',sans-serif;font-size:13px;line-height:18px;vertical-align:top;">${label}</td>
        <td style="padding:10px 0 10px 16px;color:${colors.ink};font-family:Arial,'Helvetica Neue',sans-serif;font-size:14px;font-weight:700;line-height:20px;text-align:right;vertical-align:top;">${value}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;border-collapse:collapse;border-top:1px solid ${colors.border};border-bottom:1px solid ${colors.border};">${content}</table>`;
}

function notice(title, text, tone = "brand") {
  const tones = {
    brand: [colors.brandSoft, colors.brandDark],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
  };
  const [background, foreground] = tones[tone];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border-collapse:separate;background:${background};border-radius:12px;">
    <tr><td style="padding:16px 18px;color:${foreground};font-family:Arial,'Helvetica Neue',sans-serif;font-size:14px;line-height:21px;"><strong>${title}</strong><br>${text}</td></tr>
  </table>`;
}

function statusChip(label, tone = "brand") {
  const tones = {
    brand: [colors.brandSoft, colors.brandDark],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
  };
  const [background, foreground] = tones[tone];
  return `<span style="display:inline-block;padding:7px 12px;background:${background};border-radius:999px;color:${foreground};font-family:Arial,'Helvetica Neue',sans-serif;font-size:12px;font-weight:700;line-height:16px;">${label}</span>`;
}

function createTemplate(id, data) {
  const recipientName = htmlText(data, "recipientName");
  const recipientNameSubject = subjectText(rawText(data, "recipientName"));
  const optionalMessage = htmlText(data, "message", true);

  switch (id) {
    case "client_link_invitation": {
      const providerName = htmlText(data, "providerName");
      const providerNameSubject = subjectText(rawText(data, "providerName"));
      const expiresAt = htmlText(data, "expiresAt");
      const link = actionUrl(data);
      return {
        subject: `${providerNameSubject} convidou você para o Rotinaê`,
        preheader: `Aceite o vínculo com ${providerNameSubject} até ${rawText(data, "expiresAt")}.`,
        eyebrow: "CONVITE DE VÍNCULO",
        title: "Você recebeu um convite",
        intro: `Olá, ${recipientName}. ${providerName} quer conectar seu perfil de cliente no Rotinaê.`,
        bodyHtml:
          paragraph("Ao aceitar, você poderá consultar os horários e solicitar agendamentos disponíveis desse prestador.") +
          details([
            ["Prestador", providerName],
            ["Válido até", expiresAt],
          ]) +
          notice("Convite individual", "Este link é pessoal, expira e só pode ser utilizado uma vez. Não encaminhe esta mensagem.", "warning"),
        action: { label: "Aceitar convite", ...link },
        textDetails: [`Prestador: ${rawText(data, "providerName")}`, `Válido até: ${rawText(data, "expiresAt")}`],
      };
    }
    case "appointment_request_received": {
      const clientName = htmlText(data, "clientName");
      const link = actionUrl(data);
      return {
        subject: `Nova solicitação de ${subjectText(rawText(data, "clientName"))}`,
        preheader: `${rawText(data, "date")} às ${rawText(data, "time")} aguarda sua análise.`,
        eyebrow: "NOVA SOLICITAÇÃO",
        title: "Um horário aguarda sua confirmação",
        intro: `Olá, ${recipientName}. ${clientName} solicitou um atendimento.`,
        bodyHtml: details([
          ["Cliente", clientName],
          ["Data", htmlText(data, "date")],
          ["Horário", htmlText(data, "time")],
          ["Serviço", htmlText(data, "service")],
          ["Local", htmlText(data, "location")],
        ]) + (optionalMessage ? notice("Mensagem do cliente", optionalMessage) : ""),
        action: { label: "Analisar solicitação", ...link },
        textDetails: appointmentTextDetails(data, true),
      };
    }
    case "appointment_confirmed": {
      const providerName = htmlText(data, "providerName");
      const link = actionUrl(data);
      return {
        subject: `Agendamento confirmado para ${subjectText(rawText(data, "date"))}`,
        preheader: `${rawText(data, "date")} às ${rawText(data, "time")} com ${rawText(data, "providerName")}.`,
        eyebrow: "AGENDAMENTO CONFIRMADO",
        title: "Seu horário está confirmado",
        intro: `Olá, ${recipientName}. Seu atendimento com ${providerName} foi confirmado.`,
        status: statusChip("Confirmado", "success"),
        bodyHtml: details(appointmentRows(data, providerName)) + (optionalMessage ? notice("Mensagem do prestador", optionalMessage) : ""),
        action: { label: "Ver agendamento", ...link },
        textDetails: appointmentTextDetails(data),
      };
    }
    case "appointment_reminder": {
      const providerName = htmlText(data, "providerName");
      const link = actionUrl(data);
      return {
        subject: `Lembrete: seu atendimento é ${subjectText(rawText(data, "relativeDate"))}`,
        preheader: `${rawText(data, "date")} às ${rawText(data, "time")} com ${rawText(data, "providerName")}.`,
        eyebrow: "LEMBRETE DE AGENDA",
        title: `Seu atendimento é ${htmlText(data, "relativeDate")}`,
        intro: `Olá, ${recipientName}. Passando para lembrar do seu horário com ${providerName}.`,
        bodyHtml: details(appointmentRows(data, providerName)) + (optionalMessage ? notice("Orientação", optionalMessage) : ""),
        action: { label: "Ver detalhes", ...link },
        textDetails: appointmentTextDetails(data),
      };
    }
    case "appointment_rescheduled": {
      const providerName = htmlText(data, "providerName");
      const link = actionUrl(data);
      return {
        subject: `Agendamento remarcado para ${subjectText(rawText(data, "newDate"))}`,
        preheader: `Novo horário: ${rawText(data, "newDate")} às ${rawText(data, "newTime")}.`,
        eyebrow: "AGENDAMENTO REMARCADO",
        title: "Seu horário foi atualizado",
        intro: `Olá, ${recipientName}. O atendimento com ${providerName} mudou de data ou horário.`,
        status: statusChip("Remarcado", "warning"),
        bodyHtml:
          details([
            ["Horário anterior", `${htmlText(data, "oldDate")} às ${htmlText(data, "oldTime")}`],
            ["Novo horário", `${htmlText(data, "newDate")} às ${htmlText(data, "newTime")}`],
            ["Serviço", htmlText(data, "service")],
            ["Local", htmlText(data, "location")],
          ]) + (optionalMessage ? notice("Motivo ou orientação", optionalMessage) : ""),
        action: { label: "Ver novo horário", ...link },
        textDetails: [
          `Horário anterior: ${rawText(data, "oldDate")} às ${rawText(data, "oldTime")}`,
          `Novo horário: ${rawText(data, "newDate")} às ${rawText(data, "newTime")}`,
          `Serviço: ${rawText(data, "service")}`,
          `Local: ${rawText(data, "location")}`,
        ],
      };
    }
    case "appointment_cancelled": {
      const cancelledBy = htmlText(data, "cancelledBy");
      const reason = htmlText(data, "reason", true);
      const link = actionUrl(data);
      return {
        subject: `Agendamento de ${subjectText(rawText(data, "date"))} cancelado`,
        preheader: `O horário de ${rawText(data, "date")} às ${rawText(data, "time")} foi cancelado.`,
        eyebrow: "AGENDAMENTO CANCELADO",
        title: "O atendimento foi cancelado",
        intro: `Olá, ${recipientName}. ${cancelledBy} cancelou este agendamento.`,
        status: statusChip("Cancelado", "danger"),
        bodyHtml:
          details([
            ["Data", htmlText(data, "date")],
            ["Horário", htmlText(data, "time")],
            ["Serviço", htmlText(data, "service")],
          ]) +
          (reason ? notice("Motivo informado", reason, "danger") : "") +
          notice("Registro preservado", "O cancelamento permanece no histórico e o horário foi liberado.", "brand"),
        action: { label: "Ver minha agenda", ...link },
        textDetails: appointmentTextDetails(data),
      };
    }
    case "trial_started": {
      const link = actionUrl(data);
      return {
        subject: "Seu período de teste Premium começou",
        preheader: `Use todos os recursos Premium até ${rawText(data, "trialEndsAt")}.`,
        eyebrow: "30 DIAS DE PREMIUM",
        title: "Seu teste Premium começou",
        intro: `Olá, ${recipientName}. Seu perfil Prestador já pode usar os recursos Premium do Rotinaê.`,
        status: statusChip("Teste ativo", "success"),
        bodyHtml:
          details([["Término do teste", htmlText(data, "trialEndsAt")]]) +
          notice("Sem cobrança durante o teste", "Você pode cancelar antes do término. O Premium continuará ativo até a data final e depois o downgrade será automático.", "brand"),
        action: { label: "Conhecer o Premium", ...link },
        textDetails: [`Término do teste: ${rawText(data, "trialEndsAt")}`],
      };
    }
    case "trial_ending": {
      const link = actionUrl(data);
      return {
        subject: `Seu teste Premium termina em ${subjectText(rawText(data, "daysRemaining"))}`,
        preheader: `Após ${rawText(data, "trialEndsAt")}, novas operações seguirão os limites do Gratuito.`,
        eyebrow: "SEU TESTE ESTÁ TERMINANDO",
        title: `Faltam ${htmlText(data, "daysRemaining")}`,
        intro: `Olá, ${recipientName}. Seu período de teste Premium termina em breve.`,
        status: statusChip("Atenção", "warning"),
        bodyHtml:
          details([["Premium disponível até", htmlText(data, "trialEndsAt")]]) +
          notice("O que acontece depois?", "Seus agendamentos existentes continuam na agenda e os dados Premium ficam disponíveis para consulta. Novas operações passam a seguir o Gratuito.", "warning"),
        action: { label: "Assinar Premium", ...link },
        textDetails: [`Premium disponível até: ${rawText(data, "trialEndsAt")}`],
      };
    }
    case "premium_activated": {
      const link = actionUrl(data);
      return {
        subject: "Premium ativado com sucesso",
        preheader: `Sua assinatura está ativa. Próxima cobrança: ${rawText(data, "nextBillingAt")}.`,
        eyebrow: "ASSINATURA PREMIUM",
        title: "Seu Premium está ativo",
        intro: `Olá, ${recipientName}. A confirmação do pagamento foi recebida e seu acesso Premium está liberado.`,
        status: statusChip("Ativa", "success"),
        bodyHtml: details([
          ["Valor", htmlText(data, "price")],
          ["Próxima cobrança", htmlText(data, "nextBillingAt")],
          ["Forma de pagamento", htmlText(data, "paymentMethod")],
        ]),
        action: { label: "Gerenciar assinatura", ...link },
        textDetails: [
          `Valor: ${rawText(data, "price")}`,
          `Próxima cobrança: ${rawText(data, "nextBillingAt")}`,
          `Forma de pagamento: ${rawText(data, "paymentMethod")}`,
        ],
      };
    }
    case "subscription_payment_failed": {
      const retryAt = htmlText(data, "retryAt", true);
      const link = actionUrl(data);
      return {
        subject: "Não conseguimos processar sua assinatura Premium",
        preheader: "Atualize a forma de pagamento para manter seu Premium.",
        eyebrow: "FALHA NA COBRANÇA",
        title: "Revise sua forma de pagamento",
        intro: `Olá, ${recipientName}. A última cobrança da assinatura Premium não foi confirmada.`,
        status: statusChip("Pagamento pendente", "danger"),
        bodyHtml:
          (retryAt ? details([["Nova tentativa", retryAt]]) : "") +
          notice("Seu agendamento não foi cancelado", "A falha desta cobrança não altera nem remove os atendimentos já existentes. Atualize o pagamento pelo portal seguro.", "danger"),
        action: { label: "Atualizar pagamento", ...link },
        textDetails: retryAt ? [`Nova tentativa: ${rawText(data, "retryAt")}`] : [],
      };
    }
    case "subscription_cancellation_scheduled": {
      const link = actionUrl(data);
      return {
        subject: "Cancelamento do Premium agendado",
        preheader: `Seu Premium permanece ativo até ${rawText(data, "accessEndsAt")}.`,
        eyebrow: "CANCELAMENTO AGENDADO",
        title: "Seu Premium continua ativo por enquanto",
        intro: `Olá, ${recipientName}. Recebemos sua solicitação de cancelamento.`,
        status: statusChip("Cancelamento agendado", "warning"),
        bodyHtml:
          details([["Acesso Premium até", htmlText(data, "accessEndsAt")]]) +
          notice("Você ainda pode desistir", "Até essa data, todos os recursos Premium continuam disponíveis. Depois, o downgrade para o Gratuito será automático.", "warning"),
        action: { label: "Desfazer cancelamento", ...link },
        textDetails: [`Acesso Premium até: ${rawText(data, "accessEndsAt")}`],
      };
    }
    case "subscription_downgraded": {
      const link = actionUrl(data);
      return {
        subject: "Seu plano agora é Gratuito",
        preheader: "Agendamentos existentes foram preservados; novas operações seguem os limites do Gratuito.",
        eyebrow: "ALTERAÇÃO DE PLANO",
        title: "Seu plano mudou para Gratuito",
        intro: `Olá, ${recipientName}. O período Premium terminou e o downgrade foi concluído.`,
        status: statusChip("Gratuito", "brand"),
        bodyHtml:
          notice("Nada foi apagado", "Seus agendamentos existentes continuam na agenda. Dados Premium permanecem disponíveis para consulta.", "success") +
          details([
            ["Novos agendamentos", "Até 2 por dia"],
            ["Clientes cadastrados", "Até 5"],
            ["Novas notas de cliente", "Indisponíveis"],
          ]),
        action: { label: "Ver planos", ...link },
        textDetails: ["Novos agendamentos: até 2 por dia", "Clientes cadastrados: até 5", "Novas notas de cliente: indisponíveis"],
      };
    }
    default:
      throw new Error(`Template transacional desconhecido: ${id}`);
  }
}

function appointmentRows(data, providerName) {
  return [
    ["Prestador", providerName],
    ["Data", htmlText(data, "date")],
    ["Horário", htmlText(data, "time")],
    ["Serviço", htmlText(data, "service")],
    ["Duração", htmlText(data, "duration")],
    ["Local", htmlText(data, "location")],
  ];
}

function appointmentTextDetails(data, includeClient = false) {
  const rows = [];
  if (includeClient) rows.push(`Cliente: ${rawText(data, "clientName")}`);
  if (data.providerName) rows.push(`Prestador: ${rawText(data, "providerName")}`);
  rows.push(`Data: ${rawText(data, "date")}`, `Horário: ${rawText(data, "time")}`, `Serviço: ${rawText(data, "service")}`);
  if (data.duration) rows.push(`Duração: ${rawText(data, "duration")}`);
  if (data.location) rows.push(`Local: ${rawText(data, "location")}`);
  return rows;
}

function renderHtml(template) {
  const action = template.action;
  const actionBlock = `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;"><tr><td style="border-radius:12px;background:${colors.brand};">
    <a href="${action.html}" style="display:inline-block;padding:15px 22px;color:${colors.surface};font-family:Arial,'Helvetica Neue',sans-serif;font-size:15px;font-weight:700;line-height:18px;text-decoration:none;">${escapeEmailHtml(action.label)}</a>
  </td></tr></table>
  <p style="margin:0 0 24px;color:${colors.mutedSoft};font-family:Arial,'Helvetica Neue',sans-serif;font-size:12px;line-height:18px;word-break:break-all;">Se o botão não funcionar, copie este endereço:<br><a href="${action.html}" style="color:${colors.brand};text-decoration:underline;">${action.html}</a></p>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeEmailHtml(template.subject)}</title>
  <style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-card{border-radius:0!important}.email-pad{padding:28px 22px!important}.email-header{padding:22px!important}}</style>
</head>
<body style="margin:0;padding:0;background:${colors.canvas};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeEmailHtml(template.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:${colors.canvas};border-collapse:collapse;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" class="email-shell" style="width:600px;max-width:600px;border-collapse:separate;">
        <tr><td class="email-header" style="padding:0 8px 20px;color:${colors.brandDark};font-family:Arial,'Helvetica Neue',sans-serif;font-size:28px;font-weight:800;letter-spacing:-1px;">agenda<span style="color:${colors.brand};">ê</span></td></tr>
        <tr><td class="email-card" style="overflow:hidden;background:${colors.surface};border:1px solid ${colors.border};border-radius:20px;box-shadow:0 12px 32px rgba(33,6,95,.10);">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tr><td style="height:6px;background:${colors.brand};font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td class="email-pad" style="padding:40px;">
              <p style="margin:0 0 12px;color:${colors.brand};font-family:Arial,'Helvetica Neue',sans-serif;font-size:12px;font-weight:700;letter-spacing:1.2px;line-height:16px;">${template.eyebrow}</p>
              ${template.status ? `<div style="margin:0 0 16px;">${template.status}</div>` : ""}
              <h1 style="margin:0 0 16px;color:${colors.ink};font-family:Arial,'Helvetica Neue',sans-serif;font-size:28px;line-height:35px;letter-spacing:-.4px;">${template.title}</h1>
              ${paragraph(template.intro)}
              ${template.bodyHtml}
              ${actionBlock}
              <p style="margin:0;color:${colors.muted};font-family:Arial,'Helvetica Neue',sans-serif;font-size:14px;line-height:21px;">Até logo,<br><strong style="color:${colors.brandDark};">Equipe Rotinaê</strong></p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:22px 12px 0;color:${colors.mutedSoft};font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;line-height:17px;text-align:center;">Mensagem transacional enviada pelo Rotinaê. Nunca informe sua senha ou dados completos de pagamento por e-mail.<br>© ${new Date().getFullYear()} Rotinaê.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderText(template) {
  const lines = [template.eyebrow, "", template.title, "", template.intro.replaceAll(/<[^>]+>/g, "")];
  if (template.textDetails?.length) lines.push("", ...template.textDetails);
  lines.push("", `${template.action.label}: ${template.action.raw}`, "", "Até logo,", "Equipe Rotinaê");
  return lines.join("\n");
}

export function renderTransactionalEmail(id, data) {
  if (!transactionalTemplateIds.includes(id)) throw new Error(`Template transacional desconhecido: ${id}`);
  const template = createTemplate(id, data);
  return Object.freeze({
    id,
    subject: subjectText(template.subject),
    html: renderHtml(template),
    text: renderText(template),
  });
}

