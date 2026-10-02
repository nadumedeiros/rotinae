# Handoff de UX/UI — Reorganização do modal de pagamento (`payments.tsx`)

## Histórico de Versões

| **Data** | **Versão** | **Descrição** | **Solicitante** | **Autor** |
|---|---|---|---|---|
| 18/08/2026 | 1.0 | Criação do documento: diagnóstico da hierarquia atual do formulário de cadastro/edição de pagamento (`paymentForm`, `apps/agendae/app/payments.tsx`) e proposta de reorganização em quatro grupos escaneáveis (Cliente e serviço · Valor e vencimento · Situação do pagamento · Observações), com textos revisados e ajustes de design system necessários | Usuário | UI e Design System |

---

> **Responsável por este documento:** UI e Design System
> **Preparado em:** 18/08/2026
> **Destinatário:** especialista de implementação de frontend (wiring de `payments.tsx`)
> **Natureza:** especificação de design/UX — **não é implementação**. Nenhum arquivo de código foi alterado para produzir este documento. Toda alteração em `apps/agendae/app/payments.tsx` deve ser feita por quem for implementar, a partir desta especificação.
> **Fontes consultadas:** `apps/agendae/app/payments.tsx` (bloco `paymentForm`, linhas 495-744, e `StyleSheet` associado); `docs/DESIGN_SYSTEM_MVP.md` (tokens e governança visual); `docs/HANDOFF_PAGAMENTOS_STATUS_PAGINACAO_UX_DANTE.md` (fluxo e regras de negócio dos 4 status já implementados); `docs/HANDOFF_VISUAL_SERVICOS_NERO.md` (padrão de referência de handoff visual já aplicado a outro modal do mesmo app).

---

## 0. Como usar este documento

Este documento **não reabre nenhuma regra de negócio** já decidida (transições de status, bloqueio de cancelamento com recibo filho, quitação parcial etc. — ver `docs/HANDOFF_PAGAMENTOS_STATUS_PAGINACAO_UX_DANTE.md`). Ele trata exclusivamente de **hierarquia de informação, agrupamento de campos, ordem de preenchimento e textos** do formulário já existente. Nenhum campo é adicionado ou removido; nenhum valor visual novo é proposto fora de `apps/agendae/src/theme/tokens.ts` — todo token citado abaixo já existe nesse arquivo.

---

## 1. Diagnóstico da estrutura atual

### 1.1 Ordem de campos hoje (linha a linha)

| Ordem | Bloco | Linhas | Observação |
|---|---|---|---|
| 1 | Cabeçalho ("Dados do pagamento" + descrição fixa) | 497-511 | Título estático, igual em criação e edição; não usa o padrão de cabeçalho dos demais modais da mesma tela |
| 2 | Cliente (seletor) | 513-548 | Primeiro campo — correto, é "quem" |
| 3 | **Quitação parcial** (`partialPaymentBox`) — condicional | 549-599 | Só aparece editando um pagamento `Pendente`/`charge`. Aparece **antes** do campo Valor principal e do seletor de Situação, sem relação visual com nenhum dos dois |
| 4 | Serviço ou origem | 600-611 | Campo secundário (o quê), posicionado antes dos dados financeiros |
| 5 | Valor + Vencimento (linha) | 612-643 | Os dois dados mais críicos do pagamento (quanto/quando) aparecem no meio do formulário, não logo após "quem" |
| 6 | Situação (4 pills) | 644-692 | Indicador de estado, distante da quitação parcial (item 3), que trata do mesmo assunto |
| 7 | Observação (opcional) | 693-707 | Corretamente por último |
| 8 | Erro de formulário | 708-713 | Contextual, ok |
| 9 | Ações (Cancelar/Salvar) | 714-741 | Ver 1.2.5 |

### 1.2 Problemas identificados

