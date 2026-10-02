# Requisitos Funcionais do MVP — Rotinaê

> **Versão:** 0.5.0
> **Status:** Baseline para refinamento e testes  
> **Data:** 14 de agosto de 2026  
> **Origem:** [Visão v0.4.0](./VISAO_DO_PRODUTO.md) · [Regras de Negócio v0.2.0](./REGRAS_DE_NEGOCIO_MVP.md)
> **Governança:** [Backlog e Registro de Decisões](../BACKLOG.md)

## Convenções

- **Must:** necessário ao lançamento do MVP.
- **Should:** importante, podendo ser entregue após o primeiro fluxo operacional utilizável.
- Cada RF deve ser relacionado a histórias e testes por seu identificador estável.

## 1. Autenticação e perfis

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-AUT-001 | Cadastrar, autenticar, encerrar sessão e recuperar acesso. | RN-PER-001–003 | Must |
| RF-AUT-002 | Permitir escolher o perfil inicial no cadastro e adicionar/alternar entre Cliente e Prestador na mesma conta. | RN-PER-001–003, 012 | Must |
| RF-AUT-003 | Exibir funções e dados conforme perfil e autorização persistidos no servidor. | RN-PER-003, 012 | Must |
| RF-AUT-004 | Registrar separadamente aceite dos Termos, ciência da Política e consentimentos opcionais. | RN-COM-003, 008–010 | Must |
| RF-AUT-005 | Consultar e editar dados básicos do próprio perfil. | RN-PER-003 | Must |
| RF-AUT-006 | Enviar e permitir reenviar mensagem de confirmação após o cadastro. | RN-PER-013, 014 | Must |
| RF-AUT-007 | Bloquear o acesso autenticado enquanto o e-mail não estiver confirmado. | RN-PER-013 | Must |
| RF-AUT-008 | Solicitar recuperação de senha com resposta neutra e link temporário. | RN-PER-014, 015 | Must |
| RF-AUT-009 | Permitir definir nova senha com token válido e exibir feedback de sucesso, expiração ou erro. | RN-PER-015 | Must |

## 2. Vínculos

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-VIN-001 | Gerar, exibir, revogar e regenerar código seguro do prestador. | RN-PER-004, 009 | Must |
| RF-VIN-002 | Permitir ao cliente solicitar vínculo informando o código. | RN-PER-005, 007 | Must |
| RF-VIN-003 | Permitir ao prestador aprovar ou rejeitar solicitação pendente. | RN-PER-007, 010 | Must |
| RF-VIN-004 | Liberar dados e operações apenas para vínculo Ativo. | RN-PER-007, 010 | Must |
| RF-VIN-005 | Permitir vários vínculos independentes por cliente. | RN-PER-008 | Must |
| RF-VIN-006 | Consultar vínculos por estado e selecionar o contexto do prestador. | RN-PER-008, 010 | Must |
| RF-VIN-007 | Revogar vínculo sem apagar o histórico sujeito à retenção. | RN-PER-011 | Must |
| RF-VIN-008 | Permitir envio assíncrono de convite individual de vínculo por e-mail ao cadastrar o cliente, sem ativação automática. | RN-PER-007, RN-COM-008 | Should |
| RF-VIN-009 | Ao aprovar uma solicitação, reconciliar a conta autenticada com o cadastro interno existente por identidade verificada, sem duplicar histórico ou aplicar mesclagem automática por nome/telefone. | RN-PER-007, RN-PER-014 | Must |

