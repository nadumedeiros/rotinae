# Regras de Negócio do MVP — Rotinaê

> **Versão:** 0.8.0
> **Status:** Aprovado para detalhamento de requisitos  
> **Data:** 14 de agosto de 2026  
> **Documento de origem:** [Documento de Visão do Produto — v0.3.0](./VISAO_DO_PRODUTO.md)
> **Governança:** [Backlog e Registro de Decisões](../BACKLOG.md)

## 1. Finalidade

Este documento consolida as regras de negócio vigentes para o MVP do Rotinaê. Os identificadores devem ser usados nos requisitos, histórias, critérios de aceite, design e testes para garantir rastreabilidade.

## 2. Glossário

| Termo | Definição |
|---|---|
| Prestador | Usuário profissional que oferece e gerencia serviços, agenda, clientes e pacotes. |
| Cliente | Usuário que se vincula a um prestador e agenda serviços para si. |
| Atendimento | Ocorrência agendada de um serviço entre cliente e prestador. |
| Pacote | Conjunto de atendimentos contratado por um cliente e controlado pelo prestador. |
| Saldo | Quantidade de atendimentos ainda disponíveis em um pacote. |
| Dia útil | Dia considerado válido para a antecedência mínima. A definição de feriados permanece pendente. |
| Código do prestador | Código utilizado pelo cliente para solicitar ou estabelecer vínculo com um prestador. |

## 3. Perfis, acesso e vínculo

| ID | Regra |
|---|---|
| RN-PER-001 | No lançamento inicial existirão somente os perfis **Prestador** e **Cliente**. |
| RN-PER-002 | Durante o acesso ou cadastro, o usuário deverá escolher se utilizará a plataforma como Prestador ou Cliente. |
| RN-PER-003 | O perfil selecionado determinará as funcionalidades e permissões disponíveis ao usuário. |
| RN-PER-004 | Cada prestador deverá possuir um código de vinculação identificável pela plataforma. |
| RN-PER-005 | O cliente informará o código do prestador em seu perfil para realizar o vínculo. |
| RN-PER-006 | A plataforma utilizará conceitos e nomenclaturas genéricas, mesmo tendo adestradores como primeiro segmento. |
| RN-PER-007 | Informar um código criará uma solicitação de vínculo, que somente ficará ativa após aprovação do prestador. |
| RN-PER-008 | Um cliente poderá manter vínculos ativos com mais de um prestador. |
| RN-PER-009 | O código será aleatório, não sequencial, revogável e regenerável; tentativas de uso estarão sujeitas a limitação. |
| RN-PER-010 | O vínculo terá os estados **Pendente**, **Ativo**, **Rejeitado** e **Revogado**. |
| RN-PER-013 | O convite enviado por e-mail será individual, expirável e de uso único; seu envio não aprovará nem ativará o vínculo. |
| RN-PER-014 | Cadastro interno e conta autenticada são entidades distintas. A associação usa e-mail verificado e aprovação no mesmo tenant; telefone isolado exige revisão e nome nunca autoriza mesclagem automática. |
| RN-PER-011 | A revogação impedirá novos acessos e operações, preservando o histórico conforme as regras de retenção. |
| RN-PER-012 | A escolha exibida no acesso não concederá privilégios; o perfil persistido e as permissões serão validados pelo servidor. |
| RN-PER-013 | Toda nova conta deverá confirmar a propriedade do e-mail antes de ser considerada ativa e acessar as funcionalidades autenticadas. |
| RN-PER-014 | Reenvio de confirmação e recuperação de senha usarão respostas neutras, terão validade limitada e não revelarão se um e-mail está cadastrado. |
| RN-PER-015 | A alteração de senha por recuperação exigirá token válido e de uso único; após o sucesso, o token será invalidado e o usuário receberá feedback explícito. |
| RN-PER-016 | O vínculo só será válido entre perfis diferentes: um Prestador não poderá se vincular a outro Prestador, e um Cliente não poderá se vincular a outro Cliente. A validação será feita pelo servidor no momento da criação/aprovação do vínculo, independentemente do que a interface exibir. |

