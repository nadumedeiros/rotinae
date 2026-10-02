# Handoff — UX do catálogo de serviços do prestador

> Responsável por este documento: Dante (arquitetura de experiência)
> Preparado em: 13/08/2026
> Destinatários: Nero (UI/Design System), ADA (wiring de frontend)
> Estado: **Aprovado pelo usuário para início imediato de Nero/ADA.** Fecha `BLG-076` (P0) do lado de fluxo/UX. Não define UI visual final (cor, tipografia, composição de layout — papel de Nero) nem implementa código (papel de ADA).

## 0. Contexto e confirmação de pré-requisitos

`BLG-076` (P0): a tabela `public.services` está vazia em toda a produção do Rotinaê. Nunca existiu tela para o prestador cadastrar serviços, então `app/agenda.tsx` (que já exige um serviço ativo do catálogo desde DEC-127) e `app/client-booking.tsx` (que monta `selectedService` a partir do mesmo catálogo via `get_client_booking_context`) travam qualquer agendamento real. Um serviço de teste foi inserido manualmente só no tenant de testes (DEC-132) — isso não resolve o problema sistêmico.

Antes de desenhar qualquer fluxo novo, confirmei por leitura direta dos artefatos que **o backend está 100% pronto e não falta nada**:

- `apps/agendae/src/domain/services/types.ts` e `service-catalog-port.ts` definem o contrato completo (`Service`, `CreateServiceInput`, `UpdateServiceInput`, `ServiceListQuery`, `ServiceErrorCode`, `ServiceCatalogPort` com 6 métodos).
- `apps/agendae/src/infra/services/supabase-service-catalog-adapter.ts` implementa os 6 métodos (`listServices`, `getService`, `createService`, `updateService`, `activateService`, `deactivateService`) contra o Supabase real, com validação client-side espelhando as constraints do banco, mapeamento completo de erro Postgres → `ServiceErrorCode` (`23505`→`SERVICE_NAME_CONFLICT`, `23514` por nome de constraint → `SERVICE_NAME_INVALID`/`DURATION_INVALID`/`VALUE_INVALID`, `42501`→`FORBIDDEN`, rede→`NETWORK_ERROR`), idempotência real de `activateService`/`deactivateService` (um único `UPDATE` sem filtrar por status atual) e nenhuma chamada `.delete()` em nenhum caminho.
- `docs/HANDOFF_SERVICOS_CRIS.md` (DEC-070/071) confirma migration, RLS, índice único parcial de nome ativo por tenant e auditoria já aplicados.

**Não há nenhuma pendência de backend a reportar.** Este documento cobre exclusivamente fluxo, campos, regras e estados — zero implementação.

## 1. Decisão de navegação

**Decisão: rota própria `/services`, acessível pelo menu do perfil (mesmo padrão de `/plans`), com item novo em `authenticated-header.tsx` e novo `Stack.Screen` em `app/_layout.tsx`. Não é uma aba dentro de `/clients` nem uma seção de `/settings.tsx`.**

### Por que não dentro de `/clients`

O próprio `docs/HANDOFF_SERVICOS_CRIS.md` (seção 0) apresenta essa opção como possibilidade, mas descartei por três razões:

1. **Domínio distinto, não subordinado.** `Client.primaryServiceId` é uma referência opcional de um cliente a um serviço — não o inverso. O catálogo de serviços é consumido por `app/agenda.tsx` (agendamento manual do prestador) e por `app/client-booking.tsx` (agendamento do cliente) tanto quanto por `clients.tsx`. Aninhar sob `/clients` sugeriria uma hierarquia de posse que não existe no domínio (RF-CAD-004 é um requisito irmão de RF-CAD-001, não filho).
2. **`clients.tsx` já tem 2953 linhas** e múltiplas responsabilidades acopladas (portfólio, código de vínculo, solicitações pendentes, políticas de agendamento por cliente). Adicionar uma aba de gestão de catálogo (list+create+edit+activate/deactivate) infla ainda mais um arquivo que já concentra risco de regressão (histórico recente de bugs em `clients.tsx`: BLG-073, BLG-074, BLG-075).
3. **Sem precedente de "abas" no projeto.** Nenhuma tela hoje mistura dois domínios de cadastro sob abas internas — `HANDOFF_RECUPERACAO_SENHA_UX_DANTE.md` já registrou esse mesmo racional para rejeitar multiplexar telas de auth; aplica-se aqui de forma idêntica (Nielsen #4, consistência com o padrão já estabelecido).

### Por que não dentro de `/settings.tsx`

`settings.tsx` é exclusivamente identidade + operação do tenant (dados pessoais, e-mail, telefone, fuso, jornada de trabalho, antecedência mínima, notificações) — todos campos de **configuração da conta**, sem lista, sem CRUD de entidades, sem paginação/filtro. Um catálogo de serviços é uma **entidade de negócio com ciclo de vida próprio** (criar, editar, ativar, desativar), estruturalmente mais parecido com `clients.tsx`/`agenda.tsx` do que com `settings.tsx`. Forçar uma lista com CRUD dentro de uma tela de formulário de configurações quebraria a consistência de propósito de `settings.tsx` (Nielsen #2, correspondência com o modelo mental: "configurações" ≠ "catálogo").

### Por que rota própria, e por que não a tab bar mobile

`apps/agendae/src/components/layout/mobile-tab-bar.tsx` tem exatamente 5 posições fixas (Início, Agenda, "Novo" central, Clientes, Financeiro) sem slot livre — confirmado por leitura direta do array `tabs`. Adicionar uma 6ª posição quebraria o layout `justify-content: space-around` calibrado para 5 itens e o próprio precedente do projeto: `/plans` já é uma tela completa (não uma aba) acessível **apenas** pelo menu do perfil em `authenticated-header.tsx`, nunca pela tab bar — exatamente o mesmo caso de "funcionalidade importante, mas sem slot fixo na barra". Serviços segue esse precedente ao pé da letra.

### Onde entra no menu, e por quê

`authenticated-header.tsx` já lista, para `activeRole === "provider"`: Agenda, Clientes, Financeiro, Planos (nessa ordem), seguidos por Configurações e Manual de uso (comuns a todos os perfis). **Decisão: inserir "Serviços" como o item logo após "Início" e antes de "Agenda"** — não ao final da lista, e não entre Financeiro e Planos.

Justificativa: hoje, **100% dos prestadores reais em produção têm o catálogo vazio** (DEC-132). Se "Serviços" entrar no fim da lista (posição menos óbvia, mesma prioridade visual que "Manual de uso"), o prestador provavelmente vai primeiro tentar "Agenda" — bater no mesmo bloqueio relatado no BLG-076 — só descobrir depois, por tentativa e erro, que existe uma tela de Serviços escondida no menu. Colocar "Serviços" **antes** de "Agenda" comunica a ordem lógica de configuração de um provedor novo (cadastro do que ele oferece → depois agenda o que oferece) e maximiza a chance de o prestador resolver o pré-requisito sem nunca bater no erro. Isto é, ao mesmo tempo, aplicação de Nielsen #2 (correspondência com o fluxo real de configuração de um negócio) e uma escolha deliberada de priorização de descoberta para destravar um P0.

Ordem final do menu (perfil prestador): **Início → Serviços → Agenda → Clientes → Financeiro → Planos → Configurações → Manual de uso.**

Ícone: nenhum ícone já catalogado em `AppIconName` (`apps/agendae/src/components/ui/app-icon.tsx`) representa bem "catálogo de serviços" sem colidir semanticamente com um ícone já em uso no mesmo menu (`packages` já é "Planos"; `clients`, `financial`, `schedule`, `settings` já ocupados). **Recomendo a Nero adicionar um novo token `services`** ao Design System de ícones — sugestão de mapeamento: primário `list-check` (FontAwesome6) / fallback `clipboard-list-outline` (MaterialCommunityIcons), transmitindo "lista de itens catalogados" sem reaproveitar a metáfora de caixa/pacote já usada por Planos.

### Mudanças estruturais necessárias (para a ADA, não implementadas aqui)

1. Nova rota `apps/agendae/app/services.tsx`.
2. Novo `<Stack.Screen name="services" />` em `apps/agendae/app/_layout.tsx`, na mesma seção das rotas autenticadas do prestador (ao lado de `clients`, `agenda`, `payments`).
3. Novo item `{ icon: "services", label: "Serviços", route: "/services" }` em `menuItems` de `authenticated-header.tsx`, posicionado antes de `Agenda` (ver acima) — presente nos dois lugares onde `menuItems` é renderizado (dropdown Web largo e `Modal` fullscreen nativo, já que ambos consomem o mesmo array).
4. **Recomendação complementar de descoberta (não obrigatória, mas fortemente recomendada dado o caráter P0):** adicionar uma 4ª ação em `UniversalCreateMenu` (`src/components/layout/universal-create-menu.tsx`), `{ icon: 'services', title: 'Novo serviço', description: 'Cadastre um serviço do seu catálogo.', route: '/services' }`, dando a Serviços a mesma paridade de acesso rápido que Cliente/Financeiro/Agendamento já têm no FAB "Novo" (visível em toda tela autenticada no mobile). Isso aumenta significativamente a chance de descoberta por um prestador novo sem depender de abrir o menu de perfil.

Nenhuma dessas mudanças estruturais é implementada por este documento — são especificações para ADA/Nero.

## 2. Sitemap afetado

```
Menu do perfil (provider)
 Início
 └─ Serviços (/services)                         [NOVA ROTA]
      ├─ [Novo serviço] → modal de criação (mesma tela)
      ├─ [tocar em um serviço / Editar] → modal de edição (mesma tela)
      ├─ [Ativar] (serviço inativo) → ação inline, sem modal de confirmação
      └─ [Desativar] (serviço ativo) → modal de confirmação → ação inline
 Agenda (/agenda)                                  [consumidor existente, sem tela nova]
 Clientes (/clients)                                [consumidor existente, sem tela nova]
 Financeiro (/payments)
 Planos (/plans)
 Configurações (/settings)
 Manual de uso (/manual)

FAB "Novo" (mobile, todas as telas autenticadas)
 └─ Novo serviço → /services                      [RECOMENDADO, seção 1]
```

## 3. Fluxo completo

### 3.1 Lista (`listServices`)

- **Sem paginação** — decisão herdada do próprio contrato de backend (`ServiceListQuery`, comentário em `types.ts`: catálogo é dado curado, poucas dezenas de itens no máximo, não um histórico transacional). A tela carrega a lista inteira de uma vez; não há parâmetros de página nem "carregar mais".
- **Filtro por status**: chips "Todos" / "Ativos" / "Inativos" (mesmo padrão visual de `filter`/`Filter` em `clients.tsx`), aplicados client-side sobre a lista já carregada (ou via `listServices({ status })`, à escolha de implementação da ADA — resultado visível para o usuário é idêntico).
- **Busca por nome** (campo de texto, opcional dado o tamanho pequeno esperado do catálogo, mas recomendado para consistência com `clients.tsx` e por já existirem prestadores com dezenas de serviços): filtra client-side por nome, sem chamada de rede adicional.
- **Layout wide (tabela) vs. mobile (cards)**: mesmo padrão de `clients.tsx` — colunas em telas largas (`Nome`, `Duração`, `Valor de referência`, `Status`, ação de editar), cards empilhados em mobile com os mesmos dados, sem paginação numérica (já que não pagina).
- **Colunas/campos exibidos por item**: nome, duração (`"45 min"`), valor de referência formatado em `BRL` (mesma função `formatCurrency` já usada em `clients.tsx`/`payments.tsx`), badge de status (`Ativo`/`Inativo`, reaproveitando o componente `Status` já existente em `clients.tsx` se for exportável, ou o mesmo padrão visual).
- Cada item tem: botão editar (abre modal preenchido) e ação de ativar/desativar (ver seção 3.4).

### 3.2 Caminho feliz

| Passo | Ator | Ação |
|---|---|---|
| 1 | Prestador | Abre "Serviços" pelo menu do perfil (ou pelo FAB "Novo → Novo serviço"). |
| 2 | Sistema | Chama `listServices()` (sem filtro) e renderiza a lista (ou o estado vazio, seção 3.3, se não houver nenhum serviço). |
| 3 | Prestador | Toca em "Novo serviço". |
| 4 | Sistema | Abre modal de criação com campos vazios (nome, duração, valor) — ver seção 4. |
| 5 | Prestador | Preenche nome, duração em minutos e valor de referência; toca em "Salvar". |
| 6 | Sistema | Valida client-side (nome não vazio, duração inteira > 0, valor inteiro ≥ 0 em centavos); chama `createService(input)`. |
| 7 | Sistema | Sucesso → fecha modal, recarrega lista, mostra feedback de sucesso ("Serviço cadastrado com sucesso."), novo serviço nasce com `status: "active"`. |
| 8 | Prestador | Em outro momento, toca em um serviço existente para editar. |
| 9 | Sistema | Abre modal de edição preenchido com nome/duração/valor atuais; exibe o status atual como informação (badge), não como campo editável junto do restante do formulário (ver seção 3.4 sobre por que ativar/desativar é uma ação separada). |
| 10 | Prestador | Altera nome e/ou duração e/ou valor; toca em "Salvar alterações". |
| 11 | Sistema | Valida client-side; chama `updateService({ id, ...camposAlterados })`; sucesso → fecha modal, recarrega lista, feedback de sucesso ("Serviço atualizado com sucesso."). Nenhum agendamento nem política de cliente já persistidos é reescrito (RN-SRV-007). |
| 12 | Prestador | Decide que não oferece mais um serviço; toca em "Desativar" no serviço ativo. |
| 13 | Sistema | Exibe modal de confirmação explicando a consequência (ver seção 3.4); ao confirmar, chama `deactivateService(id)`; sucesso → recarrega lista, serviço passa a aparecer com badge "Inativo", some das opções de novo agendamento (ver seção 5). |
| 14 | Prestador | Decide voltar a oferecer um serviço inativo; toca em "Ativar". |
| 15 | Sistema | Chama `activateService(id)` diretamente, sem confirmação (ação não destrutiva); sucesso → badge volta a "Ativo", feedback de sucesso. |

### 3.3 Estados vazios

**3.3.1 Catálogo totalmente vazio (o estado de 100% dos prestadores reais hoje, per BLG-076/DEC-132) — o mais crítico:**

- Card central com ícone, título "Nenhum serviço cadastrado ainda", texto explicativo direto sobre a consequência prática: "Cadastre pelo menos um serviço para poder criar agendamentos — sem um serviço ativo, você e seus clientes não conseguem agendar." e botão primário "Cadastrar primeiro serviço" abrindo o modal de criação diretamente (mesmo padrão de `clients.tsx`, mas com o texto do estado vazio explicitamente causal — não um texto genérico de "nenhum item encontrado" — porque aqui o estado vazio bloqueia uma função central do produto, não é apenas "ainda sem dados").
- Nunca mostrar essa tela sem uma ação primária visível — é o único estado vazio do produto onde a ausência de dado impede diretamente outra funcionalidade essencial (agenda), então o CTA precisa estar impossível de ignorar (Nielsen #5, prevenção de erro: o próprio estado vazio já orienta a única ação que resolve o bloqueio, em vez de deixar o prestador descobrir sozinho, dias depois, ao tentar agendar).

**3.3.2 Filtro/busca sem resultado** (catálogo não vazio, mas filtro atual não bate com nada): "Nenhum serviço encontrado" + "Tente alterar a busca ou o filtro selecionado." — mesmo texto/padrão já usado em `clients.tsx` para o caso equivalente.

### 3.4 Ativar/desativar como ação separada de "Salvar"

**Decisão de fluxo importante:** diferente do formulário de cliente (`clients.tsx`), onde `status` é só mais um campo do mesmo payload de `updateClient`, o contrato de serviço **não permite** isso — `UpdateServiceInput` (`types.ts`) não tem campo `status`; ativar/desativar são operações próprias e idempotentes (`activateService`/`deactivateService`), estruturalmente separadas de `updateService` no próprio `ServiceCatalogPort`. A UI deve espelhar essa separação, não escondê-la atrás de um único botão "Salvar":

- No modal de edição, o status atual aparece como informação (badge "Ativo"/"Inativo"), e a ação de mudar o status é um botão dedicado ("Desativar serviço" / "Reativar serviço"), separado do botão "Salvar alterações" (que só cobre nome/duração/valor).
- Na lista, cada linha/card também tem a ação de ativar/desativar diretamente, sem precisar abrir o modal de edição — mesmo padrão de "ação rápida na linha" já usado por `editClient` em `clients.tsx`.
- **Desativar exige confirmação** (modal, mesmo padrão do `confirmDeleteVisible` de `clients.tsx`), porque remove o serviço das opções de novo agendamento (impacto real, ainda que reversível): "Desativar [nome do serviço]? Ele deixará de aparecer para novos agendamentos — seus e de clientes. Agendamentos já criados com este serviço não são afetados." Botões: "Cancelar" / "Desativar" (`danger`/destructivo visualmente, mas nunca com o vocabulário de "excluir" — nunca há exclusão física, RN-SRV-005).
- **Ativar não exige confirmação** — ação não destrutiva, idempotente, seguro reverter imediatamente (Nielsen #3, controle e liberdade do usuário: reverter uma desativação deve ser tão fácil quanto foi desativar).

### 3.5 Edge case: reativar serviço com nome em conflito

O índice único do banco só cobre serviços **ativos** (`services_tenant_active_name_uk`, `20260806101700_services_catalog.sql`) — então é possível ter um serviço inativo "Corte simples" e, depois, um serviço ativo diferente também chamado "Corte simples" (nome reaproveitado, permitido pela regra). Se o prestador tentar **reativar** o primeiro nessas condições, `activateService` retorna `SERVICE_NAME_CONFLICT` (mesma checagem de unicidade se aplica a qualquer `UPDATE` de `status` para `active`).

**Tratamento de UX exigido:** ao tentar ativar e receber `SERVICE_NAME_CONFLICT`, exibir mensagem específica (não a genérica de erro) orientando a única saída possível: "Já existe um serviço ativo chamado '[nome]'. Renomeie este serviço antes de reativá-lo." com um atalho direto para abrir o modal de edição do serviço que está sendo reativado (permitindo renomear e, na sequência, tentar ativar de novo). Sem esse tratamento específico, o prestador ficaria preso num erro sem caminho claro de recuperação (Nielsen #9).

## 4. Campos do formulário (criar/editar)

| Campo | Tipo de UI | Obrigatório | Validação client-side (espelha o backend) | Observações |
|---|---|---|---|---|
| Nome | Texto livre | Sim | Não vazio após `trim()` (`SERVICE_NAME_INVALID`); recomendo limite de exibição de 60 caracteres (guarda de UX, não imposta pelo backend, para caber com folga em cards/seletores de agenda) | Verificação adicional client-side recomendada (mesmo padrão do e-mail duplicado em `clients.tsx`): comparar, antes de chamar `createService`/`updateService`/`activateService`, contra os nomes de serviços **ativos** já carregados (case-insensitive, ignorando o próprio registro em edição) para dar feedback imediato de `SERVICE_NAME_CONFLICT` sem esperar o round-trip — o backend continua sendo a autoridade final. |
| Duração (minutos) | Numérico (`keyboardType="number-pad"`) | Sim | Inteiro, `> 0` (`DURATION_INVALID`) — não aceitar vírgula/ponto decimal nem negativo | Rótulo com sufixo "min". Opcional (recomendado, não obrigatório): chips de atalho para durações comuns (15/30/45/60/90/120 min) que preenchem o campo, sem impedir digitação livre — mesma lógica de conveniência já usada pelos chips de serviço em `agenda.tsx`. |
| Valor de referência | Numérico com máscara de moeda (`R$ 0,00`, mesmo padrão de `serviceValue` em `clients.tsx`) | Sim | Inteiro em centavos, `≥ 0` (`VALUE_INVALID`) — **zero é um valor válido** (ex.: serviço cortesia/avaliação gratuita), não confundir com "obrigatório preencher um valor positivo" | Convertido para centavos exatamente como já feito em `clients.tsx` (`Math.round(parsedValue * 100)`); exibido/editado sempre em reais na UI, nunca em centavos. |
| Status | Não é um campo do formulário de criar/editar | — | — | Nasce sempre `active` na criação (o próprio `CreateServiceInput` não tem campo `status`); mudança de status é ação separada (seção 3.4). No modal de edição, aparece como badge informativo, não como campo do formulário. |

### Regras de validação, na ordem em que devem ser checadas (evita chamadas de rede desnecessárias)

1. Nome vazio/só espaços → erro inline no campo, sem chamar o serviço.
2. Duração vazia, não inteira, zero ou negativa → erro inline no campo, sem chamar o serviço.
3. Valor vazio, não numérico ou negativo → erro inline no campo, sem chamar o serviço.
4. Nome duplicado entre serviços ativos (checagem client-side contra a lista já carregada) → erro inline no campo, sem chamar o serviço.
5. Só então chamar `createService`/`updateService`; qualquer erro devolvido pelo backend (`ServiceError.message`, já em português e humanizado pelo adapter) deve ser exibido tal como vem — os `HUMAN_MESSAGES` já cobertos por `mapServiceError` cobrem exatamente os mesmos casos das validações 1–4, então o erro de servidor nunca deveria aparecer para um usuário que passou pelas validações client-side, exceto em corrida (ex.: outro dispositivo cadastrou o mesmo nome entre o carregamento da lista e o salvamento) — nesse caso, o erro do servidor É a fonte da verdade e deve prevalecer.

## 5. Estados de erro (mapeamento de `ServiceErrorCode`)

| Código | Quando ocorre nesta tela | Tratamento de UX |
|---|---|---|
| `SERVICE_NOT_FOUND` | Editar/ativar/desativar um serviço que foi removido/alterado por outra sessão entre o carregamento da lista e a ação (nunca por exclusão física — só se outra sessão fez algo entre o load e a ação) | Fechar o modal se aberto; mostrar feedback ("Este serviço não foi encontrado. A lista foi atualizada."); recarregar `listServices()` automaticamente. |
| `SERVICE_NAME_INVALID` | Só deveria ocorrer em corrida, já que é barrado client-side | Erro inline no campo Nome, formulário preservado. |
| `SERVICE_NAME_CONFLICT` | Nome duplicado com serviço ativo — na criação/edição, ou ao reativar (ver seção 3.5) | Erro inline no campo Nome (criar/editar) ou mensagem dedicada com atalho para editar (reativar, seção 3.5); nunca fecha o formulário/modal automaticamente. |
| `DURATION_INVALID` / `VALUE_INVALID` | Só deveria ocorrer em corrida, já que é barrado client-side | Erro inline no campo correspondente, formulário preservado. |
| `FORBIDDEN` | Tentativa de agir sobre serviço de outro tenant (não deveria ser alcançável pela UI normal) | Banner genérico "Você não tem permissão para esta ação.", sem detalhes adicionais. |
| `SESSION_EXPIRED` | Sessão expirou durante a operação | Banner "Sua sessão expirou. Entre novamente."; mesmo padrão já usado em outras telas do app para esse código. |
| `NETWORK_ERROR` | Falha de rede | Banner "Falha de conexão. Verifique sua internet e tente novamente."; **formulário nunca é limpo** — usuário deve poder tocar "Salvar" de novo sem redigitar nada (handoff de backend, seção 4, já exige isso explicitamente). |
| `UNKNOWN` | Erro não mapeado | Banner genérico ("Não foi possível concluir agora. Tente novamente."); `console.error` do erro real antes de exibir a mensagem amigável (mesmo padrão de instrumentação de DEC-128/129, para não perder a causa real em produção). |

## 6. Decisão sobre limite de plano Free

**Decisão: não aplicar nenhum limite de quantidade de serviços (ativos ou totais) por plano — nem Free, nem Premium.**

Justificativa:

1. **Risco direto de recriar o próprio incidente que este trabalho existe para fechar.** O produto inteiro está bloqueado hoje porque nenhum prestador consegue ter sequer *um* serviço ativo. Introduzir qualquer limite no plano Free (mesmo generoso, ex. "até 3 serviços") adiciona uma nova classe de bloqueio em cima de uma funcionalidade que acabou de sair de "impossível" para "possível" — o custo de errar essa calibragem (limite baixo demais, ou lógica de contagem com bug) é reproduzir o mesmo sintoma do BLG-076 para uma fatia de usuários, com uma causa nova e mais difícil de diagnosticar.
2. **Não há sinal de que catálogo de serviços seja um eixo de monetização no produto.** Os limites de plano já existentes (`ProviderEntitlement.clientLimit = 5` para Free, `dailyAppointmentLimit`) miram recursos que escalam com **uso/receita** (mais clientes = mais receita potencial; mais agendamentos/dia = mais uso da plataforma). Catálogo de serviços é dado de configuração/cadastro **fixo**, análogo a `workdayStart`/`workdayEnd`/`timezone` (`ProviderSettings`, DEC-072) — nenhum desses tem limite de plano hoje, porque não é o tipo de recurso que se presta a gating por volume.
3. **O próprio backend já justificou a ausência de paginação com a mesma premissa** ("dezenas de itens no máximo, tipicamente muito menos", `types.ts`/`HANDOFF_SERVICOS_CRIS.md`) — um prestador típico (personal trainer, esteticista, barbeiro) tem de 1 a ~15 serviços distintos. Um limite de plano só faria diferença prática para o extremo superior dessa distribuição, que não é o perfil de usuário que o Free tende a reter de qualquer forma (YAGNI: não há evidência de demanda ou de uso desse eixo para monetização).
4. **Não existe campo no backend para isso hoje.** `ProviderEntitlement` (`src/domain/subscriptions/types.ts`) já tem `clientLimit: number | null`, mas não tem nada equivalente para serviços. Adicionar um `serviceLimit` exigiria: novo campo aditivo em `ProviderEntitlement`, mudança na função que resolve o entitlement (`local-subscription-adapter.ts`/Edge Function `mercado-pago-subscriptions`), e uma nova checagem client-side em `services.tsx` no mesmo padrão de `clients.tsx` (`providerPlan === "free" && clients.length >= 5`). Isso é escopo de Chris (backend) e está fora do que decidi implementar aqui.

**Se o produto decidir, no futuro, introduzir esse limite:** não é uma decisão que me cabe tomar sozinho nesta sessão — deve ser tratada como uma frente própria (Virgil para requisito de negócio + Chris para `serviceLimit` no backend + Dante para o fluxo de bloqueio/upsell), e nunca antes de o catálogo estar validado em produção com prestadores reais usando o fluxo básico sem fricção adicional.

## 7. Regras de negócio (RN) e requisitos funcionais (RF)

Novos, específicos desta entrega (categoria `RN-SRV`, nova — não havia nenhuma até esta decisão; `RF-CAD` estendido a partir do último item existente, `RF-CAD-007`, em `docs/REQUISITOS_FUNCIONAIS_MVP.md`):

### Regras de negócio

| ID | Regra |
|---|---|
| RN-SRV-001 | Duração deve ser um número inteiro de minutos maior que zero. |
| RN-SRV-002 | Valor de referência deve ser um número inteiro de centavos maior ou igual a zero (zero é um valor válido); exibido e editado sempre em reais na interface. |
| RN-SRV-003 | Nome do serviço não pode ser vazio nem conter apenas espaços. |
| RN-SRV-004 | Nome deve ser único (case-insensitive) entre serviços com status ativo do mesmo prestador; nome repetido entre um serviço ativo e um inativo é permitido. |
| RN-SRV-005 | Um serviço nunca é excluído fisicamente; toda ação de "remover" da interface significa inativar, nunca apagar o registro. |
| RN-SRV-006 | Ativar e desativar são operações idempotentes: repetir a ação sobre um serviço já no status alvo deve devolver sucesso, nunca erro. |
| RN-SRV-007 | Editar nome, duração ou valor de referência de um serviço nunca reescreve agendamentos já confirmados (`valueCentsSnapshot`/`serviceNameSnapshot`) nem o valor configurado por política de cliente já persistido (RN-AGD-023). |
| RN-SRV-008 | Desativar um serviço não cancela nem invalida agendamentos existentes que o referenciem; apenas remove o serviço das opções disponíveis para novos agendamentos. |
| RN-SRV-009 | Reativar um serviço cujo nome colide (case-insensitive) com outro serviço já ativo do mesmo prestador deve ser rejeitado, orientando explicitamente o prestador a renomear antes de tentar reativar novamente. |
| RN-SRV-010 | O catálogo de serviços não é paginado na interface — toda a lista do prestador é carregada de uma vez, filtrável por status e por busca textual client-side. |
| RN-SRV-011 | Não há limite de quantidade de serviços (ativos ou totais) por plano de assinatura, Free ou Premium (ver seção 6 para justificativa completa). |

### Requisitos funcionais

| ID | Requisito | Rastreabilidade |
|---|---|---|
| RF-CAD-008 | O sistema deve permitir ao prestador listar todos os serviços do próprio catálogo (ativos e inativos), sem paginação, com filtro por status e busca por nome. | RN-SRV-010 |
| RF-CAD-009 | O sistema deve permitir ao prestador cadastrar um novo serviço informando nome, duração em minutos e valor de referência; o serviço deve nascer sempre com status ativo. | RN-SRV-001–003 |
| RF-CAD-010 | O sistema deve permitir ao prestador editar nome, duração e valor de referência de um serviço existente, sem alterar snapshots de agendamentos ou de políticas de cliente já persistidos. | RN-SRV-007 |
| RF-CAD-011 | O sistema deve permitir ao prestador ativar ou desativar um serviço de forma idempotente e reversível, sem excluir fisicamente o registro em nenhum momento. | RN-SRV-005, RN-SRV-006, RN-SRV-008 |
| RF-CAD-012 | O sistema deve impedir a criação, edição ou reativação de um serviço com nome duplicado (case-insensitive) entre serviços ativos do mesmo prestador, permitindo reaproveitar o nome de um serviço inativo. | RN-SRV-004, RN-SRV-009 |
| RF-CAD-013 | O sistema deve exibir um estado vazio acionável, com atalho direto para cadastro, quando o catálogo do prestador não tiver nenhum serviço — reconhecendo que este é hoje o estado padrão de todo prestador em produção. | RF-CAD-004 |
| RF-CAD-014 | O sistema deve impedir a criação de qualquer agendamento (pelo prestador em `app/agenda.tsx` ou pelo cliente em `app/client-booking.tsx`) sem um serviço ativo selecionado, orientando explicitamente o prestador a cadastrar um serviço quando o catálogo estiver vazio, em vez de apresentar apenas uma mensagem de validação genérica sem caminho de ação. | RN-AGD-002, RN-AGD-003, BLG-076 |

RF-CAD-014 é uma **dependência complementar cruzada**, detalhada na seção 8 — não é resolvida só pela existência da tela `/services`.

## 8. Heurísticas aplicadas (somente onde fazem diferença real nesta entrega)

- **Nielsen #1 — Visibilidade do status:** badge de status sempre visível na lista e no modal de edição; feedback explícito de sucesso/erro em toda mutação (criar, editar, ativar, desativar).
- **Nielsen #2 — Correspondência com o mundo real:** posição de "Serviços" no menu (antes de "Agenda") espelha a ordem real de configuração de um negócio — primeiro o que se oferece, depois a agenda do que se oferece.
- **Nielsen #3 — Controle e liberdade do usuário:** reativar um serviço é uma ação de um toque, sem confirmação, para que desfazer uma desativação seja tão fácil quanto fazê-la.
- **Nielsen #4 — Consistência:** mesmos padrões visuais de `clients.tsx` (busca, filtro por chips, cards mobile/tabela wide, modal de confirmação destrutiva) reaproveitados integralmente — nenhuma linguagem de interação nova é introduzida.
- **Nielsen #5 — Prevenção de erros:** validação client-side espelhando exatamente as constraints do backend, checadas antes de qualquer chamada de rede; estado vazio do catálogo já contém a única ação que resolve o bloqueio.
- **Nielsen #9 — Ajuda a reconhecer, diagnosticar e recuperar-se de erros:** tratamento dedicado do conflito de nome ao reativar (seção 3.5), com atalho direto para a correção, em vez de um erro sem saída.
- **Don Norman — Affordance/mapeamento:** ativar/desativar como botões próprios (não escondidos num campo de formulário) comunica corretamente que são operações distintas de "salvar alterações", espelhando a própria separação do contrato (`activateService`/`deactivateService` vs. `updateService`).
- **Gestalt — Proximidade/hierarquia:** nome, duração e valor agrupados como um bloco (dados do serviço); status e a ação de ativar/desativar tratados como um bloco visualmente separado, reforçando que pertencem a operações diferentes.

## 9. Dependências e pendências para outros agentes

### Para Nero (Design System / UI)

- Novo token de ícone `services` em `AppIconName` (`app-icon.tsx`) — sugestão de mapeamento na seção 1.
- Componentes de lista/formulário/modal de confirmação: reaproveitar os átomos/moléculas/organismos já usados em `clients.tsx` (não inventar um novo padrão visual de card, tabela, modal ou botão).

### Para ADA (wiring)

1. Implementar `apps/agendae/app/services.tsx` consumindo `serviceCatalogService` (`ServiceCatalogPort`) conforme fluxo, campos e estados desta especificação.
2. Adicionar `<Stack.Screen name="services" />` em `app/_layout.tsx`.
3. Adicionar o item "Serviços" em `menuItems` de `authenticated-header.tsx` (seção 1), na posição especificada, nos dois lugares onde `menuItems` é renderizado (dropdown Web e `Modal` nativo).
4. **Obrigatório para fechar o ciclo do BLG-076 de fato — não apenas criar a tela isolada:** hoje, `app/agenda.tsx` usa um campo de **texto livre** para "Serviço" com chips de sugestão (`serviceOptions`), validado por comparação de string normalizada (`normalize(item.name) === normalize(service)`, linha ~686) — se o catálogo estiver vazio, o usuário só recebe a mensagem genérica "Selecione um serviço ativo do catálogo." sem nenhum caminho de ação, e mesmo com catálogo populado, um erro de digitação nunca vai casar com nenhuma opção. Recomendo fortemente que `app/agenda.tsx` (e, no mesmo espírito, o texto informativo já existente em `app/client-booking.tsx`) substitua esse campo de texto livre por um seletor restrito ao catálogo (mesmo padrão do seletor de cliente já implementado nessa mesma tela, `clientPickerVisible`/`clientOptions`), e que, especificamente quando `serviceOptions.length === 0`, a tela exiba uma mensagem acionável ("Você ainda não tem serviços cadastrados. Cadastre um serviço para continuar.") com um botão/link direto para `/services`, em vez de deixar o campo de texto disponível para uma validação que nunca vai passar. Isto implementa RF-CAD-014. Este item é **complementar** ao escopo desta entrega (a tela `/services` em si), mas sem ele o usuário ainda vai bater num beco sem saída ao tentar agendar com o catálogo vazio — a existência da tela sozinha não fecha o ciclo percebido pelo usuário.
5. `apps/agendae/FRONTEND_CONTRACTS.md`, seção "Catálogo de serviços — contrato preparado, sem tela ainda" (linha ~219), deve ser atualizada para refletir a existência da tela assim que implementada — manutenção de documentação, não decisão de UX.

### Para Chris (backend)

Nenhuma pendência. Confirmado nesta sessão que `ServiceCatalogPort`/`SupabaseServiceCatalogAdapter` cobrem os 6 métodos necessários sem lacuna.

### Não implementado nesta decisão, registrado para o futuro

- Limite de quantidade de serviços por plano — decisão explícita de **não** implementar agora (seção 6); se revisitado, é nova frente própria (Virgil + Chris + Dante).

## 10. Critérios de aceite

- `/services` carrega a lista completa do catálogo do prestador autenticado, sem paginação, filtrável por status e busca.
- Catálogo vazio exibe estado acionável com CTA direto para cadastro, não um texto genérico de "nenhum item".
- Criar serviço: nome, duração (inteiro > 0) e valor (inteiro ≥ 0 em centavos, exibido em reais) são obrigatórios e validados client-side antes de qualquer chamada de rede; serviço nasce sempre ativo.
- Editar serviço: altera nome/duração/valor sem afetar nenhum agendamento ou política de cliente já persistidos; nunca inclui `status` no mesmo payload de salvar.
- Ativar é uma ação de um toque, sem confirmação; desativar exige confirmação explicando a consequência (some das opções de novo agendamento, sem cancelar agendamentos existentes).
- Nome duplicado entre serviços ativos é bloqueado tanto na criação/edição quanto na reativação, com mensagem que orienta a correção (nunca um beco sem saída).
- Todos os 9 `ServiceErrorCode` têm tratamento de UX definido nesta especificação (seção 5), nenhum cai em um erro genérico sem contexto.
- Formulário nunca é limpo em caso de `NETWORK_ERROR`/`UNKNOWN` — usuário pode tentar salvar de novo sem redigitar.
- Item "Serviços" aparece no menu do prestador na posição especificada (antes de "Agenda"), com rota própria e `Stack.Screen` dedicado.
- Nenhum limite de plano é aplicado à quantidade de serviços.

## 11. Registro em BACKLOG.md

Este handoff gera a entrada `DEC-133` (decisão de navegação + decisão de não aplicar limite de plano Free), registrada com status `Aprovada` (autorização explícita do usuário para início imediato de Nero/ADA nesta sessão) — ver `BACKLOG.md`, seção 4. O item `BLG-076` foi atualizado para refletir que o fluxo/UX está definido, pendente de UI (Nero) e wiring (ADA).

## 12. Campo de profissão/especialidade do prestador (conceito distinto do catálogo)

> **Pedido novo, sessão distinta do restante deste documento.** As seções 1–11 tratam do catálogo de serviços (`services`, `BLG-076`, `DEC-133`). Esta seção 12 trata de um conceito **diferente** — a identidade profissional do prestador — e não deve ser confundida com o catálogo pelos próximos agentes.

### 12.1 Distinção conceitual (leitura obrigatória antes de implementar)

| | **Serviço do catálogo** (seções 1–11 deste documento) | **Profissão/especialidade do prestador** (esta seção) |
|---|---|---|
| O que é | Um item específico que o prestador oferece, com ciclo de vida próprio | Um atributo descritivo da identidade profissional do prestador (pessoa/negócio) |
| Exemplos | "Sessão avulsa 50min" (R$150), "Pacote mensal 8 sessões" (R$980), "Avaliação gratuita" (R$0) | "Personal Trainer", "Adestrador(a)", "Professor(a) particular", "Técnico(a) em informática" |
| Cardinalidade | Um prestador tem **N serviços** (lista, `services`, `ServiceCatalogPort`) | Um prestador tem **1 profissão** (campo único de perfil, como `displayName`/`phone`) |
| Onde mora hoje | Tabela `services`, backend completo (DEC-070/071) | **Não existe hoje** — campo novo, sem coluna, sem contrato |
| Tem duração/valor? | Sim, sempre (`durationMinutes`, `referenceValueCents`) | Não — é só texto descritivo, sem duração nem valor |
| Tem estado ativo/inativo? | Sim (`status`, ações `activateService`/`deactivateService`) | Não — não tem ciclo de vida, é só editável como qualquer campo de identidade |
| Onde se edita | Tela própria `/services` (CRUD completo, seção 1–5) | Dentro de `app/settings.tsx`, junto dos demais dados de identidade (seção 12.3) |
| Relação entre os dois | **Nenhuma obrigatória.** Um prestador "Personal Trainer" pode ter serviços chamados "Sessão avulsa", "Pacote mensal" etc. — a profissão não determina, não restringe e não valida os nomes dos serviços do catálogo. Os dois campos são preenchidos de forma totalmente independente. |

**Consequência prática para Nero/ADA:** nunca implementar a profissão como uma linha do catálogo de serviços, nunca reaproveitar `ServiceCatalogPort`/`services` para isto, e nunca inferir a profissão a partir dos nomes de serviços cadastrados (ex.: não tentar "adivinhar" que um prestador é personal trainer porque cadastrou um serviço chamado "Treino"). São dois campos de formulário completamente desacoplados, em duas telas diferentes, com dois backends diferentes (um pronto, um pendente).

### 12.2 Decisão: texto livre (com chips de sugestão), não lista fechada

**Decisão: campo de texto livre opcional, com chips de sugestão para acelerar o preenchimento dos casos mais comuns — não um enum/lista fechada de valores.**

Avaliação das duas opções:

1. **Lista fechada (enum):** facilitaria, no futuro, um filtro/busca do cliente por especialidade — mas essa funcionalidade **não existe hoje em nenhuma tela** (nem em `client-providers.tsx`, nem em `client-home.tsx`, nem em `client-booking.tsx` há filtro ou busca por especialidade de prestador) e não foi pedida nesta sessão. Implementar um enum fechado agora, para um filtro que talvez nunca seja construído, é otimização prematura (YAGNI — mesmo racional já aplicado nesta sessão para descartar limite de plano no catálogo, seção 6). Além disso, o domínio de prestadores do Rotinaê é heterogêneo por natureza — os próprios exemplos do pedido (Adestrador, Personal Trainer, Professor, Técnico) cobrem verticais completamente diferentes (bem-estar animal, saúde/fitness, educação, serviços técnicos) sem nenhum eixo comum óbvio. Uma lista fechada exigiria: (a) alguém arbitrar hoje uma lista supostamente exaustiva de profissões atendidas pelo produto, (b) todo prestador cuja profissão real não estiver na lista cair num "Outro" genérico ou ficar sem opção adequada, e (c) qualquer profissão nova exigir uma migration/deploy de código para ser adicionada — atrito desproporcional ao problema real que este campo resolve (hoje: nenhum prestador consegue dizer o que faz).
2. **Texto livre puro (sem nenhuma ajuda de preenchimento):** resolve a flexibilidade, mas sozinho reproduz o problema de dado sujo citado no pedido ("personal trainer" vs "Personal Trainer" vs "Personal").
3. **Texto livre + chips de sugestão + normalização client-side no salvamento (decisão final):** mantém a flexibilidade total (qualquer prestador pode digitar sua profissão, por mais nichada que seja) e reduz a variação de capitalização sem impor um vocabulário fechado. Os chips são apenas atalhos de preenchimento (mesmo padrão de conveniência já usado pelos chips de duração do serviço, seção 4, e pelos chips de serviço em `agenda.tsx`) — tocar um chip preenche o campo de texto, mas o prestador pode digitar livremente por cima, inclusive algo fora da lista de sugestões.

Chips de sugestão recomendados (não exaustivo, não é validação — apenas atalho): "Personal Trainer", "Esteticista", "Barbeiro(a)", "Adestrador(a)", "Professor(a) particular", "Nutricionista", "Fisioterapeuta", "Técnico(a)". Lista de exemplo para Nero calibrar visualmente; não é a lista de valores permitidos (não existe lista de valores permitidos).

**Normalização client-side no salvamento (mitiga o dado sujo sem enum):** ao salvar, aplicar `trim()` e capitalização de cada palavra (Title Case) antes de persistir — ex.: "personal trainer" e "PERSONAL TRAINER" são ambos normalizados para "Personal Trainer" no momento do salvamento, reduzindo (não eliminando) a variação de capitalização entre prestadores, sem impedir nenhum texto de ser salvo. Isto é uma normalização de exibição, não uma validação — nunca rejeita o texto digitado, apenas o reformata.

### 12.3 Onde o campo vive no formulário (`app/settings.tsx`)

**Decisão: dentro do card já existente "Dados profissionais" (visível apenas para `activeRole === "provider"`, `app/settings.tsx` linha ~227), logo após o campo "Nome de exibição" e antes de "E-mail".**

Justificativa:

- O card já se chama **"Dados profissionais"** (linha 228) — hoje esse título é levemente impreciso, porque o card só contém nome, e-mail, telefone e fuso horário (nenhum dado de fato "profissional"/de negócio). O campo de profissão passa a dar ao título do card um sentido literal que hoje ele só tem parcialmente.
- Posição logo após "Nome de exibição": nome e profissão são as duas informações que compõem a "identidade pública" do prestador perante o cliente (seções 12.4–12.5) — agrupá-las adjacentes segue Gestalt (proximidade: dados que serão exibidos juntos ao cliente ficam agrupados juntos no formulário também).
- Campo **opcional** (não obrigatório, sem `*` vermelho como "Nome de exibição"/"Telefone" já têm hoje) — contas de prestadores já existentes na produção não têm esse dado hoje (coluna nova, nula por padrão); não é retroativamente exigido, e nenhuma tela do sistema é bloqueada pela ausência dele (diferente do catálogo de serviços vazio, que bloqueia agendamento — RN-PRF-004 abaixo). Rótulo sugerido: "Profissão/especialidade" com `hint` abaixo: "Aparece para seus clientes ao lado do seu nome. Opcional."
- Campo é `TextInput` simples (mesmo componente de "Nome de exibição"), com `maxLength` de 60 caracteres (mesmo guarda de UX do nome de serviço, seção 4) e os chips de sugestão da seção 12.2 logo abaixo do campo (mesmo padrão visual dos chips de duração já recomendado na seção 4).
- **Não** entra no card "Agenda e notificações" (o outro card da tela) — esse card é inteiramente operacional (jornada, antecedência, notificações), sem nenhum dado de identidade; misturar quebraria a mesma separação de propósito já documentada para não colocar o catálogo de serviços dentro de `settings.tsx` (seção 1, "Por que não dentro de `/settings.tsx`" — aqui o racional é o oposto: este campo **é**, de fato, dado de identidade/conta, então **pertence** a `settings.tsx`, diferente do catálogo).

### 12.4 Onde reflete para o CLIENTE (as 3 telas)

**Princípio geral: a profissão é sempre um complemento visual ao nome do prestador — nunca o substitui, nunca aparece sozinha, e nunca é exibida quando ausente (sem placeholder tipo "Profissão não informada" nas telas do cliente — se o prestador não preencheu, a interface do cliente simplesmente não reserva espaço para o dado, mesmo comportamento de campos opcionais ausentes já usado em `phone` de `ClientProviderLink`).**

**`apps/agendae/app/client-providers.tsx` (lista de vínculos do cliente, linha ~70):** hoje cada card mostra `provider.providerName` em negrito e, logo abaixo, usa a classe de estilo `styles.specialty` para exibir o **status do vínculo** ("Vínculo aprovado" / "Aguardando aprovação") — **atenção da ADA: esse nome de estilo já existe e já está ocupado por outra informação; não é a "especialidade" ainda**. Ao introduzir a profissão real, a linha abaixo do nome deve combinar as duas informações separadas por `·`, sem remover o status do vínculo (que é operacionalmente mais importante neste contexto — o cliente precisa saber se pode agendar): `"Personal Trainer · Vínculo aprovado"` quando a profissão estiver preenchida, ou apenas `"Vínculo aprovado"` (comportamento atual, inalterado) quando não estiver. Recomendo renomear a classe de estilo para algo como `subline` no momento da implementação, para não perpetuar a confusão de nome (`specialty` guardando texto de status).

**`apps/agendae/app/client-home.tsx` (carrossel de prestadores ativos, linha ~200):** **atenção da ADA — este bloco já tem um campo `specialty` no tipo local `Provider` (linha 33) e já o renderiza (linha 203), mas é um componente morto hoje**: `initialProviders` é um array vazio hardcoded (linha 39, `const initialProviders: Provider[] = [];`) e `useState(initialProviders)` (linha 48) nunca é alimentado por nenhuma chamada de rede — a tela não busca prestadores reais para este carrossel. Ou seja, o campo que este pedido está formalizando **já foi antecipado conceitualmente** neste stub, mas ele não é hoje um consumidor vivo de dado real. Não é necessário nenhum trabalho aqui para fechar esta seção — fica registrado apenas para quando este carrossel for eventualmente ligado a dados reais (fora de escopo desta decisão): nesse momento, `specialty` já teria destino natural de mapeamento para o novo campo de profissão.

**`apps/agendae/app/client-booking.tsx` (seleção de prestador para agendar, linha ~262–298):** hoje cada card do carrossel mostra avatar/iniciais, `context.providerName` em negrito, e uma linha secundária com informação do **serviço** (`"${contextService.name} · ${contextService.durationMinutes} min"` ou `"Sem serviço ativo"`). **Não** recomendo combinar profissão nessa mesma linha (ela já carrega informação operacional distinta — o serviço primário — e misturar identidade com operação nessa linha específica prejudicaria a leitura rápida durante a escolha do prestador, o momento de maior carga cognitiva do fluxo de agendamento). Recomendo uma **linha própria, entre o nome e a linha de serviço**: nome (negrito) → profissão, se houver (texto pequeno, cor `colors.muted`, mesmo padrão de `providerSpecialty` já estilizado em `client-home.tsx` linha ~683) → linha de serviço (inalterada). Quando a profissão não estiver preenchida, a linha simplesmente não é renderizada (sem alterar o espaçamento vertical do card para os demais prestadores da lista — cada card cresce independentemente).

### 12.5 Onde reflete para o PRÓPRIO prestador (cabeçalho/menu de perfil)

`apps/agendae/src/components/layout/authenticated-header.tsx` exibe, no menu de perfil (linhas ~332–333 e ~430–432), `displayName` seguido do rótulo de papel (`"Prestador"`/`"Cliente"`/`"Administrador"`, derivado de `activeRole`/`isAdmin` — nunca da profissão).

**Decisão: não substituir nem remover o rótulo de papel — ele é dado de autorização/contexto de sessão (`activeRole`), não deve ser confundido com a profissão, que é só metadado descritivo.** Recomendação (nice-to-have, não bloqueante desta entrega): quando a profissão estiver preenchida e `activeRole === "provider"`, compor o rótulo como `"Prestador · Personal Trainer"` em vez de apenas `"Prestador"` — mesmo padrão de composição com `·` já recomendado na seção 12.4 para as telas do cliente, reforçando a própria identidade profissional do prestador ao alternar de perfil (útil sobretudo para quem usa múltiplos perfis/tenants, DEC-110).

**Pendência de implementação a sinalizar para ADA, não decidida como obrigatória aqui:** hoje `authenticated-header.tsx` obtém `displayName` diretamente da sessão (`session.user.displayName`, linha ~150) — a profissão não faz parte desse objeto de sessão hoje e vive em `ProviderSettings` (`providerSettingsService.getSettings()`), que o header **não chama atualmente** (só `settings.tsx` chama). Buscar a profissão só para o cabeçalho exigiria uma chamada de rede adicional a cada carregamento do header (custo real, componente presente em toda tela autenticada) — a alternativa mais barata é incluir `profession` no próprio objeto de sessão resolvido no login/`getSession()`, análogo a como `displayName` já chegou lá. Essa escolha de onde buscar o dado é decisão de arquitetura de dados (Chris/ADA), não de UX — fica registrada aqui como dependência, não resolvida por este documento.

### 12.6 Regras de negócio (RN) e requisitos funcionais (RF)

Nova categoria `RN-PRF` (perfil profissional do prestador) e `RF-PRF`, distintas de `RN-SRV`/`RF-CAD` (catálogo de serviços, seções 1–11) — nomeadas de forma deliberadamente diferente para que a distinção conceitual da seção 12.1 fique também rastreável na numeração dos requisitos.

#### Regras de negócio

| ID | Regra |
|---|---|
| RN-PRF-001 | Profissão/especialidade é um atributo de identidade do prestador (um valor por prestador, dado de perfil), não um item do catálogo de serviços — não referencia, não restringe e não é derivada de nenhum registro de `services`. |
| RN-PRF-002 | O campo é de texto livre, opcional, sem lista fechada (enum) de valores permitidos. |
| RN-PRF-003 | Limite de exibição de 60 caracteres (guarda de UX, mesma medida do nome de serviço, seção 4) e normalização de capitalização (Title Case) aplicada no momento do salvamento, sem rejeitar nenhum texto digitado. |
| RN-PRF-004 | A ausência de profissão informada (`null`/vazio) não bloqueia nenhuma funcionalidade do sistema — diferente do catálogo de serviços vazio (RN-SRV, `BLG-076`), este campo nunca é pré-condição de nenhum fluxo de agendamento ou vínculo. |
| RN-PRF-005 | A exibição da profissão para o cliente é sempre complementar ao nome do prestador (nunca substitui o nome, nunca é exibida isoladamente). |
| RN-PRF-006 | A profissão nunca substitui nem se sobrepõe ao rótulo de papel do usuário (`"Prestador"`/`"Cliente"`/`"Administrador"`) em nenhuma superfície do sistema — são informações independentes (uma de autorização/contexto de sessão, outra descritiva). |

#### Requisitos funcionais

| ID | Requisito | Rastreabilidade |
|---|---|---|
| RF-PRF-001 | O sistema deve permitir ao prestador informar, editar e apagar sua profissão/especialidade como texto livre opcional, em `Configurações` (`app/settings.tsx`), sem validação contra lista fechada de valores. | RN-PRF-001–003 |
| RF-PRF-002 | O sistema deve exibir a profissão do prestador, quando informada, como informação complementar ao nome em toda tela onde o cliente visualiza o prestador (`client-providers.tsx`, `client-booking.tsx` e, quando ligado a dado real, `client-home.tsx`), sem alterar o layout quando o dado estiver ausente. | RN-PRF-004, RN-PRF-005 |

Estende conceitualmente `RF-AUT-005` ("Consultar e editar dados básicos do próprio perfil", `docs/REQUISITOS_FUNCIONAIS_MVP.md`) sem renumerá-lo — a profissão é mais um dado básico de perfil do prestador, mas ganha ID próprio (`RF-PRF`) para não misturar rastreabilidade com o catálogo de serviços (`RF-CAD`).

### 12.7 Pendência explícita de backend (não implementada aqui, não implementável pela ADA sozinha)

**Diferente do catálogo de serviços (seções 1–11), este campo não tem nenhum backend pronto hoje.** Confirmado por leitura direta:

- `apps/agendae/src/domain/provider/types.ts` — `ProviderSettings` não tem nenhum campo equivalente hoje (só `id, displayName, email, phone, timezone, workdayStart, workdayEnd, minimumAdvanceHours, emailNotifications, pushNotifications, updatedAt`).
- `apps/agendae/src/infra/provider/supabase-provider-settings-adapter.ts` monta `ProviderSettings` a partir de `profiles` (identidade) e `tenants` (operação) via `getSettings()`/RPC `update_provider_settings` (linhas ~264–350). Profissão é dado de identidade, então pertenceria a `profiles` (não a `tenants`, que é exclusivamente operacional — mesmo racional já usado para separar `/services` de `/settings.tsx`, seção 1).
- Isso exige, no mínimo: (1) nova coluna nullable em `profiles` (ex. `profession text`), com eventual `check` de tamanho; (2) `update_provider_settings` (RPC) ganhar um novo parâmetro opcional e devolvê-lo na `returns table`; (3) `SupabaseProviderSettingsAdapter` (`toProviderSettings`/`ProfileRow`/`UpdateProviderSettingsRow`) mapear o novo campo; (4) `get_client_booking_context` (RPC consumida por `client-booking.tsx`) e a consulta por trás de `listClientProviderLinks()` (`ClientProviderLink`, consumida por `client-providers.tsx`) precisarem devolver esse mesmo dado ao cliente, o que implica alterar duas RPCs/consultas adicionais, não só uma.

**Isto não é uma migration trivial de uma coluna isolada — toca 2–3 RPCs e pelo menos 2 adapters/telas do lado do cliente.** Por isso, registro esta pendência explicitamente como decisão de escopo maior a ser confirmada por Marcus com o usuário antes de qualquer implementação de persistência real — minha parte aqui é exclusivamente o desenho de UX/regra de negócio (seções 12.1–12.6), não a implementação. **A ADA não deve implementar persistência real deste campo sem essa confirmação prévia.** Se autorizado, a ordem de dependência é: Chris (migration + RPCs) → ADA (adapter + telas dos 12.3–12.5).

### 12.8 Registro em BACKLOG.md

Esta seção gera a entrada `DEC-134` (decisão de UX: texto livre com chips de sugestão, não lista fechada; posição do campo em `settings.tsx`; pontos de reflexo para o cliente e para o próprio prestador; pendência de backend sinalizada e não autorizada nesta sessão) — ver `BACKLOG.md`, seção 4.