**1.2.1 — Cabeçalho não segue o padrão dos demais modais da mesma tela.**
`paymentForm` usa `styles.sectionHeader`/`sectionTitle` (linha 1921-1944): título de tamanho `typography.size.subtitle` (18px), texto fixo "Dados do pagamento" em criação **e** em edição, sem `accessibilityRole="header"`. Todos os outros modais de `payments.tsx` — `clientModal` (linha 2368-2396), `periodPickerModal` (linha 1263-1270) — usam `clientModalHeader`/`clientModalTitle`/`clientModalSubtitle`: título em `typography.size.title` (22px, mais proeminente) com `accessibilityRole="header"` e subtítulo contextual. O modal de pagamento é o único que não diz, no próprio título, se o usuário está criando ou editando algo — o rótulo do botão de ação (linha 733-739, "Registrar" vs. "Salvar") é hoje a única pista textual dessa diferença. Isso é evidência de que o cabeçalho é resquício de um layout anterior: o `StyleSheet` ainda guarda `formCard`/`mainGrid`/`summaryCard`/`sectionIcon` (linhas 1910-1933), estilos de uma composição de card fixo na página que não é mais usada em lugar nenhum do arquivo — o formulário migrou para modal, mas o cabeçalho não foi atualizado para o padrão de modal já consolidado nas outras três janelas da mesma tela.

**1.2.2 — O grupo financeiro (quanto + quando) não está próximo do grupo "quem" (Gestalt: proximidade).**
Entre o campo Cliente e o par Valor/Vencimento existem dois blocos inteiros (quitação parcial condicional + Serviço). Isso adia a leitura dos dois dados que o critério de aceite desta tarefa aponta como prioritários ("quanto está pagando, quando"), quando o usuário já entregou a informação de contexto (quem) e está pronto para ver o número.

**1.2.3 — A quitação parcial está desconectada da Situação, embora trate do mesmo assunto.**
A caixa de "Valor recebido agora" (linha 552-598) e o seletor "Situação" (linha 644-692) são as duas únicas partes do formulário que alteram o *estado* do pagamento. Hoje elas ficam em pontas opostas do formulário, com o campo "Serviço" e o par "Valor/Vencimento" no meio — nada as agrupa visualmente como "isto aqui decide o que acontece com o pagamento". Um usuário editando um pagamento pendente vê primeiro uma caixa destacada de quitação, sem ainda saber (porque ainda não rolou a tela) que mais abaixo existe um seletor de situação que interage com o mesmo valor.

**1.2.4 — Nenhuma diferenciação visual entre grupos de campos.**
`styles.form` usa `gap: 20` (linha 1945) — um valor fixo que **não corresponde a nenhum token da escala de espaçamento** (`spacing.md = 16`, `spacing.lg = 28`; ver `docs/DESIGN_SYSTEM_MVP.md`, seção 4.4, e `tokens.ts`). Esse valor fixo aplica a mesma distância entre *todos* os campos, relacionados ou não — violando a regra de governança do Design System ("nunca usar margens fixas", seção 8, item 1) e, na prática, fazendo o formulário parecer uma lista plana de 6-7 itens de peso igual, em vez de 4 grupos de importância diferente.

**1.2.5 — Hierarquia das ações é fraca, mas dentro do padrão já usado no restante do app.**
`cancelButton` (linha 2128-2136) não tem `backgroundColor` (fica "fantasma", texto `colors.muted`) e `saveButton` (linha 2137-2148) tem fundo `colors.brand` — a cor já diferencia primário de secundário, e ambos usam `formActionButton` (`flex: 1`, linha 2149), o mesmo padrão de largura igual usado em **todos** os outros pares de botão do arquivo (`confirmActions`, exclusão, atrasar/cancelar). Ou seja, **isto não é uma inconsistência exclusiva do formulário de pagamento** — é o padrão de botões de rodapé de todo `payments.tsx`. Não recomendamos alterar essa convenção isoladamente aqui (ver seção 3.7); a melhoria proposta é textual/de ordem, não estrutural.