No MVP, uma mesma conta pode possuir os perfis Cliente e Prestador. Um deles é o contexto ativo por vez; adicionar ou alternar perfil não cria outra identidade, e o servidor deve autorizar cada operação pelo perfil ativo e pelos vínculos/tenants correspondentes.

## 4. Agendamento

| ID | Regra |
|---|---|
| RN-AGD-001 | Prestador e cliente poderão criar agendamentos. |
| RN-AGD-002 | Todo agendamento deverá respeitar a disponibilidade configurada pelo prestador. |
| RN-AGD-003 | O sistema impedirá a criação ou remarcação para horários fora da disponibilidade. |
| RN-AGD-004 | Agendamentos e remarcações deverão respeitar antecedência mínima de **1 dia útil**. |
| RN-AGD-005 | O prestador poderá criar, editar, remarcar e cancelar atendimentos sob sua gestão. |
| RN-AGD-006 | O cliente poderá criar, remarcar e cancelar apenas os próprios atendimentos. |
| RN-AGD-007 | Operações de agenda deverão respeitar as permissões e o vínculo entre cliente e prestador. |
| RN-AGD-008 | O fuso oficial de cada agenda será o configurado no perfil do prestador. |
| RN-AGD-009 | Um dia útil corresponderá ao mesmo horário do próximo dia entre segunda e sexta-feira que não seja feriado nacional brasileiro; a regra valerá para prestador e cliente. |
| RN-AGD-010 | Agendamentos terão os estados **Agendado**, **Concluído**, **Cancelado** e **Não compareceu**. |
| RN-AGD-011 | Apenas o prestador poderá marcar um atendimento como Concluído ou Não compareceu. |
| RN-AGD-012 | Criação e remarcação deverão ser atômicas, impedindo dupla reserva; se a remarcação falhar, o horário original será preservado. |
| RN-AGD-013 | Alterações posteriores na disponibilidade não cancelarão agendamentos existentes. |
| RN-AGD-014 | O cliente criará diretamente o agendamento, sem aprovação adicional, desde que haja vínculo ativo, disponibilidade e atendimento às demais regras. |
| RN-AGD-015 | O prestador poderá definir, por cliente e dentro do próprio tenant, limite total, limite diário e período permitido para solicitações de agendamento. |
| RN-AGD-016 | Cada limite poderá ser configurado como **Livre**; no armazenamento, ausência de limite será representada por `null`, nunca por zero. |
| RN-AGD-017 | Limites numéricos definidos serão inteiros a partir de 1; o limite diário não poderá superar o limite total quando ambos existirem. |
| RN-AGD-018 | O cliente visualizará valor do serviço, quantidade restante, limite diário e período aplicável antes de confirmar. O nome interno do serviço não substitui essas informações. |
| RN-AGD-019 | Ao atingir o limite total ou diário, nova criação e remarcação pelo cliente serão bloqueadas com motivo compreensível; o servidor fará a validação final atomicamente. |
| RN-AGD-020 | Agendamentos Cancelados não consumirão os limites. Agendados, Concluídos e Não compareceu consumirão a quantidade total; o limite diário contará ocorrências não canceladas na data civil do atendimento. |
| RN-AGD-021 | O período definido limitará as datas de atendimento que o cliente poderá solicitar. Período Livre não adicionará restrição além das demais regras de agenda. |
| RN-AGD-022 | Alterar uma política não cancelará agendamentos existentes; ela será aplicada a novas criações e remarcações. Disponibilidade, antecedência, vínculo, plano, pacote e política serão cumulativos, prevalecendo a restrição mais forte. |
| RN-AGD-023 | O valor em centavos será apresentado ao cliente e copiado como snapshot no agendamento, para que alterações futuras não modifiquem retroativamente o histórico. |
| RN-AGD-024 | Um bloqueio de disponibilidade impedirá novas criações e remarcações solicitadas pelo cliente apenas enquanto houver sobreposição com o período ativo. O prestador poderá criar manualmente dentro do bloqueio. Compromissos preexistentes serão preservados e nunca cancelados automaticamente. |

O prestador definirá a duração de cada serviço e poderá configurar intervalos de indisponibilidade. Feriados estaduais e municipais não serão calculados automaticamente no MVP; o prestador poderá bloqueá-los manualmente.

