# Handoff da Agenda para backend — Cris

> Estado em 03/08/2026: experiência responsiva concluída; integração real pendente.

## Escopo preparado

- lista e calendário mensal, ambos disponíveis em desktop e mobile;
- filtro de mês/ano, busca, status e paginação de 10 itens;
- criação, edição, cancelamento com preservação do histórico, exclusão administrativa e confirmação manual pelo prestador;
- recorrência semanal, quinzenal, mensal ou por datas escolhidas no calendário, entre 2 e 24 ocorrências, vinculadas por `recurrenceGroupId`;
- mensagem para o cliente separada da observação interna;
- contrato frontend em `src/domain/agenda` sem dependência de biblioteca externa.

### Convenção dos modais

Modais que coletam dados não fecham ao clicar no fundo, evitando perda acidental. O fechamento ocorre pelo `X` ou por ação explícita como Cancelar/Salvar. Seletores e mensagens informativas, que não mantêm formulário, podem fechar pelo fundo.

O protótipo ainda persiste em `localStorage` (`agendae:appointments:v1`). Esse armazenamento é somente demonstração, não é multiusuário e deve ser substituído por uma implementação HTTP de `AppointmentPort`.

## Modelo e visibilidade

O contrato canônico está em `apps/agendae/src/domain/agenda/types.ts`. Pontos obrigatórios:

- `clientMessage`: pode ser retornada ao prestador e ao cliente vinculado;
- `internalNotes`: somente prestador autorizado; deve ser omitida, e não apenas ocultada visualmente, nas respostas ao cliente;
- valor e nome do serviço são snapshots do momento da confirmação;
- `startsAt` é instante ISO em UTC e `timezone` preserva o fuso IANA usado na agenda;
- estado do atendimento e confirmação são dimensões separadas;
- confirmação manual grava `confirmationSource=provider_manual`, `confirmedAt`, ator e auditoria.
- criação recorrente é transacional: se qualquer ocorrência conflitar ou violar uma regra, nenhuma deve ser criada; a resposta identifica as datas conflitantes.

## Endpoints esperados

| Operação | Sugestão |
|---|---|
| Listar/paginar | `GET /v1/appointments?month=YYYY-MM&page=1&pageSize=10&state=&confirmationStatus=&search=` |
| Detalhar | `GET /v1/appointments/:id` |
| Criar | `POST /v1/appointments` |
| Editar/remarcar | `PATCH /v1/appointments/:id` |
| Cancelar | `POST /v1/appointments/:id/cancel` com `{ reason?: string }`; `cancelledBy` deve vir da sessão |
| Confirmar manualmente | `POST /v1/appointments/:id/manual-confirmation` |
| Excluir registro incorreto | `DELETE /v1/appointments/:id` apenas com permissão e auditoria |

Listagens mensais devem devolver paginação no modo lista. Para o calendário, pode ser usado o mesmo endpoint com projeção resumida ou um endpoint mensal agregado, evitando uma chamada por dia.

## Dependências de domínio

1. Sessão e `tenantId` autenticados; nunca aceitar `tenantId` confiando apenas no corpo.
2. Vínculo cliente–prestador ativo.
3. Serviço ativo, valor e duração vigentes.
4. Fuso IANA e disponibilidade do prestador.
5. Política do cliente: período permitido, limite diário e limite total, incluindo modos livres.
6. Cota do plano, antecedência, pacote/saldo quando aplicável.

### Precedência do bloqueio

- solicitação autenticada como **cliente** que sobrepõe bloqueio ativo: rejeitar com `AGENDA_BLOCKED`;
- criação manual autenticada como **prestador**: permitir dentro do próprio bloqueio, mantendo a validação contra compromissos já ocupados;
- criação do bloqueio: preservar todos os compromissos anteriores, sem cancelamento em lote ou efeito colateral;
- cancelamento: executar somente por comando explícito e auditado, preservando o registro com estado `cancelled`, `cancelledBy`, `cancelledAt` e motivo opcional visível à outra parte.

