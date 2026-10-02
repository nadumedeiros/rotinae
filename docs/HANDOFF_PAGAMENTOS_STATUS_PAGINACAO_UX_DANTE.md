# Handoff — UX de status financeiros (Atrasado/Cancelado) e paginação real em `payments.tsx`

> Responsável por este documento: Dante (arquitetura de experiência)
> Preparado em: 11/08/2026
> Destinatário: ADA (wiring de frontend)
> Origem: dois achados de QA do Leon sobre `apps/agendae/app/payments.tsx`, no contexto da frente de governança retroativa de `manual_payments` (DEC-092 a DEC-099, `BLG-047`)
> Estado: **Proposta de arquitetura de experiência — pendente de formalização em `BACKLOG.md` pelo Virgil** (ver seção 8). Não é handoff aprovado; a Ada não deve iniciar a implementação antes dessa formalização, salvo indicação em contrário do usuário.

## 1. Objetivo

Fechar, com decisão de UX rastreável, dois achados de QA sobre `apps/agendae/app/payments.tsx`:

1. **[Alto]** A tela só expõe 2 dos 4 status do domínio (`Pendente`/`Recebido`), deixando `RF-FIN-002` ("Alterar status entre Pendente, Pago, Atrasado e Cancelado com auditoria") incompleto na prática, apesar de o backend já suportar os 4 estados desde DEC-092/093.
2. **[Médio]** `fetchAllPayments()` busca todas as páginas do histórico via loop antes de renderizar, anulando o ganho de performance da paginação real implementada em `SupabasePaymentAdapter.listPayments` (DEC-098/099) — mesmo padrão problemático já existente em `clients.tsx` (`loadPortfolio`).

Este documento define o fluxo, os estados, as regras de habilitação/desabilitação e os critérios de aceite para a ADA implementar. Não define UI visual final (papel de Nero) nem código (papel de ADA).

## 2. O que já existe e este handoff não reabre

- `PaymentStatus` no domínio (`apps/agendae/src/domain/payments/types.ts`): `"pending" | "received" | "overdue" | "cancelled"` — 4 estados, já persistidos e auditados pelo backend (DEC-092/093).
- `updatePayment(id, input)` já aceita qualquer um dos 4 status via `UPDATE` comum, com auditoria de mudança de status (`manual_payments_audit_status_change`, DEC-093).
- `registerPartialPayment` já bloqueia quitação parcial sobre pagamento `cancelled` (`PAYMENT_CANCELLED`) e sobre pagamento já `received` (`PAYMENT_ALREADY_SETTLED`) — DEC-094. Reabrir uma cobrança cancelada **não é suportado**; se algum dia for necessário, é um fluxo deliberado e explícito (ex.: criar novo lançamento), nunca um efeito colateral (DEC-094).
- `deletePayment` já rejeita a exclusão de uma `charge` que tem `receipt` filho (`PAYMENT_HAS_RECEIPTS`, FK `on delete restrict`, DEC-099) — mas isso vale só para **exclusão física**, não para mudança de status. `updatePayment` não tem hoje nenhuma trava equivalente contra cancelar uma cobrança que já recebeu quitação parcial (ver seção 4.4, achado técnico registrado, não decidido aqui).
- `SupabasePaymentAdapter.listPayments` já implementa paginação real no Postgres (`range()`/`count: "exact"`), aceitando `{ page, pageSize: 10 }` e retornando `{ items, page, pageSize, totalItems, totalPages }` (DEC-098/099). `PaymentListInput` **não tem** filtro de período — só `page`/`pageSize`.
- O widget de paginação da tela ("Anterior"/"Próxima", "Página X de Y", "N–M de Total") já existe e já é usado por `visiblePayments`/`visibleClients` — nenhum componente novo de paginação precisa ser criado.
- Padrões de interação de referência já estabelecidos e reaproveitados neste handoff: `agenda.tsx` já tem (a) um `statusSelector` inline de **4 opções** com `flexWrap: "wrap"` dentro do formulário de edição, e (b) botões de ação rápida por linha (`Confirmar manualmente`, `Cancelar agendamento`) que abrem um modal de confirmação (`confirmModal`) antes de aplicar a mudança de status.