## 5. Atendimentos recorrentes

| ID | Regra |
|---|---|
| RN-REC-001 | A recorrência será configurada no momento do agendamento. |
| RN-REC-002 | Cada ocorrência da recorrência será criada como atendimento independente. |
| RN-REC-003 | Uma ocorrência poderá ser alterada ou cancelada sem afetar automaticamente as demais. |
| RN-REC-004 | Todas as ocorrências deverão respeitar a disponibilidade e a antecedência mínima aplicáveis. |
| RN-REC-005 | O MVP permitirá recorrência semanal, quinzenal e mensal. |
| RN-REC-006 | A série deverá possuir data final ou quantidade definida, limitada a 52 ocorrências. |
| RN-REC-007 | A criação será atômica: se uma ocorrência for inválida ou conflitante, nenhuma será criada e os conflitos serão apresentados para correção. |
| RN-REC-008 | A alteração isolada será registrada como exceção sem perder a referência à série original. |


## 6. Observações do atendimento

| ID | Regra |
|---|---|
| RN-OBS-001 | Cada atendimento poderá possuir uma lista de observações compartilhadas. |
| RN-OBS-002 | Prestador e cliente poderão registrar observações no atendimento. |
| RN-OBS-003 | As observações serão visíveis para o prestador e para o cliente vinculados ao atendimento. |
| RN-OBS-004 | O campo será utilizado para lembretes e informações relacionadas ao atendimento. |
| RN-OBS-005 | O campo de observações não funcionará como chat nem oferecerá troca de mensagens em tempo real. |
| RN-OBS-006 | Cada observação registrará autor, data e hora. |
| RN-OBS-007 | Autor e prestador poderão editar ou excluir conforme suas permissões, mantendo trilha de auditoria. |
| RN-OBS-008 | O conteúdo será tratado como texto, terá limite definido nos requisitos e será sanitizado antes da exibição. |
| RN-OBS-009 | No agendamento, a mensagem para o cliente será compartilhada e exibida nos detalhes visíveis ao cliente vinculado. |
| RN-OBS-010 | A observação interna do agendamento será visível somente ao prestador e nunca será incluída em telas, notificações ou respostas destinadas ao cliente. |

## 7. Pacotes e saldo

| ID | Regra |
|---|---|
| RN-PAC-001 | O saldo do pacote representa a quantidade de atendimentos disponíveis. |
| RN-PAC-002 | O saldo inicial será definido quando o pacote for criado ou registrado como vendido. |
| RN-PAC-003 | Cada atendimento vinculado ao pacote e concluído consumirá automaticamente uma unidade do saldo. |
| RN-PAC-004 | O sistema exibirá o saldo atualizado do pacote. |
| RN-PAC-005 | O prestador poderá ajustar manualmente o saldo quando necessário. |
| RN-PAC-006 | Um ajuste manual atualizará o saldo imediatamente sem alterar o histórico dos atendimentos. |
| RN-PAC-007 | O prestador poderá definir uma data de validade para cada pacote. |
| RN-PAC-008 | A validade será exibida na plataforma para apoiar o gerenciamento. |
| RN-PAC-009 | Ao vincular um atendimento agendado a um pacote, uma unidade ficará reservada e deixará de estar disponível para novos agendamentos. |
| RN-PAC-010 | Ao concluir o atendimento, a unidade reservada será consumida uma única vez, mesmo em caso de repetição da operação. |
| RN-PAC-011 | O cancelamento do atendimento antes da conclusão liberará a unidade reservada. |
| RN-PAC-012 | O status Não compareceu consumirá a unidade reservada. |
| RN-PAC-013 | O saldo não poderá ser negativo e somente pacotes Ativos, não vencidos e com saldo disponível aceitarão novos vínculos. |
| RN-PAC-014 | A validade será opcional e, quando informada, terminará às 23h59 no fuso do prestador; o atendimento deverá ocorrer até essa data. |
| RN-PAC-015 | Ajustes manuais exigirão motivo e registrarão autor, data, saldo anterior e saldo posterior. |
| RN-PAC-016 | Reserva, consumo, liberação e ajuste de saldo serão operações atômicas e auditáveis. |