**1.2.6 — Rótulo "Situação" sem contexto quando lido isoladamente.**
Dentro da lista de pagamentos, a coluna "SITUAÇÃO" (linha 995) tem o contexto da linha inteira (cliente, serviço, valor) ao redor. Dentro do formulário, o mesmo rótulo aparece isolado, sem reforçar que se trata do status *deste* pagamento — pequena perda de clareza corrigida na seção 4.

---

## 2. Critério de aceite (reafirmado)

O usuário deve conseguir, ao abrir o formulário, identificar rapidamente, nesta ordem de prioridade de leitura:

1. **Quem** está pagando (cliente) e **o quê** está sendo pago (serviço/origem);
2. **Quanto** está pagando (valor);
3. **Quando** (vencimento);
4. **Qual ação** precisa realizar agora (registrar, salvar, alterar situação, registrar quitação parcial).

A proposta da seção 3 organiza o formulário exatamente nessa sequência, com agrupamento visual que reforça cada bloco.

---

## 3. Nova estrutura proposta

### 3.1 Visão geral

```
Cabeçalho do modal (título dinâmico + subtítulo contextual + fechar)  — ver 3.2
ScrollView do formulário
  GRUPO 1 — Cliente e serviço                                        — ver 3.3
    Cliente (seletor)
    Serviço ou origem
  GRUPO 2 — Valor e vencimento                                       — ver 3.4
    Valor | Vencimento (lado a lado, como já é hoje)
  GRUPO 3 — Situação do pagamento                                    — ver 3.5
    Situação (4 pills)
    Quitação parcial (condicional, agora DENTRO deste grupo)
  GRUPO 4 — Observações (opcional)                                   — ver 3.6
    Observação
  Banner de erro (condicional, inalterado)
Rodapé de ações (fora do scroll, inalterado em estrutura)              — ver 3.7
```

Nenhum campo muda de tipo, obrigatoriedade ou comportamento — apenas posição, agrupamento visual e texto de apoio.

### 3.2 Cabeçalho do modal — padronizar com os demais modais da tela

Substituir `sectionHeader`/`sectionTitle`/`sectionText` (leftover de layout anterior, ver 1.2.1) pelo mesmo padrão já usado em `clientModal`/`periodPickerModal`: `clientModalHeader`/`clientModalTitle`/`clientModalSubtitle` — ou um alias com o mesmo valor de tokens (`paymentModalHeader`/`paymentModalTitle`/`paymentModalSubtitle`), à escolha de quem implementar, desde que os **valores** sejam idênticos aos já usados nos outros três modais desta tela (`typography.size.title`, `typography.family.bold`, `colors.ink` para o título; `typography.size.body`, `colors.muted`, `spacing.xs` de margem para o subtítulo).

- **Título dinâmico:** `"Novo pagamento"` (criação) / `"Editar pagamento"` (edição) — em vez do texto fixo "Dados do pagamento". Adicionar `accessibilityRole="header"` ao `Text` do título (hoje ausente), igual ao já usado no título do `clientModal`.
- **Subtítulo contextual:**
  - Criação: `"Registre um valor a cobrar ou já recebido."`
  - Edição: `"Atualize os dados deste pagamento."`
- Botão fechar: inalterado (`styles.closeButton`, ícone `error`, `colors.muted`).

Isso resolve, sem custo de um componente novo, a ambiguidade de "qual ação preciso realizar" apontada no critério de aceite: o título já entrega a resposta antes mesmo de o usuário olhar para o botão do rodapé.

### 3.3 Grupo 1 — Cliente e serviço (quem + o quê)

Sem mudança de campo ou comportamento — apenas reagrupamento: o campo **Serviço ou origem** (hoje linha 600-611, posicionado depois da caixa de quitação parcial) passa a vir **imediatamente após o Cliente**, formando um único bloco visual "quem + o quê está sendo pago", antes de qualquer dado financeiro.