## 3. Problema 1 — Status "Atrasado" e "Cancelado" na interface

### 3.1 Decisão: dois pontos de entrada, coerentes com o que já existe na própria tela e em `agenda.tsx`

Nenhuma tela do projeto usa swipe ou menu contextual (long-press) para mudar status — o padrão estabelecido é: **(a)** um seletor de situação dentro do formulário de edição para qualquer transição, e **(b)** botões de ação rápida por linha, com confirmação, para as duas transições que têm peso ou frequência de uso alta (`agenda.tsx`: confirmar manualmente e cancelar). Este handoff replica exatamente esse padrão em `payments.tsx`, sem inventar um mecanismo de interação novo.

**(a) Seletor de situação do formulário (`paymentForm`) passa de 2 para 4 opções.**

- Hoje: `(["Pendente", "Recebido"] as PaymentStatus[])`, `flexDirection: "row"`, sem `flexWrap`.
- Novo: `(["Pendente", "Recebido", "Atrasado", "Cancelado"] as PaymentStatus[])`, reaproveitando o mesmo `statusOption`/`statusOptionActive` já existente, com ícone por opção (mesmo padrão que já existe hoje para as 2 primeiras):
  - Pendente → ícone `schedule` (já usado hoje).
  - Recebido → ícone `success` (já usado hoje).
  - Atrasado → ícone `warning`.
  - Cancelado → ícone `error` (mesmo ícone já usado por `agenda.tsx` no botão de cancelar agendamento).
- **Mudança de layout necessária:** adicionar `flexWrap: "wrap"` ao `styles.statusSelector` de `payments.tsx` (hoje ausente), replicando exatamente o `statusSelector` de `agenda.tsx` (que já resolve 4 opções com `flexWrap: "wrap"` + `flexGrow: 1` por opção). Sem isso, 4 pills com ícone+texto não cabem em uma única linha em viewports de 320–414px. Resultado esperado: 2×2 em mobile, uma linha em telas largas — mesmo comportamento observável hoje no seletor de 4 status de `agenda.tsx`.

**(b) Ações rápidas por linha, só para as duas transições que Leon apontou como ausentes, mesmo padrão de `agenda.tsx`:**

- **"Marcar como atrasado"** — ícone `warning`, cor `colors.danger`. Visível apenas quando `item.status === "Pendente"` e `item.kind !== "receipt"`.
- **"Cancelar cobrança"** — ícone `error`, cor `colors.danger` (mesmo ícone/cor já usados por `agenda.tsx` no botão "Cancelar agendamento"). Visível apenas quando `item.status` é `"Pendente"` ou `"Atrasado"` (nunca sobre algo já `Recebido` ou já `Cancelado`) **e** `item.kind !== "receipt"` **e** o pagamento não tem nenhum `receipt` filho (ver 3.3).
- Local: mesma coluna de ações do desktop (`paymentActionColumn`, hoje com `rowEditButton`/`rowDeleteButton`) e mesmo agrupamento do mobile (`mobileActionButtons`), antes de `Editar`/`Excluir` — **precedente direto**: a linha de `agenda.tsx` já mostra até 4 ícones condicionais na mesma coluna (`Confirmar manualmente` + `Cancelar` + `Editar` + `Excluir`), então 4 ícones (`Marcar como atrasado` + `Cancelar cobrança` + `Editar` + `Excluir`) não é um padrão novo de densidade.
- Ambas as ações abrem um modal de confirmação **reaproveitando a estrutura já existente em `payments.tsx`** para excluir (`styles.confirmModal`/`confirmIcon`/`confirmActions`/`cancelButton`), com ícone, título, texto e botão de ação primária próprios — sem criar um componente de modal novo:

| Ação | Ícone/cor do modal | Título | Texto | Botão primário |
|---|---|---|---|---|
| Marcar como atrasado | `warning`, `colors.danger` | "Marcar como atrasado?" | "Esta cobrança será marcada como atrasada. Você pode alterar o status novamente a qualquer momento." | "Marcar como atrasado" — **não** reaproveitar o estilo vermelho `confirmDeleteButton` aqui (a ação não é destrutiva); usar um botão de ênfase neutra/marca (mesma cor de `styles.saveButton`, já existente no formulário). |
| Cancelar cobrança | `error`, `colors.danger` | "Cancelar cobrança?" | "Esta cobrança será cancelada e não poderá receber pagamentos nem ser reaberta. Se precisar cobrar de novo, registre um novo lançamento." — copy alinhada explicitamente ao comportamento já decidido em DEC-094 (sem fluxo de reabertura). | "Cancelar cobrança" — este sim reaproveita `confirmDeleteButton`/`confirmDeleteText` (ação irreversível, mesmo peso visual da exclusão). |

- Depois de confirmar, chamar `updatePayment(id, { status: "overdue" | "cancelled" })` e recarregar a lista (mesmo padrão já usado por `confirmDelete`/`savePayment`). Nenhuma chamada a `registerPartialPayment` é envolvida nessas duas ações.

### 3.2 Regras de habilitação/desabilitação no seletor do formulário

