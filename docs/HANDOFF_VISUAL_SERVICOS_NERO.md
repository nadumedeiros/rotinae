# Handoff visual — Catálogo de serviços (`/services`) e profissão/especialidade do prestador

> Responsável por este documento: Nero (Design System / UI)
> Preparado em: 13/08/2026
> Fonte de verdade de fluxo/UX: `docs/HANDOFF_UX_SERVICOS_DANTE.md` (12 seções, DEC-133 e DEC-134). Este documento **não redefine nenhum fluxo, campo ou regra de negócio** já decidido por Dante — traduz o que já foi aprovado em composição de tela, componente, token e responsividade, para a ADA implementar sem tomar decisão de design.
> Destinatário: ADA (wiring de frontend)
> Fecha o lado visual de `BLG-076` (P0). Gera `DEC-135` em `BACKLOG.md`.

Convenção de nomenclatura: não havia handoff visual anterior do Nero neste projeto (`docs/HANDOFF_VISUAL*.md` estava vazio) — nomeei seguindo o padrão já usado pelos demais agentes (`HANDOFF_<ASSUNTO>_<AGENTE>.md`, ex. `HANDOFF_UX_SERVICOS_DANTE.md`, `HANDOFF_SERVICOS_CRIS.md`).

---

## 0. Como usar este documento

Cada bloco abaixo especifica, por tela/estado: composição, componentes reaproveitados (arquivo + nome do estilo/token), estados (vazio/carregando/erro/sucesso) e comportamento responsivo. **Nenhum valor visual novo é proposto fora de `apps/agendae/src/theme/tokens.ts`** — toda cor, espaçamento, raio e tipografia citados abaixo já existe nesse arquivo. A única adição de vocabulário visual desta entrega é um nome de ícone novo (`services`, seção 1.4), pois nenhum ícone já catalogado representa "catálogo de serviços" sem colisão semântica (confirmado por Dante, seção 1 do handoff dele, e por leitura direta de `app-icon.tsx`).

Breakpoint único usado em todo o app e reaproveitado aqui sem alteração: `const wide = width >= breakpoints.tablet` (768px), padrão de `useWindowDimensions()` presente em `clients.tsx` (linha 131-132), `agenda.tsx`, `authenticated-header.tsx`, `settings.tsx`, `client-providers.tsx`. Nada abaixo introduz um breakpoint diferente.

---

## BLOCO A — Tela `/services` (catálogo de serviços do prestador)

### 1. Navegação e descoberta

#### 1.1 Item de menu (`authenticated-header.tsx`)

Inserir no array `menuItems` (`src/components/layout/authenticated-header.tsx`, linha ~104-114), exatamente entre `Início` e `Agenda`, replicando a estrutura literal dos itens vizinhos:

```ts
{ icon: "services" as const, label: "Serviços", route: "/services" },
```

Posição final do array de `menuItems` (perfil `provider`):

```
{ icon: "home", label: "Início", route: "/dashboard" },
{ icon: "services", label: "Serviços", route: "/services" },   // NOVO
{ icon: "schedule", label: "Agenda", route: "/agenda" },
{ icon: "clients", label: "Clientes", route: "/clients" },
{ icon: "financial", label: "Financeiro", route: "/payments" },
{ icon: "packages", label: "Planos", route: "/plans" },
{ icon: "settings", label: "Configurações", route: "/settings" },
{ icon: "file", label: "Manual de uso", route: "/manual" },
```

Sem estilo novo: o item usa exatamente `styles.profileItem`/`styles.profileItemText` (dropdown Web, linhas ~337-350) e `styles.nativeMenuItem`/`styles.nativeMenuIcon`/`styles.profileItemText` (modal fullscreen nativo, linhas ~439-450) — os dois lugares onde `menuItems` é mapeado hoje. Nenhum componente novo de menu é necessário.

#### 1.2 `Stack.Screen` — fora do escopo visual

Registro de rota em `app/_layout.tsx` é responsabilidade da ADA (Dante, seção 1, item estrutural 2). Não há composição visual associada a esse passo.

#### 1.3 FAB `UniversalCreateMenu` (recomendação de Dante, seção 1, item 4 — reforçada aqui)

Adicionar a `actions` (`src/components/layout/universal-create-menu.tsx`, linha 8-12) uma 4ª entrada, seguindo exatamente a mesma forma literal das 3 já existentes (sem estilo novo — `styles.action`/`styles.actionIcon`/`styles.actionTitle`/`styles.actionDescription` já cobrem qualquer novo item da lista):

```ts
{ icon: 'services', title: 'Novo serviço', description: 'Cadastre um serviço do seu catálogo.', route: '/services' },
```

Posição sugerida: ao final do array (após "Novo agendamento"), preservando a ordem de prioridade operacional já estabelecida (Cliente → Financeiro → Agendamento → Serviço), já que Cliente/Financeiro/Agendamento são ações do dia a dia e Serviço tende a ser configurado com menor frequência após o cadastro inicial.

#### 1.4 Ícone novo: token `services`

Nenhum ícone já catalogado em `AppIconName` (`src/components/ui/app-icon.tsx`) representa "catálogo de serviços" sem colidir com o que já está em uso no mesmo menu (`packages` = Planos, `clients`/`financial`/`schedule`/`settings` já ocupados) — confirmado por leitura direta do arquivo, mesma conclusão de Dante (seção 1).

**Especificação para a ADA adicionar ao mapa `icons` de `app-icon.tsx`** (sem desenhar SVG — apenas nomear/mapear, seguindo a estrutura já usada por todos os outros itens do arquivo):

```ts
services: { primary: 'list-check', fallback: 'clipboard-list-outline' },
```

- `primary`: FontAwesome6 `list-check` — transmite "lista de itens catalogados/verificáveis", sem reaproveitar a metáfora de caixa/pacote de `packages` (Planos).
- `fallback`: MaterialCommunityIcons `clipboard-list-outline` — mesma família semântica (lista), usado quando `family="material-community"` for passado ao componente.
- Adicionar `'services'` à union `AppIconName` (linha 6-11 do arquivo), no mesmo padrão alfabético/temático já usado ali (sugestão: ao lado de `packages`, já que ambos aparecem lado a lado no menu do prestador).

Uso: `<AppIcon name="services" size={20} color={colors.brand} />` em todos os pontos do menu (idêntico ao uso de `packages`/`financial` já existente).

---

### 2. Tela `/services` — composição geral

