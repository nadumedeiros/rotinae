# Contratos de Front-end — Etapa 1

> Versão: 0.13.0
> Data: 11 de agosto de 2026
> Escopo: entrada, autenticação, sessão e protótipo de clientes/vínculo

Este documento descreve a porta que o front-end espera do backend. Todas as telas de autenticação, inclusive `switch-profile.tsx`, consomem `SupabaseAuthAdapter` real. Uma identidade pode possuir Cliente e Prestador, com um único `activeRole`; `addRole` provisiona o papel ausente e `switchRole` altera o contexto no servidor. As telas não devem importar Supabase ou outro SDK de infraestrutura diretamente.

## Topologia pública da Etapa 1

- `/`: conteúdo institucional preservado no painel esquerdo e formulário de login diretamente na área funcional;
- `/select-profile`: escolha de perfil para o futuro cadastro;
- `/create-account`: captura inicial de e-mail, senha e perfil;
- `/confirm-email`: orientação e reenvio de confirmação;
- `/change-password`: definição visual de nova senha após recuperação;
- `/feedback`: estados de sucesso, expiração e erro dos fluxos de acesso;
- `/dashboard`: Home autenticada demonstrativa, com KPIs, agenda diária e menu de perfil;
- `/clients`: gestão demonstrativa de clientes, código do prestador e solicitações de vínculo;
- `/agenda`: visão inicial demonstrativa dos compromissos e destino das notificações de agendamento;
- `/payments`: registro manual demonstrativo de valores de serviços, sem processamento financeiro;
- a antiga rota intermediária `/login` foi removida; não há tela pública anterior ao formulário de acesso.

## Limites arquiteturais

- Campos de data editáveis são exibidos e digitados em `DD/MM/AAAA`, com máscara aplicada durante a digitação.
- Datas enviadas aos adapters/API permanecem no formato ISO `AAAA-MM-DD`; a conversão acontece na fronteira entre formulário e domínio.

- `src/domain/auth`: tipos e interface independentes do fornecedor.
- `src/infra/auth`: adaptadores que implementam a interface.
- `app`: telas consomem apenas a porta injetada/exportada pela composição.
- A seleção visual de perfil nunca concede privilégios; o servidor devolve e valida o perfil persistido.
- No MVP, cada conta possui somente um perfil: `provider` ou `client`.
- Tokens de sessão não devem ser registrados em logs nem expostos em mensagens.

## Porta `AuthPort`

```ts
interface AuthPort {
  signIn(input: SignInInput): Promise<Session>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
}

type SignInInput = {
  email: string;
  password: string;
  selectedRole?: 'provider' | 'client';
};
```

`selectedRole` é somente contexto da interface durante o onboarding. O backend não deve alterar o perfil persistido com base nesse campo.

## Resposta de sessão

```json
{
  "accessToken": "token-opaco",
  "expiresAt": "2026-08-02T18:00:00.000Z",
  "user": {
    "id": "uuid",
    "email": "usuario@exemplo.com",
    "role": "provider",
    "displayName": "Nome exibido"
  }
}
```

O adaptador real poderá obter esses dados de múltiplas respostas do Supabase, desde que entregue este formato ao front-end. Persistência e renovação segura da sessão pertencem ao adaptador.

## Erros normalizados

| Código | Uso esperado pela UI |
|---|---|
| `INVALID_CREDENTIALS` | Mensagem neutra, sem revelar se a conta existe |
| `ACCOUNT_DISABLED` | Informar indisponibilidade e orientar suporte |
| `RATE_LIMITED` | Solicitar espera antes de nova tentativa |
| `NETWORK_ERROR` | Preservar campos e permitir tentar novamente |
| `UNKNOWN` | Mensagem genérica e rastreável no monitoramento |

O adaptador converte erros do fornecedor nesses códigos. Mensagens técnicas não chegam às telas.

## Estados e eventos da interface

| Evento | Estado inicial | Resultado esperado |
|---|---|---|
| `auth.signIn.requested` | formulário preenchido | botão bloqueado e indicador de carregamento |
| `auth.signIn.succeeded` | requisição em curso | sessão disponível e navegação substituída pelo shell |
| `auth.signIn.failed` | requisição em curso | campos preservados, erro acessível e nova tentativa habilitada |
| `auth.signOut.requested` | sessão ativa | sessão removida e retorno à entrada |
| `auth.session.restored` | inicialização | direcionamento conforme perfil persistido |
| `auth.session.missing` | inicialização | entrada pública |

