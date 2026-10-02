# Handoff — Perfil do prestador e notificações

> Estado em 04/08/2026: tela e contratos frontend preparados; API real pendente.

## Perfil do prestador

Contrato: `src/domain/provider/provider-settings-port.ts`.

- `GET /v1/provider/settings` retorna dados derivados da sessão.
- `PATCH /v1/provider/settings` atualiza nome, telefone, fuso, horário padrão, antecedência e preferências.
- e-mail não deve ser alterado por este endpoint; exige fluxo próprio de confirmação.
- fuso usa identificador IANA e mudanças afetam novas interpretações, não reescrevem instantes históricos.
- horário inicial deve ser anterior ao final; antecedência aceita 0–720 horas.
- erros normalizados: `PROFILE_NOT_FOUND`, `NAME_INVALID`, `PHONE_INVALID`, `TIMEZONE_INVALID`, `WORKING_HOURS_INVALID`, `ADVANCE_NOTICE_INVALID`, `FORBIDDEN`, `SESSION_EXPIRED`, `NETWORK_ERROR` e `UNKNOWN`.

## Notificações

Contrato: `src/domain/notifications/notification-port.ts`.

- `GET /v1/notifications?page=1&pageSize=10` retorna paginação e `unreadCount`.
- `POST /v1/notifications/:id/read` e `POST /v1/notifications/read-all` devem ser idempotentes.
- destinos são controlados pelo servidor e mapeados no cliente; nunca aceitar URL arbitrária.
- payload contém texto mínimo e não inclui observações internas, códigos de vínculo, documentos ou dados financeiros completos.
- consulta, leitura e contagem são isoladas por usuário/tenant.

## Estado local atual

A página `/settings` usa `localStorage` somente como demonstração. O cabeçalho ainda usa notificações estáticas. A troca pelo backend deve ocorrer via implementações HTTP das portas, sem alterar os componentes visuais.

## Critérios de aceite

- falha de carregamento não apaga o formulário;
- falha de gravação mantém os valores para nova tentativa;
- sessão expirada redireciona para autenticação;
- resposta proibida não revela existência de outro perfil/notificação;
- preferências e alterações críticas geram auditoria sem copiar conteúdo sensível;
- marcar notificação repetidamente produz o mesmo resultado.