Estrutura de página idêntica à de `clients.tsx` (mesma ordem de blocos, mesmo `SafeAreaView`/`AuthenticatedHeader`/`ScrollView`/`MobileTabBar`), sem o carrossel de métricas nem os cards de código de vínculo/solicitações (que são específicos do domínio de clientes e não têm equivalente em serviços — Dante não pediu nenhum indicador numérico para `/services`, então nenhum é inventado aqui).

```
SafeAreaView (style: styles.safe, reaproveitar 1:1 de clients.tsx → colors.canvas)
 AuthenticatedHeader
 ScrollView (contentContainerStyle: styles.scroll)
   View (style: [styles.content, !wide && styles.contentMobile])
     Cabeçalho de página (pageHeading)         — ver 2.1
     Toolbar (busca + filtro por status)        — ver 2.2
     Lista/tabela de serviços OU estado vazio   — ver 2.3–2.4
   Footer (Platform.OS === "web", reaproveitar styles.footer/footerBrand/footerText de clients.tsx)
 MobileTabBar
Modal — criar/editar serviço                    — ver 3
Modal — confirmar desativação                    — ver 4.2
Modal — feedback (sucesso/aviso/erro)            — ver 5
```

#### 2.1 Cabeçalho de página

Reaproveitar exatamente `styles.pageHeading`/`styles.pageHeadingWide`/`styles.headingCopy`/`styles.eyebrow`/`styles.title`/`styles.titleMobile`/`styles.description`/`styles.primaryButton`/`styles.primaryButtonText` de `clients.tsx` (linhas 1876-1926).

- Eyebrow: `"CATÁLOGO"` (equivalente a `"RELACIONAMENTO"` em clients.tsx — categoria da tela em caixa alta, `colors.brand`, `typography.family.bold`, `typography.size.caption`, `letterSpacing: 1.2`).
- Título: `"Serviços"` (`styles.title`/`styles.titleMobile`, 36/30px conforme wide/mobile, `typography.family.bold`).
- Descrição: `"Cadastre os serviços que você oferece e mantenha valores e durações sempre atualizados."` (`styles.description`, `colors.muted`, `typography.size.bodyLarge`).
- Botão primário: `"Novo serviço"` com `<AppIcon name="add" size={20} color={colors.onBrand} />`, estilo `styles.primaryButton` (fundo `colors.brand`, `elevation.card`, `radius.sm`) — abre o modal de criação (seção 3) com campos vazios. **Não exibir este botão sozinho no topo quando o catálogo estiver vazio** — nesse caso, a ação primária vive dentro do estado vazio (seção 2.4), evitando dois CTAs idênticos competindo na mesma tela; o botão do cabeçalho só aparece quando já existe ao menos um serviço na lista (mesmo padrão de hierarquia visual: um único caminho óbvio de ação por tela).

**Sem card de aviso de limite de plano** (`styles.planLimitNotice` de `clients.tsx` **não é reaproveitado aqui**) — RN-SRV-011 (Dante, seção 6) define explicitamente que não há limite de plano para serviços. Não incluir nenhuma variação desse componente nesta tela.

#### 2.2 Toolbar — busca e filtro por status

Reaproveitar exatamente `styles.directory`/`styles.toolbar`/`styles.toolbarMobile`/`styles.searchBox`/`styles.searchInput`/`styles.filters`/`styles.filter`/`styles.filterActive`/`styles.filterText`/`styles.filterTextActive` de `clients.tsx` (linhas 2293-2343), sem alteração:

- Campo de busca: placeholder `"Buscar serviço por nome"` (equivalente a `"Buscar por nome ou e-mail"`), ícone `<AppIcon name="search" size={20} color={colors.mutedSoft} />`.
- Chips de filtro: `["Todos", "Ativos", "Inativos"]` (rótulo no plural, já que aqui não há individualização por registro como em clientes — decisão de copy, não de componente; o componente de chip é idêntico).
- Layout: `toolbar` (row, `flexWrap: wrap`, `justify-content: space-between`, borda inferior `colors.border`) em telas largas; `toolbarMobile` (coluna, `align-items: stretch`) em mobile — comportamento herdado sem alteração.

#### 2.3 Lista — tabela (wide) vs. cards (mobile)

**Tabela (`wide`)**: reaproveitar `styles.tableHeader`/`styles.columnTitle` de `clients.tsx` (linhas 2344-2356), com colunas ajustadas ao domínio de serviço:

| Coluna | Rótulo (`columnTitle`) | Estilo de largura equivalente |
|---|---|---|
| Nome | `"SERVIÇO"` | `styles.clientColumn` → renomear para `styles.serviceNameColumn` com o mesmo `flex: 2.2` |
| Duração | `"DURAÇÃO"` | novo `styles.durationColumn` com `flex: 1` (entre `serviceColumn` `flex:1.5` e `dateColumn` `flex:1.1` de clients.tsx — valor intermediário, já que "45 min" é mais curto que um texto de serviço) |
| Valor de referência | `"VALOR"` | `styles.dateColumn` → renomear para `styles.valueColumn`, `flex: 1.1` |
| Status | `"STATUS"` | `styles.statusColumn`, `flex: 0.9`, sem alteração |
| (ação) | — | `styles.actionColumn`, `width: 84`, sem alteração |

Cada linha (`styles.clientRow` → `styles.serviceRow`, mesmos valores: `minHeight: 80`, `paddingHorizontal: spacing.lg`, borda superior `colors.border`) exibe:

- Nome do serviço em `styles.clientName` → `styles.serviceName` (mesmos valores: `colors.ink`, `typography.family.semibold`, `typography.size.bodyLarge`), sem avatar/iniciais (não há identidade de pessoa aqui — remover `styles.clientAvatar`/`clientInitials`, que não fazem sentido para um item de catálogo).
- Duração formatada `"45 min"` em `styles.cellText` (reaproveitado sem alteração).
- Valor formatado em `BRL` via a mesma função `formatCurrency(cents)` já usada em `clients.tsx` (linha 85) e `payments.tsx` — não recriar formatação de moeda.
- Badge de status: **componente `Status` de `clients.tsx` (linhas 1789-1809) reaproveitado literalmente**, apenas trocando o texto de `"Ativo"/"Inativo"` (que já é exatamente o rótulo desejado — nenhuma tradução necessária) e o tipo de entrada de `ClientStatus` para `ServiceStatus` mapeado (`"active"` → exibir `"Ativo"`, `"inactive"` → exibir `"Inativo"`, mesma função `status: client.status === "active" ? "Ativo" : "Inativo"` já usada em `clients.tsx` linha 78 para mapear o valor do domínio). Reaproveitar 1:1 `styles.status`/`statusActive`/`statusInactive`/`statusText`/`statusTextActive`/`statusTextInactive`.
- Ação de editar: mesmo `styles.rowEditButton` (`<AppIcon name="edit" size={16} color={colors.brand} />`) + `<AppIcon name="forward" .../>`, mesmo `actionColumn`.
- **Ação de ativar/desativar na própria linha** (não existe em `clients.tsx`, é específico de serviço — ver 4.1): um segundo botão de ação inline, ao lado do de editar, dentro do mesmo `actionColumn` (que precisa crescer de `width: 84` para acomodar 2 ações + seta — sugestão `width: 116`, mantendo `flexDirection: row`, `gap: spacing.sm`, `justify-content: flex-end` já existentes). Ícone: `<AppIcon name={service.status === "active" ? "warning" : "success"} size={16} color={service.status === "active" ? colors.danger : colors.success} />` dentro do mesmo formato de botão circular de `styles.rowEditButton` (`width/height: 36`, `radius.sm`), mas com fundo `colors.dangerSoft` (ativo → ação de desativar) ou `colors.successSoft` (inativo → ação de ativar) em vez de `colors.brandSoft`, para diferenciar visualmente de "editar" sem introduzir uma cor nova.

**Cards (mobile)**: reaproveitar `styles.clientCard` → `styles.serviceCard` (mesmos valores: `minHeight` ajustável ao conteúdo — como não há bloco de política de agendamento aqui, o card fica mais curto que o de cliente; sugestão `minHeight: 148` em vez de `238`, mesmo `marginHorizontal/marginBottom/padding/borderWidth/borderColor/borderRadius/backgroundColor`), com:

- Linha superior: nome do serviço (`styles.serviceName`) à esquerda, `Status` (mesmo componente) à direita — mesmo padrão de `styles.cardMeta` (`flexDirection: row`, `justify-content: space-between`) já usado no card de cliente para "Serviço e valor" + `Status`.
- `styles.cardDivider` (linha de 1px, `colors.border`, `marginVertical: spacing.md`) — reaproveitado sem alteração.
- Linha de dados: `"45 min · R$ 150,00"` (duração e valor concatenados com `·`, mesmo padrão de concatenação já usado em `client.service · formatCurrency(...)` em `clients.tsx` linha 994-995), em `styles.metaValue` (reaproveitado).
- Linha de ações: dois botões lado a lado — Editar (`styles.rowEditButton`, ícone `edit`) e Ativar/Desativar (mesmo botão circular descrito acima para wide, cores `dangerSoft`/`successSoft` conforme o status), dentro de um `View` com `flexDirection: row`, `gap: spacing.sm`, `justify-content: flex-end` — mesma composição de `styles.cardDate` de `clients.tsx` (linha 2564-2570), sem o ícone de calendário (não há data por linha em serviço) e sem `styles.cardArrow` (o card inteiro não precisa ser clicável para abrir detalhe — diferente de cliente, que navega para `/clients/:id`; aqui, tocar em "Editar" já abre o modal, então **o card não é `Pressable` navegável, é uma `View` estática** com os dois botões de ação explícitos — evita affordance ambígua de "tocar em qualquer lugar do card" quando não há tela de detalhe para onde navegar).

**Sem paginação** (RN-SRV-010, Dante seção 6/3.1): **não reaproveitar** `styles.pagination`/`styles.paginationMobile`/`styles.pageButton`/`styles.pageCurrent` de `clients.tsx`. A lista inteira é renderizada de uma vez dentro do `ScrollView` da página — não há footer de paginação nesta tela.

#### 2.4 Estado vazio — catálogo totalmente vazio (estado real de 100% dos prestadores hoje)

Este é o estado mais crítico da tela (Dante, seção 3.3.1) — precisa de tratamento visual mais assertivo que o `styles.empty`/`emptyTitle`/`emptyText` genérico de `clients.tsx` (que é adequado para "filtro sem resultado", seção 2.5 abaixo, mas não para este caso).

**Especificação**: card central maior que o padrão de `styles.empty` (`padding: spacing.xxl`, `alignItems: center`, `gap: spacing.sm` — reaproveitado como base), mas com CTA proeminente:

- Ícone: `<AppIcon name="services" size={32} color={colors.brand} />` (usa o próprio ícone novo do domínio, em `colors.brand` em vez de `colors.mutedSoft` — diferencia visualmente de um "nada encontrado" comum, reforçando que é o próprio conteúdo central da tela que está zerado, não um resultado de busca).
- Título (`styles.emptyTitle`, reaproveitado: `colors.ink`, `typography.family.bold`, `typography.size.subtitle`): **"Nenhum serviço cadastrado ainda"**.
- Texto (`styles.emptyText`, reaproveitado: `colors.muted`, `typography.family.regular`, `textAlign: center`, mas **sem** o `maxWidth` implícito de uma linha só — este texto é mais longo que os textos vazios de `clients.tsx`, então aplicar `maxWidth: 420` para não esticar a linha em telas largas): **"Cadastre pelo menos um serviço para poder criar agendamentos — sem um serviço ativo, você e seus clientes não conseguem agendar."**
- **CTA obrigatório, nunca ausente** (Dante, seção 3.3.1 — "nunca mostrar essa tela sem uma ação primária visível"): botão idêntico ao `styles.primaryButton`/`primaryButtonText` do cabeçalho (mesmo componente visual, não um botão novo), texto **"Cadastrar primeiro serviço"**, `marginTop: spacing.md` em relação ao texto acima, abrindo o mesmo modal de criação da seção 3.

Diferença chave em relação a `clients.tsx`: lá, o estado vazio de "nenhum cliente cadastrado ainda" (linha 1062) é só texto, sem botão dentro do próprio bloco vazio (o CTA "Novo cliente" já está sempre visível no cabeçalho). Aqui, **os dois CTAs coexistem apenas quando a lista não está vazia** — quando vazia, o botão do cabeçalho é omitido (seção 2.1) e o único caminho de ação é o botão dentro do estado vazio, evitando ambiguidade sobre qual botão usar no momento de maior fricção do produto (P0).

#### 2.5 Estado vazio — filtro/busca sem resultado (catálogo não vazio)

