# Handoff — UX de cancelamento de agendamento pelo cliente e restrição do "Excluir" no app do prestador

| **Data** | **Versão** | **Descrição** | **Projeto** | **Cliente** |
|---|---|---|---|---|
| 14/08/2026 | 1.1 | Criação do documento (seções 1–12: ação "Cancelar" do cliente em `client-home.tsx` e restrição do "Excluir" do prestador em `agenda.tsx`, DEC-148/BLG-090/BLG-091). Adenda pós-DEC-150 (seção 13): estado bloqueado do cancelamento pelo cliente dentro da janela de 24h, orientação para contatar o prestador e tratamento do erro de servidor `CANCELLATION_ADVANCE_NOTICE_INVALID` (BLG-092). | Rotinaê | Equipe Rotinaê |

> Preparado para: ADA (wiring de frontend)
> Origem: DEC-146/DEC-147 (análise de requisitos), BLG-090/BLG-091
> Estado: **Proposta de arquitetura de experiência — pendente de aprovação explícita do usuário (ver seção 9).** A ADA não deve iniciar a implementação antes dessa aprovação, salvo indicação em contrário do usuário.

## 1. Objetivo

Fechar, com decisão de UX rastreável, os dois itens que DEC-146/DEC-147 deixaram para uma rodada de experiência:

1. **BLG-090** — dar ao cliente uma ação de "Cancelar agendamento", hoje inexistente em qualquer tela do app do cliente, reaproveitando `appointmentService.cancelAppointment`/RPC `cancel_appointment`, já genéricos e já auditados para o ator cliente (DEC-146).
2. **BLG-091** — comunicar, na tela do prestador (`app/agenda.tsx`), a restrição do botão "Excluir agendamento" a agendamentos sem identidade de cliente vinculada (`client_id` nulo ou cliente sem `client_user_id`), sem deixar o prestador sem explicação para uma ação que ele via antes e deixou de ver.

Este documento define fluxo, estados, textos e critérios de aceite. Não define UI visual final (papel de Nero, se acionado) nem código (papel da ADA).

## 2. O que já existe e este handoff não reabre

- `cancel_appointment(p_id, p_reason default null)` já resolve o papel do chamador (`profiles.role`), valida ownership do cliente (`clients.client_user_id = auth.uid()`), bloqueia cancelamento pelo cliente após o início do horário, aceita motivo opcional e dispara `notify_appointment_change` bidirecional — nada disso é reaberto aqui (DEC-146).
- `AppointmentPort.cancelAppointment(id, input?: CancelAppointmentInput)` já é chamável de qualquer tela autenticada, cliente ou prestador, sem alteração de contrato.
- `RN-CAN-008` (motivo opcional) / `RN-CAN-009` (sem antecedência mínima para o cliente, só o prestador decide o desfecho após o início do horário) / `RN-CAN-010` (prestador só cancela agendamento ainda no estado Agendado) / `RN-CAN-011` (sem efeito automático sobre `manual_payments`) já formalizadas em `docs/REGRAS_DE_NEGOCIO_MVP.md` v0.7.0 — este handoff aplica essas regras na interface, não as redefine.
- `RN-CAN-012–014` (exclusão definitiva restrita a agendamento sem identidade de cliente vinculada) já formalizadas no mesmo documento — este handoff só decide *como comunicar* essa restrição, não *se* ela existe.
- Padrão visual de referência já estabelecido em `app/agenda.tsx`, reaproveitado neste handoff sem variação: card de agendamento com badge de status, coluna de ações com ícones condicionais por status (`Confirmar manualmente`, `Cancelar agendamento`, `Editar`, `Excluir`), e modal de confirmação (`confirmModal`/`confirmIcon`/`confirmTitle`/`confirmText`/`confirmActions`/`cancelButton`/`confirmDelete`) com campo de motivo opcional já implementado exatamente para o cancelamento pelo prestador (linhas 2696–2755). O texto "Confirmar cancelamento" / "Voltar" já existe nesse modal e é reaproveitado literalmente.
- Padrão visual de referência do lado do cliente: `app/client-booking.tsx` já tem um modal informativo de "não é possível fazer isso agora" (`exception`, ícone `warning`/`colors.warning`, título "Revise o agendamento", botão único "Entendi", linhas 796–819) e um modal de sucesso (`successOpen`, ícone `success`/`colors.success`, botão único "Concluir", linhas 820–851) — ambos reaproveitados neste handoff.

## 3. Levantamento das superfícies candidatas no app do cliente

Releitura confirma que hoje existem exatamente três telas do lado do cliente: `client-home.tsx`, `client-booking.tsx` e `client-providers.tsx`.

| Tela | O que já faz hoje | Serve para hospedar "Cancelar agendamento"? |
|---|---|---|
| `client-booking.tsx` | Fluxo de **criação** de novo agendamento: escolher prestador → dia → horário → adicionar a uma seleção (`plannedSlots`, estado local não persistido) → revisar → confirmar. Não existe, em nenhum ponto desta tela, uma listagem dos agendamentos **já confirmados** do cliente — `plannedSlots` é descartado ao confirmar e a tela não busca agendamentos existentes. | **Não.** Não há aqui nenhum registro de agendamento real ao qual anexar uma ação de cancelamento; seria necessário construir do zero uma listagem que não existe, o que contradiz a tela ser uma tela de "novo agendamento", não de "meus agendamentos". |
| `client-home.tsx` | Painel "Próximos atendimentos" (seção `appointmentsPanel`), populado por `appointmentService.listAppointments({ month, state: "scheduled" })` para o mês atual + próximo, filtrado por `startsAt >= now` e ordenado (DEC-145/BLG-089). Cada item já é um `HomeAppointment` real com `id`, hoje exibido só como leitura (data, hora, título, badge de status), sem nenhuma ação. | **Sim.** É a única tela do cliente que já lista agendamentos reais e individualmente endereçáveis por `id`. |
| `client-providers.tsx` | Gestão de vínculos com prestadores (código de convite, lista de vínculos ativos/pendentes). Não lista agendamentos. | Não aplicável. |