## Pendências para o adaptador real do Cris

1. Implementar `AuthPort` com Supabase Auth sem alterar as telas.
2. Definir armazenamento seguro e renovação da sessão por plataforma.
3. Mapear os erros do fornecedor para `AuthErrorCode`.
4. Buscar o perfil persistido e suas permissões no servidor.
5. Implementar `AuthRegistrationPort` (cadastro, confirmação de e-mail e recuperação de senha) — contrato já definido, ver seção seguinte.
6. Criar testes de contrato usando os mesmos cenários do mock.

## Porta `AuthRegistrationPort`

Contrato decoupled de `AuthPort` (DEC-067), definido a partir da experiência real de `create-account.tsx`, `confirm-email.tsx` e `change-password.tsx`. Não força `MockAuthAdapter` nem `SupabaseAuthAdapter` a mudar, já que nenhum dos dois implementa esta porta ainda.

```ts
interface AuthRegistrationPort {
  signUp(input: SignUpInput): Promise<SignUpResult>;
  resendConfirmationEmail(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(input: UpdatePasswordInput): Promise<void>;
}
```

- `signUp` nunca devolve `Session`: toda conta nova exige confirmação de e-mail antes de qualquer sessão operacional (DEC-055); o retorno é `{ email, emailConfirmationRequired: true }`.
- `role` no cadastro define o perfil inicial; `AuthPort.addRole` adiciona o segundo perfil e `AuthPort.switchRole` alterna o contexto ativo sem criar outra identidade.
- `resendConfirmationEmail` e `requestPasswordReset` têm resposta sempre neutra e anti-enumeração — nunca revelam se a conta existe, já está confirmada ou está bloqueada.
- Nenhum método recebe token manual de confirmação/recuperação. O link do e-mail abre uma sessão temporária detectada pelo próprio SDK do Supabase; `updatePassword` só chama `updateUser({ password })` sobre essa sessão. Ausência de sessão de recuperação lança `SESSION_EXPIRED` (reaproveitado, não é um código novo).
- Quatro códigos novos em `AuthErrorCode`: `AUTH_EMAIL_NOT_CONFIRMED` (login com e-mail ainda não confirmado, distinto de `ACCOUNT_DISABLED`), `AUTH_LINK_INVALID` (link de confirmação/recuperação expirado, malformado ou já usado, resposta única anti-enumeração), `AUTH_WEAK_PASSWORD` (senha rejeitada pelo backend apesar de passar da validação client-side) e `AUTH_PASSWORD_REUSED` (reservado; decisão pendente sobre implementar histórico de senha ou ajustar o texto de `change-password.tsx`).
- O roteiro completo de implementação Supabase, a lacuna de criação de `profiles`/`legal_acknowledgements`/`consent_events` sem sessão no cadastro, e o achado de UX do fluxo "Esqueci minha senha" estão em `docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md`.

## Fora desta etapa

- Consentimentos além do aceite combinado já modelado em `SignUpInput.legalAcceptance`.
- Verificação de telefone.
- Vínculo por código do prestador.
- Autorização real e proteção definitiva de rotas.
- Dados reais de agenda, clientes ou pacotes.

## Protótipo de clientes e vínculo por código

A rota `/clients` exercita localmente o fluxo previsto por `RF-VIN` e `RF-CAD`, sem persistência e sem substituir o futuro contrato de backend.

- o prestador possui um código aleatório, revogável e regenerável;
- a interface permite copiar o código para a área de transferência; o envio ao cliente ocorre fora do Rotinaê;
- compartilhar o código não concede acesso;
- o uso pelo cliente cria uma solicitação `Pendente`;
- somente a aprovação autenticada do prestador cria vínculo `Ativo`;
- rejeitar remove a solicitação da fila demonstrativa;
- regenerar invalida visualmente o código anterior na sessão;
- busca, filtros, cadastro, edição e exclusão operam apenas em memória;
- listagens tabulares usam paginação de 10 registros por página após aplicação de busca e filtros;
- solicitações de vínculo exibem até dois itens no card-resumo e abrem lista completa paginada em blocos de 10;
- operações locais exibem modal acessível de sucesso, alerta ou erro, persistente até confirmação, e confirmação antes da exclusão;
- e-mail duplicado, solicitação inexistente/processada e vínculo duplicado são tratados no protótipo;
- falhas reais de rede, sessão, autorização e persistência dependerão dos códigos normalizados do futuro adaptador;
- cadastro e edição permitem valor do serviço e política por cliente: quantidade total, quantidade diária e período, cada restrição com opção Livre;
- limites inválidos, diário maior que total, período invertido e valor negativo são bloqueados antes do envio;
- a interface não deve decidir `provider_id`, `tenant_id`, papel ou autorização.