- Cliente (seletor, obrigatório) — inalterado (`clientSelector`, `clientSelectorName`, `clientSelectorEmail`).
- Serviço ou origem (obrigatório) — inalterado (`fieldInput`, placeholder `"Ex.: Atendimento individual"`).

Rótulo do grupo (ver 3.8 sobre o novo padrão de rótulo de seção): **"CLIENTE E SERVIÇO"**.

### 3.4 Grupo 2 — Valor e vencimento (quanto + quando)

O par que hoje já vem lado a lado (`formRow`/`rowField`, linha 612-643) é mantido exatamente como está — essa composição já está correta e não precisa de nenhuma mudança de componente. A única mudança é de **posição**: este grupo passa a ser o segundo bloco do formulário, logo depois de Cliente/Serviço, em vez de vir depois da caixa condicional de quitação parcial.

- Valor (moeda, obrigatório) — inalterado (`currencyField`/`currencyPrefix`/`currencyInput`).
- Vencimento (data, obrigatório) — inalterado (`DatePickerField`).

Rótulo do grupo: **"VALOR E VENCIMENTO"**.

Isso coloca os dois dados mais críticos do pagamento (segundo o próprio critério de aceite) na segunda posição de leitura do formulário — imediatamente visíveis após rolar um campo, sem nenhum bloco condicional entre eles e o grupo anterior.

### 3.5 Grupo 3 — Situação do pagamento (o que muda de estado)

Reúne, num único bloco, as duas partes do formulário que alteram o estado do pagamento — hoje espalhadas em pontas opostas (ver 1.2.3):

1. **Situação** (4 pills: Pendente/Recebido/Atrasado/Cancelado) — vem primeiro dentro do grupo, pois define o estado-alvo. Componente, regras de habilitação (`disabledStatusReason`) e textos de bloqueio **inalterados** — essa lógica é do domínio de fluxo (`docs/HANDOFF_PAGAMENTOS_STATUS_PAGINACAO_UX_DANTE.md`), não deste documento.
2. **Quitação parcial** (`partialPaymentBox`) — passa a aparecer **dentro** deste mesmo grupo, imediatamente **abaixo** do seletor de Situação, em vez de acima do campo Serviço. Continua condicional às mesmas regras atuais (`editingId && editingPayment?.status === "Pendente" && editingPayment.kind !== "receipt"`) — nenhuma regra de exibição é alterada.

Rótulo do grupo: **"SITUAÇÃO DO PAGAMENTO"**.

Justificativa da ordem interna (pills antes da caixa de quitação): a pill "Pendente" já precisa estar selecionada/visível para a quitação parcial fazer sentido — ler primeiro "qual é a situação" e, na sequência imediata, "quanto entrou agora" cria uma narrativa única ("o pagamento está pendente → aqui está o valor que chegou agora"), em vez de apresentar o valor recebido antes de o usuário saber que o pagamento ainda está pendente.

### 3.6 Grupo 4 — Observações (opcional, secundária)

Inalterado em posição (já é o último campo) e em comportamento. Mantido explicitamente separado dos três grupos anteriores por ser a única informação não essencial para responder "quem, quanto, quando, qual ação" — o rótulo de grupo aqui reforça esse caráter secundário.

Rótulo do grupo: **"OBSERVAÇÕES (OPCIONAL)"** — units já usa `styles.optional` para o texto "(opcional)" junto do rótulo do campo; o rótulo de grupo reforça a mesma informação num nível acima, sem duplicar estilo novo.

### 3.7 Rodapé de ações

**Sem mudança estrutural.** Mantém `formActions`/`cancelButton`/`saveButton`/`formActionButton` exatamente como estão (mesma largura igual entre os dois botões, mesmo padrão usado nos demais rodapés de modal do arquivo — ver 1.2.5). Duas melhorias de baixo risco, sem alterar a convenção de largura:

- Adicionar ícone ao botão primário, reforçando a hierarquia por peso visual (não só por cor): `<AppIcon name="success" size={18} color={colors.onBrand} />` antes do texto "Registrar"/"Salvar", no mesmo padrão já usado em outros botões primários do arquivo (`newPaymentButton`, linha 767-774, já combina ícone + texto). Isso não é obrigatório para atender ao critério de aceite, é um reforço opcional.
- Texto do botão primário mantém a lógica já existente (`"Salvando..."` / `"Registrar"` / `"Salvar"`, linha 733-739) — nenhuma mudança de copy aqui.

### 3.8 Rótulo de seção — novo padrão de nome de estilo, zero tokens novos

Para que os quatro grupos acima sejam escaneáveis sem depender de divisórias pesadas, propomos um pequeno texto de categoria acima de cada grupo, reaproveitando **exatamente os mesmos valores de token** já usados em `eyebrow`/`historyEyebrow` (linhas 1829-1834 e 2536-2541: `typography.family.bold`, `typography.size.caption`, `letterSpacing: 1.2`), mudando apenas a cor de `colors.brand` para `colors.muted` — para não competir visualmente com o eyebrow de categoria de página ("FINANCEIRO") nem com os títulos de modal (`colors.brand` já é usado pelo cabeçalho da página; dentro do modal, um rótulo de grupo na mesma cor de marca ficaria "gritando" mais do que o próprio título do modal).

Nome de estilo sugerido: `formSectionLabel`.

```
formSectionLabel: {
  color: colors.muted,
  fontFamily: typography.family.bold,
  fontSize: typography.size.caption,
  letterSpacing: 1.2,
  marginBottom: spacing.xs,
}
```

Isto **não é um token novo** — é uma terceira variação de nome para uma combinação de tokens que já existe duas vezes no mesmo arquivo (`eyebrow`, `historyEyebrow`), só troca a cor por outra já catalogada (`colors.muted`). Nenhuma entrada nova é necessária em `tokens.ts`.

### 3.9 Espaçamento entre grupos — substituir o valor fixo por tokens

Corrigir a violação de governança apontada em 1.2.4 (`gap: 20` não é um token) e usar a diferença de espaçamento para reforçar a separação entre grupos (Gestalt: proximidade), sem criar nenhum valor novo:

- Dentro de um grupo (entre rótulo de seção e campo, ou entre dois campos do mesmo grupo, como Situação + quitação parcial): `spacing.md` (16px).
- Entre um grupo e o próximo (ex.: fim de "Cliente e serviço" até o rótulo de "Valor e vencimento"): `spacing.xl` (40px) — substitui o `gap: 20` uniforme de hoje.

Isso significa envolver cada grupo em um `View` próprio com `gap: spacing.md` internamente, e aplicar `marginTop: spacing.xl` no `View` de cada grupo (exceto o primeiro), em vez do `gap: 20` único aplicado hoje ao contêiner `form` inteiro.

---

## 4. Labels e textos revisados

| Campo/elemento | Texto atual | Texto proposto | Motivo |
|---|---|---|---|
| Título do modal | `"Dados do pagamento"` (fixo) | `"Novo pagamento"` / `"Editar pagamento"` (dinâmico) | Responde de imediato "qual ação estou realizando", conforme critério de aceite; alinha com o padrão dos demais modais da tela |
| Subtítulo do modal | `"Preencha as informações essenciais."` (fixo) | `"Registre um valor a cobrar ou já recebido."` / `"Atualize os dados deste pagamento."` | Contextualiza a ação sem repetir o título |
| Rótulo de grupo 1 | — (inexistente) | `"CLIENTE E SERVIÇO"` | Cria hierarquia escaneável sem alterar nenhum campo |
| Rótulo de grupo 2 | — (inexistente) | `"VALOR E VENCIMENTO"` | Idem, destaca o par mais crítico |
| Rótulo de grupo 3 | — (inexistente) | `"SITUAÇÃO DO PAGAMENTO"` | Une visualmente Situação + quitação parcial |
| Rótulo de grupo 4 | — (inexistente) | `"OBSERVAÇÕES (OPCIONAL)"` | Reforça caráter secundário |
| Label do campo "Situação" | `"Situação"` | `"Situação do pagamento"` | Mantém clareza quando o campo é lido fora do contexto da lista (onde a coluna já se chama "SITUAÇÃO") |
| Demais labels (Cliente, Serviço ou origem, Valor, Vencimento, Valor recebido agora, Observação) | — | **Inalterados** | Já são claros e diretos; nenhuma revisão necessária |