## 8. Cancelamento de atendimento

| ID | Regra |
|---|---|
| RN-CAN-001 | O cliente poderá cancelar um atendimento antes da data e do horário agendados. |
| RN-CAN-002 | O cancelamento liberará automaticamente o horário na agenda. |
| RN-CAN-003 | O prestador será notificado sobre o cancelamento realizado pelo cliente. |
| RN-CAN-004 | O atendimento receberá o status **Cancelado**. |
| RN-CAN-005 | O atendimento cancelado permanecerá no histórico. |
| RN-CAN-006 | Um atendimento Concluído ou marcado como Não compareceu não poderá ser cancelado. |
| RN-CAN-007 | Falha no envio da notificação não desfará o cancelamento. |
| RN-CAN-008 | O cancelamento pelo cliente não exigirá motivo. Quando informado, o motivo será registrado e exibido ao prestador, no mesmo padrão já usado para o motivo informado pelo prestador ao cliente. |
| RN-CAN-009 | **[REVISADA — DEC-150]** O cancelamento pelo cliente exigirá antecedência mínima de **24 horas** em relação ao horário de início do atendimento (`starts_at`). Dentro dessa janela, o cliente não poderá cancelar diretamente; a interface orientará explicitamente a contatar o prestador, que poderá cancelar sem restrição de antecedência (RN-CAN-010). Após o início do horário, permanece inalterado: somente o prestador decidirá o desfecho (Concluído ou Não compareceu). Esta redação substitui a original (v0.7.0/DEC-146), que definia ausência de qualquer antecedência mínima para o cancelamento pelo cliente — ver nota de revisão ao final desta seção. |
| RN-CAN-010 | O prestador poderá cancelar qualquer atendimento que ainda esteja no estado Agendado, sem restrição de antecedência mínima. |
| RN-CAN-011 | O cancelamento de um atendimento não produzirá nenhum efeito automático sobre registros do controle financeiro (`manual_payments`) do mesmo cliente, pois esses registros não possuem nem podem possuir vínculo estrutural com um agendamento específico. Eventuais ajustes financeiros decorrentes de um cancelamento serão feitos manualmente pelo prestador, mesmo princípio já adotado em RN-CPA-006 para o cancelamento de pacotes. |
| RN-CAN-012 | A exclusão definitiva (*hard delete*) de um agendamento é uma ação administrativa distinta do cancelamento: remove o registro por completo, não preserva o atendimento no histórico do cliente nem do prestador, e não segue as regras RN-CAN-001 a 011. |
| RN-CAN-013 | A exclusão definitiva será permitida somente quando o agendamento não tiver identidade de cliente vinculada capaz de vê-lo — ou seja, quando não houver cliente associado ao agendamento, ou o cliente associado não possuir conta de usuário vinculada ao seu cadastro. |
| RN-CAN-014 | Sempre que o agendamento tiver cliente com conta de usuário vinculada, a exclusão definitiva não será oferecida; a remoção desse agendamento só poderá ocorrer pelo fluxo de cancelamento (RN-CAN-001 a 011), independentemente do estado do agendamento ou de já ter sido confirmado. |
| RN-CAN-015 | A antecedência mínima de cancelamento pelo cliente (RN-CAN-009) será verificada tanto na interface, para feedback imediato, quanto no servidor, dentro da RPC `cancel_appointment`, como defesa em profundidade — mesmo padrão já adotado para a antecedência mínima de criação e remarcação (RF-AGE-006). A validação server-side é a que efetivamente impede a operação e retornará um código de erro específico (`CANCELLATION_ADVANCE_NOTICE_INVALID`), distinto dos demais erros já existentes de `cancel_appointment` (`FORBIDDEN`, `APPOINTMENT_NOT_FOUND`, `INVALID_STATE_TRANSITION`). |
| RN-CAN-016 | A janela de 24 horas de RN-CAN-009 será contada como duração corrida em instante absoluto (`starts_at - now() >= 24 horas`), sem depender do fuso do prestador nem do calendário de dias úteis/feriados — diferente, portanto, do cálculo de dia útil usado na antecedência mínima de criação e remarcação (RN-AGD-004/008/009, função `minimum_bookable_instant`). A comparação reaproveita o mesmo princípio de instante absoluto já usado no bloqueio de cancelamento pelo cliente após o início do horário, que já compara `starts_at` a `now()` sem nenhum cálculo de fuso. |