Reaproveitar `styles.empty`/`emptyTitle`/`emptyText` **exatamente como estão** em `clients.tsx` (linha 1054-1066), sem CTA adicional:

- Ícone: `<AppIcon name="search" size={32} color={colors.mutedSoft} />` (idêntico ao de clients.tsx).
- Título: **"Nenhum serviço encontrado"**.
- Texto: **"Tente alterar a busca ou o filtro selecionado."** (texto idêntico ao já usado em `clients.tsx`, Dante pediu explicitamente reaproveitar esse padrão, seção 3.3.2).

#### 2.6 Estado de carregamento

Não há um padrão de skeleton dedicado em `clients.tsx` hoje (a tela carrega e preenche o estado, sem skeleton visual) — **não inventar um skeleton novo aqui**. Reaproveitar o mesmo padrão implícito já usado pela tela de clientes: lista vazia até a resposta chegar (sem indicador de spinner dedicado nesta versão). Se a ADA identificar necessidade de um indicador de carregamento explícito, usar o mesmo texto simples já usado em `client-providers.tsx` (`"Carregando vínculos..."`, dentro de `styles.card`) como precedente — **não decidir isso como definitivo aqui**; registrar como ponto em aberto na seção 8.

---

### 3. Modal de criar/editar serviço

Reaproveitar **estrutura completa e literal** do modal de cliente (`clients.tsx`, linhas 1142-1544) — mesmo `Modal`/`KeyboardAvoidingView`/`View accessibilityViewIsModal`/cabeçalho/`ScrollView` de formulário com `flexShrink: 1`/rodapé de ações fixo fora do scroll, incluindo a correção de scroll+teclado consolidada nesta sessão (DEC-124/DEC-129): `KeyboardAvoidingView` com `behavior="padding"` (iOS) / `"height"` (Android) / `undefined` (Web) envolvendo o backdrop, e `ScrollView` do formulário com `style={styles.formScroll}` (`flexShrink: 1`) — **nunca só `contentContainerStyle`**, conforme o próprio anti-padrão documentado em DEC-124.

```
Modal (transparent, animationType="fade", onRequestClose fecha o modal)
 KeyboardAvoidingView (style: styles.modalBackdrop)
   View (accessibilityViewIsModal, style: [styles.modalCard, !wide && styles.modalCardMobile])
     Cabeçalho: título dinâmico + subtítulo + botão fechar     — ver 3.1
     ScrollView (style: styles.formScroll, contentContainerStyle: styles.form)
       Campo Nome                                               — ver 3.2
       Campo Duração (minutos) + chips de atalho                — ver 3.3
       Campo Valor de referência (máscara de moeda)             — ver 3.4
       Badge de status (informativo, não editável)               — ver 3.5
       Banner de erro de formulário (condicional)                — ver 3.6
     Rodapé de ações (fora do scroll): Desativar/Ativar (se editando) + Cancelar/Salvar — ver 3.7
```

#### 3.1 Cabeçalho do modal

Reaproveitar 1:1 `styles.modalHeader`/`modalTitle`/`modalSubtitle`/`closeButton`:

- Título: `"Editar serviço"` / `"Novo serviço"` (equivalente a `editingId ? "Editar cliente" : "Novo cliente"`).
- Subtítulo: `"Atualize os dados deste serviço."` / `"Preencha os dados do serviço que você oferece."`.
- Botão fechar: `<AppIcon name="error" size={20} color={colors.muted} />` dentro de `styles.closeButton`, idêntico.

#### 3.2 Campo Nome

Reaproveitar 1:1 `styles.fieldGroup`/`fieldLabel`/`requiredMark`/`fieldInput`/`fieldInputError`/`fieldErrorText` do padrão de "Nome completo" em `clients.tsx` (linhas 1182-1194):

- Label: `"Nome do serviço"` com `*` obrigatório (`styles.requiredMark`, `colors.danger`).
- `TextInput` com `autoFocus`, `maxLength={60}` (guarda de UX de Dante, seção 4 — limite de exibição, não imposto pelo backend), placeholder `"Ex.: Sessão avulsa 50min"`.
- Erro inline abaixo do campo, mesma `styles.fieldErrorText`, cobrindo tanto validação client-side (nome vazio) quanto o conflito de nome (`SERVICE_NAME_CONFLICT`, seção 6 abaixo) — mesmo padrão de exibição, texto diferente conforme o caso.

#### 3.3 Campo Duração (minutos) + chips de atalho

Estrutura de campo idêntica a 3.2, mas com `keyboardType="number-pad"` (equivalente ao campo "Quantidade total permitida" em `clients.tsx`, linha 1317-1325) e um sufixo visual `"min"`:

- Label: `"Duração"` com `*` obrigatório.
- Campo numérico: reaproveitar a composição de `styles.currencyField`/`currencyPrefix`/`currencyInput` (linhas 2829-2850) **invertida** — em vez de prefixo `"R$"` à esquerda, usar sufixo `"min"` à direita dentro do mesmo container (`flexDirection: row`, `alignItems: center`, mesmo `borderWidth/borderColor/borderRadius/backgroundColor` de `currencyField`), com o `TextInput` (`styles.currencyInput`, reaproveitado) à esquerda e o texto `"min"` (mesmo estilo de `styles.currencyPrefix`, mas posicionado depois — trocar `flexDirection` do container para acomodar) à direita. Isso evita criar um componente de campo totalmente novo: é o mesmo "campo com afixo" já usado para moeda, só invertido.
- **Chips de atalho de duração** (recomendado por Dante, seção 4, não obrigatório): reaproveitar **exatamente** `styles.serviceOptions`/`serviceOption`/`serviceOptionActive`/`serviceOptionText`/`serviceOptionTextActive` de `agenda.tsx` (linhas 3586-3597) — o mesmo componente visual de "chips de sugestão" já usado ali para os serviços mais comuns. Valores dos chips: `["15 min", "30 min", "45 min", "60 min", "90 min", "120 min"]`; tocar um chip preenche o campo numérico com o valor correspondente (mesma lógica de conveniência do chip de serviço em `agenda.tsx` — preenche mas não bloqueia digitação livre por cima).
- Erro inline: mesma `styles.fieldErrorText`.

#### 3.4 Campo Valor de referência

