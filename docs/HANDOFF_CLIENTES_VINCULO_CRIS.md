# Handoff — Clientes e vínculo por código

> Responsável futuro: Cris  
> Preparado em: 03/08/2026  
> Estado: front-end demonstrativo concluído; persistência real pendente

## 1. Objetivo

Conectar `/clients` ao Supabase sem alterar o comportamento ou os estados visuais da tela. A interface atual mantém dados em memória. A futura composição deverá injetar uma implementação de `ClientPortfolioPort`, preservando domínio e UI independentes do SDK.

Arquivos de contrato:

- `apps/agendae/src/domain/clients/types.ts`
- `apps/agendae/src/domain/clients/client-portfolio-port.ts`

## 2. Regras que não podem mudar

1. O servidor deriva usuário, perfil e tenant da sessão; a UI nunca escolhe `provider_id` ou `tenant_id`.
2. Informar o código cria vínculo `pending`, sem acesso operacional.
3. Somente o proprietário do tenant aprova ou rejeita.
4. Apenas vínculo `active` autoriza dados e operações do cliente.
5. Um cliente pode ter vínculos independentes com vários prestadores.
6. Regenerar código revoga o anterior atomicamente; solicitações existentes permanecem inalteradas.
7. Exclusão visual de cliente deve virar arquivamento/revogação lógica. Histórico sujeito a retenção não é apagado.
8. Código completo, tokens e dados pessoais não entram em logs, analytics ou mensagens técnicas.
9. Valor e política de agendamento pertencem ao contexto tenant-cliente, não ao perfil global do cliente.
10. Limites livres são persistidos como `null`; zero nunca significa ilimitado.
11. Vínculo só é válido entre perfis diferentes (RN-PER-016): a identidade que informa o código precisa ter perfil Cliente ativo. Se a conta autenticada tiver perfil Prestador (ou não tiver nenhum vínculo de perfil Cliente disponível), o servidor recusa com `LINK_ROLE_MISMATCH` — antes mesmo de checar tenant, código ou duplicidade. A mesma restrição vale no sentido inverso: um Cliente não pode gerar nem aprovar código de vínculo.

## 3. Operações esperadas

| Porta | Implementação Supabase sugerida |
|---|---|
| `getOverview` | RPC/agregação autorizada no tenant ativo |
| `listClients` | consulta paginada no servidor, 10 itens, busca e status antes da paginação |
| `createClient` | função transacional que cria cadastro no tenant e impede e-mail duplicado normalizado |
| `updateClient` | update com RLS, ownership e controle de concorrência |
| `archiveClient` | arquivamento lógico; nunca `delete` físico direto pela tela |
| `getLinkCodeSummary` | retorna apenas prefixo, status e validade; não retorna segredo persistido |
| `rotateLinkCode` | Edge Function/RPC server-side com CSPRNG, hash + pepper e retorno único de `fullCode` |
| `listPendingLinkRequests` | vínculos `pending` do tenant autenticado, paginados no servidor em blocos de 10 |
| `decideLinkRequest` | transição atômica `pending -> active/rejected`, auditada |
| `revokeClientLink` | transição para `revoked`, preservando histórico |

O cadastro/edição também persiste `service_value_cents` e a política: `total_booking_limit`, `daily_booking_limit`, `request_window_start` e `request_window_end`. Recomenda-se tabela/versionamento próprio por vínculo (`provider_client_booking_policies`) para manter histórico e evitar misturar configuração de tenants diferentes. A criação/remarcação deve validar política e reservar quantidade na mesma transação usada para impedir conflito de horário.

### Telefone, WhatsApp e convite por e-mail

- `phone` é opcional, mas obrigatório quando alguma finalidade de WhatsApp estiver autorizada; persistir normalizado em E.164 (Brasil: `+55...`) e manter estado de verificação separado;
- WhatsApp fica restrito a mensagens transacionais de `appointment_confirmation` e `appointment_reminder`; marketing, texto livre e reaproveitamento do consentimento para outra finalidade ficam proibidos;
- cada finalidade exige consentimento independente, revogável e auditável (`granted`, `captured_at`, `captured_by_user_id`, `source`); a revogação deve bloquear novos envios imediatamente;
- antes de enfileirar uma mensagem, o servidor valida tenant, vínculo ativo, agendamento pertencente ao cliente, telefone verificado, consentimento atual e template aprovado;
- o envio usa fila/outbox, chave de idempotência, tentativas limitadas e webhook autenticado do provedor. A interface nunca chama diretamente a API do WhatsApp;
- ao cadastrar, `linkInvitationDelivery: email` solicita o envio assíncrono do convite. Falha no e-mail não desfaz o cadastro: retorna estado `queued/sent/failed` e permite reenvio;
- o e-mail de vínculo deve usar convite individual, expirável e de uso único. Não registrar o código completo em logs, analytics, notificações push ou mensagens de erro;
- aplicar rate limit por tenant, cliente e destino, registrar auditoria sem conteúdo sensível e tratar bounce/complaint antes de novo envio.