## 3. Cadastros e serviços

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-CAD-001 | Prestador cadastrar, consultar e editar clientes de sua carteira. | RN-PER-003, 010 | Must |
| RF-CAD-002 | Consultar o histórico operacional de cliente vinculado. | RN-PER-003, 011 | Must |
| RF-CAD-003 | Cadastrar, consultar e editar animais vinculados ao cliente. | RN-PER-006 | Must |
| RF-CAD-004 | Cadastrar, editar, ativar e inativar serviços com nome, duração e valor de referência. | RN-AGD-002, 003 | Must |
| RF-CAD-005 | Cliente consultar serviços dos prestadores com vínculo Ativo. | RN-PER-010, RN-AGD-007 | Must |
| RF-CAD-006 | Prestador configurar por cliente valor do serviço, limite total, limite diário e período permitido, com opção Livre para cada restrição. | RN-AGD-015–018, 021 | Must |
| RF-CAD-007 | Cliente consultar valor, limites, saldo de quantidade e período aplicáveis ao próprio contexto de prestador. | RN-AGD-018, 023 | Must |

## 4. Disponibilidade e agenda

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-AGE-001 | Prestador configurar dias, faixas, intervalos, bloqueios e exceções. | RN-AGD-002, 003, 013 | Must |
| RF-AGE-002 | Exibir slots compatíveis com disponibilidade, duração e compromissos. | RN-AGD-002, 003 | Must |
| RF-AGE-003 | Prestador criar atendimento para cliente com vínculo Ativo. | RN-AGD-001–005, 007 | Must |
| RF-AGE-004 | Cliente criar diretamente o próprio atendimento, sem aprovação adicional. | RN-AGD-001–004, 006, 014 | Must |
| RF-AGE-005 | Impedir conflito, dupla reserva e operação fora da disponibilidade. | RN-AGD-002, 003, 012 | Must |
| RF-AGE-006 | Aplicar um dia útil de antecedência conforme fuso e calendário definidos. | RN-AGD-004, 008, 009 | Must |
| RF-AGE-007 | Prestador editar ou remarcar atendimento Agendado. | RN-AGD-005, 012 | Must |
| RF-AGE-008 | Cliente remarcar somente o próprio atendimento Agendado. | RN-AGD-006, 007, 012 | Must |
| RF-AGE-009 | Consultar agenda em lista e calendário, com filtros e status. | RN-AGD-005, 006, 010 | Must |
| RF-AGE-010 | Preservar o agendamento original quando uma remarcação falhar. | RN-AGD-012 | Must |
| RF-AGE-011 | Validar atomicamente limite total, limite diário e período por cliente antes de criar ou remarcar. | RN-AGD-015–022 | Must |
| RF-AGE-012 | Informar ao cliente qual restrição impediu a solicitação sem expor dados internos ou de outros vínculos. | RN-AGD-019, 022 | Must |
| RF-AGE-013 | Registrar no agendamento o valor do serviço vigente no momento da confirmação. | RN-AGD-023 | Must |

## 5. Recorrência

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-REC-001 | Configurar recorrência semanal, quinzenal ou mensal, com término e até 52 ocorrências. | RN-REC-001, 005, 006 | Must |
| RF-REC-002 | Gerar ocorrências independentes mantendo referência à série. | RN-REC-002, 008 | Must |
| RF-REC-003 | Validar toda a série e criá-la atomicamente. | RN-REC-004, 007 | Must |
| RF-REC-004 | Informar conflitos antes da confirmação. | RN-REC-007 | Must |
| RF-REC-005 | Remarcar ou cancelar uma ocorrência sem alterar as demais. | RN-REC-003, 008 | Must |

