# Handoff — UX dos "dias de atendimento semanais" do prestador

> Responsável por este documento: Dante (arquitetura de experiência)
> Preparado em: 13/08/2026
> Destinatários: Chris (schema/RPC), ADA (wiring de frontend), Nero (somente se algum componente visual novo for necessário — ver seção 8)
> Estado: fluxo/UX proposto, aguardando validação do coordenador (Marcus) antes de acionar Chris/ADA. Fecha a etapa de UX de `BLG-080` (P1). Não define UI visual final (cor, tipografia, tamanho exato de componente — papel de Nero) nem implementa código (papel de Chris/ADA). Não edita `BACKLOG.md` — outro especialista está com esse arquivo em uso nesta sessão; a entrada `DEC-NNN` correspondente deve ser registrada por quem consolidar este handoff no backlog.

## 0. Contexto e pré-requisitos confirmados por leitura de código

Regra de negócio já fechada pelo Virgil em `DEC-139`/`BLG-080` (`BACKLOG.md`) — **não reaberta aqui**:

- RN-AGD-025: o prestador escolhe qualquer subconjunto não vazio dos 7 dias da semana; zero dias marcados é inválido.
- RN-AGD-026 (corrigida): feriado nacional **não** tem nenhuma relação com "dia de atendimento" — não bloqueia nada, nem para cliente nem para prestador. O único tratamento de feriado é um lembrete visual informativo na agenda do **prestador**, registrado separadamente em `BLG-081` (P2, não acionado agora — ver seção 8.3).
- RN-AGD-027: a restrição vale só para criação/remarcação **solicitada pelo cliente**. O prestador sempre pode agendar manualmente fora do dia de atendimento.
- RN-AGD-028: não é retroativo — mudar os dias de atendimento não cancela nem altera agendamentos/séries já existentes.
- RN-AGD-029: tenants novos e existentes nascem com os 7 dias marcados por padrão.

Confirmado por leitura direta do código, antes de desenhar qualquer fluxo:

- `apps/agendae/app/settings.tsx` já tem, na `StyleSheet`, os estilos `weekdayList`/`weekday`/`weekdayActive`/`weekdayText`/`weekdayTextActive` (linhas 625–639) — **definidos mas não usados em nenhum JSX da tela hoje**. Não há nenhum seletor de dias renderizado atualmente; só existem campos de horário (`workdayStart`/`workdayEnd`) e antecedência mínima (`advanceHours`), dentro do card "Agenda e notificações". Esses estilos mortos parecem ter sido deixados como preparação para esta funcionalidade — ver recomendação na seção 2.1.
- `apps/agendae/app/client-booking.tsx` usa `defaultProviderSchedule.allowedWeekdays: [1, 2, 3, 4, 5]` fixo (linha 51) como único fallback; `policy.allowedWeekdays` (linha 154) hoje sempre usa esse fixo, porque `BookingContext`/`get_client_booking_context` não devolve nenhum campo de dias da semana ainda. O restante do objeto `policy` (`startTime`, `endTime`) **já segue o padrão correto** de preferir o dado real do contexto quando disponível (`currentContext?.workdayStart... ?? providerSchedule.workdayStart`, linhas 155–156) — `allowedWeekdays` é a única propriedade que ainda não tem esse fallback condicional, por não existir dado real para preferir.
- `apps/agendae/src/domain/agenda/client-booking-policy.ts` (`isDayAllowed`, `listTimesForDay`, `hasAvailableTimeForDay`) **já é genérico e correto para qualquer subconjunto de `allowedWeekdays`** — não depende da lógica de segunda-a-sexta de forma nenhuma; basta receber o array real. **Nenhuma mudança é necessária nesta camada de domínio.** Isto reduz o escopo do que falta: é só levar o dado real da configuração do prestador até `policy.allowedWeekdays`, nada na regra de cálculo de horários precisa mudar.
- `apps/agendae/app/agenda.tsx` tem um **terceiro** lugar com o mesmo dado mockado: `profileSchedule` (linha 254, estado local `useState`) com `allowedWeekdays: [1, 2, 3, 4, 5]` fixo, exibido como texto informativo read-only para o próprio prestador ("Padrão atual: Seg, Ter, Qua...", linhas 1518–1522, dentro do bloco "Disponibilidade para clientes"). Esse texto hoje é decorativo/mock (não vem de nenhuma chamada de rede) — sinalizado à ADA na seção 7.2 como um terceiro ponto de wiring, para não deixar esse texto desalinhado do valor real configurado em Configurações depois que a funcionalidade existir.
- `ProviderSettings`/`UpdateProviderSettingsInput` (`apps/agendae/src/domain/provider/types.ts`) não têm hoje nenhum campo equivalente a dias de atendimento. O precedente mais recente de extensão aditiva desse mesmo contrato é `profession` (`DEC-137`): campo opcional adicionado sem quebrar `app/settings.tsx`, RPC recriada com parâmetro novo. Cito esse precedente na seção 7.1 como referência de padrão já validado no projeto, não como decisão de schema (isso é escolha de Chris).