Reaproveitar **1:1, sem nenhuma alteração**, o campo "Valor do serviço" já existente em `clients.tsx` (linhas 1243-1261): `styles.currencyField`/`currencyPrefix`/`currencyInput`, prefixo `"R$"`, `keyboardType="decimal-pad"`, placeholder `"0,00"`, conversão para centavos com `Math.round(parsedValue * 100)` (mesma função já usada por `clients.tsx`, citada por Dante seção 4). Único ajuste de copy: o texto de ajuda abaixo do campo (`styles.fieldHelper`) passa de `"O cliente verá esse valor antes de solicitar o agendamento."` para `"Valor de referência exibido durante o agendamento. Zero é um valor válido (ex.: avaliação gratuita)."` — reforçando RN-SRV-002 (zero é permitido), já que este é um ponto onde um prestador pode hesitar ao digitar "0,00" achando que é um erro.

#### 3.5 Status — informativo, não editável junto do formulário

**Diferença estrutural deliberada em relação ao modal de cliente** (onde Status é um seletor de dois botões dentro do mesmo formulário, `styles.statusSelector`/`statusOption`, linhas 1475-1500): aqui, conforme Dante seção 3.4 (`UpdateServiceInput` não tem campo `status` — ativar/desativar são operações próprias, não parte do payload de salvar), **o status aparece apenas como o mesmo componente `Status` (badge) já usado na lista** (seção 2.3), posicionado logo abaixo do cabeçalho do modal (antes do primeiro campo do formulário) quando `editingId` existe — nunca como um controle interativo dentro do `ScrollView` de campos. Em modo de criação (`!editingId`), este bloco não aparece (o serviço nasce sempre `active`, sem necessidade de mostrar nada).

Composição sugerida: `View` com `flexDirection: row`, `alignItems: center`, `gap: spacing.sm`, `marginTop: spacing.sm` (entre o cabeçalho e o `ScrollView`, fora dele — mesmo espírito do "badge de status visível" já presente na lista): texto `"Status atual:"` (`styles.fieldLabel`, reaproveitado) + o componente `Status` (badge). A ação de mudar o status vive exclusivamente no rodapé (seção 3.7), nunca aqui.

#### 3.6 Banner de erro de formulário

Reaproveitar 1:1 `styles.formError`/`formErrorText` de `clients.tsx` (linhas 1501-1506, 2670-2683): ícone `<AppIcon name="warning" size={16} color={colors.danger} />`, fundo `colors.dangerSoft`, texto `colors.danger`. Usado para os erros de seção 6 que não são inline por campo (`FORBIDDEN`, `SESSION_EXPIRED`, `NETWORK_ERROR`, `UNKNOWN`, `SERVICE_NOT_FOUND`).

#### 3.7 Rodapé de ações

Reaproveitar `styles.modalActions`/`modalActionsMobile`/`modalActionGroup`/`cancelButton`/`cancelButtonText`/`saveButton`/`saveButtonText` de `clients.tsx` (linhas 1508-1541, 2684-2732), com uma diferença de conteúdo à esquerda:

- Em `clients.tsx`, o slot esquerdo do rodapé é o botão "Excluir" (`styles.deleteButton`, só quando `editingId`). **Aqui não existe exclusão** (RN-SRV-005) — o slot esquerdo é substituído pelo botão de **Ativar/Desativar**, reaproveitando exatamente o componente visual de `styles.deleteButton`/`deleteButtonText` (`colors.dangerSoft`/`colors.danger`, mesma forma/tamanho) quando a ação é **desativar** (serviço ativo), e uma variante com `colors.successSoft`/`colors.success` (mesmas dimensões, só troca de cor — nenhum token novo) quando a ação é **ativar** (serviço inativo). Ícone: `<AppIcon name="warning" .../>` (desativar) ou `<AppIcon name="success" .../>` (ativar), texto `"Desativar serviço"` / `"Reativar serviço"`. Em modo de criação (`!editingId`), o slot fica vazio (`<View />`), igual ao padrão já usado por `clients.tsx` quando não há `editingId`.
- Slot direito inalterado: `"Cancelar"` (`styles.cancelButton`) + `"Salvar serviço"` / `"Salvar alterações"` (`styles.saveButton`, ícone `success`), cobrindo apenas nome/duração/valor — nunca o status (reforça a separação de Dante, seção 3.4).
- **Clicar em "Desativar serviço" não fecha o modal direto** — abre o modal de confirmação (seção 4.2) por cima; só após confirmar é que a lista recarrega e o modal de edição fecha. **Clicar em "Reativar serviço" executa direto**, sem confirmação (ação não destrutiva, Dante seção 3.4) — ao concluir, atualiza o badge da seção 3.5 no próprio modal (ele permanece aberto, permitindo continuar editando nome/duração/valor na sequência, já que reativar não fecha o formulário).

---

### 4. Ativar/desativar como ação inline (fora do modal)

#### 4.1 Ativar — ação direta, sem confirmação