---

## 5. Ajustes de design system necessários

| Item | Tipo de ajuste | Detalhe |
|---|---|---|
| `formSectionLabel` | Novo *nome* de estilo (não é token novo) | Reaproveita `colors.muted` + `typography.family.bold` + `typography.size.caption` + `letterSpacing: 1.2`, mesmo padrão de composição de `eyebrow`/`historyEyebrow` (ver 3.8) |
| Espaçamento do contêiner `form` | Correção de valor fixo para token | `gap: 20` → estrutura em grupos com `spacing.md` (intra-grupo) e `spacing.xl` (entre grupos) — ver 3.9. Nenhum valor fora da escala documentada em `docs/DESIGN_SYSTEM_MVP.md`, seção 4.4 |
| Cabeçalho do modal | Reaproveitamento, sem estilo novo | Usar os mesmos valores de `clientModalHeader`/`clientModalTitle`/`clientModalSubtitle` já existentes no mesmo arquivo (linhas 2377-2396) |
| Ícone no botão primário (opcional) | Reaproveitamento, sem estilo novo | `<AppIcon name="success" .../>`, mesmo padrão já usado em `newPaymentButton` (linha 767-774) |
| Cor/tokens de status (pills, badges) | **Sem alteração** | Já definidos em `docs/HANDOFF_PAGAMENTOS_STATUS_PAGINACAO_UX_DANTE.md`, seção 3.4 — este documento não reabre essa decisão |

Nenhum novo `Color Token`, `Spacing Token`, `Radius Token` ou `Typography Token` é adicionado a `tokens.ts`. Toda mudança acima é composição de valores já existentes.

---

## 6. Responsividade

Nenhuma mudança de comportamento por breakpoint é necessária. O agrupamento proposto (seção 3) funciona igual em `wide` e mobile:

- O par Valor/Vencimento continua usando `formRow` (linha) em telas largas e `formRowMobile` (coluna) em mobile — comportamento herdado, inalterado.
- Os rótulos de grupo (`formSectionLabel`) são texto simples, sem impacto de layout em nenhum breakpoint.
- `paymentFormModal` (linha 2798-2805, `maxWidth: 620`, `maxHeight: "92%"`) permanece o mesmo contêiner de modal — a reorganização interna não exige mudança de largura/altura máxima.

---

## 7. Acessibilidade

- Título do modal passa a ter `accessibilityRole="header"` (hoje ausente em `sectionTitle`, ver 1.2.1), consistente com o título do `clientModal`.
- Rótulos de grupo (`formSectionLabel`) são apenas organização visual — não substituem nenhum `accessibilityLabel` de campo já existente; leitores de tela continuam navegando campo a campo pelos rótulos individuais (`fieldLabel`) já presentes.
- Nenhuma mudança nos estados de erro inline (`fieldErrorText`, `accessibilityRole="alert"`) nem no bloqueio de opções de status (`accessibilityState={{ disabled }}`) — ambos preservados exatamente como estão hoje.
- Contraste: `colors.muted` sobre `colors.surface` (usado no novo `formSectionLabel`) já é combinação validada em outros usos no mesmo arquivo (ex.: `clientModalSubtitle`, `partialBalanceLabel`) — nenhuma combinação de cor nova é introduzida.