## 6. Atendimento, cancelamento e observações

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-ATE-001 | Criar atendimento no estado Agendado. | RN-AGD-010 | Must |
| RF-ATE-002 | Prestador alterar Agendado para Concluído ou Não compareceu. | RN-AGD-010, 011 | Must |
| RF-ATE-003 | Registrar autor, instante e transição de estado. | RN-AGD-010, 011 | Must |
| RF-CAN-001 | Prestador ou cliente autorizado cancelar atendimento Agendado. | RN-CAN-001, 006 | Must |
| RF-CAN-002 | Liberar slot e eventual reserva de saldo após cancelamento. | RN-CAN-002, RN-PAC-011 | Must |
| RF-CAN-003 | Notificar a parte afetada sem tornar a operação dependente do envio. | RN-CAN-003, 007 | Must |
| RF-CAN-004 | Preservar atendimento Cancelado no histórico. | RN-CAN-004, 005 | Must |
| RF-CAN-005 | Permitir que o cliente cancele o próprio atendimento pelo mesmo mecanismo de cancelamento e notificação já usado pelo prestador, com motivo opcional. | RN-CAN-001, 008, 009 | Must |
| RF-CAN-006 | Restringir a exclusão definitiva (*hard delete*) de agendamento a registros sem identidade de cliente vinculada, oferecendo apenas o cancelamento nos demais casos. | RN-CAN-012–014 | Must |
| RF-CAN-007 | Impedir o cancelamento pelo cliente quando faltarem menos de 24 horas para o início do atendimento, orientando explicitamente a contatar o prestador em vez de bloquear a ação sem explicação. | RN-CAN-009, 010 | Must |
| RF-CAN-008 | Validar a antecedência mínima de cancelamento tanto na interface quanto na RPC `cancel_appointment`, retornando um código de erro específico (`CANCELLATION_ADVANCE_NOTICE_INVALID`) quando a validação falhar no servidor. | RN-CAN-015, 016 | Must |
| RF-OBS-001 | Prestador e cliente adicionar observações compartilhadas ao atendimento. | RN-OBS-001–005 | Must |
| RF-OBS-002 | Exibir autor e data; permitir edição/exclusão autorizada com auditoria. | RN-OBS-006–008 | Must |
| RF-OBS-003 | Permitir no agendamento uma mensagem compartilhada com o cliente e uma observação interna exclusiva do prestador, com identificação clara de visibilidade. | RN-OBS-009, 010 | Must |
| RF-EVO-001 | Prestador registrar atividades e evolução cronológica do serviço. | RN-PER-003 | Must |
| RF-EVO-002 | Prestador definir se cada evolução será privada ou compartilhada com o cliente. | RN-PER-003 | Should |

## 7. Pacotes e saldo

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-PAC-001 | Criar pacote com cliente, serviço, saldo inicial, valor e validade opcional. | RN-PAC-001, 002, 007, 014 | Must |
| RF-PAC-002 | Consultar pacotes Ativos, Vencidos e Cancelados. | RN-PAC-004, 007, RN-CPA-002 | Must |
| RF-PAC-003 | Cliente consultar saldo, validade e histórico dos próprios pacotes. | RN-PAC-004, 008 | Must |
| RF-PAC-004 | Vincular atendimento a pacote compatível, ativo, válido e com saldo. | RN-PAC-009, 013, 014 | Must |
| RF-PAC-005 | Reservar unidade ao agendar e consumir uma única vez ao concluir ou registrar falta. | RN-PAC-009, 010, 012, 016 | Must |
| RF-PAC-006 | Liberar reserva ao cancelar atendimento. | RN-PAC-011 | Must |
| RF-PAC-007 | Ajustar saldo manualmente com motivo e trilha completa. | RN-PAC-005, 006, 015 | Must |
| RF-PAC-008 | Cancelar pacote, liberar reservas futuras e preservar histórico. | RN-CPA-001–006 | Must |

## 8. Financeiro básico

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-FIN-001 | Registrar manualmente valor a receber em reais, cliente, origem e vencimento. | RN-FIN-001–004 | Must |
| RF-FIN-002 | Alterar status entre Pendente, Pago, Atrasado e Cancelado com auditoria. | RN-FIN-004, 006 | Must |
| RF-FIN-003 | Exibir resumo de valores por status e período. | RN-FIN-003, 004 | Should |
| RF-FIN-004 | Não processar pagamentos dos serviços. | RN-FIN-001 | Must |
| RF-FIN-005 | Registrar quitação parcial, recalcular o saldo pendente e manter uma linha consultável para cada valor recebido. | RN-FIN-005, 007 | Must |
| RF-FIN-006 | Ao excluir uma quitação lançada incorretamente, restaurar seu valor ao saldo pendente e auditar a correção. | RN-FIN-006, 008 | Must |

