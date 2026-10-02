# Handoff — modelos de e-mail transacionais

> Estado em 04/08/2026: templates HTML e texto prontos; envio real, SMTP e fila ainda pendentes no backend.

## 1. Entrega

O pacote em `emails/` contém modelos com a identidade visual do Rotinaê, layout responsivo para clientes de e-mail, alternativa em texto, escape de conteúdo dinâmico e validação de URL de ação.

Fonte de implementação:

- `emails/transactional-templates.mjs` — renderizador transacional;
- `emails/supabase/*.html` — templates nativos do Supabase Auth;
- `emails/previews/index.html` — catálogo visual gerado por `npm run preview:emails`.

O módulo usa somente JavaScript padrão, sem dependência de provedor. Pode ser chamado por uma API, worker, Edge Function ou serviço de fila que execute ESM.

## 2. Catálogo transacional

| ID | Destinatário | Gatilho | Dados obrigatórios |
|---|---|---|---|
| `client_link_invitation` | Cliente | convite individual criado pelo prestador | `recipientName`, `providerName`, `expiresAt`, `actionUrl` |
| `appointment_request_received` | Prestador | nova solicitação de horário | `recipientName`, `clientName`, `date`, `time`, `service`, `location`, `actionUrl` |
| `appointment_confirmed` | Cliente | solicitação confirmada | `recipientName`, `providerName`, `date`, `time`, `service`, `duration`, `location`, `actionUrl` |
| `appointment_reminder` | Cliente | lembrete operacional habilitado | `recipientName`, `providerName`, `relativeDate`, `date`, `time`, `service`, `duration`, `location`, `actionUrl` |
| `appointment_rescheduled` | Cliente | data ou horário alterado | `recipientName`, `providerName`, `oldDate`, `oldTime`, `newDate`, `newTime`, `service`, `location`, `actionUrl` |
| `appointment_cancelled` | Parte afetada | cancelamento confirmado | `recipientName`, `cancelledBy`, `date`, `time`, `service`, `actionUrl` |
| `trial_started` | Prestador | trial único ativado | `recipientName`, `trialEndsAt`, `actionUrl` |
| `trial_ending` | Prestador | aviso de fim do trial | `recipientName`, `daysRemaining`, `trialEndsAt`, `actionUrl` |
| `premium_activated` | Prestador | pagamento confirmado pelo backend | `recipientName`, `price`, `nextBillingAt`, `paymentMethod`, `actionUrl` |
| `subscription_payment_failed` | Prestador | cobrança em estado pendente/falha | `recipientName`, `actionUrl` |
| `subscription_cancellation_scheduled` | Prestador | cancelamento no fim do período | `recipientName`, `accessEndsAt`, `actionUrl` |
| `subscription_downgraded` | Prestador | downgrade efetivado | `recipientName`, `actionUrl` |

`message`, `reason` e `retryAt` são opcionais quando indicados pelo evento. O renderizador nunca recebe `internalNotes`, tokens, códigos completos, dados de cartão ou conteúdo de outro tenant.

Os assuntos são gerados pelo catálogo e removem quebras de linha para evitar injeção de cabeçalho. Links de ação precisam usar HTTPS; HTTP só é aceito para `localhost` em desenvolvimento.

## 3. Autenticação e segurança

Copiar os cinco arquivos de `emails/supabase/` para o editor de templates do Supabase Auth ou para a configuração local equivalente:

| Arquivo | Template Supabase | Variáveis |
|---|---|---|
| `confirmation.html` | Confirm signup | `.Email`, `.ConfirmationURL` |
| `recovery.html` | Reset password | `.Email`, `.ConfirmationURL` |
| `email-change.html` | Change email address | `.NewEmail`, `.ConfirmationURL` |
| `password-changed-notification.html` | Password changed | `.Email`, `.SiteURL` |
| `email-changed-notification.html` | Email address changed | `.OldEmail`, `.SiteURL` |

Ativar as notificações de segurança de senha e e-mail no projeto. Os modelos usam as variáveis oficiais documentadas pelo Supabase e não inventam tokens próprios.

Os links de confirmação e recuperação estão diretos em `{{ .ConfirmationURL }}` para acompanhar as telas atuais. Antes da produção, avaliar uma página intermediária com `TokenHash` ou fluxo OTP para provedores que pré-carregam links; desativar click tracking para que o provedor não reescreva URLs de autenticação.

## 4. Integração do backend

O envio deve ocorrer depois da transação de domínio, por outbox/fila idempotente:

```js
import { renderTransactionalEmail } from "./emails/transactional-templates.mjs";

const email = renderTransactionalEmail("appointment_confirmed", {
  recipientName: "Juliana",
  providerName: "Dra. Ana Ribeiro",
  date: "12 de agosto de 2026",
  time: "10:30",
  service: "Acompanhamento",
  duration: "50 min",
  location: "Clínica Movimento",
  actionUrl: "https://app.agendae.com.br/minha-agenda/123",
});

await emailOutbox.enqueue({
  idempotencyKey: "appointment:123:confirmed:email:v1",
  to: recipient.email,
  subject: email.subject,
  html: email.html,
  text: email.text,
});
```

Requisitos da fila:

1. gravar o evento depois do commit do agendamento, vínculo ou entitlement;
2. usar chave idempotente por evento, destinatário e canal;
3. limitar tentativas e registrar `queued`, `sent`, `failed`, bounce e complaint;
4. não desfazer a operação de domínio quando o provedor falhar;
5. redigir logs sem conteúdo sensível e sem o código completo de convite;
6. aplicar preferências por `channel=email` e finalidade antes de enfileirar mensagens opcionais;
7. gerar URLs HTTPS com expiração e autorização no backend.

O e-mail não substitui notificações in-app, push ou WhatsApp. O evento de domínio deve continuar válido mesmo se todos os canais de comunicação falharem.

## 5. Assinatura e downgrade

O e-mail de downgrade mantém a regra aprovada do produto: agendamentos existentes e dados Premium permanecem disponíveis para consulta; novas operações passam aos limites do Gratuito (até 2 agendamentos por dia, até 5 clientes e sem novas notas internas).

O `premium_activated` só deve ser enviado após webhook/consulta autoritativa do provedor de pagamento. Retorno do checkout, sozinho, não libera o plano nem dispara confirmação.

O produto não processa pagamentos entre cliente e prestador no MVP; portanto não existe template de recibo de serviço ou confirmação bancária desse fluxo.

## 6. SMTP e publicação

Usar domínio de envio próprio com SPF, DKIM e DMARC configurados e ambiente de homologação separado. A decisão de provedor continua substituível; o template não contém SDK de SendGrid, Sendy, Resend ou Mercado Pago.

Para projetos Supabase novos no plano gratuito, a personalização de templates depende de SMTP próprio ou plano que permita customização. Configurar SMTP antes de validar os templates em produção e testar entrega, bounce, complaint, spam e links em Gmail, Outlook e Apple Mail.

Referências oficiais:

- [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates);
- [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp);
- [Supabase Customizing email templates](https://supabase.com/docs/guides/local-development/customizing-email-templates).

## 7. Validação local

```bash
npm run test:emails
npm run preview:emails
```

Os testes cobrem os 12 templates transacionais, escape de HTML, rejeição de URLs inseguras, campos obrigatórios, prevenção de quebra de linha em assunto e presença das variáveis oficiais nos templates Supabase.

