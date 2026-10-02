# Handoff — Catálogo de serviços

> Responsável futuro: Cris
> Preparado em: 06/08/2026
> Estado: contrato definido; nenhuma tela, migration ou adapter implementados ainda

## 0. Aviso importante — não existe tela para este contrato

Diferente dos demais handoffs (`/clients`, `/agenda`, `/payments`), **não há hoje nenhuma rota, mock ou protótipo visual de gestão de serviços** em `apps/agendae/app/`. RF-CAD-004 ("Cadastrar, editar, ativar e inativar serviços com nome, duração e valor de referência") nunca foi implementado no front.

Este handoff existe para desbloquear o Cris a implementar schema/RLS/adapter **antes** de a tela existir — a mesma abordagem já usada para `AppointmentPort` (`docs/HANDOFF_AGENDA_CRIS.md`), que tem contrato e adaptador local de demonstração sem uma tela de agenda dedicada além do que já existe. A diferença aqui é que nem o adaptador local/demonstrativo existe: só o contrato TypeScript.

**Recomendação explícita:** antes de qualquer integração de tela, envolver Dante (fluxo/UX de cadastro de serviços, provavelmente uma aba dentro de `/clients` ou uma rota própria `/services`) e Nero (componentes visuais, reaproveitando os padrões de tabela/formulário já usados em `/clients`). Este documento cobre apenas o contrato de domínio e o roteiro de backend — não prescreve nenhuma tela.

## 1. Objetivo

Implementar o catálogo de serviços do prestador no Supabase, aderente a `ServiceCatalogPort`, para que:

1. `AppointmentPort` (agenda) deixe de depender de um catálogo inexistente — hoje `AppointmentRecord.serviceId`/`serviceNameSnapshot`/`valueCentsSnapshot` pressupõem uma entidade de serviço que nunca foi contratada;
2. `ClientPortfolioPort` possa, opcionalmente, referenciar um serviço padrão por cliente via o novo campo aditivo `Client.primaryServiceId`, sem quebrar o que já está implementado (`SupabaseClientPortfolioAdapter`, DEC-069).

Arquivos de contrato:

- `apps/agendae/src/domain/services/types.ts`
- `apps/agendae/src/domain/services/service-catalog-port.ts`

Arquivo aditivo (não quebra contrato existente):

- `apps/agendae/src/domain/clients/types.ts` — `Client.primaryServiceId?: string | null` e `CreateClientInput.primaryServiceId?: string | null`.

## 2. Regras que não podem mudar

1. O servidor deriva usuário, perfil e tenant da sessão; a UI/adapter nunca decide `tenant_id` a partir do corpo da requisição (mesma convenção de `ClientPortfolioPort`).
2. Nunca há exclusão física de serviço (`delete`). Inativar é a única forma de remover um serviço da oferta ativa — mesma convenção de `archiveClient`. Um serviço inativo permanece consultável por `id` para preservar a integridade referencial de `AppointmentRecord.serviceId` (agendamentos históricos) e de `Client.primaryServiceId`.
3. `referenceValueCents` é um valor "de tabela", não um histórico. Editar o valor de um serviço **nunca** reescreve `AppointmentRecord.valueCentsSnapshot` de agendamentos já confirmados (RN-AGD-023) nem `Client.serviceValueCents` de políticas de cliente já configuradas.
4. `durationMinutes` deve ser um inteiro maior que zero — é insumo direto do cálculo de slots de agenda (RN-AGD-002, RN-AGD-003), então validação inconsistente aqui quebra silenciosamente a disponibilidade.
5. `activateService`/`deactivateService` são idempotentes: reaplicar a operação sobre um serviço já no status alvo deve devolver 200 com o registro atual, nunca um erro de "já está ativo/inativo".
6. Isolamento por tenant via RLS deny-by-default, mesma arquitetura de `clients`/`provider_client_links` (`docs/ARQUITETURA_BACKEND_ETAPA_1.md`).
7. Nada neste contrato define UI. Nenhuma tela deve ser criada como parte desta implementação de backend — ver seção 0.

## 3. Operações esperadas

| Porta | Implementação Supabase sugerida |
|---|---|
| `listServices(query?)` | `select` simples no tenant do prestador autenticado, sem paginação (ver justificativa abaixo), filtrável por `status` |
| `getService(id)` | `select` por `id` restrito ao tenant; `SERVICE_NOT_FOUND` fora do tenant ou inexistente |
| `createService(input)` | `insert` validando `name` não vazio, `durationMinutes` inteiro > 0, `referenceValueCents` inteiro >= 0 |
| `updateService(input)` | `update` parcial com as mesmas validações; nunca reescreve snapshots já gravados em `appointments`/`clients` |
| `activateService(id)` | `update status = 'active'`, idempotente |
| `deactivateService(id)` | `update status = 'inactive'`, idempotente; não cancela nem invalida agendamentos existentes que referenciem o serviço (mesmo espírito de RN-AGD-013 para disponibilidade) |

### Por que sem paginação

O catálogo de um prestador é dado curado, não transacional: dezenas de itens no máximo, tipicamente muito menos. Diferente de `clients` (cresce por cadastro contínuo) ou `appointments` (cresce por ocorrência no tempo), `services` não tem uma trajetória de crescimento ilimitado esperada no MVP. Uma lista simples evita paginação desnecessária em toda tela que precisar popular um seletor de serviço (criação de agendamento, configuração de política de cliente). Se o volume observado em produção invalidar essa premissa, revisar para paginação real (YAGNI — não implementar antecipadamente).