RN-CAN-009/010 substituem, de forma explícita e rastreável, a nota antiga não numerada sobre a janela de cancelamento ("o cliente poderá cancelar até imediatamente antes do horário", "o prestador poderá cancelar qualquer atendimento Agendado"), que já era o comportamento real, mas nunca tinha identificador próprio.

**Revisão de 14/08/2026 (DEC-150):** RN-CAN-009 foi corrigida a pedido explícito do usuário, que identificou o risco operacional de permitir cancelamento pelo cliente em cima da hora — passando de "sem antecedência mínima" (v0.7.0/DEC-146) para "antecedência mínima de 24 horas", com RN-CAN-015 e RN-CAN-016 detalhando, respectivamente, a defesa em profundidade (cliente + servidor) e o cálculo exato da janela. RN-CAN-010 (cancelamento pelo prestador) permanece sem qualquer antecedência mínima, inclusive dentro da janela de 24 horas do cliente — decisão deliberada de produto, não limitação técnica: cabe ao prestador, avisado pelo cliente, cancelar o quanto antes para liberar o horário a outra pessoa. Mesmo padrão de correção explícita de regra já usado em DEC-139 para RN-AGD-026.

## 9. Cancelamento de pacote

| ID | Regra |
|---|---|
| RN-CPA-001 | O prestador poderá cancelar um pacote de serviços. |
| RN-CPA-002 | O pacote cancelado receberá o status **Cancelado**. |
| RN-CPA-003 | Novos atendimentos não poderão ser vinculados ao pacote cancelado. |
| RN-CPA-004 | O histórico do pacote cancelado permanecerá disponível para consulta. |
| RN-CPA-005 | O cancelamento liberará as reservas dos atendimentos futuros, que permanecerão agendados sem vínculo ao pacote. |
| RN-CPA-006 | O saldo restante ficará indisponível e não será convertido automaticamente em reembolso financeiro. |


## 10. Controle financeiro e pagamentos de serviços

| ID | Regra |
|---|---|
| RN-FIN-001 | O MVP não processará pagamentos dos serviços entre cliente e prestador. |
| RN-FIN-002 | O prestador poderá cadastrar manualmente o cliente, o valor do serviço e as informações necessárias ao controle de pagamentos. |
| RN-FIN-003 | Os registros financeiros terão finalidade de controle operacional e não substituirão sistema contábil, fiscal ou bancário. |
| RN-FIN-004 | O controle básico terá valor em reais, vencimento e status **Pendente**, **Pago**, **Atrasado** ou **Cancelado**. |
| RN-FIN-005 | O prestador poderá registrar pagamentos parciais; cada valor quitado gerará um registro próprio e reduzirá atomicamente o saldo pendente do lançamento de origem. O MVP não contemplará parcelamento planejado, conciliação bancária, emissão fiscal nem comissões. |
| RN-FIN-006 | Alterações financeiras registrarão autor, data e valores anterior e posterior. |
| RN-FIN-007 | Um pagamento parcial deverá ser maior que zero e não poderá exceder o saldo pendente. Ao atingir o saldo total, o lançamento de origem será marcado como Pago. |
| RN-FIN-008 | A exclusão autorizada de um registro de valor quitado restaurará o respectivo valor ao saldo pendente, com auditoria da correção. |
| RN-FIN-009 | Uma cobrança (`kind = charge`) que possui ao menos um recibo de quitação (`kind = receipt` com `parent_payment_id` apontando para ela) não pode ser marcada como **Cancelado**. A regra é aplicada tanto na UI quanto pelo trigger `manual_payments_prevent_cancel_with_receipts` no PostgreSQL. |

A ausência de pagamento de serviços dentro da plataforma não impede a cobrança da assinatura do Plano Premium do Rotinaê, que pertence ao modelo SaaS e deverá ter seu mecanismo definido durante a implementação.

