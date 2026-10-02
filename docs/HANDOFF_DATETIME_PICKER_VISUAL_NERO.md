# Handoff visual — Seletor de Data (calendário) e Seletor de Hora (colunas roláveis)

| **Data** | **Versão** | **Descrição** | **Solicitante** | **Autor** |
|---|---|---|---|---|
| 14/08/2026 | 1.0 | Criação do documento — tokens visuais, estados e responsividade dos dois componentes novos de design system (Seletor de Data e Seletor de Hora), fechando a parte visual de `BLG-095`/`BLG-096`. | Usuário (via orquestração do projeto) | Especialista de UI/Design System |

> Fonte de verdade de fluxo/UX: `docs/HANDOFF_DATETIME_PICKER_UX_DANTE.md` (12 seções, `DEC-155`, `BLG-095`/`BLG-096`). Este documento **não redefine nenhum fluxo, gatilho, regra de fechamento, granularidade ou comportamento de acessibilidade** já decidido ali — traduz o que já foi definido em token exato (cor, espaçamento, raio, elevação, tipografia, ícone), reaproveitando integralmente `apps/agendae/src/theme/tokens.ts` e os padrões visuais já usados em `app/agenda.tsx`/`app/clients.tsx`/`app/client-home.tsx`.
> Destinatário: responsável pelo wiring de frontend (implementação dos dois componentes e sua aplicação nos nove campos-alvo listados na seção 3 do handoff de UX).
> **Nenhum valor visual novo é proposto fora de `tokens.ts`**, com uma única exceção justificada: dois nomes de ícone novos (`chevronUp`/`chevronDown`, seção 4.4) — nenhum ícone de seta vertical já existe no catálogo (`AppIconName`), necessário para as setas de incremento/decremento do seletor de hora, já exigidas pelo handoff de UX (seção 6.5/6.8) e pela acessibilidade (seção 6.8, alternativa de clique para leitor de tela).

---

## 0. Como usar este documento

Cada seção especifica, por componente/estado: token exato (nome + valor, citando o arquivo de origem), componente/padrão já existente reaproveitado, e justificativa quando um valor precisa ser combinado ou estendido (nunca criado do zero). Breakpoint único reaproveitado, idêntico ao resto do app: `const wide = width >= breakpoints.tablet` (768px), já usado em `agenda.tsx`, `clients.tsx`, `client-home.tsx`, `settings.tsx`, `authenticated-header.tsx`.

Verificação de consistência com os modais mais recentes do app (`app/client-home.tsx`, modais de cancelamento e "Menos de 24h"/informativo, e `app/agenda.tsx`, modal informativo "Este agendamento não pode ser excluído"): todos usam `backdrop` (overlay `colors.overlay`), cartão com `radius.lg` + `elevation.floating` + `colors.surface`, ícone circular `radius.pill` com fundo "soft" (`dangerSoft`/`warningSoft`/`successSoft`/`brandSoft`), título `typography.family.bold`/`typography.size.title`, corpo `colors.muted`/`typography.family.regular`. Os dois componentes novos usam exatamente os mesmos quatro tokens estruturais (`radius.lg`, `elevation.floating`, `colors.surface`, `colors.overlay`) — a única diferença é de **família de layout interno**, não de token: seguem a família "modal com cabeçalho" (`modalHeader`/`modalTitle`/`modalSubtitle`/`closeButton`, já usada por `monthPickerModal`/`blockModal` em `agenda.tsx`), correta para um conteúdo de seleção (não uma mensagem única), e não a família "modal com ícone central" (usada só para confirmação/aviso). As duas famílias já convivem hoje no app com os mesmos tokens de cor/raio/elevação — nenhuma terceira família é introduzida.

---

## 1. Modal — Seletor de Data

### 1.1 Contêiner

Reaproveita **1:1** a geometria já usada pelo seletor de mês/dias existente (`monthPickerModal`, `agenda.tsx` linhas 4284-4291), por ser o modal de seleção mais próximo em propósito (escolher uma data, não preencher um formulário longo):

| Token | Valor | Origem |
|---|---|---|
| `width` | `"100%"` | — |
| `maxWidth` | `480` | Igual a `monthPickerModal` |
| `maxHeight` | `"92%"` | Igual a `blockModal`/`formModal` |
| `padding` | `spacing.lg` (28) | `tokens.ts` |
| `borderRadius` | `radius.lg` (24) | `tokens.ts` |
| `backgroundColor` | `colors.surface` (`#FFFFFF`) | `tokens.ts` |
| sombra | `elevation.floating` | `tokens.ts` |