### Migration sugerida

```sql
create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  name text not null check (char_length(btrim(name)) > 0),
  duration_minutes integer not null check (duration_minutes > 0),
  reference_value_cents integer not null check (reference_value_cents >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index services_tenant_active_name_key
  on public.services (tenant_id, lower(btrim(name)))
  where status = 'active';
```

- índice único parcial evita dois serviços ativos com o mesmo nome (case-insensitive) no mesmo tenant, sem impedir reaproveitar um nome já usado por um serviço inativo (histórico não é apagado);
- RLS deny-by-default: somente o proprietário do tenant (`owner_user_id = auth.uid()`, mesmo padrão de `clients`) lê/muta linhas do próprio tenant;
- trigger de auditoria reaproveitando `audit_creation`/`audit_status_change` já existentes (DEC-069), cobrindo criação e mudança de `status`;
- `tenant_id` imutável após criação (mesmo trigger de imutabilidade seletiva já usado em `clients`).

### Extensão de `clients` (aditiva)

```sql
alter table public.clients
  add column primary_service_id uuid null references public.services(id);
```

- coluna nova, nula por padrão — não afeta nenhuma linha existente nem exige backfill;
- sem `on delete cascade`/`restrict` explícito: como `services` nunca é excluído fisicamente (regra 2), essa decisão de integridade referencial não chega a ser exercitada; ainda assim, recomenda-se `on delete restrict` (padrão do Postgres) por segurança caso a regra mude no futuro;
- RLS de `clients` já existente não precisa mudar: a nova coluna é apenas mais um campo da mesma linha, sujeito à mesma policy.

### Extensão de `appointments` (quando o schema de agenda for implementado)

Este handoff não implementa `appointments` (fora de escopo — ver `docs/HANDOFF_AGENDA_CRIS.md`), mas documenta a dependência para quando essa migration for escrita: `appointments.service_id` deve referenciar `services(id)` (`on delete restrict`, já que exclusão física de serviço nunca ocorre), e a criação/edição de um agendamento deve validar `services.status = 'active'` e pertencimento ao mesmo tenant antes de copiar `serviceNameSnapshot`/`valueCentsSnapshot` — retornando `SERVICE_NOT_FOUND` (já existente em `AppointmentErrorCode`) quando o serviço não existir, não pertencer ao tenant, ou estiver inativo.

## 4. Erros públicos

O adaptador converte erros do Postgres/Supabase para `ServiceErrorCode`. Nenhuma tela futura deve interpretar texto cru do fornecedor.

| Código | Uso esperado |
|---|---|
| `SERVICE_NOT_FOUND` | serviço inexistente, de outro tenant, ou removido/renomeado entre a listagem e a ação |
| `SERVICE_NAME_INVALID` | nome vazio, só espaços, ou acima do limite de tamanho definido na tela futura |
| `SERVICE_NAME_CONFLICT` | já existe serviço ativo com o mesmo nome (case-insensitive) no tenant |
| `DURATION_INVALID` | duração ausente, zero, negativa ou não inteira |
| `VALUE_INVALID` | valor de referência ausente, negativo ou não inteiro (frontend trabalha sempre em centavos) |
| `FORBIDDEN` | tentativa de acessar/mutar serviço de outro tenant |
| `SESSION_EXPIRED` | sessão expirada durante a operação |
| `NETWORK_ERROR` | falha de rede; preservar formulário quando houver tela |
| `UNKNOWN` | erro não mapeado; registrar com `correlationId` |

## 5. Critérios mínimos de aceite

- consultas e mutações são isoladas por tenant, sem exceção;
- `deactivateService` nunca é exclusão física; o registro permanece consultável por `getService`;
- reativar/inativar repetidamente o mesmo serviço não gera erro nem duplica auditoria;
- editar `referenceValueCents` ou `durationMinutes` não altera nenhum `AppointmentRecord` ou `Client.serviceValueCents` já persistido;
- nome duplicado (case-insensitive) entre serviços ativos do mesmo tenant é rejeitado com `SERVICE_NAME_CONFLICT`; nome repetido entre um serviço ativo e um inativo é permitido;
- `durationMinutes`/`referenceValueCents` não numéricos, negativos ou zero (duração) são rejeitados antes da escrita;
- todas as mutações produzem evento de auditoria sem copiar dados sensíveis (não há dados sensíveis neste domínio, mas o padrão de auditoria deve ser mantido por consistência);
- `Client.primaryServiceId` aceita `null`/ausente sem exigir nenhuma migração de dado existente;
- web, Android e iOS (quando aplicável) executam os mesmos cenários de contrato.

## 6. Próximo passo de integração

1. Implementar a migration de `services` e a extensão aditiva de `clients` descritas na seção 3.
2. Implementar `SupabaseServiceCatalogAdapter implements ServiceCatalogPort` em `src/infra/services`, exportado como `serviceCatalogService`, seguindo o padrão de `clientPortfolioService`/`authService`.
3. Nenhuma tela deve ser alterada ou criada como parte desta entrega — este contrato fica pronto para ser consumido quando Dante/Nero desenharem a tela de gestão de serviços e quando `AppointmentPort` for implementado de fato (que hoje só tem adaptador local em `localStorage`, não Supabase).