## 11. Comunicação e consentimento

| ID | Regra |
|---|---|
| RN-COM-001 | A plataforma poderá utilizar terceiros para enviar e-mails, notificações push e mensagens via WhatsApp. |
| RN-COM-002 | O provedor será definido durante a implementação considerando custo, disponibilidade e facilidade de integração. |
| RN-COM-003 | No primeiro acesso, o usuário deverá aceitar os Termos de Uso e a Política de Privacidade. |
| RN-COM-004 | O usuário poderá escolher se deseja receber comunicações relacionadas ao uso da plataforma. |
| RN-COM-005 | As comunicações poderão incluir confirmações, lembretes, alterações, cancelamentos e comunicados importantes. |
| RN-COM-006 | As mensagens automáticas conterão somente as informações necessárias ao evento. |
| RN-COM-007 | O MVP não oferecerá personalização avançada de templates. |
| RN-COM-008 | Aceite dos Termos, ciência da Política de Privacidade e consentimentos opcionais serão registrados separadamente com versão, data e origem. |
| RN-COM-009 | Preferências serão configuráveis por canal e finalidade, com revogação disponível ao usuário. |
| RN-COM-010 | Comunicações operacionais indispensáveis serão separadas das comunicações opcionais; suas bases legais deverão ser validadas antes do lançamento. |
| RN-COM-011 | Mensagens e notificações exibirão apenas dados mínimos e não incluirão observações ou documentos em tela bloqueada. |
| RN-COM-012 | Falhas de entrega serão registradas e não reverterão a operação que originou a mensagem. |
| RN-COM-013 | Todo evento relevante de agendamento gerará notificação persistida para a outra parte quando houver identidade vinculada: criação/solicitação, confirmação, remarcação, cancelamento, conclusão e registro de não comparecimento. |
| RN-COM-014 | Todo evento de vínculo ou ampliação de perfil gerará notificação persistida ao destinatário aplicável: solicitação por código, aprovação, rejeição, revogação e adição dos papéis Cliente ou Prestador à conta. |
| RN-COM-015 | Produtores de notificações serão transacionais e idempotentes: repetição sem nova transição não criará duplicata; o conteúdo usará somente dados mínimos e nunca incluirá observação interna, motivo sensível, e-mail, telefone ou dados de reconciliação. |
| RN-COM-016 | A notificação persistida será a fonte de verdade; push nativo será um canal de entrega opcional e sua falha nunca reverterá o evento de negócio nem removerá o item da inbox. |
| RN-COM-017 | Push somente será enfileirado para aparelhos ativos do destinatário quando a preferência estiver habilitada e a permissão do sistema tiver permitido registrar o token. Logout desativará a instalação atual. |
| RN-COM-018 | A entrega push será rastreada por notificação e aparelho, com limite de tentativas, confirmação por receipt e desativação de tokens informados como não registrados pelo provedor. O toque somente abrirá destinos internos conhecidos e para a mesma identidade autenticada. |

> **Atenção para requisitos e LGPD:** deve ser distinguida a base legal de mensagens estritamente transacionais daquela aplicável a comunicações opcionais. Também devem ser definidos registro, data, versão e revogação do consentimento.

## 12. Planos e monetização

### 12.1 Período de teste

| ID | Regra |
|---|---|
| RN-PLN-001 | Todo novo prestador terá acesso ao Plano Premium por **30 dias**, sem custo. |
| RN-PLN-002 | Ao final do teste, o prestador poderá permanecer no Plano Gratuito ou contratar o Plano Premium. |

> Para evitar concessão indevida de benefício comercial, o período de teste é atribuído ao usuário Prestador. O perfil Cliente não contrata plano no modelo atual.

### 12.2 Plano Gratuito