O adaptador real deverá expor operações próprias para gerar/rotacionar código, solicitar, listar, aprovar, rejeitar e revogar vínculos. O servidor continuará como autoridade, aplicará rate limiting, evitará enumeração e armazenará apenas o material seguro definido na arquitetura. A exibição atual do código completo existe somente no protótipo local.

O contrato TypeScript preparado para essa integração está em `src/domain/clients/client-portfolio-port.ts`; o roteiro de implementação e segurança está em `docs/HANDOFF_CLIENTES_VINCULO_CRIS.md`.

## Contrato da Home

A Home agregará seus KPIs e compromissos por meio de `src/domain/dashboard/dashboard-port.ts`. O futuro adaptador deverá devolver um snapshot consistente, derivado da sessão e do tenant, com valores em centavos, data civil no fuso do prestador e erros normalizados. O roteiro está em `docs/HANDOFF_DASHBOARD_CRIS.md`.

O menu do perfil navega apenas para rotas implementadas. Módulos ainda não construídos permanecem desabilitados e identificados como “Em breve”, evitando navegação quebrada.

As notificações possuem destino interno explícito por recurso e leitura persistida no Supabase. No Android/iOS, `PushNotificationManager` registra a instalação conforme sessão, preferência e permissão; tocar no aviso valida `recipientUserId` e uma `NotificationDestination` conhecida, marca a inbox como lida quando possível e abre a rota correspondente. A Web não importa APIs nativas de push.

O registro financeiro deverá consumir `src/domain/payments/payment-port.ts`. Cliente e tenant serão validados pelo servidor; valores trafegam em centavos e o Rotinaê não movimenta dinheiro nem confirma recebimento por integração bancária nesta etapa.

## Histórico

### Pagamentos — protótipo persistente