Contratos preparados no front: `ClientCommunicationPreferences`, `CommunicationConsentEvidence`, `SendClientLinkInvitationInput`, `ClientLinkInvitationDelivery` e `ClientMessagingPort`.

### Reconciliação entre cadastro interno e conta do cliente

O cliente criado pelo prestador é um registro interno e pode existir com `client_user_id = null`. Quando uma pessoa autenticada informar o código:

1. validar código, tenant, identidade e e-mail verificado sem revelar cadastros existentes;
2. executar `previewLinkReconciliation` dentro do tenant;
3. um único cadastro sem identidade e com o mesmo e-mail verificado recomenda `attach_existing`;
4. correspondência somente por telefone sempre exige `manual_review`; nome nunca autoriza associação;
5. mais de um cadastro com o mesmo e-mail exige revisão/mesclagem administrativa;
6. cadastro já associado a outro `client_user_id` retorna conflito e nunca é sobrescrito;
7. sem correspondência, a aprovação pode criar o registro vinculado com `record_origin = client_created`;
8. aprovação, preenchimento de `client_user_id`, ativação do vínculo e preservação das políticas devem ocorrer na mesma transação e gerar auditoria.

Restrições recomendadas: índice único parcial para `tenant_id + normalized_email` nos registros não arquivados e unicidade de `tenant_id + client_user_id` quando não nulo. Corridas simultâneas devem resultar em uma única associação; a segunda operação recebe conflito idempotente.

O front expõe `LinkReconciliationPreview`, `ClientReconciliationCandidate`, `previewLinkReconciliation` e a classificação testável em `link-reconciliation.ts`.

O fluxo do cliente que informa o código deverá ter uma porta própria ou extensão versionada. A resolução do código precisa ocorrer no servidor, com rate limiting e resposta não enumerável.

## 4. Tabelas e segurança

Usar como fonte de verdade `docs/ARQUITETURA_BACKEND_ETAPA_1.md`, especialmente:

- `tenants` e `tenant_memberships`;
- `provider_link_codes` (`token_hash`, `display_prefix`, status e timestamps);
- `provider_client_links` (estados e atores de decisão);
- `audit_events` append-only.

Policies mínimas:

- prestador lista/muta somente dados do tenant que possui;
- cliente lê somente os próprios recursos em vínculo `active` e no contexto selecionado;
- nenhum policy confia apenas em `tenant_id` recebido do cliente;
- aprovação, rejeição, rotação e revogação são auditadas;
- tentativa cross-tenant retorna erro público neutro e deixa evidência técnica segura.

## 5. Erros públicos

O adaptador converte Postgres/Supabase nos códigos de `ClientDomainErrorCode`. A tela não interpreta texto cru do fornecedor.