| ID | Regra |
|---|---|
| RN-PLN-003 | O Plano Gratuito permitirá até **2 ocorrências de atendimento por dia**, somando as criadas pelo prestador e por seus clientes. |
| RN-PLN-004 | O dia será calculado das 00h às 23h59 no fuso IANA do prestador e contará a data de realização da ocorrência. |
| RN-PLN-008 | Cada ocorrência recorrente contará individualmente no dia em que ocorrer. |
| RN-PLN-009 | Atendimentos Cancelados não consumirão a cota; remarcações liberarão a data original e consumirão a cota da nova data. |
| RN-PLN-010 | Ao atingir 2 ocorrências na data, novas ocorrências naquele dia serão bloqueadas para prestador e clientes, sem afetar as já existentes. |
| RN-PLN-011 | O Plano Gratuito permitirá no máximo 5 clientes cadastrados e não permitirá adicionar notas internas na página do cliente. Dados e notas existentes permanecerão disponíveis para leitura após downgrade. |

### 12.3 Plano Premium

| ID | Regra |
|---|---|
| RN-PLN-005 | O Plano Premium terá preço inicial de **R$ 29,00 por mês**. |
| RN-PLN-006 | O Plano Premium permitirá agendamentos ilimitados. |
| RN-PLN-007 | O Plano Premium dará acesso a todas as funcionalidades disponíveis na versão contratada. |
| RN-PLN-012 | O Premium incluirá recorrência, documentos e anexos, evolução detalhada, financeiro, indicadores e automações multicanal. |
| RN-PLN-013 | O teste começará na ativação da conta do prestador, durará 30 períodos de 24 horas e será concedido uma única vez por identidade verificada. |
| RN-PLN-014 | Ao terminar o teste sem assinatura, a conta migrará para o Gratuito; dados Premium serão preservados para leitura, mas novas operações Premium serão bloqueadas. |
| RN-PLN-015 | Agendamentos existentes serão preservados após downgrade, mesmo acima do limite; novos agendamentos obedecerão à cota. |
| RN-PLN-016 | A validação comercial incluirá cobrança real da assinatura por provedor a definir, com renovação mensal, cancelamento e tratamento de falha de pagamento. |
| RN-PLN-017 | O cancelamento realizado durante o teste não encerrará o Premium imediatamente: o acesso continuará até completar os 30 períodos de 24 horas, com downgrade automático para o Gratuito ao final. |

### 12.4 Horizonte de agendamento por plano

| ID | Regra |
|---|---|
| RN-PLN-018 | O prestador com Premium ativo — assinatura `active` ou `cancel_at_period_end` dentro do período já pago, ou trial vigente — poderá agendar sem nenhum limite de meses à frente. |
| RN-PLN-019 | O prestador no Plano Gratuito — sem Premium ativo e fora do período já pago — terá um limite de **1 mês** à frente para novos agendamentos e remarcações, contado a partir da data corrente no fuso do prestador. |
| RN-PLN-020 | A carência posterior ao cancelamento do Premium não constituirá uma janela nova de 30 dias: reaproveitará exatamente o mecanismo já existente de período pago (`current_period_ends_at`) ou, na ausência deste, o fim do trial (`trial_ends_at`). Nenhum novo contador de carência será criado. |
| RN-PLN-021 | Quando o período pago se encerrar e o prestador migrar efetivamente para o Gratuito, o sistema varrerá os agendamentos futuros desse prestador e cancelará automaticamente apenas os que ultrapassarem o novo limite de 1 mês; os que estiverem dentro do limite permanecerão intactos. Esta é uma exceção pontual e explícita a RN-PLN-015, restrita a este eixo de horizonte de meses — não afeta a cota diária (RN-PLN-003) nem o teto de clientes (RN-PLN-011), que continuarão preservando tudo normalmente. |
| RN-PLN-022 | Cada cancelamento automático originado por RN-PLN-021 registrará motivo padronizado, distinto de um cancelamento manual, para fins de auditoria e eventual reversão; o cliente vinculado ao agendamento será notificado pelo mesmo mecanismo já usado para cancelamento (RN-COM-013). |
| RN-PLN-023 | A verificação do horizonte de meses ocorrerá no servidor, dentro das mesmas funções que já validam a criação e a remarcação de agendamento; qualquer verificação equivalente no cliente terá caráter apenas de otimização de UX, nunca de barreira de segurança. Cada ocorrência de uma série recorrente será avaliada e tratada individualmente, sem afetar as demais (mesmo princípio de RN-REC-003), e a rotina de varredura de RN-PLN-021 será idempotente, não duplicando cancelamento nem notificação em reprocessamentos. |