- `PaymentPort` cobre listagem, criação, atualização, exclusão e registro atômico de pagamento parcial.
- `listPayments(input?: PaymentListInput): Promise<PaymentPage>` (DEC-098/DEC-099): achado do Leon — sem paginação, a listagem trazia todo o histórico financeiro do tenant de uma vez, risco real porque esse histórico cresce continuamente (cada quitação parcial soma uma linha `receipt`), diferente do catálogo de serviços (`ServiceCatalogPort.listServices`, dado curado, DEC-070) que permanece sem paginação por decisão consciente. A convenção replicada é a mesma já usada por `ClientPortfolioPort.listClients`/`AppointmentPort.listAppointments`/`NotificationPort.listNotifications`: `PaymentListInput = { page: number; pageSize: 10 }` e `PaymentPage = { items: PaymentRecord[]; page: number; pageSize: 10; totalItems: number; totalPages: number }`. Diferença deliberada em relação às três portas citadas: `input` é **opcional** (`listPayments()` continua compilando sem argumentos), porque a porta já existia sem paginação e a mudança precisa ser aditiva, mesmo espírito de `Client.primaryServiceId` (DEC-070). `SupabasePaymentAdapter` implementa o corte real no Postgres (`range()` + `count: "exact"`, DEC-099); ao omitir `input`, aplica `page: 1`/`pageSize: 10` (não mais o histórico inteiro).
- `apps/agendae/src/infra/payments/local-payment-adapter.ts` (protótipo `localStorage`/memória) foi removido por ser código morto (DEC-099): nenhuma tela o importava desde a migração para `SupabasePaymentAdapter` (DEC-092). `paymentService` aponta hoje só para o adapter Supabase.
- A interface trata carregamento, falha de leitura/gravação, tentativa novamente, duplicidade, edição e exclusão confirmada.
- Códigos normalizados vigentes: `CLIENT_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `DUPLICATE_PAYMENT`, `VALUE_INVALID`, `DUE_DATE_INVALID`, `PAYMENT_VALUE_INVALID`, `PAYMENT_EXCEEDS_BALANCE`, `PAYMENT_ALREADY_SETTLED`, `PAYMENT_CANCELLED` (DEC-094 — quitação parcial de cobrança cancelada; distinto de `PAYMENT_ALREADY_SETTLED`), `PAYMENT_HAS_RECEIPTS` (DEC-099 — excluir uma `charge` que já tem `receipt` filho de quitação parcial), `FORBIDDEN`, `SESSION_EXPIRED`, `NETWORK_ERROR`, `STORAGE_ERROR` e `UNKNOWN`.
- Cada quitação parcial cria uma linha `receipt`, vinculada por `parentPaymentId`, e reduz o saldo da linha `charge`; excluir a quitação restaura o saldo.
- Autorização real, sincronização entre dispositivos e falhas HTTP permanecem responsabilidade do adaptador remoto; não devem ser simuladas como segurança no cliente.

### Agenda — contrato preparado

- `AppointmentPort` cobre consulta mensal paginada, detalhe, criação, edição/remarcação, cancelamento, exclusão autorizada e confirmação manual.
- O estado do atendimento é separado do estado e da origem da confirmação.
- `clientMessage` é compartilhado; `internalNotes` é exclusivo do prestador e deve ser omitido dos payloads destinados ao cliente.
- Datas trafegam como instantes ISO em UTC com o fuso IANA preservado; valor e nome do serviço são snapshots.
- Os erros de conflito, vínculo, política, cota, permissão, sessão e rede estão normalizados em `AppointmentErrorCode`.
- A tela ainda usa armazenamento demonstrativo; o contrato e o roteiro de substituição estão em `docs/HANDOFF_AGENDA_CRIS.md`.

### Perfil do prestador e notificações — contratos preparados

- `ProviderSettingsPort` cobre consulta e atualização de dados profissionais, agenda padrão e preferências.
- `NotificationPort` cobre paginação, contagem não lida e leitura individual/em massa idempotente.
- O registro push usa uma instalação opaca no Secure Store e RPCs que derivam `auth.uid()`; token, fila, receipts e segredo do dispatcher nunca são expostos pela porta de leitura da inbox.
- A implementação HTTP e os critérios de segurança estão em `docs/HANDOFF_PERFIL_NOTIFICACOES_CRIS.md`.

### Disponibilidade e agendamento pelo cliente

- O prestador define dias da semana, jornada e intervalo no perfil; essa configuração gera a disponibilidade padrão.
- Ao salvar as configurações profissionais, `allowedWeekdays`, `workdayStart`, `workdayEnd` e `intervalMinutes` devem atualizar a Agenda e a grade oferecida ao cliente. O protótipo local sincroniza essas telas pela chave `agendae:provider-settings:v1` e pelo evento `agendae:provider-settings-updated`.
- Vagas específicas substituem a disponibilidade padrão somente na data em que forem publicadas. Nas demais datas, continuam valendo as configurações do perfil.
- A quantidade confirmável respeita o saldo do pacote e os limites diário/total da política individual do cliente; não existe um teto global nesta tela.
- Em uma data com vagas específicas, um horário não publicado deve retornar `SLOT_UNAVAILABLE`.
- Nas demais datas, o frontend gera vagas somente nos dias permitidos e dentro da jornada; `get_client_booking_context` devolve, por prestador/mês, os compromissos já agendados (`occupiedStartsAt`) e os bloqueios de agenda (`blocks`, `starts_at`/`ends_at` arbitrários, não necessariamente o dia inteiro) em bruto, e é a tela (`app/client-booking.tsx` + `src/domain/agenda/client-booking-policy.ts`) que remove as vagas correspondentes antes de oferecer opções ao cliente.
- Um bloqueio nunca esconde o dia inteiro apenas por existir: ele recorta o expediente do prestador (`workdayStart`–`workdayEnd`, no fuso do prestador) e só marca vagas individuais como indisponíveis (`blockedSlotIds`). O dia só aparece como indisponível no calendário quando, depois de remover bloqueios e ocupações (`hasAvailableTimeForDay`), não sobra nenhum horário livre.
- O cliente pode montar uma seleção com várias datas, inclusive entre meses. Cada item precisa ser revalidado atomicamente na confirmação para impedir corrida por vaga, duplicidade e estouro de cota.
- Uma confirmação em lote cria um agendamento e uma notificação ao prestador por item. Falha parcial não é aceita: o backend confirma todos ou nenhum e devolve os itens conflitantes.
- O protótipo persiste seleções/notificações apenas no navegador. Sincronização, transação, push e autorização dependem do adaptador remoto.
- As regras puras do frontend estão em `src/domain/agenda/client-booking-policy.ts`, com cenários automatizados para dias, substituição por vagas específicas, geração de horários, duplicidade, vaga ocupada e bloqueios parciais/totais de agenda (`blockedSlotIds`, `hasAvailableTimeForDay`).

### Planos e assinatura SaaS

- `SubscriptionPort` fornece o entitlement do prestador, checkout hospedado, cancelamento no fim do período, retomada e portal de cobrança.
- `AdminSubscriptionPort` expõe somente overrides manuais auditáveis para perfis com Prestador.
- A tela nunca considera o retorno do checkout como confirmação; o entitlement do backend, conciliado por webhook idempotente, é a fonte de verdade.
- O contrato completo de integração está em `docs/HANDOFF_PLANOS_ASSINATURA_BACKEND.md`.

### Página individual do cliente

- `ClientPortfolioPort` inclui listagem, criação, edição e exclusão de anotações internas do caso.
- a rota `/clients/[id]` concentra dados, política e histórico interno; a linha/seta navega e o lápis da tabela edita sem sair da lista.
- anotações locais são demonstrativas e devem ser substituídas pelos endpoints descritos no handoff de clientes.

### Catálogo de serviços — rota `/services` (BLG-076, DEC-133/134/135)

`ServiceCatalogPort` (`src/domain/services/service-catalog-port.ts`) fecha a lacuna de RF-CAD-004 (DEC-070): `AppointmentRecord.serviceId`/`serviceNameSnapshot`/`valueCentsSnapshot` sempre pressupuseram um catálogo de serviços. A rota `app/services.tsx` agora consome `serviceCatalogService` (`SupabaseServiceCatalogAdapter`) diretamente: listar (com filtro por status e busca por nome, ambos client-side, sem paginação), criar, editar, ativar e desativar. Item "Serviços" no menu do prestador (`authenticated-header.tsx`, entre "Início" e "Agenda") e no FAB `UniversalCreateMenu`. Fluxo/UX completo em `docs/HANDOFF_UX_SERVICOS_DANTE.md` (seções 1–11; a seção 12, sobre o campo de profissão/especialidade do prestador, é um conceito distinto e permanece fora de escopo — ver DEC-134/136); handoff visual em `docs/HANDOFF_VISUAL_SERVICOS_NERO.md` (Bloco A).

- `Service` tem `name`, `durationMinutes`, `referenceValueCents` (centavos, valor "de tabela") e `status: 'active' | 'inactive'`; nunca é excluído fisicamente, apenas inativado (mesma convenção de `archiveClient`).
- `listServices` não é paginado: catálogo é dado curado (dezenas de itens, não histórico transacional) — decisão documentada no handoff, revisável se o volume real invalidar a premissa.
- `activateService`/`deactivateService` são idempotentes: reaplicar sobre o status atual não é erro; ativar não exige confirmação, desativar exige (modal de confirmação, nunca com o vocabulário de "excluir").
- Validação client-side (nome, duração inteira > 0, valor inteiro ≥ 0 em centavos, conflito de nome entre serviços ativos) extraída como função pura testável em `src/domain/services/service-form-validation.ts`; mapeamento de `ServiceErrorCode` para apresentação visual (campo/banner/feedback) em `src/domain/services/service-error-presentation.ts`; filtro/busca da lista em `src/domain/services/service-catalog-view.ts`.
- `app/agenda.tsx`: quando `serviceOptions` está vazio (catálogo do prestador sem nenhum serviço ativo), o campo "Serviço" exibe um aviso acionável com atalho direto para `/services` (RF-CAD-014), em vez de deixar o usuário bater apenas na validação genérica "Selecione um serviço ativo do catálogo." sem caminho de ação.
- `Client.primaryServiceId` (aditivo, opcional) foi adicionado a `src/domain/clients/types.ts` como referência opcional a `Service.id`, sem alterar `ClientPortfolioPort` nem exigir mudança em `SupabaseClientPortfolioAdapter`/`MockClientPortfolioAdapter` para continuar compilando. Não substitui `primaryService` (rótulo livre) nem implica que `serviceValueCents` deva copiar `referenceValueCents` — ambos podem divergir intencionalmente, do mesmo jeito que `valueCentsSnapshot` diverge do catálogo após reajustes.

| Versão | Data | Alteração |
|---|---|---|
| 0.1.0 | 02/08/2026 | Porta inicial de autenticação e contrato de integração front-end/backend. |
| 0.2.0 | 02/08/2026 | Login movido para a rota inicial, remoção da tela intermediária e registro da topologia pública da Etapa 1. |
| 0.3.0 | 02/08/2026 | Rotas visuais de cadastro, confirmação de e-mail, alteração de senha e feedback; contratos reais correspondentes permanecem pendentes do Cris. |
| 0.4.0 | 03/08/2026 | Inclusão da rota demonstrativa de clientes e do fluxo visual de vínculo por código com solicitação pendente e aprovação do prestador. |
| 0.5.0 | 03/08/2026 | Contrato da Agenda, confirmação manual, filtros, paginação e separação entre mensagem compartilhada e observação interna. |
| 0.6.0 | 04/08/2026 | Fluxo cliente/prestador para vagas publicadas e agenda livre, seleção multi-mês, cotas, notificações locais e Manual contextual por perfil. |
| 0.7.0 | 06/08/2026 | Contrato `AuthRegistrationPort` para cadastro, confirmação de e-mail e recuperação de senha, decoupled de `AuthPort`; quatro códigos novos em `AuthErrorCode`; handoff `docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md` (DEC-067). |
| 0.8.0 | 06/08/2026 | Contrato `ServiceCatalogPort` (RF-CAD-004) fechando a lacuna de catálogo de serviços pressuposta por `AppointmentRecord`; `Client.primaryServiceId` adicionado de forma aditiva; nenhuma tela criada — handoff `docs/HANDOFF_SERVICOS_CRIS.md` (DEC-070). |
| 0.9.0 | 07/08/2026 | Registro histórico de DEC-076: 7 das 8 telas passaram ao adapter real e `switch-profile.tsx` ficou temporariamente no mock. A restrição de perfil único deste registro foi posteriormente substituída pela regra multi-perfil. |
| 0.10.0 | 11/08/2026 | `PaymentPort.listPayments` estendido de forma aditiva com paginação opcional (`PaymentListInput`/`PaymentPage`), fechando o achado do Leon sobre histórico financeiro sem paginação; mesma convenção `page`/`pageSize: 10` já usada por `ClientPortfolioPort`/`AppointmentPort`/`NotificationPort`. Contrato apenas — nenhum adapter corta o resultado ainda (DEC-098). | |
| 0.11.0 | 11/08/2026 | `SupabasePaymentAdapter.listPayments` implementa o corte real de paginação no Postgres (`range()`/`count: "exact"`); novo código `PAYMENT_HAS_RECEIPTS` para exclusão de `charge` com `receipt` filho; `local-payment-adapter.ts` (código morto) removido — `paymentService` só aponta para o adapter Supabase (DEC-099). |
| 0.12.0 | 11/08/2026 | `listPayments` passa período, status, busca e página à RPC `list_manual_payments`; a resposta inclui KPIs consolidados no servidor e `hasReceipt`. A RN-FIN-009 também é garantida por trigger no PostgreSQL. |
| 0.13.0 | 11/08/2026 | Push nativo conectado à inbox com permissão, token por instalação, preferência, logout e abertura segura; fila/receipts ficam no backend e a Web preserva apenas a central persistida (DEC-119). |
| 0.14.0 | 13/08/2026 | Rota `app/services.tsx` implementada consumindo `ServiceCatalogPort` real (BLG-076, DEC-133/134/135): listar, criar, editar, ativar e desativar serviços, sem paginação; item "Serviços" no menu do prestador e no FAB `UniversalCreateMenu`; novo ícone `services` em `AppIconName`; `app/agenda.tsx` ganha aviso acionável com atalho para `/services` quando o catálogo está vazio (RF-CAD-014). |