**Variante mobile (`!wide`)**: `padding: spacing.md` (16), `borderRadius: radius.md` (16) — mesmos dois ajustes já aplicados por `modalCardMobile` (`clients.tsx`) a qualquer modal do app abaixo de 768px. Nenhum modo "tela cheia" é introduzido: como em todos os modais já existentes, o cartão permanece centralizado dentro de `backdrop` (`padding: spacing.lg`, `alignItems/justifyContent: center`, `backgroundColor: colors.overlay`) — em telas de 360–414px de largura isso já produz um cartão de ~300–360px, suficiente para a grade 7×6 na variante compacta da célula (seção 1.3).

### 1.2 Cabeçalho

Reaproveitado **1:1**: `modalHeader` (row, `justify-content: space-between`), `modalTitle` (`colors.ink`, `typography.family.bold`, `typography.size.title` = 22), `modalSubtitle` (`colors.muted`, `typography.family.regular`, opcional — só quando a tela que aplica o componente sobrepuser um subtítulo), `closeButton` (40×40, `radius.pill`, `colors.surfaceSubtle`) com `<AppIcon name="error" size={20} color={colors.muted} />`. Título padrão: **"Selecionar data"** (Dante, seção 5.3; sobrescrevível por prop).

### 1.3 Navegação de mês e grade

Reaproveitados **1:1**, sem nenhum valor novo:

- `calendarHeader` (row, `justify-content: space-between`, `paddingBottom: spacing.lg`).
- `calendarNav` (42×42, `borderWidth: 1`, `borderColor: colors.border`, `radius.pill`, `backgroundColor: colors.surface`) com `<AppIcon name="back"/"forward" size={18} color={colors.brand} />`.
- `calendarTitle` (`colors.ink`, `typography.family.bold`, `typography.size.title`, `textTransform: capitalize`) — ex.: "Agosto de 2026".
- `weekHeader`/`weekLabel` (fundo `colors.surfaceSubtle`, borda `colors.border`, `typography.family.bold`, `typography.size.caption`), ordem domingo→sábado (DEC-153, já corrigida em todo o app).
- `calendarGrid`/`calendarCell` **sempre na variante compacta** (`calendarCellMobile`: `minHeight: 58`, `padding: 4`) — **independente do breakpoint `wide`**, replicando exatamente o precedente já existente nos dois seletores de data compactos que já existem hoje dentro de modal (`agenda.tsx`, grade do campo de data do formulário de agendamento, linhas 1876-1916, e grade de `recurrenceCalendarVisible`, linhas 1876+) — ambos aplicam `calendarCellMobile` sempre, reservando a variante grande (`minHeight: 124`, sem o modificador `Mobile`) exclusivamente para a visão de agenda em página cheia (com pontos/eventos dentro da célula), que não é o caso aqui.
- `calendarDay` (28×28, `radius.pill`, `typography.family.bold`, `color: colors.ink`) para o número do dia, sem `fontSize` explícito (herdado do componente de origem, inalterado).

### 1.4 Estados da célula do dia