## 9. Arquivos, comunicação e consentimento

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-ARQ-001 | Prestador anexar, consultar e remover arquivos autorizados de cliente, animal ou atendimento. | RN-PER-003 | Should |
| RF-ARQ-002 | Restringir cada arquivo ao tenant, vínculo e usuários autorizados. | RN-PER-010–012 | Must |
| RF-COM-001 | Configurar preferências por canal e finalidade. | RN-COM-004, 008–010 | Must |
| RF-COM-002 | Enviar confirmação, lembrete e cancelamento por canal habilitado. | RN-COM-001, 005–007 | Must |
| RF-COM-003 | Registrar canal, destinatário, instante, resultado e retentativas. | RN-COM-011, 012 | Must |
| RF-COM-004 | Usar templates padronizados e dados mínimos, sem editor avançado. | RN-COM-006, 007, 011 | Must |
| RF-COM-005 | No Android/iOS, solicitar permissão, registrar/desativar o aparelho, entregar push conforme preferência e abrir com segurança a rota interna correspondente ao evento. | RN-COM-016–018 | Must |

## 10. Planos e assinatura

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-PLN-001 | Ativar uma única vez o teste Premium de 30 dias para prestador elegível. | RN-PLN-001, 013 | Must |
| RF-PLN-002 | Exibir plano, benefícios, cota usada e término do teste/assinatura. | RN-PLN-002–007 | Must |
| RF-PLN-003 | Calcular e aplicar a cota diária de 2 ocorrências do Gratuito. | RN-PLN-003, 004, 008–010 | Must |
| RF-PLN-004 | Restringir recursos conforme Gratuito e Premium, incluindo o máximo de 5 clientes e o bloqueio de novas notas internas na página do cliente no Gratuito. | RN-PLN-011, 012 | Must |
| RF-PLN-005 | Preservar dados e atendimentos no downgrade, bloqueando novas operações incompatíveis. | RN-PLN-014, 015 | Must |
| RF-PLN-006 | Ofertar Premium por R$ 29,00/mês e executar contratação, renovação e cancelamento. | RN-PLN-005–007, 016 | Must |
| RF-PLN-007 | Tratar falha de cobrança e atualizar o acesso de forma idempotente. | RN-PLN-016 | Must |
| RF-PLN-008 | Agendar o downgrade quando houver cancelamento durante o teste e manter o Premium ativo até o fim dos 30 dias. | RN-PLN-017 | Must |
| RF-PLN-009 | Validar no servidor, na criação e na remarcação de agendamento, o horizonte de 1 mês à frente para prestador sem Premium ativo, retornando um código de erro específico (`PLAN_LIMIT_REACHED`) quando o horizonte for ultrapassado. | RN-PLN-018, 019, 023 | Must |
| RF-PLN-010 | Expor consulta somente leitura do horizonte permitido (irrestrito ou data máxima) por tenant, destinada exclusivamente à otimização de UX do seletor de datas; nunca substitui a validação server-side de RF-PLN-009. | RN-PLN-023 | Should |
| RF-PLN-011 | Ao efetivar o downgrade do prestador (fim do período pago ou do trial sem conversão), varrer os agendamentos futuros do prestador e cancelar automaticamente apenas os que ultrapassarem o novo limite de 1 mês, preservando os demais. | RN-PLN-020, 021 | Must |
| RF-PLN-012 | Registrar cada cancelamento automático de RF-PLN-011 com motivo padronizado e trilha de auditoria distinta de cancelamento manual, e notificar o cliente vinculado pelo mesmo mecanismo já usado para cancelamento (RF-CAN-003). | RN-PLN-022 | Must |
| RF-PLN-013 | Garantir que a rotina de varredura de RF-PLN-011 seja idempotente, não duplicando cancelamento nem notificação em reprocessamentos. | RN-PLN-023 | Must |