Botão inline (lista, seções 2.3) executa `activateService(id)` diretamente ao toque. Feedback: reaproveitar o modal de feedback de sucesso (seção 5) com a mensagem apropriada. Nenhum modal de confirmação é exibido para esta ação (Dante, seção 3.4 — Nielsen #3).

#### 4.2 Desativar — modal de confirmação obrigatório

Reaproveitar **1:1** o modal de confirmação de exclusão de `clients.tsx` (linhas 1680-1717, estilos `styles.confirmCard`/`confirmIcon`/`confirmTitle`/`confirmText`/`confirmActions`/`confirmDeleteButton`/`confirmDeleteText`), trocando apenas o conteúdo textual (o componente visual — ícone de aviso, título, texto, dois botões — é idêntico):

- Ícone: `<AppIcon name="warning" size={24} color={colors.danger} />` dentro de `styles.confirmIcon` (fundo `colors.dangerSoft`, `radius.pill`).
- Título: **"Desativar [nome do serviço]?"**.
- Texto: **"Ele deixará de aparecer para novos agendamentos — seus e de clientes. Agendamentos já criados com este serviço não são afetados."** (texto exato definido por Dante, seção 3.4 — não alterar a redação, apenas aplicar o componente visual).
- Botões: `"Cancelar"` (`styles.cancelButton`) e `"Desativar"` (`styles.confirmDeleteButton`/`confirmDeleteText`, mesma cor `colors.danger`/`colors.onBrand` — visualmente destrutivo, mas **o texto nunca usa a palavra "excluir"**, conforme RN-SRV-005; o componente visual de `clients.tsx` usa `"Sim, excluir"` — aqui o rótulo correto é apenas `"Desativar"`, sem variação de "excluir").

Este modal é acionado tanto pelo botão inline da lista (seção 2.3) quanto pelo botão "Desativar serviço" dentro do modal de edição (seção 3.7) — mesmo componente, duas origens de disparo.

---

### 5. Modal de feedback (sucesso/aviso/erro)

Reaproveitar **1:1, sem nenhuma alteração de estilo**, o modal de feedback de `clients.tsx` (linhas 1719-1782, estilos `styles.feedbackModal`/`feedbackModalIcon`/`feedbackModalSuccess`/`feedbackModalWarning`/`feedbackModalError`/`feedbackModalTitle`/`feedbackModalText`/`feedbackModalButton`/`feedbackModalButtonText`). Mesmas três tonalidades (`success`/`warning`/`error`), mesmos ícones (`success`/`warning`/`error`), mesmo botão único `"Entendi"`. Mensagens de conteúdo conforme os textos definidos por Dante (seções 3.2, 5) — nenhuma copy nova é inventada aqui além do que já está no handoff de UX.

---

### 6. Mapeamento visual de erros (`ServiceErrorCode`)

Tabela de correspondência entre o código de erro (já definido por Dante, seção 5) e o componente visual a usar (todos já especificados nas seções acima — esta tabela só amarra qual componente usar para cada código):

| Código | Componente visual | Onde |
|---|---|---|
| `SERVICE_NOT_FOUND` | Modal de feedback, tom `warning` (seção 5) + fechamento automático do modal de edição se aberto | Fecha modal, recarrega lista |
| `SERVICE_NAME_INVALID` | Erro inline no campo Nome (`styles.fieldErrorText`, seção 3.2) | Dentro do modal, formulário preservado |
| `SERVICE_NAME_CONFLICT` (criar/editar) | Erro inline no campo Nome (seção 3.2) | Dentro do modal |
| `SERVICE_NAME_CONFLICT` (reativar, edge case 3.5 do Dante) | Modal de feedback, tom `warning` (seção 5), com texto contendo o atalho para abrir o modal de edição do serviço em conflito — **usar o mesmo padrão de link inline já usado em `clients.tsx`** (`styles.planLimitLink`: `color: colors.brand`, `fontFamily: typography.family.bold`) dentro do texto do modal de feedback, como um `Text` clicável adicional abaixo de `feedbackModalText` | Modal de feedback + atalho |
| `DURATION_INVALID` | Erro inline no campo Duração (seção 3.3) | Dentro do modal |
| `VALUE_INVALID` | Erro inline no campo Valor (seção 3.4) | Dentro do modal |
| `FORBIDDEN` | Banner `styles.formError` (seção 3.6) dentro do modal, ou modal de feedback tom `error` se disparado fora de um modal aberto (ex.: ação inline de ativar/desativar na lista) | Contextual |
| `SESSION_EXPIRED` | Modal de feedback, tom `error` (seção 5) | — |
| `NETWORK_ERROR` | Banner `styles.formError` dentro do modal (formulário nunca é limpo, Dante seção 5) ou modal de feedback tom `error` se a ação era inline (ativar/desativar/reativar fora do modal) | Contextual |
| `UNKNOWN` | Mesmo tratamento de `NETWORK_ERROR` | Contextual |

Regra geral de posicionamento (não inventa nada novo, só formaliza a escolha entre os dois componentes já existentes): **erros de campo específico → inline; erros que não apontam para um campo → banner dentro do modal aberto; erros disparados por uma ação sem modal aberto (ex.: ativar/desativar direto na lista) → modal de feedback.**

---

### 7. Responsividade — resumo Bloco A

| Elemento | Mobile (`< 768px`) | Wide (`≥ 768px`, `breakpoints.tablet`) |
|---|---|---|
| Cabeçalho de página | `styles.pageHeading` empilhado (coluna) | `styles.pageHeadingWide` (linha, título+descrição à esquerda, botão à direita) |
| Toolbar | `styles.toolbarMobile` (coluna, busca cheia + filtros abaixo) | `styles.toolbar` (linha, busca + filtros lado a lado) |
| Lista | Cards empilhados (`styles.serviceCard`), sem cabeçalho de colunas | Tabela com `styles.tableHeader` + linhas `styles.serviceRow` |
| Modal de criar/editar | `styles.modalCardMobile` (padding reduzido, `radius.md`) + `styles.modalActionsMobile` (botões empilhados, `column-reverse`) | `styles.modalCard` (padding `spacing.lg`, `radius.lg`, `maxWidth: 620`) + `styles.modalActions` (botões lado a lado) |
| Campo duração + moeda | Empilhados (`styles.fieldGroup`, um por linha) | Podem ficar lado a lado usando o mesmo `styles.formRow`/`rowField` já usado em `agenda.tsx` para Data/Horário — opcional, não obrigatório; empilhado também é aceitável e mais simples de implementar |

Nenhum breakpoint novo. Nenhuma reorganização de componente exclusiva desta tela — tudo herda o comportamento já testado em `clients.tsx`.

---

## BLOCO B — Campo de profissão/especialidade do prestador

> Lembrete de escopo (Dante, seção 12.1): este bloco é um **atributo de identidade** (1 valor por prestador), não um item de catálogo. Nenhum componente do Bloco A é reaproveitado aqui por acaso de nome — qualquer semelhança visual (ex.: chips) é por serem o mesmo padrão de "atalho de preenchimento", não por relação de domínio.

### 8. Campo em `app/settings.tsx` — card "Dados profissionais"

Inserir dentro do `form` do primeiro card (`styles.card`, `"Dados profissionais"`, linha ~221-279 de `settings.tsx`), **logo após o campo "Nome de exibição" e antes de "E-mail"** (posição exata definida por Dante, seção 12.3):

```
View (styles.field)
  Text (styles.label) "Profissão/especialidade"          — sem requiredMark, campo opcional
  TextInput (styles.input) maxLength={60}
  Text (styles.hint) "Aparece para seus clientes ao lado do seu nome. Opcional."
  View (chips de sugestão) — ver 8.1
```

Reaproveitar **1:1** `styles.field`/`styles.label`/`styles.input`/`styles.hint`/`styles.fieldErrorText`/`styles.inputError` já existentes em `settings.tsx` (linhas 505-531) — mesmo componente visual do campo "Nome de exibição" logo acima. Único ajuste: **sem `styles.requiredMark`** (campo opcional, RN-PRF-002) — nenhum `*` vermelho, diferente de "Nome de exibição"/"Telefone" que já têm.

Placeholder sugerido: `"Ex.: Personal Trainer"`.

#### 8.1 Chips de sugestão

Reaproveitar **exatamente** o mesmo componente visual de chip já especificado no Bloco A (seção 3.3) e já existente em `agenda.tsx` (`styles.serviceOptions`/`serviceOption`/`serviceOptionActive`/`serviceOptionText`/`serviceOptionTextActive`, linhas 3586-3597) — mesma estrutura de "linha de chips que preenche um campo de texto ao tocar, sem bloquear digitação livre por cima". Renomear localmente em `settings.tsx` para `styles.professionOptions`/`professionOption`/etc. (mesmos valores de espaçamento/cor/raio, arquivo diferente).

Lista de chips (exemplo dado por Dante, seção 12.2 — não é lista fechada, apenas atalho): `"Personal Trainer"`, `"Esteticista"`, `"Barbeiro(a)"`, `"Adestrador(a)"`, `"Professor(a) particular"`, `"Nutricionista"`, `"Fisioterapeuta"`, `"Técnico(a)"`. Posicionados logo abaixo do `TextInput`, antes do texto `hint` (ou depois — sugestão: `hint` primeiro, chips depois, mesmo padrão de `agenda.tsx` onde os chips de serviço vêm antes do texto de ajuda quando há; como não há um precedente de ordem fixa entre hint e chips no app, **registrar como decisão em aberto para a ADA escolher a ordem visualmente mais limpa na implementação** — não é uma decisão que muda a leitura do fluxo).

Nenhuma normalização visual (Title Case) é exibida durante a digitação — a normalização (Dante, seção 12.2) acontece **apenas no momento de salvar** (`trim()` + capitalização de cada palavra), então o campo mostra exatamente o que o prestador está digitando até o `onBlur`/submit; não recriar como máscara em tempo real (evita o campo "brigar" com o cursor do usuário enquanto ele digita, problema clássico de máscara de capitalização em tempo real).

#### 8.2 Título do card

Dante nota (seção 12.3) que o título "Dados profissionais" hoje é impreciso (só contém nome/e-mail/telefone/fuso) e passa a fazer sentido literal com este campo. **Nenhuma mudança de título é necessária** — o nome do card já existe e já cobre o novo campo semanticamente; não é uma alteração visual desta entrega.

---

### 9. Reflexo para o CLIENTE — as três telas

Princípio geral (Dante, seção 12.4, aplicado abaixo por tela): a profissão é sempre complemento do nome, nunca aparece sozinha, e **nunca gera placeholder quando ausente** — se o prestador não preencheu, a interface do cliente não reserva espaço algum para o dado (mesmo comportamento de campo opcional ausente já usado para `phone` de `ClientProviderLink`).

#### 9.1 `app/client-providers.tsx` (lista de vínculos do cliente)

Estado atual (linha 70): `styles.specialty` hoje exibe o **status do vínculo** (`"Vínculo aprovado"` / `"Aguardando aprovação"`), não a especialidade — Dante já sinalizou essa ambiguidade de nome (seção 12.4).

**Especificação visual**: quando a profissão estiver preenchida, compor a mesma linha (mesmo `Text`, mesmo estilo `colors.muted`/`typography.family.regular`/`typography.size.caption` já usado por `styles.specialty`) como:

```
"Personal Trainer · Vínculo aprovado"
```

Quando ausente, o texto permanece exatamente como é hoje (`"Vínculo aprovado"` / `"Aguardando aprovação"`, sem alteração). **Nenhum estilo novo é necessário** — é a mesma `Text`/`styles.specialty`, só com o conteúdo condicionalmente concatenado (`profession ? \`${profession} · ${statusLabel}\` : statusLabel`).

**Renomeação de estilo recomendada à ADA** (não obrigatória para o resultado visual, mas alinhada com o próprio apontamento de Dante sobre o nome `specialty` estar ocupado por outra informação): renomear `styles.specialty` → `styles.subline` no momento da implementação, mantendo os mesmos valores (`marginTop: spacing.xs`, `color: colors.muted`, `fontFamily: typography.family.regular`, `fontSize: typography.size.caption`).

#### 9.2 `app/client-booking.tsx` (carrossel de seleção de prestador)

Estado atual (linhas 262-298): cada card mostra avatar/iniciais (`styles.avatar`/`avatarText`), `providerName` em negrito (`styles.providerName`), e uma linha de serviço (`styles.providerService`: `"${contextService.name} · ${contextService.durationMinutes} min"` ou `"Sem serviço ativo"`).

**Especificação visual (linha própria, entre nome e linha de serviço, conforme Dante seção 12.4)**:

```
View (styles.flex, já existente)
  Text (styles.providerName) — nome, inalterado
  Text (novo: styles.providerProfession) — SÓ RENDERIZADO SE profession existir
  Text (styles.providerService) — linha de serviço, inalterada
```

Novo estilo `styles.providerProfession`, com os **mesmos valores exatos** já usados por `providerSpecialty` em `client-home.tsx` (linha 688-693, componente morto mas com o estilo correto para este propósito, conforme apontado por Dante): `marginTop: spacing.xs`, `color: colors.muted`, `fontFamily: typography.family.regular`, `fontSize: typography.size.caption`. Quando `profession` for `undefined`/vazio, o `Text` inteiro não é renderizado (`{profession ? <Text style={styles.providerProfession}>{profession}</Text> : null}`) — o card cresce/encolhe independentemente para os demais prestadores da lista, sem reservar altura fixa (Dante, seção 12.4, "sem alterar o espaçamento vertical do card").

**Não** combinar profissão na mesma linha do serviço (`styles.providerService`) — decisão explícita de Dante para não sobrecarregar a linha de maior carga cognitiva do fluxo de agendamento.

#### 9.3 `app/client-home.tsx` — fora de escopo (confirmado)

Conforme instrução explícita: **nenhuma especificação visual é produzida para `client-home.tsx`** nesta entrega. O carrossel de prestadores ali (linha ~200) é componente morto (`initialProviders` é array vazio hardcoded, linha 39; nunca alimentado por rede) — já usa `styles.providerSpecialty` (linha 688) corretamente para um campo `specialty` que já existe no tipo local `Provider` (linha 33), então **nenhuma mudança visual é necessária ali quando/se esse carrossel for religado a dados reais no futuro** — o estilo já é o padrão correto e serviu de referência direta para a seção 9.2 acima.

---

### 10. Reflexo para o PRÓPRIO prestador — cabeçalho/menu de perfil

`authenticated-header.tsx`, linhas ~332-333 (dropdown Web) e ~430-432 (modal fullscreen nativo): hoje exibe `displayName` (`styles.profileName`) seguido do rótulo de papel (`styles.profileRole`: `"Prestador"`/`"Cliente"`/`"Administrador"`).

**Especificação visual (nice-to-have, não bloqueante — Dante, seção 12.5)**: quando `activeRole === "provider"` e a profissão estiver preenchida, compor `styles.profileRole` (mesmo estilo, sem alteração de cor/fonte/tamanho) como:

```
"Prestador · Personal Trainer"
```

Em vez de apenas `"Prestador"`. Quando ausente ou quando `activeRole !== "provider"`/`isAdmin`, o texto permanece exatamente como é hoje. **O rótulo de papel nunca é substituído** — apenas estendido com `· [profissão]` quando aplicável, reforçando RN-PRF-006 (a profissão nunca se sobrepõe ao rótulo de autorização/contexto de sessão).

Esta é a mesma composição com `·` já usada nas seções 9.1 e 9.2 — um único padrão visual de "informação primária · informação secundária" reaproveitado nos três pontos de reflexo, sem inventar uma segunda convenção de junção.

**Pendência de origem de dado** (Dante, seção 12.5, não resolvida por este documento): o header hoje não busca `ProviderSettings` — essa é uma decisão de arquitetura de dados (Chris/ADA), não de UX/visual. A composição acima só pode ser implementada quando esse dado estiver disponível na sessão.

---

### 11. Responsividade — resumo Bloco B

Nenhum dos pontos do Bloco B introduz um layout novo por breakpoint — todos reaproveitam componentes já responsivos:

- Campo em `settings.tsx`: já dentro de `styles.grid`/`gridWide` (coluna única em mobile, duas colunas lado a lado em `wide` — comportamento herdado do card inteiro, não do campo individual).
- Chips de sugestão: `flexWrap: wrap` (herdado de `serviceOptions`) já quebra linha automaticamente em telas estreitas, sem breakpoint dedicado.
- `client-providers.tsx`/`client-booking.tsx`: a nova linha de texto é conteúdo dentro de um card já responsivo (`gridWide`/`providerCarouselCard`) — não altera a lógica de quebra de coluna existente.

---

### 12. Pendência de backend — não bloqueia o design, bloqueia a persistência

Reforçando o que Dante já registrou (seção 12.7): **a especificação visual acima do Bloco B pode ser implementada pela ADA como UI pura (campo, chips, linhas de exibição) independentemente do status da pendência de backend.** O que **não** deve ser implementado antes de autorização explícita de Marcus/usuário é a **persistência real** (nova coluna em `profiles`, parâmetro novo em `update_provider_settings`, propagação via `get_client_booking_context`/`listClientProviderLinks()`) — a ADA pode construir a tela com estado local (`useState`) e mocks, mas não deve ligar a gravação real no banco até essa dependência ser destravada. Este documento não altera esse gate; apenas confirma que ele não impede o trabalho visual.

---

## 13. Lacunas e dúvidas registradas para Dante (não decididas aqui)

1. **Ordem entre `hint` e chips de sugestão em `settings.tsx` (seção 8.1)**: Dante não especificou se os chips vêm antes ou depois do texto de ajuda "Aparece para seus clientes...". Deixei como decisão de implementação da ADA (ambas as ordens são visualmente coerentes com os padrões existentes) — se Dante tiver preferência por consistência com algum outro ponto do app, favor confirmar.
2. **Estado de carregamento explícito de `/services` (seção 2.6)**: `clients.tsx` não tem um padrão de skeleton/spinner dedicado hoje (a lista simplesmente aparece vazia até a resposta chegar). Não inventei um skeleton novo por não ser um padrão já estabelecido no app, mas registro que, se o carregamento de `/services` demorar perceptivelmente mais que o de clientes (não deveria, mesmo padrão de `listServices()` sem paginação), pode valer a pena Dante/Marcus decidirem se este é o momento de introduzir um padrão de skeleton no Design System — não decidido unilateralmente aqui.
3. **Largura do `actionColumn` na tabela wide de `/services` (seção 2.3)**: sugeri `width: 116` (de `84` original) para acomodar duas ações inline (editar + ativar/desativar) em vez de uma. Esse número é uma estimativa de espaçamento, não um token — a ADA deve ajustar visualmente durante a implementação se `116` não for suficiente para os dois botões de `36×36` + ícone de seta com o `gap: spacing.sm` já especificado.

---

## 14. Checklist de handoff (Frontend Readiness)

- [x] Componentes catalogados (reaproveitados de `clients.tsx`/`agenda.tsx`/`settings.tsx`/`client-providers.tsx`/`client-booking.tsx`, nenhum novo além do ícone `services`)
- [x] Variantes definidas (badge ativo/inativo, botão ativar vs. desativar, modal criar vs. editar)
- [x] Estados definidos (vazio crítico, vazio de busca, carregamento sinalizado como pendência menor, erro por código, sucesso)
- [x] Tokens documentados (todos citados de `tokens.ts`, nenhum valor novo fora dele)
- [x] Breakpoint único reaproveitado (`breakpoints.tablet`, 768px)
- [x] Hierarquia tipográfica reaproveitada (`typography.family`/`size` citados por nome em cada componente)
- [x] Microinterações documentadas (ativar sem confirmação, desativar com confirmação, chips preenchendo campo sem bloquear digitação)
- [x] Nenhuma inconsistência visual introduzida (nenhum componente novo de layout — só um nome de ícone novo, devidamente justificado)
- [ ] Acessibilidade — replicar os mesmos `accessibilityRole`/`accessibilityLabel`/`accessibilityState` já usados nos componentes de origem citados (não redocumentado aqui item a item porque é herdado 1:1 do código-fonte referenciado, não uma decisão visual nova)

---

## 15. Registro em BACKLOG.md

Gera `DEC-135`: handoff visual definitivo do catálogo de serviços (`/services`) e do campo de profissão/especialidade do prestador, consolidando DEC-133/DEC-134 (Dante) em composição de tela, componente, token e responsividade, sem introduzir nenhum valor visual fora de `tokens.ts` além do novo token de ícone `services` (`list-check`/`clipboard-list-outline`).