| Código | Resposta da UI |
|---|---|
| `CLIENT_EMAIL_CONFLICT` | manter formulário e informar duplicidade |
| `CLIENT_NOT_FOUND` | fechar detalhe, atualizar lista e informar indisponibilidade |
| `BOOKING_POLICY_INVALID` | manter formulário e destacar limites/período inconsistentes |
| `BOOKING_TOTAL_LIMIT_REACHED` | informar quantidade esgotada e impedir confirmação |
| `BOOKING_DAILY_LIMIT_REACHED` | informar limite da data escolhida e permitir escolher outro dia |
| `BOOKING_REQUEST_WINDOW_CLOSED` | informar período permitido e impedir data fora da janela |
| `LINK_ALREADY_EXISTS` | informar estado existente sem duplicar vínculo |
| `CLIENT_RECONCILIATION_AMBIGUOUS` | exigir revisão sem escolher automaticamente |
| `CLIENT_IDENTITY_ALREADY_ATTACHED` | bloquear associação e preservar o titular atual |
| `CLIENT_DUPLICATE_RECORD` | encaminhar para mesclagem administrativa auditável |
| `PHONE_REQUIRED` | pedir telefone com DDD antes de autorizar WhatsApp |
| `PHONE_NOT_VERIFIED` | não enviar e orientar verificação do número |
| `CONSENT_REQUIRED` | bloquear a finalidade não autorizada |
| `TEMPLATE_NOT_APPROVED` | não tentar texto livre; registrar falha operacional |
| `MESSAGE_ALREADY_QUEUED` | considerar idempotência e não duplicar lembrete |
| `PROVIDER_UNAVAILABLE` | manter na fila e aplicar política de nova tentativa |
| `RATE_LIMITED` | aguardar janela segura sem duplicar mensagem |
| `LINK_REQUEST_NOT_FOUND` / `INVALID_LINK_TRANSITION` | atualizar solicitações e informar que já foi processada |
| `LINK_CODE_EXPIRED` / `LINK_CODE_NOT_FOUND` | mensagem neutra; não revelar prestador |
| `LINK_ROLE_MISMATCH` | remover a solicitação da lista e informar que vínculo só é permitido entre um Prestador e uma conta Cliente |
| `FORBIDDEN` / `SESSION_EXPIRED` | bloquear mutação e retornar ao fluxo de acesso quando aplicável |
| `RATE_LIMITED` | orientar espera sem expor limites internos |
| `NETWORK_ERROR` / `UNKNOWN` | preservar entrada e oferecer nova tentativa com correlation ID seguro |

## 6. Migração da tela

1. Criar `SupabaseClientPortfolioAdapter implements ClientPortfolioPort` em `src/infra/clients`.
2. Exportar a composição como `clientPortfolioService`, seguindo o padrão de `authService`.
3. Substituir arrays e mutações locais de `/clients` por chamadas assíncronas à porta.
4. Manter modais e mapear `ClientDomainError` para os feedbacks existentes.
5. Aplicar loading independente para lista, formulário, código e decisão de vínculo.
6. Invalidar/rebuscar overview, página atual e solicitações após cada mutação.
7. Persistir página, busca e filtro somente como estado de UI; paginação ocorre no servidor.

## 7. Testes de aceite

- código gerado por um Prestador é recusado (`LINK_ROLE_MISMATCH`) quando resgatado por outra conta com perfil Prestador; a solicitação não chega a ficar `pending` de forma persistente;
- prestador A não lista ou altera cliente do prestador B;
- cliente pendente/rejeitado/revogado não acessa dados operacionais;
- aprovação concorrente não cria duplicidade;
- rotação invalida imediatamente o código anterior;
- código completo aparece uma única vez após rotação e não é registrado;
- busca/filtro retornam total correto e páginas de 10 itens;
- solicitações mostram dois itens no resumo e lista completa paginada em blocos de 10;
- limite total 1 impede uma segunda marcação consumidora;
- limite diário 1 permite marcações em dias distintos e bloqueia a segunda no mesmo dia;
- cancelamento libera quantidade; conclusão e não comparecimento continuam consumindo;
- período definido bloqueia datas anteriores e posteriores; período Livre não adiciona restrição;
- combinação de limites aplica a condição mais restritiva e não cancela agenda existente após edição;
- valor é salvo em centavos, mostrado ao cliente e copiado como snapshot no agendamento;
- políticas do mesmo cliente em prestadores diferentes permanecem isoladas;
- sessão expirada e falha de rede preservam dados digitados;
- todas as mutações produzem feedback e evento de auditoria esperado;
- web, Android e iOS executam os mesmos cenários de contrato.

## 8. Página individual e anotações internas

- `GET /v1/clients/:id` retorna somente cliente pertencente ao tenant autenticado.
- `GET/POST /v1/clients/:id/notes` e `PATCH/DELETE /v1/client-notes/:noteId` sustentam o histórico interno.
- anotações registram autor, criação e atualização; exclusões e edições são auditadas.
- o conteúdo é exclusivo do prestador e nunca integra payloads, notificações ou telas do cliente.
- erros normalizados incluem `CLIENT_NOTE_NOT_FOUND` e `CLIENT_NOTE_INVALID`.

## 9. Decisão pendente antes da migration

Resolver `BLG-042`: política definitiva de validade e exibição do código. A recomendação vigente é retorno completo somente na geração/rotação e persistência apenas de hash/prefixo. O protótipo mostra o código durante a sessão exclusivamente para demonstrar a experiência.