O seletor de 4 opções deve **desabilitar visualmente** (opacidade reduzida via token `opacity.disabled`, `accessibilityState={{ disabled: true }}`, sem removê-la da tela) combinações que não fazem sentido de negócio, em vez de escondê-las — visibilidade do que existe é preferível a esconder (Nielsen #1/#6: o prestador vê os 4 estados possíveis e entende por que um deles não está disponível agora, em vez de estranhar a ausência):

| De → Para | Permitido? | Por quê |
|---|---|---|
| Pendente → Recebido/Atrasado/Cancelado | Sim | Transições normais do fluxo. |
| Atrasado → Recebido/Pendente/Cancelado | Sim | Reversível — reclassificar um atraso não é uma decisão de peso. |
| Recebido → Cancelado | **Desabilitado** | Cancelar algo já recebido não reflete a realidade financeira; se foi um engano, o caminho é editar o valor ou excluir o lançamento, não cancelar. |
| Recebido → Atrasado | **Desabilitado** | Não há sentido em marcar como atrasado algo que já foi pago. |
| Qualquer coisa com `receipt` filho → Cancelado | **Desabilitado** | Ver 3.3. |
| Cancelado → qualquer outro | **Desabilitado** no formulário de edição | DEC-094: reabertura de cobrança cancelada não é suportada; se o formulário permitisse reverter `Cancelado` livremente, contradiria essa decisão sem nenhuma trava correspondente no backend. |

Quando o prestador tenta tocar numa opção desabilitada, reaproveitar o mesmo bloco `errorBox`/`errorText` já existente no formulário (usado hoje para erros de `savePayment`) para explicar o motivo — por exemplo, "Não é possível cancelar: este pagamento já possui recibo de quitação." — em vez de um tooltip (que não existe de forma confiável em touch).

### 3.3 Regra de negócio nova: cobrança com quitação parcial não pode ser cancelada

Um pagamento (`kind: "charge"`) que já tem pelo menos um `receipt` filho (`parentPaymentId` de outro registro apontando para ele) não deve poder ser marcado como `Cancelado` — total ou parcialmente quitado, cancelar contradiz o dinheiro que já mudou de mãos. Se o prestador precisar corrigir um engano, o caminho é editar o valor/observações do lançamento, não cancelá-lo.

- **Nova regra de negócio a formalizar (RN-FIN, número a definir pelo Virgil):** "Uma cobrança (`kind = charge`) que possui ao menos um recibo de quitação (`kind = receipt` com `parent_payment_id` apontando para ela) não pode ser marcada como `Cancelado`."
- **Achado técnico registrado, não decidido aqui:** hoje essa regra só existe se a UI a aplicar (desabilitando a opção) — `updatePayment` não tem nenhuma trava no banco equivalente à FK `on delete restrict` usada para bloquear a exclusão (`PAYMENT_HAS_RECEIPTS`, DEC-099). Ou seja, a proteção proposta neste handoff é só de UI; um `UPDATE` direto (ou uma tela futura) ainda poderia cancelar uma cobrança com recibo. Fica registrado como achado para avaliação do Chris (equivalente a uma validação de domínio na própria função/trigger, análoga à checagem de `status = 'cancelled'` que `register_manual_partial_payment` já faz na direção oposta, DEC-094) — **fora do escopo deste handoff de UX**.
- **Pré-requisito de dado para a Ada:** a tela hoje descarta `parentPaymentId` ao montar `PaymentRecord` local (`records.map(...)` em `loadPayments`, linha ~307-321 de `payments.tsx`) — só usa `kind`. Para a UI decidir "esta cobrança tem recibo filho", é preciso: (a) incluir `parentPaymentId` no tipo local `PaymentRecord` e no mapeamento, e (b) computar, para cada `charge`, se existe algum item na lista com `kind === "receipt" && parentPaymentId === item.id`. Isso só funciona de forma confiável quando o conjunto completo de pagamentos do período está em memória — ver seção 4, decisão de carregamento progressivo, que mantém esse conjunto disponível.

### 3.4 Badge visual dos 4 status — decisão de token de cor

| Status | Fundo | Texto/ícone | Ícone |
|---|---|---|---|
| Pendente | `colors.warningSoft` | `colors.warning` | `schedule` (inalterado) |
| Recebido | `colors.successSoft` | `colors.success` | `success` (inalterado) |
| Atrasado | `colors.dangerSoft` | `colors.danger` | `warning` |
| Cancelado | `colors.surfaceSubtle` | `colors.muted` | `error` |

**Justificativa e nota de divergência deliberada:** `agenda.tsx` usa `dangerSoft`/`danger` para o badge de "Cancelado" de agendamentos. Este handoff **não** replica essa cor para "Cancelado" em pagamentos, porque aqui o vermelho já está reservado para "Atrasado" — o estado que de fato exige atenção/ação do prestador (dinheiro que deveria ter entrado e não entrou). Reaproveitar vermelho também para "Cancelado" tornaria os dois badges visualmente indistinguíveis num scan rápido da lista, exatamente o tipo de ambiguidade que este handoff existe para eliminar. Em vez disso, "Cancelado" segue o precedente de `clients.tsx` para "Inativo" (`surfaceSubtle`/`muted`) — um estado resolvido, sem expectativa financeira pendente, que não deve competir visualmente com "Atrasado". Nenhuma cor nova fora da paleta (`apps/agendae/src/theme/tokens.ts`) é introduzida.

Nota: os ícones das ações rápidas (`Marcar como atrasado`, `Cancelar cobrança`) usam `colors.danger` mesmo quando o badge resultante ("Cancelado") não usa mais essa cor — isso é intencional e consistente com o resto do app (o ícone do botão "Excluir", por exemplo, é sempre vermelho independentemente da cor do item que ele afeta). Cor do botão de ação ≠ cor do badge de estado resultante.

### 3.5 Fluxo estrutural

```
Lista de pagamentos (histórico)
 ├─ Linha com status "Pendente"
 │    ├─ [Marcar como atrasado] → confirmação → updatePayment(status: "overdue") → badge muda para Atrasado
 │    ├─ [Cancelar cobrança] (só se sem receipt filho) → confirmação → updatePayment(status: "cancelled") → badge muda para Cancelado
 │    ├─ [Editar] → formulário com seletor de 4 status (ver 3.2 para regras de desabilitação)
 │    └─ [Excluir] → confirmação existente (inalterada)
 ├─ Linha com status "Atrasado"
 │    ├─ [Cancelar cobrança] (só se sem receipt filho) → mesma confirmação acima
 │    ├─ [Editar] → seletor de 4 status
 │    └─ [Excluir] → inalterado
 ├─ Linha com status "Recebido"
 │    └─ Nenhuma ação rápida nova; [Editar]/[Excluir] inalterados (Cancelado desabilitado no seletor do formulário, ver 3.2)
 └─ Linha com status "Cancelado"
      └─ Nenhuma ação rápida nova; [Editar] abre formulário com "Cancelado" já selecionado e as demais opções desabilitadas (ver 3.2); [Excluir] inalterado
```

### 3.6 Correção factual necessária em DEC-095 (não decidida aqui — ver seção 8)

DEC-095 concluiu que RF-FIN-002 "já [estava] integralmente satisfeita pelo `updatePayment` implementado em DEC-092/093" e que "nenhuma implementação nova [seria] exigida". Essa conclusão está correta apenas na camada de **backend** (o método `updatePayment` de fato aceita qualquer um dos 4 status). Mas na camada de **interface**, `payments.tsx` só expõe 2 dos 4 status — o prestador não tem, hoje, nenhuma forma de exercer a alteração para "Atrasado" ou "Cancelado" na prática. Ou seja, RF-FIN-002 não estava de fato satisfeito de ponta a ponta quando DEC-095 foi registrada; a análise de DEC-095 tratou "o contrato aceita" como equivalente a "o requisito está cumprido", sem verificar a tela. Este handoff fecha essa lacuna do lado de UI; a correção do registro histórico de DEC-095 fica para o Virgil (seção 8).

## 4. Problema 2 — Paginação real na interface

### 4.1 Por que a solução "óbvia" (página real por clique, filtro só na página atual) não se sustenta sozinha aqui

Diferente de `clients.tsx` (que não tem conceito de período), a seção "Pagamentos registrados" de `payments.tsx` é **sempre** filtrada por período (`periodFilter`, com padrão "mês atual") — o período não é um filtro opcional que fica "desligado" por padrão como a busca (`paymentQuery`, vazio por padrão) ou o filtro de status (`paymentFilter`, "Todos" por padrão). `RF-FIN-003` ("Exibir resumo de valores por status e período") também exige esse recorte por período para o resumo (KPIs).

`PaymentListInput` só aceita `{ page, pageSize }` — sem filtro de período. Isso significa que uma página pedida diretamente ao servidor (`listPayments({ page: N, pageSize: 10 })`) traria uma fatia arbitrária do histórico **inteiro** do tenant (ordenado por `created_at desc`), não do período selecionado — quebrando a navegação por período que já existe e é usada por padrão em toda visita à tela. Migrar isso para o servidor (adicionar filtro de período/agregação ao contrato) é uma mudança de arquitetura de backend, fora do que me foi delegado nesta rodada — fica registrada como recomendação de follow-up para o Chris (seção 4.4), não implementada aqui.

Dado isso, a opção "paginação real só quando não há filtro/busca ativos" proposta como referência não se aplica de forma limpa a `payments.tsx`, porque, na prática, o período está **sempre** ativo — o modo de "paginação real sem filtro" quase nunca seria alcançado. Isso é diferente do achado equivalente em `clients.tsx`, que não tem essa complicação (fora do escopo desta tarefa, mas registrado para não ser copiado sem ajuste caso o mesmo padrão seja revisado lá).

### 4.2 Decisão: carregamento progressivo, sem mudar nenhuma regra de filtro/busca/período existente

Em vez de mudar o que é filtrado (o que teria impacto de produto real — ver seção 4.5), a mudança recomendada nesta rodada é em **como e quando** os dados chegam à tela, resolvendo o problema real por trás do achado do Leon (a tela trava numa espera que cresce com o histórico) sem alterar nenhum resultado de busca/filtro/KPI:

1. **Primeira página chega rápido e a tela já é usável.** `loadPayments()` busca a página 1 (`listPayments({ page: 1, pageSize: 10 })`), popula `payments` com esse primeiro lote e encerra `loadingPayments` — a tabela já renderiza com dados reais, e o total de páginas/itens (`totalItems`/`totalPages`, vindos de `count: "exact"` já na primeira resposta) já é conhecido nesse momento.
2. **As páginas restantes continuam chegando em segundo plano**, uma de cada vez (sequencial, não `Promise.all` disparando todas de uma vez como hoje — isso também reduz o pico de requisições simultâneas conforme o histórico cresce, uma melhoria de implementação independente da UX). Um novo estado (ex.: `reconcilingHistory`) fica `true` enquanto isso acontece.
3. **Enquanto `reconcilingHistory` é `true`:** os KPIs (`Valores recebidos`, `Valores a receber`, `Total de pendentes`) e a contagem "N lançamento(s) encontrado(s)" mostram um indicador leve de que ainda estão sendo consolidados (ex.: um pequeno spinner substituindo o valor, ou o valor parcial com uma etiqueta "calculando…" ao lado) — nunca um estado vazio nem um número que pareça definitivo e depois "pule" sem explicação (Nielsen #1, visibilidade do status). A tabela e a paginação continuam interativas nesse meio-tempo (nunca travar a navegação por causa de um cálculo em segundo plano — Nielsen #3, controle do usuário).
4. **Busca (`paymentQuery`) e filtro de status (`paymentFilter`) continuam funcionando exatamente como hoje**, sobre o conjunto em memória (`payments`), que vai crescendo progressivamente. Se o prestador buscar antes da consolidação terminar, o resultado reflete o que já chegou até aquele momento — mostrar, junto ao contador de resultados, a mesma indicação de "calculando…" citada acima evita que isso pareça um bug ("por que meu cliente não aparece?") em vez de um carregamento em andamento.
5. **Falha parcial:** se uma página em segundo plano falhar, reaproveitar o `stateBanner`/`historyError` já existente, mas com texto que deixe claro que os dados exibidos podem estar incompletos (ex.: "Não foi possível carregar todo o histórico. Os valores exibidos podem estar incompletos.") e manter o botão "Tentar novamente" já existente (que dispara um novo `loadPayments()` completo).

Esta mudança não altera **o que** é mostrado (mesmos filtros, mesmo período, mesmos KPIs, mesmo resultado final) — só **quando** cada parte fica disponível, trocando "tela travada até o histórico inteiro chegar" por "tela utilizável desde a primeira resposta do servidor, com o restante consolidando visivelmente em segundo plano". É uma mitigação real e honesta do sintoma que cresce com o volume (a espera bloqueante), sem fingir resolver o custo de rede total, que só cai de fato com um filtro de período no backend (seção 4.4).

### 4.3 Critérios de aceite para a ADA (Problema 2)

- A tabela/lista renderiza com dados reais assim que a página 1 chega do servidor, sem esperar pelo histórico completo.
- `totalItems`/`totalPages` da primeira resposta alimentam o rótulo "Página X de Y" e "N–M de Total" imediatamente — não são mais derivados de `Math.ceil(filteredPayments.length / pageSize)` sobre um array ainda incompleto.
- As páginas restantes são buscadas sequencialmente (uma requisição em voo por vez), nunca todas em paralelo via `Promise.all` como hoje.
- KPIs e a contagem de "lançamentos encontrados" exibem um indicador não bloqueante de "calculando/atualizando" enquanto `reconcilingHistory` é `true`, e nenhum número exibido antes da consolidação é tratado como final (nenhum "salto" silencioso e confuso de valor).
- Busca, filtro de status e seletor de período continuam produzindo exatamente os mesmos resultados de hoje uma vez que a consolidação em segundo plano termina — nenhuma mudança de comportamento de filtro é introduzida por este handoff.
- Falha ao buscar uma página em segundo plano não derruba a tela nem os dados já carregados; usa o banner de erro já existente com texto ajustado para deixar claro que os dados podem estar incompletos.
- Criar, editar, excluir ou mudar status de um pagamento (seção 3) continua recarregando a lista pelo mesmo mecanismo (`loadPayments()`), preservando o carregamento progressivo.

### 4.4 Recomendação de follow-up, fora do escopo desta rodada (para o Chris avaliar)

A causa raiz do custo de rede que só tende a crescer é a ausência de um filtro de período (ou de um endpoint de resumo agregado) em `PaymentPort`. Recomendo abrir um novo item de backlog para o Chris avaliar, quando o volume justificar:

- Estender `PaymentListInput` com um filtro de período (ex.: `dueDateFrom`/`dueDateTo` ou `year`/`month`), permitindo que `listPayments` retorne, de fato, só a fatia do período selecionado — o que tornaria a paginação real de página-por-clique (sem o carregamento progressivo desta seção) finalmente possível para o caso comum (mês/ano selecionado).
- Alternativamente ou em conjunto, um método de resumo agregado calculado no Postgres (ex.: `getPaymentsSummary({ period })`) para os três números de KPI, em vez de somá-los no cliente sobre o histórico inteiro — mesmo espírito do snapshot server-side já implementado para a Home (`DashboardPort`, `BLG-046`).

Nenhuma dessas duas mudanças é decidida ou implementada por este handoff — ambas exigem alterar o contrato/backend, fora da minha alçada nesta rodada.

### 4.5 Decisão de produto que NÃO tomei sozinho — preciso de validação do usuário

Cheguei a considerar uma alternativa mais agressiva: fazer a tabela ("Pagamentos registrados") parar de obedecer ao filtro de período, deixando o período escopar **só** os KPIs (que são, pela própria redação de `RF-FIN-003`, "resumo... por período") — e transformar a tabela numa lista paginada de verdade, independente de período, com busca/status como únicos filtros. Isso tornaria a paginação real de página-por-clique tecnicamente viável sem esperar por mudança de backend.

**Não tomei essa decisão sozinha** porque ela muda um comportamento visível e hoje intencional (o rótulo "Pagamentos registrados" e sua contagem já são filtrados pelo período selecionado, e um prestador pode legitimamente esperar ver, por exemplo, "os atrasados de agosto" ao trocar o período) — é uma mudança de produto, não só uma correção técnica de paginação. Se o usuário confirmar que a tabela pode deixar de ser escopada por período (mantendo o período só para os KPIs), esse seria o caminho recomendado para uma paginação real de página-por-clique sem depender de nenhuma mudança de backend; caso contrário, a recomendação desta seção 4.4 (filtro de período no backend) é o único caminho para paginação real de página-por-clique preservando o comportamento atual da tabela.

## 5. Componentização (inventário de reaproveitamento)

Nenhum átomo, molécula ou organismo novo é necessário.

| Componente/padrão | Uso nesta entrega |
|---|---|
| `statusSelector`/`statusOption`/`statusOptionActive` (já existente em `payments.tsx`, com precedente de 4 opções em `agenda.tsx`) | Seletor de situação do formulário, estendido de 2 para 4 opções, com `flexWrap: "wrap"` adicionado. |
| `confirmModal`/`confirmIcon`/`confirmActions`/`cancelButton`/`confirmDeleteButton` (já existente em `payments.tsx`, usado hoje só para excluir) | Reaproveitado para os dois novos modais de confirmação (marcar como atrasado, cancelar cobrança). |
| `rowEditButton`/`rowDeleteButton`/`mobileActionButtons` (já existente) | Recebem os dois novos botões de ação rápida condicionais, mesmo padrão de `agenda.tsx`. |
| `listStatus`/`listStatusText` (já existente) | Estendido com duas variantes novas (`listStatusOverdue`, `listStatusCancelled`), tokens de cor listados na seção 3.4. |
| `errorBox`/`errorText` (já existente no formulário) | Reaproveitado para explicar por que uma opção do seletor de status está desabilitada. |
| `stateBanner`/`historyError`/botão "Tentar novamente" (já existente) | Reaproveitado para falha parcial de carregamento em segundo plano (seção 4.2, item 5). |
| Widget de paginação "Anterior"/"Próxima"/"Página X de Y" (já existente) | Passa a refletir `totalItems`/`totalPages` reais vindos do servidor assim que a primeira página chega, sem nenhum componente novo. |

## 6. Heurísticas e acessibilidade aplicadas

- **Nielsen #1 — Visibilidade do status:** indicador de "calculando/atualizando" nos KPIs e na contagem de resultados enquanto o histórico é consolidado em segundo plano; badges de status sempre visíveis e distinguíveis por cor+ícone (nunca só por cor, para não depender de percepção de cor).
- **Nielsen #3 — Controle do usuário:** busca, filtro e paginação continuam interativos durante o carregamento em segundo plano; nenhuma ação de mudança de status é aplicada sem confirmação explícita quando ela é irreversível (cancelar) ou historicamente relevante (marcar como atrasado).
- **Nielsen #5 — Prevenção de erros:** opções de status que não fazem sentido dado o estado atual do pagamento ficam desabilitadas (não escondidas) no seletor do formulário, com explicação; ação de cancelar exige confirmação com texto que já avisa, antes do fato, que a ação não pode ser desfeita (DEC-094).
- **Nielsen #4/#6 — Consistência e reconhecimento:** todos os padrões de interação (seletor de status, botões de ação rápida por linha, modal de confirmação) já existem em `agenda.tsx`/`payments.tsx` e são reaproveitados sem variação; nenhum mecanismo novo de interação é introduzido.
- **Acessibilidade:** `accessibilityState={{ disabled: true }}` nas opções desabilitadas do seletor; `accessibilityLabel` descritivo em cada novo botão de ação rápida (ex.: "Marcar pagamento de {cliente} como atrasado", "Cancelar cobrança de {cliente}"), mesmo padrão já usado pelos botões de editar/excluir existentes; contraste dos novos badges (`dangerSoft`/`danger` e `surfaceSubtle`/`muted`) já validado em outros usos desses mesmos pares de token no app (WCAG AA); indicador de "calculando" nos KPIs deve ser perceptível por leitor de tela (texto companheiro, não só um spinner visual), mesmo cuidado já aplicado ao estado "verificando sessão" do handoff de recuperação de senha (`docs/HANDOFF_RECUPERACAO_SENHA_UX_DANTE.md`, seção 8).

## 7. Riscos e achados técnicos registrados, não decididos aqui

1. **Cancelar não tem trava de banco equivalente à de excluir (seção 3.3).** A proteção "não cancelar cobrança com recibo filho" proposta aqui é só de UI; recomendo avaliação do Chris para uma trava de domínio equivalente.
2. **Filtro de período ausente no contrato de `listPayments` (seção 4.1/4.4).** Bloqueia paginação real de página-por-clique enquanto o período estiver sempre ativo por padrão; recomendado como follow-up de backend, não decidido aqui.
3. **Decisão de produto pendente (seção 4.5):** se a tabela pode parar de ser escopada por período, mantendo o período só para os KPIs — não decidido, precisa de confirmação explícita do usuário antes de qualquer implementação nessa direção.
4. **Correção factual de DEC-095 (seção 3.6):** a conclusão "RF-FIN-002 já satisfeita, nenhuma implementação nova exigida" precisa ser corrigida/complementada — a lacuna estava na interface, não no backend. Não editei `BACKLOG.md` para isso; ver seção 8.

## 8. Registro em BACKLOG.md

**Não registrei uma nova entrada `DEC-NNN` em `BACKLOG.md` nesta rodada.** Motivo: a decisão de UX proposta aqui está entrelaçada com uma correção factual necessária em `DEC-095` (seção 3.6), que foi uma análise de requisitos do Virgil — não me pareceu apropriado, como agente de UX, reescrever ou complementar unilateralmente o registro histórico de uma decisão de outro agente. Recomendo que o usuário acione o Virgil para:

1. Formalizar a arquitetura de experiência deste handoff como uma nova `DEC-NNN` (`Proposta`, não `Aprovada`, até validação explícita do usuário — mesmo padrão de `DEC-075`/`docs/HANDOFF_RECUPERACAO_SENHA_UX_DANTE.md`).
2. Corrigir/complementar `DEC-095` com uma nota factual equivalente às já usadas em `BACKLOG.md` para atualizações de estado (ex.: a nota de DEC-079–080 sobre `BLG-044`), deixando explícito que a satisfação de `RF-FIN-002` dependia também da interface, não só do backend.
3. Decidir os dois pontos em aberto que não me cabe decidir sozinho (RN-FIN de cancelamento com recibo filho, seção 3.3, e a pergunta de produto da seção 4.5).

Nenhuma implementação deve começar antes dessa formalização, exceto se o usuário instruir diretamente o contrário.