| Estado | Token | Como difere visualmente (nunca só por cor) |
|---|---|---|
| Padrão | `calendarCell` (fundo `colors.surface`, borda `colors.border`) + `calendarDay` (`colors.ink`, sem preenchimento) | — |
| Célula vazia (fora do mês) | `calendarCellEmpty` (`backgroundColor: colors.surfaceSubtle`), sem número | Ausência total de número e de interação |
| **Hoje** (novo, não existia em nenhum calendário do app) | `calendarDayToday` (novo token, seção 1.5) | Anel de contorno (`borderWidth`), não preenchimento — difere de "Selecionado" por **forma**, não só cor |
| Selecionado | `calendarDaySelected` (já existente: `color: colors.onBrand`, `backgroundColor: colors.brand`) | Preenchimento sólido — difere de "Hoje" por forma |
| Hoje **e** Selecionado ao mesmo tempo | `calendarDaySelected` + anel adicional `borderColor: colors.onBrand`, `borderWidth: border.width` (1) | Preenchimento vence (é o estado mais decisivo), mas o anel claro sobre o preenchimento escuro mantém "hoje" perceptível sem competir com o preenchimento |
| Fora de `minDate`/`maxDate` | `calendarCellDisabled` (novo token, seção 1.5) | Opacidade reduzida em toda a célula — não é escondida (Nielsen #1/#6, mesmo princípio de `deleteButtonDisabled`) |

### 1.5 Novos tokens de célula (únicos valores novos desta seção — todos combinações de tokens já existentes, nenhum valor numérico ou de cor inventado)

```ts
// "Hoje": anel de contorno, sem preenchimento — nunca comunicado só por cor.
calendarDayToday: {
  borderWidth: border.widthStrong, // 2 — tokens.ts
  borderColor: colors.brand,
  color: colors.brand,
},
// Fora de minDate/maxDate: mesmo princípio já usado por `deleteButtonDisabled`
// (agenda.tsx) — opacidade reduzida na célula inteira, nunca escondida.
calendarCellDisabled: { opacity: opacity.disabled }, // 0.5 — tokens.ts
```

`accessibilityState={{ disabled: true }}` nas células desabilitadas (já especificado por Dante, seção 5.4 — reafirmado aqui como requisito de implementação, não de visual).

### 1.6 Interação de seleção

Sem token novo: tocar um dia válido aplica `calendarDaySelected` e fecha o modal imediatamente (Dante, seção 5.6) — nenhuma transição/animação de saída diferente da já usada por `Modal animationType="fade"` em todo o app.

---

## 2. Modal — Seletor de Hora

### 2.1 Contêiner

Reaproveita a mesma geometria do `confirmModal` já usado em `agenda.tsx`/`client-home.tsx` (modal de propósito único, compacto — mais adequado ao conteúdo do que o `blockModal` de 680px, que é dimensionado para formulários longos):

| Token | Valor | Origem |
|---|---|---|
| `width` | `"100%"` | — |
| `maxWidth` | `420` | Igual a `confirmModal` |
| `padding` | `spacing.lg` (28) | `tokens.ts` |
| `borderRadius` | `radius.lg` (24) | `tokens.ts` |
| `backgroundColor` | `colors.surface` | `tokens.ts` |
| sombra | `elevation.floating` | `tokens.ts` |

**Variante mobile**: `padding: spacing.md`, `borderRadius: radius.md` (mesmo ajuste do seletor de data, seção 1.1). O par de colunas (seção 2.3) cabe com folga dentro de 420px em qualquer largura de tela suportada — nenhum ajuste de geometria interna por breakpoint é necessário além do padding do cartão.

### 2.2 Cabeçalho

Idêntico ao do Seletor de Data (seção 1.2): `modalHeader`/`modalTitle`/`modalSubtitle`/`closeButton`, ícone `error`. Título padrão: **"Selecionar horário"** (Dante, seção 6.2). O botão "X" fecha sem aplicar alteração — mesmo efeito funcional do botão "Cancelar" do rodapé (seção 2.6), consistente com o comportamento que o ícone "X" já tem em 100% dos modais existentes do app; nenhum comportamento novo é introduzido por manter o "X" ao lado dos botões de rodapé exigidos por Dante.

### 2.3 Colunas — geometria

| Elemento | Token/valor | Justificativa |
|---|---|---|
| Container das duas colunas | `flexDirection: row`, `alignItems: center`, `justifyContent: center`, `gap: spacing.md` (16), `marginTop: spacing.lg` (28) | Espaçamento padrão já usado entre cabeçalho e corpo de qualquer modal do app |
| Largura de cada coluna | `96` | Dimensão específica de componente (mesmo padrão do app de fixar largura em px para controles pontuais, ex.: `timeBox` 72, `yearOption` `minWidth: 76`, `confirmIcon` 56 — não é um valor da escala de espaçamento por não ser um espaçamento, é uma largura de coluna) |
| Altura de cada linha (hora/minuto) | `control.heightMd` (48) | Reaproveita o mesmo token de altura já usado por `fieldInput`/`input`/`currencyField` — não um valor novo |
| Altura visível da coluna (viewport rolável) | `240` (= 5 × `control.heightMd`) | 5 linhas visíveis (2 acima, 1 central, 2 abaixo) — convenção padrão de seletor "roleta", múltiplo exato de um token já existente, não um valor arbitrário |
| Separador `:` fixo entre colunas | `typography.family.bold`, `typography.size.title` (22), `color: colors.ink`, centralizado verticalmente com a faixa de destaque | Mesmo peso/tamanho do valor central (seção 2.4), para não parecer menor que os números que separa |

### 2.4 Faixa de destaque central e gradação de ênfase

**Faixa de destaque** (`timeColumnHighlight`, novo token — combinação de tokens já existentes, nenhum valor novo):

```ts
timeColumnHighlight: {
  position: "absolute",
  top: (240 - control.heightMd) / 2, // 96 — centraliza a faixa de 48 dentro do viewport de 240
  left: 0,
  right: 0,
  height: control.heightMd, // 48
  borderRadius: radius.sm, // 12 — mesmo raio de fieldInput/currencyField/filter
  backgroundColor: colors.brandSoft, // mesmo preenchimento de calendarCellSelected/serviceOptionActive/filterActive
  pointerEvents: "none", // não pode bloquear o toque direto no valor (Dante, seção 6.5)
},
```

Sem sombra/elevação — mesmo princípio já usado por todo estado "selecionado" plano do app (`calendarCellSelected`, `serviceOptionActive`, `filterActive`: nenhum usa `elevation`, só preenchimento).

**Texto do valor central**: reaproveita literalmente a combinação já usada por `timeBox`/`time` (`agenda.tsx`, linhas 3223-3235: fundo `colors.brandSoft` + texto `colors.brandDark` `typography.family.bold`) — a mesma "pílula de horário em destaque" já usada em toda a lista de agendamentos, agora aplicada ao valor sob a faixa central:

| Posição relativa ao centro | `fontFamily` | `color` | `opacity` |
|---|---|---|---|
| Centro (valor que seria confirmado) | `typography.family.bold` | `colors.brandDark` | `opacity.opaque` (1) |
| ±1 linha | `typography.family.semibold` | `colors.ink` | `opacity.visible` (0.8) |
| ±2 linhas (bordas do viewport) | `typography.family.medium` | `colors.muted` | `opacity.subtle` (0.65) |
| Além de ±2 (visível só durante o movimento de rolagem/inércia) | `typography.family.regular` | `colors.mutedSoft` | `opacity.disabled` (0.5) — piso, nunca some |

`fontSize` constante em todas as linhas (`typography.size.title`, 22) — **decisão deliberada**: variar o tamanho da fonte por posição (comum em alguns seletores nativos) faria os números "pularem" de largura durante a rolagem, dificultando o toque direto (Dante, seção 6.5); a ênfase vem inteiramente de peso + cor + opacidade, uma gradação de 4 níveis que reaproveita integralmente a escala de opacidade já existente em `tokens.ts` (`opacity.opaque/visible/subtle/disabled`) sem introduzir nenhum valor numérico novo, e a mesma progressão tonal de texto já usada em qualquer lugar do app para hierarquia (`ink` → `muted` → `mutedSoft`).

### 2.5 Setas de incremento/decremento

Reaproveita **1:1** a geometria de `calendarNav` (42×42, `borderWidth: 1`, `borderColor: colors.border`, `radius.pill`, `backgroundColor: colors.surface`) — mesma família de "botão circular neutro de navegação" já usada pelas setas de mês do próprio Seletor de Data (seção 1.3), aplicada aqui na vertical (acima e abaixo de cada coluna, `gap: spacing.sm` entre a seta e a coluna) em vez de na horizontal. Ícone `size={18}` `color={colors.brand}` — idêntico ao par `back`/`forward` das setas de mês.

### 2.6 Rodapé — Confirmar/Cancelar

**Diferença deliberada em relação ao par "Cancelar"/"Excluir" (`confirmDelete`, vermelho) usado nos modais destrutivos**: confirmar um horário não é uma ação destrutiva, então usa o par **neutro/positivo** já usado nos modais de formulário (`clients.tsx`, `modalActions`), não o par vermelho de confirmação de exclusão:

- Container: `confirmActions` (`marginTop: spacing.lg`, `flexDirection: row`, `flexWrap: wrap`, `justifyContent: center`, `gap: spacing.sm`) — mesmo wrapper já usado por todos os modais de ação dupla do app.
- Botão secundário "Cancelar": `cancelButton`/`cancelButtonText` (sem preenchimento, texto `colors.muted`, `typography.family.semibold`) — idêntico ao "Cancelar"/"Voltar" de qualquer modal de formulário.
- Botão primário "Confirmar": `saveButton`/`saveButtonText` (`backgroundColor: colors.brand`, texto `colors.onBrand`, `typography.family.bold`) — mesmo componente visual usado por "Salvar cliente"/"Salvar serviço" em toda a base, nunca `confirmDelete` (reservado a ações irreversíveis como excluir/desativar/cancelar agendamento).

### 2.7 Linhas de preenchimento nas bordas do intervalo (achado registrado, não decidido aqui)

Como a coluna de minutos tem só 4 valores (`00`/`15`/`30`/`45`) e a de horas 24, um valor próximo da borda do intervalo (ex.: minuto `00` ou hora `23`) deixaria menos de duas linhas reais visíveis de um dos lados dentro do viewport de 5 linhas — o handoff de UX (Dante) não especifica se a coluna "gira" (a lista é circular, `45` seguido de `00` de novo) ou "trava" (para no fim, com espaço vazio remanescente). **Esta é uma decisão de interação, fora do escopo deste documento** — a especificação visual aqui se limita a garantir que, caso a decisão final seja "trava", as linhas vazias remanescentes usem o mesmo tratamento já definido para células vazias do calendário: sem número, `opacity.disabled`, sem interação (mesmo princípio de `calendarCellEmpty`, adaptado de célula de grade para linha de coluna) — para que a ADA não precise inventar um visual próprio para esse caso, qualquer que seja a decisão de Dante sobre girar ou travar.

---

## 3. Contêiner ícone + campo (9 campos-alvo)

### 3.1 Estrutura

Reaproveita **exatamente** o padrão já existente de "campo com afixo dentro do mesmo contêiner" (`currencyField`/`currencyPrefix`/`currencyInput`, já usado em `clients.tsx`/`payments.tsx` para o campo de valor com prefixo "R$"), invertendo a posição do afixo (ícone à direita, não texto à esquerda — conforme Dante, seção 5.1) e trocando o texto fixo por um ícone tocável:

```ts
// Container — mesmos valores de fieldInput/input/currencyField, apenas
// reestruturado como linha (a borda/fundo saem do TextInput e passam para
// este container, exatamente como currencyField já faz para o afixo "R$").
fieldIconRow: {
  minHeight: control.heightMd, // 48 — igual a fieldInput/input/currencyField
  paddingHorizontal: spacing.md, // 16
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm, // 8
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.sm, // 12
  backgroundColor: colors.surfaceSubtle,
},
fieldIconRowError: { borderColor: colors.danger }, // mesmo efeito de fieldInputError/inputError
// TextInput interno — sem borda/fundo próprios, mesmos valores de texto de
// fieldInput/input, igual a currencyInput em relação a currencyField.
fieldIconRowInput: {
  flex: 1,
  color: colors.ink,
  fontFamily: typography.family.regular,
  fontSize: typography.size.body,
},
```

### 3.2 Ícone

- Campo de **data**: `<AppIcon name="calendar" size={20} color={colors.brand} />` — ícone `calendar` **já existe** em `AppIconName` (`app-icon.tsx`, linha 7: `primary: 'calendar-days'`, `fallback: 'calendar-month-outline'`) e já é usado exatamente com este tamanho/cor pelo filtro de mês de `agenda.tsx` (`styles.monthFilter`, linha 934) — mesmo ícone, mesmo tamanho, mesma cor, nenhuma variação.
- Campo de **hora**: `<AppIcon name="schedule" size={20} color={colors.brand} />` — ícone `schedule` **já existe** (`app-icon.tsx`, linha 34: `primary: 'clock'`, `fallback: 'clock-outline'`). Nenhum ícone novo é necessário para os gatilhos dos dois componentes — confirmado por leitura direta de `AppIconName`.
- Posicionamento: dentro de um `Pressable` sem estilo visual próprio (`hitSlop: { top: 8, right: 8, bottom: 8, left: 8 }`, aproximando o alvo de toque de `layout.touchTarget`/`control.touchTarget` = 44 sem alterar a altura visual de 48 do campo), como último filho de `fieldIconRow` — como o container usa `alignItems: "center"` e `minHeight: 48`, tanto o `TextInput` quanto o ícone centralizam verticalmente de forma automática, sem padding vertical adicional em nenhum dos dois (mesmo mecanismo que já evita esse problema em `currencyField` hoje).
- `accessibilityRole="button"` e `accessibilityLabel` conforme já definidos por Dante (seção 5.1/6.1) — "Abrir seletor de data/horário para o campo {rótulo}".

### 3.3 Aplicação sem quebra dos 9 campos existentes

Como `fieldIconRow` reaproveita literalmente os mesmos quatro tokens (`control.heightMd`, `spacing.md`, `colors.border`/`colors.surfaceSubtle`, `radius.sm`) que os campos já usam hoje via `fieldInput`/`input`, a altura, cor de borda/fundo e raio do campo **não mudam visualmente** em nenhuma das quatro telas — a única diferença perceptível é a presença do ícone à direita. Nenhum ajuste de `gap`/margem entre campos (`field`/`fieldGroup`, `gap: spacing.sm`) é necessário nas quatro telas.

---

## 4. Ícones — inventário e único ícone novo necessário

### 4.1 Ícones já existentes, reaproveitados sem alteração

| Uso | Nome (`AppIconName`) | Definição já existente |
|---|---|---|
| Gatilho do campo de data | `calendar` | `{ primary: 'calendar-days', fallback: 'calendar-month-outline' }` |
| Gatilho do campo de hora | `schedule` | `{ primary: 'clock', fallback: 'clock-outline' }` |
| Fechar modal (X) | `error` | já usado em 100% dos modais do app |
| Navegação de mês / hora-minuto (seta horizontal, mês) | `back` / `forward` | já usado por `calendarNav` |

### 4.2 Ícone novo — apenas para as setas verticais de incremento/decremento do seletor de hora

Nenhum ícone de seta **vertical** existe hoje em `AppIconName` (confirmado por leitura completa do arquivo — o catálogo só tem `back`/`forward`, horizontais). As setas de incremento/decremento das colunas de hora/minuto (Dante, seção 6.5/6.8, já exigidas — não é uma decisão nova, é o token visual que faltava para implementá-las) precisam de um par vertical:

```ts
// Adicionar à union AppIconName (app-icon.tsx, linha 6-11):
| 'chevronUp' | 'chevronDown'

// Adicionar ao mapa `icons`:
chevronUp: { primary: 'chevron-up', fallback: 'chevron-up' },
chevronDown: { primary: 'chevron-down', fallback: 'chevron-down' },
```

`primary` (FontAwesome6 `chevron-up`/`chevron-down`) e `fallback` (MaterialCommunityIcons `chevron-up`/`chevron-down`) — mesmo nome nas duas famílias de ícone (ambas expõem esse glifo padrão), sem ambiguidade semântica com nenhum ícone já catalogado. Uso: `<AppIcon name="chevronUp" size={18} color={colors.brand} />` dentro do botão `calendarNav` (seção 2.5).

---

## 5. Responsividade — resumo

| Elemento | Mobile (`< 768px`) | Wide (`≥ 768px`) |
|---|---|---|
| Modal Seletor de Data | `padding: spacing.md`, `radius.md`, largura efetiva = largura da tela − 2×`spacing.lg` do `backdrop` | `maxWidth: 480`, `padding: spacing.lg`, `radius.lg` |
| Modal Seletor de Hora | `padding: spacing.md`, `radius.md` | `maxWidth: 420`, `padding: spacing.lg`, `radius.lg` |
| Grade do calendário | Sempre `calendarCellMobile` (58×58), independente do breakpoint — mesmo precedente já usado pelos dois seletores de data compactos existentes | Idêntico — este componente nunca usa a célula grande de 124px (exclusiva da visão de agenda em página cheia) |
| Colunas do seletor de hora | Geometria fixa (96×240 por coluna) em qualquer largura — cabe com folga dentro do `maxWidth: 420` mesmo no menor dispositivo suportado | Idêntico, sem variação |
| Setas de incremento/decremento | Sempre visíveis nas duas larguras (requisito de acessibilidade de Dante, seção 6.8 — não opcional em mobile) | Idêntico |
| Ícone dentro do campo (9 campos) | `size={20}`, mesma posição/alinhamento em qualquer largura — o campo já é responsivo (herda `flex`/largura do formulário existente); nenhuma mudança de layout do formulário | Idêntico |

Nenhum breakpoint novo. Nenhuma variação de layout exclusiva destes dois componentes além das já catalogadas acima.

---

## 6. Acessibilidade — reforço visual (não redefine o que Dante já decidiu em interação/leitor de tela)

- Nenhum estado é comunicado só por cor: "Hoje" (anel) vs. "Selecionado" (preenchimento) diferem por forma; "fora de intervalo" usa opacidade, não só tom; a gradação de ênfase do seletor de hora combina peso de fonte + cor + opacidade (4 variáveis), nunca opacidade isolada.
- Opacidade nunca chega a zero: piso de `opacity.disabled` (0.5) tanto nas linhas mais distantes do centro do seletor de hora quanto nas células fora de `minDate`/`maxDate` — nenhum conteúdo relevante desaparece visualmente, mesmo quando não interativo.
- Contraste: `colors.brandDark`/`colors.ink` sobre `colors.surface`/`colors.brandSoft` e `colors.onBrand` sobre `colors.brand` já são as combinações padrão de todo o app (usadas em `time`/`calendarDaySelected`/`saveButton`), portanto já dentro do padrão de contraste já validado nas demais telas — nenhuma combinação de cor nova é introduzida.
- Alvo de toque: ícone do campo com `hitSlop` aproximando `control.touchTarget` (44); setas de incremento/decremento em 42×42 (`calendarNav`, já acima do mínimo de 44 quando somado à própria área do botão); botão "Confirmar"/"Cancelar" em `minHeight: 44` (`saveButton`/`cancelButton`, herdado sem alteração).

---

## 7. Checklist de handoff (Frontend Readiness)

- [x] Componentes catalogados (reaproveitados de `agenda.tsx`/`clients.tsx`/`client-home.tsx`, dois tokens novos de célula/faixa combinando valores já existentes, dois nomes de ícone novos)
- [x] Variantes definidas (célula padrão/vazia/hoje/selecionada/hoje+selecionada/desabilitada; linha de coluna por distância do centro)
- [x] Estados definidos (todos os listados nas seções 1.4 e 2.4)
- [x] Tokens documentados (todos citados de `tokens.ts`, com o valor exato e o arquivo de origem quando reaproveitados)
- [x] Breakpoint único reaproveitado (`breakpoints.tablet`, 768px)
- [x] Hierarquia tipográfica reaproveitada (`typography.family`/`size` citados por nome em cada componente)
- [x] Ícones do gatilho confirmados como já existentes (`calendar`/`schedule`); ícone novo justificado e especificado (`chevronUp`/`chevronDown`)
- [x] Responsividade especificada para os dois modais e para os 9 campos
- [x] Acessibilidade visual (contraste, alvo de toque, não depender só de cor) reforçada sem redefinir fluxo/leitor de tela já decidido por Dante
- [x] Consistência confirmada com os modais mais recentes do app (cancelamento/informativos de `client-home.tsx`/`agenda.tsx`)
- [ ] Comportamento de "girar vs. travar" nas bordas do intervalo de horas/minutos (seção 2.7) — decisão de interação pendente, fora deste escopo; tratamento visual do caso "trava" já especificado para não bloquear a ADA

---

## 8. Lacunas registradas, não decididas aqui

1. **Girar vs. travar nas bordas do seletor de hora (seção 2.7)** — decisão de interação, não visual; recomendação de encaminhar a Dante antes do wiring, já que a resposta muda se a linha vazia (tratamento já especificado aqui) chega a ser necessária.
2. **Hoje + Selecionado simultâneos (seção 1.4)** — combinação de tokens já existentes proposta aqui (anel claro sobre preenchimento) por não haver precedente exato no app; validar com o usuário/Dante se o resultado visual é satisfatório na primeira revisão de tela real, já que é a única combinação de estado sem precedente direto.

---

## 9. Registro em BACKLOG.md

Fecha a parte visual de `BLG-095` (Seletor de Data) e `BLG-096` (Seletor de Hora) — ambos os itens seguem `Proposto` até a implementação real pela ADA, agora com todos os tokens necessários definidos e sem nenhuma decisão de design pendente para quem for implementar, exceto o item registrado na seção 8.1 (interação, não visual). Nenhuma nova entrada na tabela de decisões (`DEC-NNN`) é necessária — nenhuma decisão de `docs/HANDOFF_DATETIME_PICKER_UX_DANTE.md`/`DEC-155` foi reaberta ou alterada por este documento.