## 11. Multiplataforma, segurança e auditoria funcional

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-MUL-001 | Disponibilizar fluxos Must em smartphones, tablets e computadores. | RN-PER-001–003 | Must |
| RF-COM-009 | Enviar WhatsApp somente para confirmação e lembrete de agendamento quando houver telefone válido e consentimento específico vigente. | RN-COM-008 | Should |
| RF-MUL-002 | Sincronizar dados entre dispositivos pelo back-end central. | RN-PER-003 | Must |
| RF-SEG-001 | Impedir acesso entre tenants e restringir cliente aos próprios dados em vínculos Ativos. | RN-PER-010–012 | Must |
| RF-SEG-002 | Auditar vínculo, estado, cancelamento, saldo, financeiro, consentimento e ações administrativas. | RN-PAC-015, RN-FIN-006, RN-COM-008 | Must |
| RF-PRI-001 | Permitir solicitação autenticada de acesso, correção, exportação e eliminação quando aplicável. | RN-COM-008–010 | Must |

## 12. Landing page

| ID | Requisito | RN | Pri. |
|---|---|---|---|
| RF-LAN-001 | Apresentar proposta de valor, funcionalidades, planos e chamada para cadastro. | RN-PLN-001–016 | Must |
| RF-LAN-002 | Disponibilizar Termos de Uso e Política de Privacidade vigentes. | RN-COM-003, 008 | Must |

## Matriz de cobertura por domínio

| Domínio | RN | RF | HU |
|---|---|---|---|
| Perfil e vínculo | RN-PER | RF-AUT, RF-VIN | HU-AUT, HU-VIN |
| Agenda e recorrência | RN-AGD, RN-REC, RN-CAN | RF-AGE, RF-REC, RF-ATE, RF-CAN | HU-AGE, HU-REC, HU-CAN |
| Observações e evolução | RN-OBS | RF-OBS, RF-EVO | HU-OBS, HU-EVO |
| Pacotes | RN-PAC, RN-CPA | RF-PAC | HU-PAC |
| Financeiro | RN-FIN | RF-FIN | HU-FIN |
| Comunicação | RN-COM | RF-COM | HU-COM |
| Planos | RN-PLN | RF-PLN | HU-PLN |
| Segurança e privacidade | RN-PER, RN-COM | RF-SEG, RF-PRI | HU-PRI |

## Histórico

| Versão | Data | Alteração |
|---|---|---|
| 0.1.0 | 02/08/2026 | Catálogo inicial de requisitos funcionais, consolidado por Virgil e revisado por Cris e Ada |
| 0.2.0 | 02/08/2026 | Inclusão dos requisitos de confirmação de e-mail, reenvio, recuperação e alteração segura de senha |
| 0.3.0 | 11/08/2026 | Inclusão de entrega push nativa com permissão, token por instalação, preferência, rastreabilidade e abertura segura (DEC-119). |
| 0.4.0 | 14/08/2026 | RF-CAN-005 (cancelamento pelo cliente reaproveitando o mecanismo já existente do prestador) e RF-CAN-006 (restrição da exclusão definitiva a agendamentos sem identidade de cliente vinculada) (DEC-146, DEC-147). |
| 0.5.0 | 14/08/2026 | RF-CAN-007 (bloqueio do cancelamento pelo cliente dentro de 24h do horário, com orientação para contatar o prestador) e RF-CAN-008 (validação client-side e server-side da antecedência mínima, com o código `CANCELLATION_ADVANCE_NOTICE_INVALID`), revisando RF-CAN-005/RN-CAN-009 a pedido do usuário (DEC-150). |
| 0.6.0 | 19/08/2026 | RF-PLN-009 a 013: horizonte de agendamento de 1 mês para o Plano Gratuito, validado no servidor com o código `PLAN_LIMIT_REACHED`; consulta de leitura para otimização de UX; varredura automática pós-downgrade com motivo padronizado, notificação ao cliente e idempotência. |