## 13. Objetivos de validação comercial

| ID | Objetivo |
|---|---|
| VAL-001 | Avaliar a aceitação do modelo de assinatura. |
| VAL-002 | Medir a conversão do teste de 30 dias para o Plano Premium. |
| VAL-003 | Avaliar a aceitação do preço de R$ 29,00 por mês. |
| VAL-004 | Avaliar se os limites de 2 agendamentos por dia e 5 clientes incentivam a migração para o Premium sem inviabilizar a experimentação. |

## 14. Matriz resumida de permissões

| Ação | Prestador | Cliente |
|---|:---:|:---:|
| Criar agendamento | Sim | Sim, para si |
| Editar ou remarcar atendimento | Sim | Sim, para si |
| Cancelar atendimento | Sim, sem antecedência mínima | Sim, para si, com antecedência mínima de 24h (RN-CAN-009) |
| Definir disponibilidade | Sim | Não |
| Criar ou cancelar pacote | Sim | Não |
| Ajustar saldo | Sim | Não |
| Visualizar saldo e validade | Sim | Sim, no próprio pacote |
| Adicionar observação compartilhada | Sim | Sim, no próprio atendimento |
| Registrar controle financeiro | Sim | Não |
| Informar código de vínculo | Não | Sim |

## 15. Histórico de alterações

| Versão | Data | Responsável | Alteração |
|---|---|---|---|
| 0.1.0 | 02/08/2026 | Equipe Rotinaê | Consolidação inicial das regras de negócio do MVP, perfis, vínculo, planos e objetivos de validação |
| 0.2.0 | 02/08/2026 | Equipe Rotinaê | Decisões da revisão Virgil/Cris/Ada sobre vínculo, agenda, estados, recorrência, saldo, finanças, comunicação, planos, segurança e auditoria |
| 0.3.0 | 02/08/2026 | Equipe Rotinaê | Confirmação obrigatória de e-mail, respostas neutras, validade limitada e tokens de recuperação de uso único |
| 0.4.0 | 06/08/2026 | Equipe Rotinaê | RN-PER-016: vínculo restrito a perfis diferentes (Prestador não vincula Prestador, Cliente não vincula Cliente) |
| 0.6.0 | 11/08/2026 | Equipe Rotinaê | RN-COM-016–018: inbox como fonte, push opcional por aparelho, preferência/permissão/logout, rastreio de entrega, receipts e abertura segura (DEC-119). |
| 0.7.0 | 14/08/2026 | Equipe Rotinaê | RN-CAN-008–011: motivo opcional, ausência de antecedência mínima para cancelamento e ausência de efeito automático sobre `manual_payments`. RN-CAN-012–014: restrição da exclusão definitiva (*hard delete*) a agendamentos sem identidade de cliente vinculada (DEC-146, DEC-147). |
| 0.8.0 | 14/08/2026 | Equipe Rotinaê | **Revisão de RN-CAN-009** (corrige v0.7.0/DEC-146): cancelamento pelo cliente passa a exigir antecedência mínima de 24 horas, com orientação explícita para contatar o prestador dentro da janela; RN-CAN-015–016 adicionadas (defesa em profundidade cliente+servidor; cálculo por instante absoluto, distinto do dia útil de RN-AGD-004). Matriz de permissões (seção 14) atualizada. Revisão a pedido explícito do usuário (DEC-150), mesmo padrão de correção formal já usado em DEC-139 para RN-AGD-026. |
| 0.9.0 | 19/08/2026 | Equipe Rotinaê | Nova seção 12.4 — RN-PLN-018 a 023: horizonte de agendamento de 1 mês para o Plano Gratuito, sem limite para Premium ativo (assinatura vigente ou trial), reaproveitando `current_period_ends_at`/`trial_ends_at` já existentes; varredura automática pós-downgrade cancela apenas agendamentos além do novo limite (exceção pontual a RN-PLN-015, sem afetar RN-PLN-003/011), com motivo padronizado, notificação ao cliente (RN-COM-013) e idempotência. |