### Dia de atendimento (`ATTENDANCE_DAY_UNAVAILABLE`)

Além do bloqueio de agenda, o cliente não pode solicitar (criação ou remarcação) um horário fora do dia de atendimento configurado pelo prestador. A checagem roda dentro das RPCs de escrita de `appointments` (não é só validação de tela) e:

- só se aplica quando a solicitação é do **cliente** (`requested_by = 'client'`); o prestador nunca é bloqueado por esta regra ao criar ou remarcar manualmente, no mesmo precedente já usado para `AGENDA_BLOCKED`/`OUTSIDE_ALLOWED_PERIOD`/limites diário e total;
- na remarcação, só é avaliada quando o horário efetivamente muda — reagendar mantendo a mesma data/hora não passa por esta checagem;
- o dia da semana é calculado no fuso horário do tenant (fuso do prestador, o mesmo usado para `v_local_date`/antecedência mínima), seguindo a convenção `Date.getDay()` do JS/TS: `0=domingo, 1=segunda, ..., 6=sábado` — não a convenção ISO (`isodow`, 1=segunda…7=domingo) usada em outro contexto para dias úteis;
- os dias habilitados vêm de `tenants.attendance_days` (coluna adicionada e a regra implementada em migration de backend própria, com decisão de arquitetura registrada em `BACKLOG.md`, `DEC-139`);
- não é retroativa: alterar `attendance_days` nunca revalida ou cancela agendamentos/séries já existentes, só afeta novas solicitações a partir da mudança;
- é independente da checagem de feriado nacional (`is_national_holiday`), que segue sua própria regra sem relação com esta.

7. Controle de concorrência transacional para impedir dois agendamentos no mesmo slot.
8. Auditoria de criação, alteração, cancelamento, exclusão e confirmação manual sem copiar conteúdos sensíveis.
9. Evento de notificação separado da transação; falha de entrega não desfaz o agendamento.

## Cenários e exceções

| Código | Comportamento da interface |
|---|---|
| `SLOT_UNAVAILABLE` | manter formulário aberto e pedir outro horário |
| `ATTENDANCE_DAY_UNAVAILABLE` | informar que o dia escolhido está fora dos dias de atendimento do prestador e pedir outra data |
| `OUTSIDE_ALLOWED_PERIOD` | explicar o período permitido ao cliente |
| `DAILY_LIMIT_REACHED` / `TOTAL_LIMIT_REACHED` | informar o limite aplicável sem criar registro parcial |
| `ADVANCE_NOTICE_INVALID` | mostrar a antecedência mínima exigida |
| `CLIENT_LINK_INACTIVE` | bloquear criação e orientar regularização do vínculo |
| `PLAN_LIMIT_REACHED` | informar limite do plano sem apagar agenda existente |
| `INVALID_STATE_TRANSITION` | recarregar o item e apresentar o estado atual |
| `ALREADY_CONFIRMED` | tratar como idempotência e exibir o registro confirmado |
| `FORBIDDEN` | negar sem revelar dados de outro tenant |
| `SESSION_EXPIRED` | solicitar nova autenticação preservando apenas dados não sensíveis |
| `NETWORK_ERROR` | manter formulário e permitir tentar novamente |

## Critérios mínimos de aceite

- consultas e mutações são isoladas por tenant;
- conflito simultâneo é impedido no banco, não somente validado antes;
- limites livres não são persistidos como zero;
- alteração de política não cancela compromissos existentes;
- o cliente nunca recebe `internalNotes` em payload, log ou notificação;
- mensagem compartilhada é sanitizada e tem limite de tamanho;
- confirmação manual é idempotente e auditável;
- paginação é estável e ordenada por `startsAt` e `id`;
- datas são testadas em mudança de dia e horário de verão do fuso configurado.

## Próximo passo de integração

Implementar `HttpAppointmentAdapter`, injetá-lo na tela e remover o acesso direto ao `localStorage`. O adaptador deve mapear os códigos de erro da API para `AppointmentErrorCode`; nenhum componente visual deve depender do formato bruto da resposta HTTP.