**Decisão: a ação "Cancelar agendamento" mora exclusivamente no painel "Próximos atendimentos" de `client-home.tsx`**, em cada card da lista. Não é criada nenhuma tela nova, nem uma segunda superfície em `client-booking.tsx` — o cliente já está proposital e exclusivamente na tela de listagem quando o cancelamento faz sentido, e duplicar a ação em duas telas violaria consistência sem ganho (Nielsen #4).

### 3.1 Simplificação que a própria consulta já garante

Como a consulta de `loadHome()` já filtra `state: "scheduled"` **e** `startsAt >= now`, todo item hoje exibido em "Próximos atendimentos" é, por construção, um agendamento que ainda não começou e ainda está no estado Agendado. Isso significa que — diferente do botão "Cancelar" do prestador em `agenda.tsx`, que precisa checar `item.status !== "Cancelado" && item.status !== "Concluído"` porque a lista dele mistura todos os estados do dia — **o botão "Cancelar agendamento" do cliente não precisa de nenhuma condição de habilitação adicional**: se o item está na lista, ele é cancelável (RN-CAN-009, sem antecedência mínima até o início do horário). Nenhuma lógica de estado nova é necessária além de renderizar o botão em todo item da lista.

### 3.2 O que acontece com o card depois do cancelamento (decisão explícita, pedida pelo usuário)

**Decisão: o card desaparece da lista imediatamente após a confirmação bem-sucedida, sem período de exibição riscada.** Justificativa: a consulta já exclui por definição qualquer coisa que não seja `state: "scheduled"` — manter o card visível "riscado" por um tempo exigiria buscar deliberadamente um registro que a própria query já decide não trazer, alterando o contrato da tela (que é uma prévia de **próximos** atendimentos, não um histórico) sem necessidade. Mecanismo: após `cancelAppointment` retornar com sucesso, fechar o modal de confirmação, mostrar um modal de sucesso curto (seção 5) e then chamar `loadHome()` (mesma função já usada pelo refetch em foco/retorno — nenhum mecanismo novo), que naturalmente já não traz mais o item cancelado.

**Achado registrado, não decidido aqui:** não existe hoje, em nenhuma tela do cliente, uma visão de histórico (atendimentos concluídos/cancelados). Isso significa que, depois de cancelar, o cliente não tem onde conferir "que cancelei mesmo" além do modal de sucesso momentâneo. Não é um requisito deste handoff resolver essa lacuna — registro como possível item de backlog futuro (ex.: aba "Histórico" em `client-home.tsx` ou tela dedicada), fora do escopo de BLG-090.

## 4. Fluxo e wireframe textual — "Cancelar agendamento" no cliente

### 4.1 Card na lista "Próximos atendimentos" (`client-home.tsx`)

Estrutura atual do card (`styles.appointment`/`appointmentMobile`): `dateBox` (dia/mês) → `appointmentCopy` (hora, título do serviço, duração) → `statusBadge` ("A confirmar"/"Confirmado"). Adiciona-se uma área de ação, mesma posição relativa que `agenda.tsx` usa (depois do badge de status):

- **Desktop/tablet (`wide`):** um botão de ação com ícone `error`/`colors.danger` (mesmo ícone e cor já usados por `agenda.tsx` no botão de cancelar) **com rótulo textual** "Cancelar" ao lado do ícone — diferente de `agenda.tsx`, que só usa ícone (porque lá há até 4 ações na mesma linha); aqui há só uma ação, então o rótulo cabe e melhora reconhecimento sobre memorização (Nielsen #6) para um público de cliente final, não profissional, que usa a tela com muito menos frequência que o prestador.
- **Mobile (`!wide`):** o mesmo botão, ocupando a largura disponível abaixo do conteúdo do card, mesmo padrão de bloco de ação secundária já usado em outros cards do app (ex.: linha de ação em `mobileActionButtons`/`manualConfirmAction` de `agenda.tsx`, adaptado para um botão só).
- `accessibilityLabel`: `"Cancelar agendamento de {item.title} em {item.day}/{item.month} às {item.time}"` — dados suficientes para diferenciar cards sem repetir o nome do próprio cliente (que já sabe quem é).

### 4.2 Modal de confirmação de cancelamento (cliente)

Reaproveita integralmente a estrutura já usada por `agenda.tsx` para o cancelamento do prestador (`confirmModal`/`confirmIcon`/`confirmTitle`/`confirmText`/`confirmActions`/`cancelButton`/`confirmDelete`) — `client-home.tsx` ainda não tem esses estilos e precisa declará-los, mas reproduzindo exatamente a composição visual já validada (nenhum mecanismo de interação novo), com textos adaptados à perspectiva do cliente:

| Elemento | Prestador (`agenda.tsx`, referência) | Cliente (`client-home.tsx`, este handoff) |
|---|---|---|
| Ícone | `error`, `colors.danger`, fundo `confirmIcon` padrão | Igual (reaproveitado sem variação) |
| Título | "Cancelar agendamento?" | "Cancelar agendamento?" (idêntico) |
| Texto | "O compromisso continuará no histórico com o status Cancelado e o horário voltará a ficar disponível para novos agendamentos." | "O prestador será notificado do cancelamento. Este atendimento deixará de aparecer nos seus próximos agendamentos." |
| Campo de motivo | Label "Motivo para o cliente (opcional)", placeholder "Ex.: Preciso reorganizar minha agenda" | Label "Motivo para o prestador (opcional)", placeholder "Ex.: Não vou poder comparecer" — mesmo campo `TextInput` multiline, `maxLength={500}`, mesmo texto auxiliar abaixo adaptado: "Esta mensagem será enviada e ficará visível para o prestador." (RN-CAN-008: motivo simétrico ao já usado pelo prestador) |
| Botão secundário | "Voltar" | "Voltar" (idêntico) |
| Botão primário | "Confirmar cancelamento" (`confirmDelete`/`confirmDeleteText`, vermelho — ação irreversível) | "Confirmar cancelamento" (idêntico, mesma cor — mesma natureza irreversível) |

**Estado de carregamento (Nielsen #1):** enquanto a chamada a `cancelAppointment` está em voo, o botão primário fica desabilitado e troca o texto para "Cancelando…", evitando duplo envio — mesmo princípio já aplicado a outros botões de submissão do app (ex.: `sendButton`/`codeSubmitting` em `client-home.tsx`, que já faz exatamente isso para o código de vínculo).

**Estado de erro:** se `cancelAppointment` rejeitar, o modal de confirmação **permanece aberto** (não se fecha nem descarta o motivo já digitado) e exibe uma mensagem inline abaixo do campo de motivo, reaproveitando o mesmo par visual `errorBox`/`errorText` já usado no formulário de `agenda.tsx` para erros de validação — texto: a mensagem de erro retornada pelo adapter, com fallback "Não foi possível cancelar. Tente novamente." Botão primário volta a ficar habilitado para nova tentativa (Nielsen #9, tratamento de erros sem perder o que o usuário já fez).

**Estado de sucesso:** ao confirmar com sucesso, fecha o modal de confirmação e abre um segundo modal, reaproveitando a estrutura de sucesso já existente em `client-booking.tsx` (`successModalIcon`, ícone `success`/`colors.success`, botão único "Concluir"):

- Título: "Agendamento cancelado"
- Texto: "O prestador foi notificado. Este atendimento não aparece mais na sua lista."
- Botão único: "Entendi" — ao pressionar, fecha o modal **e** dispara `loadHome()` (o refetch que efetivamente remove o card, conforme seção 3.2).

## 5. Fluxo estrutural (cliente)

```
Painel "Próximos atendimentos" (client-home.tsx)
 └─ Card de agendamento (sempre cancelável — ver 3.1)
      └─ [Cancelar] → modal de confirmação
           ├─ [Voltar] → fecha modal, nada muda
           └─ [Confirmar cancelamento]
                ├─ sucesso → modal "Agendamento cancelado" → [Entendi] → loadHome() → card não aparece mais
                └─ erro → mensagem inline no próprio modal de confirmação → usuário pode tentar de novo ou [Voltar]
```

## 6. Restrição do "Excluir agendamento" no prestador (`app/agenda.tsx`)

### 6.1 Regra de decisão (herdada de DEC-147, não redecidida aqui)

Por linha (`Appointment` já mapeado por `toUiAppointment`):

- `item.clientId === null` → **Excluir permanece 100% inalterado** (comportamento atual, sem nenhuma mudança visual ou de interação).
- `item.clientId` aponta para um cliente cujo `clientUserId` é `null` (cadastro manual sem conta própria) → **Excluir permanece 100% inalterado.**
- `item.clientId` aponta para um cliente cujo `clientUserId` está preenchido (cliente com conta de verdade) → **Excluir muda de comportamento**, conforme 6.2.

### 6.2 Decisão de comunicação: manter visível, desabilitar a ação, explicar ao toque — não esconder

Decisão explícita, alinhada ao mesmo princípio já usado no handoff de status financeiros (`docs/HANDOFF_PAGAMENTOS_STATUS_PAGINACAO_UX_DANTE.md`, seção 3.2): **visibilidade do que existe é preferível a esconder** (Nielsen #1/#6), e é a opção que melhor atende à preocupação explícita de não confundir o prestador ("cadê o excluir que eu via antes").

- **O ícone "Excluir" continua no mesmo lugar, na mesma posição relativa da coluna de ações, em toda linha** — nunca é removido do layout. Isso é deliberado: esconder o ícone criaria exatamente o "buraco"/estranhamento que o usuário pediu para evitar (a posição espacial que o prestador já memorizou deixaria de ter nada ali). Manter o ícone visível, só mudando sua aparência e comportamento, é a transição menos disruptiva.
- Aparência: opacidade reduzida usando o token já existente `opacity.disabled` (`0.5`), mesmo tratamento visual já usado no handoff de pagamentos para opções desabilitadas de um seletor.
- Comportamento ao toque/clique: **não abre o modal de exclusão definitiva.** Em vez disso, abre um modal informativo curto — reaproveitando exatamente a mesma estrutura já usada por `client-booking.tsx` para seu modal `exception` ("Revise o agendamento": ícone `warning`/`colors.warning`, fundo `modalIconWarning`, um único botão "Entendi") — com o texto:
  - Título: "Este agendamento não pode ser excluído"
  - Texto: "Este cliente tem conta vinculada ao Rotinaê e já pode ver este agendamento. Para removê-lo, use \"Cancelar agendamento\"."
  - Botão único: "Entendi"
- `accessibilityLabel` do ícone nesse estado: `"Excluir indisponível — cliente com conta vinculada; use Cancelar agendamento"` (em vez do rótulo padrão `"Excluir {client}"`), para que um leitor de tela já anuncie o motivo sem exigir a segunda etapa do modal.
- **Não usar `disabled` nativo do `Pressable`** para este estado: `disabled={true}` impediria o `onPress` de disparar, o que impossibilitaria mostrar a explicação. O botão continua tecnicamente pressionável; a "desabilitação" é só visual e de destino (abre explicação, não o fluxo de exclusão) — mesma técnica já usada no handoff de pagamentos para opções de status "desabilitadas" que ainda respondem ao toque para explicar o motivo.

### 6.3 Por que não uma notificação global/banner de mudança de comportamento

Considerei e decido **não** adicionar um banner global único ("Atualização: Excluir agora só funciona para agendamentos sem cliente vinculado") no topo de `app/agenda.tsx`. Motivo: exigiria um mecanismo novo de persistência de "já vi este aviso" (ex.: flag local por usuário, cross-platform Web + Android), que é peso de implementação real para um ganho marginal, quando a explicação por linha (6.2) já é perceptível e justificável exatamente no momento em que o prestador tentaria usar a ação — que é a única situação em que a mudança de comportamento importa de fato. Isso é consistente com o princípio de não expandir escopo sem justificativa clara. Se o usuário achar essa cobertura insuficiente após observar o comportamento real dos prestadores, um banner dispensável é um acréscimo pequeno e independente para uma rodada futura — não decidido nem implementado aqui.

### 6.4 Caso de borda: agendamento Concluído/Cancelado com cliente vinculado

Esclarecimento explícito para a ADA, para não ser reaberto como dúvida durante a implementação: hoje, `agenda.tsx` já só mostra o botão "Cancelar agendamento" quando `item.status !== "Cancelado" && item.status !== "Concluído"` (nenhuma mudança aqui — RN-CAN-010 já restringe o cancelamento pelo prestador a agendamentos ainda no estado Agendado). Combinado com a restrição desta seção, um agendamento **Concluído ou Cancelado com cliente vinculado** fica sem nenhuma ação destrutiva disponível (nem Cancelar, nem Excluir) — só "Editar" (que já não é condicionado por status hoje). **Isto é o comportamento correto, não uma lacuna:** "Excluir" nunca foi desenhado para apagar histórico consolidado (ver achado de DEC-147, comentário original da migration), e um atendimento já concluído não deveria ser removível por nenhuma das duas vias. Nenhuma ação adicional é necessária para este caso além das restrições já decididas.

## 7. Achado técnico que precisa de ajuste para a regra de 6.1 funcionar corretamente (para a ADA avaliar antes de implementar)

`loadReferenceData()` (`agenda.tsx`) hoje busca clientes com `clientPortfolioService.listClients({ status: "active", ... })` — **só clientes ativos**. Um cliente **inativo** que tenha `clientUserId` preenchido (conta vinculada) não apareceria em `clientOptions`, e a lógica "procurar `item.clientId` em `clientOptions` para ler `clientUserId`" **não o encontraria** — tratando erroneamente esse caso como "sem cliente vinculado" e liberando "Excluir" quando não deveria (falha de segurança/privacidade, não só de UX: o cliente inativo ainda pode ter conta e, em tese, ainda enxergar o registro via `appointments_client_view` antes de qualquer desativação de acesso).

**Recomendação para a ADA, dentro do escopo desta implementação (não é mudança de contrato/backend):** ajustar `loadReferenceData()` para buscar clientes **sem filtro de `status`** (o campo já é opcional em `ClientListInput`) ao montar o mapa usado para resolver `clientUserId` por `clientId` — continuando a usar apenas os `status: "active"` para preencher o seletor de cliente do formulário de novo/editar agendamento (`clients`/`filteredClients`), que é uma preocupação diferente (não faz sentido oferecer um cliente inativo como opção para um novo agendamento). Ou seja: duas necessidades diferentes a partir da mesma chamada — passar a buscar a lista completa (ativos + inativos) uma única vez e derivar localmente (a) o array de nomes ativos para o formulário e (b) o mapa `clientId → clientUserId` completo para a regra de exibição do Excluir.

**Melhoria arquitetural recomendada, fora do escopo desta rodada:** o ideal de longo prazo é `AppointmentRecord`/a view `appointments_client_view`/`AppointmentPort.listAppointments` já trazerem um indicador de "tem cliente com conta vinculada" diretamente no registro do agendamento (ex.: `hasLinkedClientAccount: boolean`), eliminando a necessidade de cruzar com uma lista de clientes carregada separadamente e sujeita a filtros incompatíveis como o achado acima. Não decidido nem implementado aqui — fica como recomendação para avaliação futura do Chris, caso o achado acima se repita em outro lugar.

## 8. Componentização (inventário de reaproveitamento)

Nenhum átomo, molécula ou organismo novo é necessário.

| Componente/padrão | Uso nesta entrega |
|---|---|
| `confirmModal`/`confirmIcon`/`confirmTitle`/`confirmText`/`confirmActions`/`cancelButton`/`confirmDelete`/`confirmDeleteText` (já existente em `agenda.tsx`) | Estrutura replicada (não importada entre arquivos — cada tela tem seu próprio `StyleSheet`) em `client-home.tsx` para o modal de confirmação de cancelamento do cliente, com textos adaptados (seção 4.2). |
| `modalIconWarning`/modal de "Revise o agendamento" (`exception`, já existente em `client-booking.tsx`) | Estrutura replicada em `agenda.tsx` para o modal informativo "Este agendamento não pode ser excluído" (seção 6.2). |
| `successModalIcon`/modal de sucesso (já existente em `client-booking.tsx`) | Estrutura replicada em `client-home.tsx` para o modal "Agendamento cancelado" (seção 4.2). |
| `errorBox`/`errorText` (já existente no formulário de `agenda.tsx`) | Reaproveitado para o erro inline do modal de cancelamento do cliente (seção 4.2). |
| Ícone `error`/`colors.danger` (já usado em `agenda.tsx` para "Cancelar agendamento") | Reaproveitado no botão "Cancelar" do card do cliente (seção 4.1). |
| Token `opacity.disabled` (`apps/agendae/src/theme/tokens.ts`) | Aplicado ao ícone "Excluir" quando desabilitado por vínculo de cliente (seção 6.2). |
| `mobileActionButtons`/bloco de ação secundária mobile (já existente em `agenda.tsx`) | Padrão de referência para o botão "Cancelar" em mobile no card de `client-home.tsx` (seção 4.1). |

Nenhuma cor nova fora da paleta (`colors.danger`, `colors.warning`, `colors.success` e seus pares `*Soft`) é introduzida.

## 9. Heurísticas e acessibilidade aplicadas

- **Nielsen #1 — Visibilidade do status:** botão "Cancelando…" durante a chamada; modal de sucesso explícito antes de remover o card; ícone "Excluir" permanece visível (nunca escondido) mesmo quando sua função muda.
- **Nielsen #3 — Controle do usuário:** motivo de cancelamento é sempre opcional (RN-CAN-008); "Voltar" sempre disponível antes de confirmar; erro não descarta o que o cliente já digitou.
- **Nielsen #5 — Prevenção de erros:** confirmação obrigatória antes de qualquer cancelamento (ação que afeta outra pessoa — o prestador); "Excluir" nunca abre acidentalmente o fluxo de exclusão definitiva quando não deveria estar disponível.
- **Nielsen #6 — Reconhecimento sobre memorização:** botão do cliente tem ícone **e** texto ("Cancelar"), diferente do ícone isolado usado pelo prestador, pois o cliente usa a tela com menor frequência.
- **Nielsen #9 — Tratamento de erros:** mensagem de erro do cancelamento reaproveita o padrão já existente (`errorBox`/`errorText`) e nunca fecha o modal nem descarta o motivo digitado.
- **Don Norman — Affordance/Restrições:** o ícone "Excluir" desabilitado ainda parece clicável (não usa `disabled` nativo) porque sua função nesse estado é explicar, não bloquear silenciosamente.
- **Gestalt — Proximidade:** o botão "Cancelar" do cliente fica na mesma região da coluna de ação já estabelecida por `agenda.tsx` (fim do card, próximo ao badge de status), preservando a leitura visual já aprendida pelos usuários do app.
- **Acessibilidade (WCAG AA):** `accessibilityLabel` descritivo em ambos os novos botões (seções 4.1 e 6.2); `accessibilityState={{ disabled: false }}` explícito no ícone "Excluir" reaproveitado com nova função (para não confundir leitores de tela, já que ele não está de fato desabilitado no sentido de interação); contraste de `colors.danger`/`colors.warning` sobre seus fundos `*Soft` já validado em outros usos no app; nenhum estado é comunicado só por cor (ícone + texto sempre acompanham).

## 10. Critérios de aceite para a ADA

**Cliente (`client-home.tsx`):**
- Cada card em "Próximos atendimentos" exibe um botão "Cancelar" (ícone + texto), sem condição de habilitação adicional (seção 3.1).
- Toque abre modal de confirmação com texto/motivo conforme seção 4.2; "Voltar" fecha sem efeito; "Confirmar cancelamento" chama `appointmentService.cancelAppointment(id, { reason })`.
- Sucesso → modal "Agendamento cancelado" → "Entendi" → `loadHome()` → card não aparece mais na lista.
- Erro → mensagem inline no próprio modal de confirmação, sem fechar nem descartar o motivo digitado; botão primário reabilitado para nova tentativa.
- Notificação ao prestador confirmada em teste manual (a RPC já dispara `notify_appointment_change`, nada novo a testar do lado do trigger).
- Teste automatizado cobrindo o novo botão/modal (render condicional, chamada ao serviço, remoção do card após sucesso).

**Prestador (`app/agenda.tsx`):**
- Para `item.clientId === null` ou cliente sem `clientUserId`: nenhuma mudança de comportamento no botão "Excluir".
- Para cliente com `clientUserId` preenchido: ícone "Excluir" permanece visível com opacidade reduzida (`opacity.disabled`); toque abre o modal informativo da seção 6.2 em vez do modal de exclusão definitiva.
- `loadReferenceData()` ajustado para não filtrar por `status` ao montar o mapa `clientId → clientUserId` (seção 7), preservando o filtro `status: "active"` apenas para o seletor de cliente do formulário.
- Teste automatizado cobrindo os três casos: sem cliente, cliente sem conta, cliente com conta (incluindo o caso do cliente **inativo** com conta, que exercita a correção da seção 7).
- Nenhuma alteração de RPC, policy ou trigger nesta rodada — reforço opcional na policy/RPC (mencionado em BLG-091) permanece decisão de arquitetura em aberto, não resolvida por este handoff de UX.

## 11. Riscos e achados registrados, não decididos aqui

1. **Ausência de tela de histórico para o cliente (seção 3.2).** O cliente não tem hoje onde conferir agendamentos cancelados/concluídos passados. Não decidido nem implementado aqui.
2. **Achado técnico de correção necessária em `loadReferenceData()` (seção 7).** Sem o ajuste recomendado, a regra de restrição do "Excluir" pode falhar silenciosamente para clientes inativos com conta vinculada — tratado aqui como parte dos critérios de aceite (seção 10), não como item separado de backlog, por ser pré-requisito direto para a correção funcionar.
3. **Melhoria arquitetural de médio prazo (seção 7).** Expor `hasLinkedClientAccount` diretamente no registro do agendamento eliminaria a dependência de cruzar com uma lista de clientes carregada à parte. Recomendação para avaliação futura do Chris, não decidida aqui.
4. **Banner global de mudança de comportamento (seção 6.3).** Considerado e não recomendado nesta rodada por custo de implementação desproporcional ao ganho; registrado como possível acréscimo futuro caso a explicação por linha se mostre insuficiente na prática.

## 12. Registro em BACKLOG.md

Registrada como **DEC-148, Estado: Proposta** — pendente de aprovação explícita do usuário antes de qualquer implementação pela ADA, mesmo padrão já usado em DEC-075 (recuperação de senha). `BLG-090`/`BLG-091` atualizados para referenciar este documento como o handoff de UX que ambos aguardavam.

---

## 13. Adenda pós-DEC-150 — estado bloqueado do cancelamento pelo cliente dentro de 24h (14/08/2026)

> **Esta seção é uma adenda ao documento acima, não uma reabertura.** As seções 1–12 descrevem o fluxo já desenhado e já implementado (DEC-148/DEC-149) e continuam válidas sem alteração: card na lista, botão de ação, modal de confirmação com motivo opcional, modal de sucesso, remoção do card via `loadHome()`. O que muda é só a regra de elegibilidade: DEC-150 revisou `RN-CAN-009` (antes "sem antecedência mínima", agora "mínimo de 24 horas antes de `starts_at`") e criou `RN-CAN-015`/`RN-CAN-016` (defesa em profundidade cliente+servidor) e `RF-CAN-007`/`RF-CAN-008`. Esta seção define o estado novo que passa a existir quando o cliente tenta cancelar dentro dessa janela. **Origem:** `DEC-150`, `BLG-092`. **Preparado para:** ADA (wiring), Chris (RPC `cancel_appointment` — checagem server-side e código `CANCELLATION_ADVANCE_NOTICE_INVALID`). **Estado desta adenda: Proposta — registrada como `DEC-152`, pendente de aprovação explícita do usuário antes do wiring**, mesmo padrão de aprovação já usado para a proposta original desta mesma frente (DEC-148).

### 13.1 Pré-requisito técnico que este desenho assume (achado, não decisão de UX)

Releitura de `app/client-home.tsx` (`loadHome()`, linhas ~148-160) confirma que `HomeAppointment` (tipo local do arquivo) **não carrega o `startsAt` bruto em ISO** — só os campos já formatados para exibição (`day`, `month`, `time`, todos strings derivadas de `Intl.DateTimeFormat` no fuso do agendamento). Sem o instante bruto, não há como o cliente (JS da tela) calcular quantas horas faltam para `starts_at` e decidir, no lado da interface, qual dos dois estados do botão renderizar (seção 13.2) — que é exatamente a metade "client-side" da defesa em profundidade pedida por `RN-CAN-015`/`RF-CAN-008`.

**Ajuste necessário, dentro do escopo natural da ADA ao implementar este handoff (não é mudança de contrato de backend — `AppointmentRecord.startsAt` já existe e já chega até `loadHome()` via `appointmentService.listAppointments()`; só não é copiado para o tipo de exibição local):** adicionar um campo `startsAtIso: string` a `HomeAppointment`, atribuído diretamente de `item.startsAt` no mesmo `.map()` que já monta `day`/`month`/`time` (linha ~150). Nenhuma chamada de rede nova, nenhum campo novo de backend.

### 13.2 Comportamento do botão dentro da janela de 24h — rótulo muda, ação nunca desaparece

Decisão explícita, respondendo à pergunta central desta rodada: **o botão não fica oculto nem vira um "Cancelar" que falha só depois de tocado — o rótulo e o ícone mudam, dando a pista antes do toque.**

- **≥ 24h de antecedência (comportamento hoje já implementado, sem mudança):** botão "Cancelar" (ícone `error`/`colors.danger`), leva ao modal de confirmação já existente (seção 4.2 original).
- **< 24h de antecedência:** o mesmo elemento, na mesma posição do card, na mesma coluna de ação — **nunca removido do layout** (mesmo princípio já usado para o "Excluir" do prestador na seção 6.2: visibilidade em vez de esconder) — passa a exibir rótulo **"Contatar prestador"** com ícone `warning`/`colors.warning` (o mesmo par ícone/cor já usado em `client-booking.tsx` para o modal `exception` e em `agenda.tsx` para o "Excluir indisponível", nunca `error`/`colors.danger` nesse estado, porque a ação deixou de ser destrutiva).

**Por que trocar o rótulo em vez de manter "Cancelar" levando a um modal diferente** (a alternativa também cogitada): a própria tarefa identifica o risco de o cliente tocar "Cancelar" esperando cancelar e descobrir a restrição só dentro do fluxo. Diferente do "Excluir" do prestador (seção 6.2), cujo rótulo continua fazendo sentido porque a ação em si (excluir) só fica indisponível sem alternativa direta pela mesma tela, aqui existe um caminho alternativo válido e nomeável (contatar o prestador, que cancela por fora) — nomear esse caminho no próprio rótulo é mais honesto sobre o que o toque vai de fato abrir (Nielsen #2, correspondência com o mundo real; Don Norman, mapeamento) do que manter "Cancelar" e revelar a restrição só depois. O princípio herdado do "Excluir" que **é** preservado integralmente é a visibilidade — o elemento nunca desaparece nem vira `disabled` nativo.

- `accessibilityLabel` nesse estado: `"Cancelamento indisponível a menos de 24 horas do atendimento — contatar {providerName} em vez de cancelar por aqui"` (em vez do rótulo padrão de cancelamento), para que um leitor de tela já anuncie o motivo sem exigir a segunda etapa do modal — mesmo princípio já usado no `accessibilityLabel` do "Excluir indisponível" (seção 6.2).
- Cálculo: função pura `isCancelBlockedByAdvanceNotice(startsAtIso: string, now: Date): boolean`, equivalente a `new Date(startsAtIso).getTime() - now.getTime() < 24 * 60 * 60 * 1000` — reaproveitada tanto na renderização do rótulo/ícone do botão quanto, de novo, dentro de `openCancelModal`/equivalente no instante do toque (seção 13.3), para não depender de o card ter sido renderizado há pouco tempo. Nenhuma contagem regressiva ativa (`setInterval`) é necessária — o gate que efetivamente importa é o servidor (`RN-CAN-015`); o cálculo client-side é só para feedback imediato (Nielsen #1) e prevenção de erro (Nielsen #5), não para precisão ao segundo.

### 13.3 Novo estado: modal informativo "Contatar prestador"

Toque no botão em estado `< 24h` **não abre o modal de confirmação existente** (motivo opcional, "Confirmar cancelamento") — abre um modal informativo novo, reaproveitando integralmente a mesma estrutura já catalogada na seção 8 do documento original para o modal `exception` de `client-booking.tsx`/"Excluir indisponível" de `agenda.tsx` (`modalIconWarning`, ícone `warning`/`colors.warning`, botão único). Nenhum componente visual novo.

- Novo estado local sugerido em `client-home.tsx`, no mesmo padrão de nomenclatura já usado por `cancelTarget`: `contactProviderTarget: HomeAppointment | null`, com `openContactProviderModal(item)`/`closeContactProviderModal()` equivalentes a `openCancelModal`/`closeCancelModal`, porém sem campo de motivo nem chamada de serviço — este modal não faz nenhuma requisição de rede.
- Título: **"Menos de 24h para o atendimento"**
- Texto: **"Cancelamentos com menos de 24 horas de antecedência não podem ser feitos por aqui. Entre em contato diretamente com {providerName} — ele pode cancelar este atendimento a qualquer momento, sem essa restrição de prazo."** — usa `activeProvider?.name` (já carregado e já exibido na tela, seção "Prestador em uso"; o card pertence sempre ao prestador ativo, já que `activeAppointments` é filtrado por `providerId === activeProviderId`), com fallback **"com o prestador"** caso o nome não esteja disponível por qualquer motivo.
- **Sobre canal de contato direto (telefone/WhatsApp do prestador):** auditoria confirma que não existe hoje, em nenhum tipo ou tela do lado do cliente (`Provider`/`ClientProviderLink`, `client-home.tsx`, `client-providers.tsx`), nenhum dado de contato do prestador exposto ao cliente — só `id`, `name`/`providerName`, `profession`, `status`. **Decisão: não inventar um canal de contato que não existe.** A orientação fica no nível já suportado por dado real (nome do prestador), sem número de telefone, botão de WhatsApp ou link de mensagem. Registro de achado (não decisão desta rodada): se o produto quiser oferecer um atalho de contato direto no futuro, isso depende de um campo de telefone/WhatsApp do prestador ainda inexistente como dado exposto ao cliente — item de descoberta futuro, fora do escopo de BLG-092.
- Botão único: **"Entendi"** — fecha o modal, sem nenhuma chamada de rede, sem alterar `appointments` nem disparar `loadHome()` (nada mudou no agendamento).

### 13.4 Erro de servidor `CANCELLATION_ADVANCE_NOTICE_INVALID` — corrida de tempo com o modal de confirmação já aberto

Cenário: o cliente abre o modal de confirmação normal (card ainda mostrava "Cancelar", ≥ 24h no momento do toque) e demora para preencher o motivo/confirmar; nesse intervalo, o horário cruza para dentro da janela de 24h; ao tocar "Confirmar cancelamento", a RPC rejeita com `CANCELLATION_ADVANCE_NOTICE_INVALID` (`RN-CAN-015`, defesa que efetivamente impede a operação).

**Não é um erro genérico solto — reaproveita exatamente o mecanismo `cancelError`/`errorBox`/`errorText` já implementado (seção 4.2 original), com uma única diferença de comportamento para este código específico:**

- Mensagem exibida inline, no mesmo lugar do erro genérico de hoje: **"Este atendimento já está a menos de 24 horas do horário marcado. Não é possível concluir o cancelamento por aqui — entre em contato diretamente com o prestador."** — texto sugerido para o mapeamento estático código→mensagem que Chris já mantém no adapter (mesmo padrão de `ERROR_MESSAGES` já usado para `ADVANCE_NOTICE_INVALID` em `supabase-appointment-adapter.ts`); como esse mapa não interpola nome de prestador em nenhum código existente, esta mensagem também não interpola (consistência com o padrão já estabelecido), diferente do modal proativo da seção 13.3, que tem o nome disponível localmente na tela.
- **Diferença de comportamento em relação ao erro genérico (única exceção ao padrão já documentado):** como uma nova tentativa de "Confirmar cancelamento" está matematicamente fadada a falhar de novo (o tempo só avança, a janela de 24h não volta a abrir), o botão primário deve ficar **desabilitado permanentemente** depois desse erro específico — sem alternar para "Cancelando…"/permitir nova tentativa como no fluxo genérico (seção 4.2, "Botão primário volta a ficar habilitado para nova tentativa"). "Voltar" continua disponível e é, agora, o único caminho de saída do modal. Isso evita um ciclo de novo toque → nova falha idêntica (Nielsen #5, prevenção de erros) sem exigir fechar e reabrir um segundo modal.
- **Detecção pelo código, nunca pela string da mensagem:** `error instanceof AppointmentError && error.code === "CANCELLATION_ADVANCE_NOTICE_INVALID"` (mesmo tipo já existente, `apps/agendae/src/domain/agenda/types.ts`, que precisa ganhar este código na união `AppointmentErrorCode`) — nunca comparação de texto, pelo mesmo motivo que os demais códigos do arquivo já evitam isso.
- Todos os demais erros de `cancelAppointment` (rede, sessão expirada, `FORBIDDEN`, etc.) mantêm o comportamento genérico já documentado na seção 4.2 original, sem alteração.

### 13.5 Fluxo estrutural atualizado (substitui o diagrama da seção 5 para refletir o estado novo)

```
Painel "Próximos atendimentos" (client-home.tsx)
 └─ Card de agendamento
      ├─ ≥ 24h de starts_at → botão "Cancelar" (ícone error)
      │    └─ [Cancelar] → modal de confirmação (seção 4.2)
      │         ├─ [Voltar] → fecha modal, nada muda
      │         └─ [Confirmar cancelamento]
      │              ├─ sucesso → modal "Agendamento cancelado" → [Entendi] → loadHome()
      │              ├─ erro CANCELLATION_ADVANCE_NOTICE_INVALID (corrida de tempo, seção 13.4)
      │              │    → mensagem inline + botão primário desabilitado → só [Voltar] resta
      │              └─ outro erro → mensagem inline, botão primário reabilitado (comportamento já existente)
      └─ < 24h de starts_at → botão "Contatar prestador" (ícone warning, seção 13.2)
           └─ [Contatar prestador] → modal informativo "Menos de 24h para o atendimento" (seção 13.3)
                └─ [Entendi] → fecha modal, nada muda, nenhuma chamada de rede
```

### 13.6 Heurísticas e acessibilidade aplicadas nesta adenda

- **Nielsen #1 — Visibilidade do status:** o rótulo do botão já comunica a restrição antes do toque; nenhuma surpresa dentro do fluxo.
- **Nielsen #2 — Correspondência com o mundo real:** "Contatar prestador" nomeia a ação que de fato vai acontecer, em vez de manter "Cancelar" para uma ação que não cancela nada por essa via.
- **Nielsen #5 — Prevenção de erros:** botão primário desabilitado após o erro de corrida de tempo evita um ciclo de retentativas fadadas; a janela de 24h em si é uma prevenção de erro operacional (motivação original do usuário para DEC-150).
- **Nielsen #6 — Reconhecimento sobre memorização:** o ícone `warning` (já usado em outros estados restritos do app) sinaliza "atenção/restrição" com o mesmo significado visual já aprendido pelo usuário em `client-booking.tsx`/`agenda.tsx`.
- **Nielsen #9 — Tratamento de erros:** erro de servidor reaproveita o `errorBox`/`errorText` já existente; mensagem explica a causa (janela de 24h) e a alternativa (contatar o prestador), nunca um erro genérico solto.
- **Don Norman — Affordance/Mapeamento:** o botão continua com a mesma affordance de "tocável" (não usa `disabled` nativo em nenhum dos dois estados do card), mas seu rótulo/ícone mapeiam corretamente para o que a ação de fato faz em cada estado.
- **Acessibilidade (WCAG AA):** `accessibilityLabel` distinto para o estado `< 24h` (seção 13.2); contraste de `colors.warning` sobre `*Soft` já validado em outros usos no app; nenhum estado é comunicado só por cor (ícone + texto sempre acompanham, tanto no botão quanto no erro inline).

### 13.7 Critérios de aceite adicionais (complementam a seção 10 original, não a substituem)

**Cliente (`client-home.tsx`):**
- `HomeAppointment` ganha `startsAtIso`, propagado a partir de `item.startsAt` (seção 13.1); nenhuma chamada de rede nova.
- Card com `starts_at` ≥ 24h de `now()`: comportamento inalterado (botão "Cancelar", ícone `error`, modal de confirmação existente).
- Card com `starts_at` < 24h de `now()`: botão exibe "Contatar prestador" (ícone `warning`), nunca oculto; toque abre o modal informativo da seção 13.3, sem chamar `cancelAppointment`.
- Modal informativo usa o nome real do prestador ativo (`activeProvider?.name`) com fallback genérico; não exibe nenhum dado de contato inexistente (telefone/WhatsApp).
- No modal de confirmação normal, capturar `AppointmentError` com `code === "CANCELLATION_ADVANCE_NOTICE_INVALID"`: mensagem inline específica (seção 13.4) e botão primário desabilitado permanentemente para aquela abertura do modal (mensagem não seria diferente numa segunda tentativa); demais códigos de erro mantêm o comportamento genérico já existente.
- Teste automatizado cobrindo: renderização do botão em cada lado do limite de 24h (ex.: 23h59 vs. 24h01 de antecedência), abertura do modal informativo correto em `< 24h`, e o tratamento distinto do erro `CANCELLATION_ADVANCE_NOTICE_INVALID` (botão desabilitado) versus um erro genérico (botão reabilitado) no modal de confirmação.

**Servidor (`cancel_appointment`, Chris — fora do escopo de UX, registrado aqui só para rastreabilidade do handoff):**
- Checagem `starts_at - now() >= interval '24 hours'` aplicada somente quando o ator é cliente (`RN-CAN-015`, `RN-CAN-016`), sem afetar o cancelamento pelo prestador (`RN-CAN-010`, sem restrição).
- Código de erro novo `CANCELLATION_ADVANCE_NOTICE_INVALID`, distinto de `FORBIDDEN`/`APPOINTMENT_NOT_FOUND`/`INVALID_STATE_TRANSITION`, propagado até `AppointmentErrorCode` (`apps/agendae/src/domain/agenda/types.ts`) e ao mapa `ERROR_MESSAGES` do adapter, com a mensagem sugerida na seção 13.4.

### 13.8 Riscos e achados registrados, não decididos aqui

1. **Ausência de canal de contato direto do prestador exposto ao cliente** (telefone/WhatsApp) — seção 13.3. A orientação desta rodada é deliberadamente genérica ("entre em contato diretamente com {nome}"), sem inventar um mecanismo de contato inexistente. Item de descoberta futuro, não implementado nem decidido aqui.
2. **Pré-requisito técnico `HomeAppointment.startsAtIso`** (seção 13.1) — sem ele, a metade client-side da defesa em profundidade (`RF-CAN-008`) não é implementável nesta tela; tratado aqui como parte dos critérios de aceite (seção 13.7), não como item de backlog separado, por ser pré-requisito direto desta mesma entrega.

## 14. Registro em BACKLOG.md (adenda)

Adenda registrada como **DEC-152, Estado: Proposta** — pendente de aprovação explícita do usuário antes de qualquer implementação por Chris/ADA, mesmo padrão já usado para a proposta original desta frente (DEC-148). `BLG-092` atualizado para referenciar esta seção como o handoff de UX que aguardava (a parte de Dante do trabalho ali listado).