## 1. Fluxo geral (visão de handoff, sem mudança de navegação)

Diferente do handoff de Serviços (`docs/HANDOFF_UX_SERVICOS_DANTE.md`), esta funcionalidade **não cria rota nova, não cria menu novo e não cria modal novo** — é um controle adicional dentro de uma tela e um card já existentes (`app/settings.tsx`, card "Agenda e notificações"), com reflexo em uma tela consumidora já existente (`app/client-booking.tsx`). Não há sitemap novo a desenhar.

## 2. Seletor de dias de atendimento em `app/settings.tsx`

### 2.1 Formato do controle: grupo de 7 chips-toggle, não modal

**Decisão: grupo horizontal (com quebra de linha) de 7 chips-toggle, um por dia da semana, com estado marcado/desmarcado — não um modal separado, não uma lista com switches verticais.**

Justificativa:

1. **Não reaproveitar o modal "Selecionar dias" de `app/agenda.tsx`** (linha 1934, `recurrenceCalendarVisible`) sem adaptação — `BLG-080` já registrou esse alerta explicitamente, e a leitura do código confirma: aquele modal é um calendário completo para escolher **datas específicas** de uma série recorrente do cliente (até 24 dias, navegação de mês), um problema de seleção muito mais complexo do que marcar/desmarcar 7 dias da semana fixos. Usar um modal de calendário para uma escolha de 7 itens fixos seria sobre-engenharia de interação (Nielsen #8, design minimalista) — o usuário teria que abrir um modal, navegar visualmente um calendário, para uma decisão que cabe inteira, sempre visível, em uma linha do próprio formulário.
2. **Os 7 chips cabem inline no formulário**, no mesmo padrão visual já usado por `PROFESSION_SUGGESTIONS` (linhas 289–309, chips clicáveis com estado ativo/inativo) e pelos estilos `weekday`/`weekdayActive` já existentes (porém não usados) no próprio arquivo — reaproveitar essa linguagem de interação já presente na tela é consistência direta (Nielsen #4) sem introduzir um padrão visual novo.
3. **Cada chip é um toggle independente** (não um "select" de opção única) — tocar um dia já marcado desmarca; tocar um dia desmarcado marca. Rótulo abreviado de 3 letras visível (`SEG`, `TER`, `QUA`, `QUI`, `SEX`, `SÁB`, `DOM`, mesma ordem/abreviação já usada no calendário de `client-booking.tsx`, linha 423, começando na segunda-feira — manter a mesma convenção de primeiro dia da semana em todo o app, Nielsen #4), com `accessibilityLabel` no dia completo (ex.: "Segunda-feira, dia de atendimento ativado" / "Segunda-feira, dia de atendimento desativado") e `accessibilityRole="switch"`/`accessibilityState={{ checked }}` — o rótulo abreviado sozinho não é suficiente para leitor de tela.
4. **Ponto de atenção para Nero, se for revisar os estilos já existentes:** `weekday` (linha 627–628) tem `minHeight: 40`, abaixo do alvo mínimo de toque de 44×44 já exigido em `docs/DESIGN_SYSTEM_MVP.md` (seção 4.4). Recomendo ajustar para `minHeight: 44` ao ligar este controle, e simetricamente `minWidth` o suficiente para caber o rótulo de 3 letras com a mesma folga dos demais controles da tela.

### 2.2 Posição no formulário: antes de "Início"/"Término", dentro do card "Agenda e notificações"

**Decisão: o seletor de dias entra como o primeiro campo do formulário do card "Agenda e notificações" (`app/settings.tsx`, view `styles.form` dentro do segundo card), antes da linha "Início"/"Término" e antes de "Antecedência mínima".**

Justificativa (Gestalt — hierarquia de leitura, e Nielsen #2 — correspondência com o modelo mental de quem configura uma agenda):

- A sequência lógica de configurar uma rotina de atendimento é "**em quais dias** eu atendo" → "**em que horário**, nesses dias, eu atendo" → "**com quanto tempo de antecedência** um cliente pode agendar". Colocar dias antes de horário segue essa ordem de decisão; colocar depois inverteria a leitura natural (o prestador leria primeiro um horário sem saber ainda a que dias ele se aplica).
- É o mesmo card, não um card novo — o título "Agenda e notificações" e a descrição "Regras padrão da sua rotina" já cobrem semanticamente dias de atendimento sem precisar de nenhuma reformulação de copy.

Rótulo proposto para o grupo: **"Dias de atendimento"**, com asterisco de campo obrigatório (mesmo padrão visual de `requiredMark` já usado em "Nome de exibição"/"Telefone"/"Início"/"Término") — porque, embora todo dia comece marcado por padrão (RN-AGD-029), a validação de "não pode ficar vazio" (RN-AGD-025) é, na prática, uma obrigatoriedade de grupo, e o asterisco comunica isso antecipadamente (Nielsen #5, prevenção de erro).

Texto de apoio (hint) abaixo do grupo, sempre visível, refletindo a seleção atual em tempo real (visibilidade do sistema, Nielsen #1) — mesmo padrão do resumo já usado em `app/agenda.tsx` linha 1519 ("Padrão atual: Seg, Ter..."): **"Nos dias marcados, clientes podem solicitar agendamento pelos horários abaixo."** Quando todos os 7 estiverem marcados (estado padrão/inicial), nenhuma composição adicional é necessária — a frase já é verdadeira nesse caso.

### 2.3 Estados do controle

| Estado | Aparência |
|---|---|
| Marcado (dia de atendimento) | Preenchido com `colors.brand`, texto `colors.onBrand` — mesmo par de cores já usado em `weekdayActive`/`weekdayTextActive` e em `professionOptionActive`. |
| Desmarcado | Superfície neutra (`colors.surfaceSubtle`), borda `colors.border`, texto `colors.muted` — mesmo padrão de `professionOption` não selecionado. |
| Focus (teclado/web) | Contorno de foco visível de pelo menos 2 px, mesmo token já exigido para os demais campos da tela (`colors.focus`, `docs/DESIGN_SYSTEM_MVP.md` seção 4.2/7). |
| Erro de grupo (zero dias marcados, ver 2.4) | Borda do grupo inteiro em `colors.danger` (mesmo token de `inputError`), sem alterar a cor de preenchimento de cada chip individualmente — o erro é do grupo, não de um chip específico. |
| Salvando (`saving === true`) | Mesmo comportamento já aplicado aos demais controles da tela durante o salvamento (botão "Salvar" desabilitado); os chips continuam clicáveis normalmente — não há necessidade de bloquear a interação com o seletor durante o salvamento, já que a mudança só é persistida ao tocar "Salvar configurações", igual a todos os outros campos desta tela. |

### 2.4 Validação e mensagem de erro (RF-AGE-015)

Mesmo padrão já implementado em `save()` (linhas 145–168 de `settings.tsx`) para os demais campos — validação client-side síncrona, antes de qualquer chamada de rede, populando `fieldErrors` e o banner `error` compartilhado:

- Se, no momento de tocar "Salvar configurações", nenhum dia estiver marcado: adicionar uma nova chave a `fieldErrors` (ex.: `attendanceDays`) com a mensagem **"Selecione pelo menos um dia de atendimento."**, exibida imediatamente abaixo do grupo de chips (mesmo componente `fieldErrorText` já usado nos demais campos, com `accessibilityRole="alert"`), e aplicar o estilo de borda de erro no contêiner do grupo (seção 2.3). O banner genérico já existente ("Confira os campos destacados abaixo.") continua sendo definido do mesmo jeito, sem necessidade de texto especial adicional.
- **Não é necessário nenhum modal de confirmação nem bloqueio de digitação em tempo real** (ex.: impedir desmarcar o 7º dia restante) — seguir exatamente o mesmo momento de validação já usado pelo cruzamento `workdayStart >= workdayEnd` (linhas 154–161): a inconsistência só é sinalizada ao tentar salvar, nunca no meio da interação de marcar/desmarcar. Bloquear a própria interação (ex.: desabilitar o toggle do último dia restante) violaria o controle e liberdade do usuário (Nielsen #3) sem ganho real — o prestador pode estar no meio de uma reconfiguração (desmarcar um dia e, na sequência, marcar outro) e não deve ser impedido de passar por um estado intermediário de "zero dias" enquanto ainda está decidindo.

### 2.5 Não confundir com feriados (reforço explícito de copy)

Nenhum texto desta seção deve mencionar feriados. A regra de negócio corrigida em `DEC-139` deixou explícito que feriado nacional não tem relação alguma com "dia de atendimento" — evitar qualquer copy do tipo "dias de atendimento, exceto feriados" ou visual que sugira essa combinação, para não reintroduzir na UI uma direção de produto que já foi rejeitada explicitamente pelo usuário na formalização da regra.

## 3. Comportamento no calendário do cliente (`app/client-booking.tsx`)

### 3.1 Decisão: reaproveitar o mesmo estado visual "indisponível" genérico — sem criar uma categoria visual nova

**Decisão: um dia fora do "dia de atendimento" do prestador recebe exatamente o mesmo tratamento visual que hoje já existe para "dia no passado" e para "dia sem horário livre" — sem nenhuma diferenciação visual nova entre os motivos de indisponibilidade.**

Concretamente, nenhuma mudança visual é necessária em `dayAvailable()` (linha 219) nem no JSX do calendário (linhas 431–491): a função já centraliza toda a decisão de "disponível ou não" em um único booleano (`hasAvailableTimeForDay`, que já teria `isDayAllowed` retornando `false` para um dia fora de `allowedWeekdays`), e o JSX já aplica o mesmo par de estilos (`calendarDayTextDisabled`, ausência de `calendarDot`) para qualquer dia onde esse booleano é falso, seja porque é passado, porque está totalmente ocupado/bloqueado, ou porque cai fora do dia de atendimento.

Justificativa:

1. **A ação do cliente é idêntica nos três casos: escolher outro dia.** Diferenciar visualmente "este dia é fora do meu expediente" de "este dia está no passado" ou de "este dia já está todo ocupado" só faria diferença de UX se o cliente pudesse fazer algo diferente dependendo do motivo — o que não é o caso aqui. Introduzir uma categoria visual nova sem uma ação distinta associada é complexidade sem benefício (Nielsen #8, design minimalista; YAGNI aplicado a UX, mesmo racional já usado por Virgil/Dante em decisões anteriores do projeto para não antecipar diferenciação sem uso real).
2. **A legenda existente já cobre a visibilidade do sistema necessária (Nielsen #1).** O calendário já tem uma legenda explícita — "● Dia com disponibilidade" (linha 492–497) — que comunica positivamente quais dias têm vaga; o inverso (dia sem essa marcação) já comunica "não disponível" sem precisar de uma segunda legenda explicando os motivos possíveis. Adicionar "dia fora do expediente do prestador" como um terceiro estado visual (ex.: um ícone específico de "fechado") exigiria também estender a legenda, criando mais elementos para o cliente processar durante a decisão de agendar — sem mudar a decisão que ele precisa tomar.
3. **Precedente do próprio código:** hoje "dia no passado" e "dia sem horário livre" (ocupado/bloqueado) já colapsam no mesmo estado visual sem prejuízo relatado — não há histórico de confusão de usuário documentado no backlog sobre essa junção já existente. Fora do dia de atendimento é, na prática, mais um motivo dentro dessa mesma família de "indisponível", não uma categoria de natureza diferente (como seria, por exemplo, "prestador temporariamente inativo" ou "conta suspensa", que sim mudariam a ação do cliente).
4. **Custo de reverter esta decisão é baixo, caso o produto observe confusão real após o lançamento.** Como toda a lógica hoje já converge para um único booleano (`hasAvailableTimeForDay`), diferenciar visualmente no futuro exigiria apenas expor o motivo específico como um dado adicional (não uma reescrita de arquitetura) — não há necessidade de over-engineering preventivo agora.

### 3.2 O que explicitamente não muda

- `accessibilityLabel` do dia (linha 442) continua usando apenas "disponível"/"indisponível" — não é necessário (nem desejável, por 3.1) detalhar o motivo específico da indisponibilidade no rótulo de acessibilidade.
- A legenda do calendário (linha 492–497) não recebe nenhum item novo.
- Nenhum texto de feriado aparece em `client-booking.tsx` em nenhuma hipótese — reforço da mesma regra da seção 2.5, agora do lado do cliente. RN-AGD-026 é explícita: feriado nunca diferencia visualmente nenhum dia para o cliente.

## 4. Estados de erro, vazio e transição

### 4.1 Estado que RN-AGD-025 já impede em escrita (mas ainda merece defesa client-side de leitura)

Como o próprio salvamento em `settings.tsx` impede persistir zero dias marcados (seção 2.4) e a migração de dados existentes garante os 7 dias por padrão (RN-AGD-029), **não deveria existir**, em operação normal, um prestador real com `allowedWeekdays` vazio chegando ao `client-booking.tsx`. Ainda assim, por prevenção de erro (Nielsen #5) e defesa em profundidade (mesmo espírito das validações client-side que já espelham constraints de backend em outras telas do projeto, ex. `HANDOFF_UX_SERVICOS_DANTE.md` seção 4), recomendo que a tela do cliente trate esse valor defensivamente **sem quebrar**, caso chegue vazio/nulo por qualquer anomalia de dado (linha antiga não migrada, erro de sincronização, etc.):

- Se `allowedWeekdays` vier vazio para um prestador específico do contexto: o calendário simplesmente não mostrará nenhum dia disponível para esse prestador (comportamento natural de `isDayAllowed` recebendo um array vazio — nenhuma mudança de código necessária na função em si). **Recomendo, porém, uma mensagem complementar explícita quando isso ocorrer**, em vez de deixar o cliente diante de um calendário inteiro apagado sem explicação: um aviso curto dentro do painel "Escolha o dia" (mesmo padrão visual do `modeNotice` já existente, linha 387–393), do tipo **"Este prestador ainda não tem horários disponíveis configurados. Tente novamente mais tarde."** — exibido quando o prestador selecionado não tiver nenhum dia disponível em nenhum mês navegável (não apenas no mês atual, para não confundir com "este mês específico não tem vaga", que é uma situação diferente e não deve reaproveitar esse aviso). Isso evita que o cliente interprete uma anomalia de dado como "o app quebrou" (Nielsen #9, ajudar a diagnosticar) sem, no entanto, tratar esse estado como algo esperado de operação normal (não é — é defesa, não fluxo principal).

### 4.2 Estado de carregamento

Já existe hoje (implícito): antes de `loadContext()` resolver, `contexts` está vazio e a tela mostra a lista de prestadores vazia. Não é necessário nenhum estado de carregamento novo específico a esta funcionalidade — o carregamento de `allowedWeekdays` viaja dentro do mesmo payload de `get_client_booking_context` que já carrega `workdayStart`/`workdayEnd`, então não introduz uma segunda chamada de rede nem um segundo estado de loading independente.

### 4.3 Estado vazio de "mês sem nenhum dia disponível"

Situação teoricamente possível mesmo com RN-AGD-025 respeitada (ex.: prestador com apenas 1 dia de atendimento na semana, e esse dia específico cai todo bloqueado/ocupado naquele mês) — **isto já é um gap pré-existente do calendário, não introduzido por esta funcionalidade**: hoje, se todos os dias de um mês ficarem indisponíveis por qualquer motivo (bloqueios manuais extensos, por exemplo), o calendário já mostraria o mês inteiro apagado sem nenhum aviso dedicado. Não é objeto de decisão deste documento corrigir esse gap pré-existente, mas registro a observação porque reduzir de 5 para, por exemplo, 1 dia de atendimento por semana **aumenta a probabilidade prática** desse estado ocorrer (antes, com 5 dias/semana fixos, era mais raro um mês inteiro ficar sem nenhuma vaga). Sinalizo como ponto de atenção para o coordenador avaliar se entra nesta etapa ou fica para uma iteração futura — ver seção 8.4.

## 5. Regras de negócio e requisitos funcionais referenciados

Nenhuma RN/RF nova é criada por este documento — RN-AGD-025–029 e RF-AGE-014–019 (já formalizadas em `DEC-139`) cobrem integralmente a regra de negócio; este handoff só desenha o fluxo/UX em torno delas, conforme mandato de `BLG-080`.

## 6. Heurísticas e princípios aplicados

- **Nielsen #1 — Visibilidade do status:** texto de apoio dinâmico abaixo do seletor de dias (seção 2.2); legenda do calendário do cliente inalterada e ainda suficiente (seção 3.1).
- **Nielsen #2 — Correspondência com o mundo real:** ordem dos campos em `settings.tsx` segue a sequência real de decisão de um prestador (dias → horário → antecedência), seção 2.2.
- **Nielsen #3 — Controle e liberdade do usuário:** validação de "zero dias" só ocorre ao salvar, nunca bloqueando a interação de marcar/desmarcar durante a reconfiguração (seção 2.4).
- **Nielsen #4 — Consistência:** chips reaproveitam a mesma linguagem visual já usada por `PROFESSION_SUGGESTIONS` e pelos estilos `weekday*` já presentes (ainda que não usados) no próprio arquivo; abreviação de dias da semana usa a mesma convenção (segunda a domingo) já usada no calendário de `client-booking.tsx` (seção 2.1).
- **Nielsen #5 — Prevenção de erros:** asterisco de obrigatoriedade de grupo antecipando a regra de "não pode ficar vazio" (seção 2.2); defesa client-side contra anomalia de dado vazio no lado do cliente (seção 4.1).
- **Nielsen #8 — Design minimalista:** decisão deliberada de não introduzir uma categoria visual nova no calendário do cliente quando o estado genérico já resolve (seção 3.1).
- **Nielsen #9 — Ajudar a reconhecer, diagnosticar e recuperar-se de erros:** mensagem de erro de grupo com texto acionável ("Selecione pelo menos um dia de atendimento.") em vez de um erro genérico; aviso defensivo específico no lado do cliente para o caso de anomalia de dado (seção 4.1).
- **Gestalt — Proximidade/hierarquia:** dias de atendimento, horário de expediente e antecedência mínima permanecem agrupados no mesmo card ("Agenda e notificações"), na ordem que reflete a hierarquia real de dependência entre eles (seção 2.2).
- **Don Norman — Affordance/mapeamento:** cada chip é um toggle visualmente idêntico ao padrão já estabelecido de opção selecionável/não selecionável na mesma tela, sem introduzir uma nova metáfora de interação.

## 7. Handoff técnico

### 7.1 Para Chris (schema/RPC)

Nenhuma decisão de schema é tomada aqui — fica a critério de Chris (array de inteiros, 7 booleanos, bitmask, tabela auxiliar etc.). O que Chris precisa saber, vindo desta camada de UX, para implementar sem ambiguidade:

1. **Contrato de leitura:** `ProviderSettings` precisa ganhar um campo novo representando os dias de atendimento (formato à escolha de Chris) para alimentar o seletor em `settings.tsx`. Sugiro seguir o mesmo padrão aditivo já usado para `profession` (`DEC-137`): campo opcional na interface (`attendanceDays?: number[] | null` ou equivalente), nunca obrigatório, para não quebrar nenhum consumidor existente do contrato antes de a tela ser religada.
2. **Contrato de escrita:** `UpdateProviderSettingsInput`/RPC `update_provider_settings` precisa aceitar esse novo campo. **Validação de "não pode ser vazio" (RN-AGD-025) precisa existir também no servidor**, não só no client (seção 2.4 é defesa de UX, não a autoridade final) — mesmo padrão de defesa em profundidade já usado para nome de serviço/profissão (constraint de banco + validação client-side espelhada).
3. **Contrato consumido pelo cliente:** `get_client_booking_context` (RPC consumida por `client-booking.tsx`) precisa devolver esse mesmo dado por prestador, para substituir o array fixo `[1, 2, 3, 4, 5]` hoje hardcoded em `defaultProviderSchedule` (`client-booking.tsx` linha 51). **Nenhuma mudança é necessária em `client-booking-policy.ts`** — a função `isDayAllowed`/`listTimesForDay`/`hasAvailableTimeForDay` já aceita qualquer array de `allowedWeekdays` corretamente (seção 0); só a origem do dado muda.
4. **Escopo de validação server-side (RN-AGD-027):** a rejeição de dia fora do "dia de atendimento" só deve valer para criação/remarcação **solicitada pelo cliente** — o mesmo precedente de `v_requested_by = 'client'` já usado pelas políticas de limite/período do cliente (RN-AGD-015–022, citado em `DEC-139`) deve orientar onde entra essa checagem nas RPCs de agendamento (`_create_appointment_row`/`update_appointment`), sem impedir o prestador de criar manualmente fora do dia configurado.
5. **Não retroativo (RN-AGD-028):** nenhuma migration ou trigger deve alterar, cancelar ou remarcar agendamentos/séries existentes ao popular ou alterar este campo.
6. **Default de migração (RN-AGD-029):** tenants existentes e novos devem nascer com os 7 dias marcados — decisão de produto já fechada, não uma sugestão.

### 7.2 Para ADA (wiring)

1. **`app/settings.tsx`:** implementar o grupo de 7 chips-toggle descrito na seção 2, no card "Agenda e notificações", antes de "Início"/"Término" (seção 2.2), consumindo/persistindo o novo campo de `ProviderSettings`/`UpdateProviderSettingsInput` assim que Chris o expuser. Os estilos `weekdayList`/`weekday`/`weekdayActive`/`weekdayText`/`weekdayTextActive` já existem no arquivo (linhas 625–639) mas nunca foram usados — avaliar se ainda atendem (ajustando `minHeight` para 44px, seção 2.1) antes de criar estilos novos do zero.
2. **`app/client-booking.tsx`:** substituir o array fixo de `defaultProviderSchedule.allowedWeekdays` (linha 51) pelo valor real vindo de `currentContext`, seguindo exatamente o mesmo padrão de fallback já usado para `workdayStart`/`workdayEnd` na montagem de `policy` (linhas 153–160: `currentContext?.campo ?? providerSchedule.campo`). Nenhuma mudança na lógica de `dayAvailable()` nem no JSX do calendário é necessária (seção 3.1) — só a fonte do array muda.
3. **`app/agenda.tsx`:** o texto "Padrão atual: ..." (linha 1518–1522) hoje deriva de `profileSchedule`, um `useState` local mockado (linha 254) — quando o campo real de `ProviderSettings` existir, ligar esse texto ao dado real (via `providerSettingsService.getSettings()`, já importado/consumido em `settings.tsx`) evita que o próprio prestador veja, na tela de Agenda, um resumo desatualizado dos dias que ele configurou em Configurações. Sinalizado aqui como terceiro ponto de wiring — não é a tela principal desta funcionalidade, mas fica inconsistente se ignorado.
4. Nenhuma rota nova, nenhum item de menu novo, nenhum `Stack.Screen` novo — esta funcionalidade não altera navegação.

### 7.3 Não implementado nesta decisão, registrado para o futuro

- **`BLG-081`** (lembrete visual de feriado nacional na agenda do prestador, `app/agenda.tsx`) — item novo e separado, de prioridade P2, não acionado por este documento. Não há sinergia de implementação que justifique adiantá-lo junto com esta etapa: são duas fontes de dado completamente diferentes (dias de atendimento configuráveis vs. `public.is_national_holiday`, já existente e não alterado) e duas telas diferentes em termos de foco (`settings.tsx`/`client-booking.tsx` aqui, `agenda.tsx` lá). Fica só mencionado para registro de que existe, conforme pedido.
- **Estado "mês sem nenhum dia disponível" no calendário do cliente** (seção 4.3) — gap pré-existente, potencialmente mais visível após esta mudança, mas não corrigido por este documento; fica para o coordenador decidir se entra nesta etapa ou numa iteração futura.

## 8. Pontos em que fiz escolha de julgamento não coberta explicitamente pelo Virgil — para validação do coordenador

1. **Posição do seletor de dias em `settings.tsx`:** decidi colocá-lo *antes* de "Início"/"Término" (seção 2.2). O handoff de `BLG-080` só disse "mesma seção", sem especificar a ordem relativa. Se o coordenador preferir manter horário antes de dias (ex. por já ser o primeiro campo operacional hoje), é uma inversão de ordem simples, sem impacto em nenhuma outra decisão deste documento.
2. **Tratamento visual do calendário do cliente:** decidi **não** criar nenhum estado visual novo para "fora do dia de atendimento", reaproveitando o "indisponível" genérico já existente (seção 3.1) — esta era explicitamente uma decisão delegada a mim por `BLG-080`. Se, após validar com usuários reais, houver evidência de confusão sobre "por que esse dia está indisponível", a reversão é de baixo custo (seção 3.1, item 4).
3. **Formato do controle (chips-toggle inline, não modal):** também delegado a mim por `BLG-080`. Considerei e descartei um modal dedicado por ser desproporcional a uma escolha de 7 itens fixos (seção 2.1).
4. **Estado "mês sem nenhum dia disponível" (seção 4.3):** identifiquei esse gap como preexistente e potencialmente mais frequente após esta mudança, mas não decidi corrigi-lo aqui — fica como recomendação de escopo para o coordenador avaliar, não como algo que assumi silenciosamente estar fora.
5. **Reaproveitamento dos estilos `weekday*` já existentes e não usados em `settings.tsx`** (seção 2.1/7.2): assumi que são um resquício de preparação para esta funcionalidade e recomendei reaproveitá-los (com ajuste de `minHeight`) em vez de criar um padrão visual novo. Se esses estilos tiverem origem diferente (ex. de outra funcionalidade descartada), essa suposição deve ser revisitada por quem tiver esse contexto.

## 9. Critérios de aceite

- `app/settings.tsx` apresenta um grupo de 7 chips-toggle (um por dia da semana), no card "Agenda e notificações", antes de "Início"/"Término", com estado marcado/desmarcado persistente entre reload e sincronizado com o valor salvo.
- Tentar salvar com zero dias marcados exibe erro de grupo específico ("Selecione pelo menos um dia de atendimento."), sem chamar a rede, e não permite salvar até que ao menos um dia esteja marcado.
- O calendário de `client-booking.tsx` reflete exatamente os dias reais configurados pelo prestador (via `allowedWeekdays` real, não mais o array fixo `[1,2,3,4,5]`), sem nenhuma mudança de comportamento visual/estrutural além da fonte do dado.
- Nenhum texto ou estado visual relacionado a feriado nacional aparece em `settings.tsx` ou em `client-booking.tsx`.
- Alterar os dias de atendimento não cancela, remarca nem altera nenhum agendamento ou série recorrente já existente (validação funcional, não apenas de UX).
- Tenants existentes e novos continuam operando com os 7 dias marcados até que o prestador altere deliberadamente (nenhuma regressão de disponibilidade no dia do deploy).