---

## 8. Achados fora do escopo deste documento (não decididos aqui)

1. **Duas rotas para a mesma ação irreversível de cancelamento, com atrito diferente.** `docs/HANDOFF_PAGAMENTOS_STATUS_PAGINACAO_UX_DANTE.md` (seção 3.1-b) especifica que cancelar uma cobrança pela ação rápida da linha exige um modal de confirmação dedicado, com texto explícito sobre a irreversibilidade (DEC-094). Hoje, dentro do próprio `paymentForm`, selecionar a pill **"Cancelado"** (quando permitido por `disabledStatusReason`) e clicar em **"Salvar"** aplica o cancelamento **sem nenhuma confirmação equivalente** — o mesmo efeito final, com dois níveis de atrito diferentes dependendo do caminho. Este documento não decide a solução (poderia ser um passo de confirmação adicional dentro do próprio formulário, ou reaproveitar o modal de confirmação já existente antes de chamar `savePayment`) porque é uma decisão de fluxo/regra de negócio, não de reorganização visual — registro para avaliação de quem define UX de fluxo antes de implementação.
2. **Ordem entre "Situação" e "quitação parcial" quando ambos aparecem em telas muito baixas (mobile, teclado aberto).** A proposta da seção 3.5 assume que rolar até o grupo 3 é suficiente; se, na implementação, o teclado numérico do campo de quitação parcial cobrir o seletor de pills imediatamente acima, pode ser necessário um ajuste fino de scroll automático (`scrollTo` ao focar o campo) — comportamento a validar durante a implementação, não uma decisão de layout deste documento.

---

## 9. Checklist de handoff (Frontend Readiness)

- [x] Diagnóstico da hierarquia atual documentado com referência de linha exata do código-fonte
- [x] Novo agrupamento de campos definido (4 grupos), sem adicionar/remover nenhum campo
- [x] Ordem de preenchimento revisada conforme critério de aceite (quem/o quê → quanto/quando → situação → observações)
- [x] Textos e labels revisados com justificativa por item (seção 4)
- [x] Hierarquia visual das ações avaliada — mantém convenção já usada no restante do arquivo, com reforço opcional de ícone
- [x] Nenhum token novo introduzido; ajustes de estilo documentados como composição de tokens já existentes (seção 5)
- [x] Responsividade confirmada sem necessidade de breakpoint novo
- [x] Acessibilidade — pontos de melhoria pontuais listados (seção 7), sem novo padrão de interação
- [x] Achados fora de escopo registrados para decisão de fluxo (seção 8), não implementados aqui
- [ ] Validação visual em dispositivo/simulador após implementação (responsabilidade de quem implementar)

---

## 10. Encaminhamento

Este documento está pronto para ser usado como especificação de implementação do formulário de pagamento (`paymentForm`, `apps/agendae/app/payments.tsx`). Nenhuma alteração de código foi feita. Recomenda-se que a implementação:

1. Reestruture o JSX do bloco `paymentForm` (linhas 495-744) nos quatro grupos da seção 3.1, sem alterar nenhuma lógica de estado (`useState`, validação em `savePayment`, `disabledStatusReason`).
2. Atualize o `StyleSheet` conforme seções 3.8/3.9/5, removendo o uso de `sectionHeader`/`sectionTitle`/`sectionText` em favor do padrão de cabeçalho de modal já existente.
3. Avalie a remoção dos estilos órfãos identificados em 1.2.1 (`formCard`, `mainGrid`, `summaryCard`, `sectionIcon`) caso confirmado que não são usados em nenhum outro ponto do arquivo — limpeza de código, não obrigatória para este handoff, mas recomendada por reduzir ruído no `StyleSheet`.
4. Trate o achado da seção 8, item 1, como pendência a esclarecer antes ou durante a implementação, não como algo a resolver silenciosamente por conta própria.
