# Histórias de Usuário do MVP — Rotinaê

> **Versão:** 0.2.0  
> **Status:** Baseline para refinamento do backlog  
> **Data:** 2 de agosto de 2026  
> **Rastreabilidade:** [RN v0.3.0](./REGRAS_DE_NEGOCIO_MVP.md) · [RF v0.2.0](./REQUISITOS_FUNCIONAIS_MVP.md) · [RNF v0.1.0](./REQUISITOS_NAO_FUNCIONAIS_MVP.md)
> **Governança:** [Backlog e Registro de Decisões](../BACKLOG.md)

## Convenções

- **Must:** necessária ao lançamento; **Should:** entrega posterior aceitável dentro do MVP incremental.
- Critérios usam Dado/Quando/Então e complementam, sem substituir, as RN/RF/RNF relacionadas.

## Épico 1 — Identidade e vínculo

### HU-AUT-001 — Cadastrar com perfil `Must`

**Como** novo usuário, **quero** escolher Prestador ou Cliente, **para** acessar as funções do meu papel.  
**RF:** RF-AUT-001–004 · **RN:** RN-PER-001–003, 012 · **RNF:** RNF-SEG-003, 004

- Dado cadastro válido e aceite dos documentos obrigatórios, quando escolher um perfil, então a conta será criada com esse perfil persistido.
- Dado perfil Cliente, quando tentar função exclusiva do Prestador, então o servidor negará acesso sem expor dados.

### HU-AUT-002 — Confirmar e-mail `Must`

**Como** novo usuário, **quero** confirmar meu e-mail, **para** ativar a conta com segurança.  
**RF:** RF-AUT-006, 007 · **RN:** RN-PER-013, 014 · **RNF:** RNF-SEG-003, 004

- Dado cadastro válido, quando a conta for criada, então será enviada confirmação e o acesso permanecerá bloqueado até a validação.
- Dado pedido de reenvio, quando ele for aceito, então a resposta será neutra e não revelará a existência de contas.

### HU-AUT-003 — Alterar senha por recuperação `Must`

**Como** usuário sem acesso, **quero** definir uma nova senha por um link seguro, **para** recuperar minha conta.  
**RF:** RF-AUT-008, 009 · **RN:** RN-PER-014, 015 · **RNF:** RNF-SEG-003, 004

- Token válido e senha compatível alteram a credencial uma única vez e exibem sucesso.
- Token expirado, inválido ou já utilizado não altera a senha e produz feedback seguro, sem detalhes técnicos.

### HU-VIN-001 — Solicitar vínculo `Must`

**Como** cliente, **quero** informar o código de um prestador, **para** solicitar vínculo.  
**RF:** RF-VIN-001, 002 · **RN:** RN-PER-004, 005, 007, 009 · **RNF:** RNF-VIN-001–003

- Código válido cria uma única solicitação Pendente, sem conceder acesso.
- Código inválido, revogado ou tentativa excessiva não revela dados privados e não cria vínculo.

### HU-VIN-002 — Aprovar vínculo `Must`

**Como** prestador, **quero** aprovar ou rejeitar solicitações, **para** controlar minha carteira.  
**RF:** RF-VIN-003, 004 · **RN:** RN-PER-007, 010

- Aprovar transforma Pendente em Ativo e libera somente o escopo autorizado.
- Rejeitar impede o acesso; vínculos do cliente com outros prestadores permanecem independentes.

### HU-VIN-003 — Selecionar ou revogar vínculo `Must`

**Como** usuário vinculado, **quero** selecionar ou encerrar o contexto do prestador, **para** operar com os dados corretos.  
**RF:** RF-VIN-005–007 · **RN:** RN-PER-008, 010, 011 · **RNF:** RNF-VIN-004

- Ao selecionar prestador, somente seus serviços, agenda, pacotes e dados autorizados serão exibidos.
- Revogar corta novas operações em até 60 segundos e preserva histórico sujeito à retenção.

## Épico 2 — Cadastros e disponibilidade

### HU-CAD-001 — Gerenciar clientes e animais `Must`

**Como** prestador, **quero** cadastrar clientes e animais, **para** manter seu histórico operacional.  
**RF:** RF-CAD-001–003 · **RN:** RN-PER-003, 006, 010

- Cadastro ficará isolado no tenant do prestador.
- Atualizar dados não romperá atendimentos, pacotes ou histórico existentes.

### HU-CAD-002 — Gerenciar serviços `Must`

**Como** prestador, **quero** cadastrar serviços com duração e valor, **para** oferecê-los na agenda.  
**RF:** RF-CAD-004, 005 · **RN:** RN-AGD-002, 003

- Serviço ativo e válido aparecerá para clientes com vínculo Ativo.
- Serviço inativo não aceitará novos agendamentos e não apagará o histórico.

### HU-AGE-001 — Configurar disponibilidade `Must`

**Como** prestador, **quero** definir horários, intervalos e bloqueios, **para** controlar os slots oferecidos.  
**RF:** RF-AGE-001, 002 · **RN:** RN-AGD-002, 003, 013, 024

- Somente slots compatíveis com duração, bloqueios e compromissos serão oferecidos.
- Alterar a grade não cancelará atendimentos existentes; eventuais conflitos serão sinalizados.
- O bloqueio retira o intervalo das opções do cliente, mas permite inclusão manual pelo prestador.
- Nenhum compromisso anterior será cancelado automaticamente; o prestador decidirá cada cancelamento.

## Épico 3 — Agenda e recorrência

### HU-AGE-002 — Agendar como cliente `Must`

**Como** cliente com vínculo Ativo, **quero** reservar diretamente um horário, **para** marcar meu atendimento.  
**RF:** RF-AGE-004–006 · **RN:** RN-AGD-001–004, 006, 014 · **RNF:** RNF-DES-002

- Slot disponível e antecedência válida criam atendimento Agendado sem aprovação adicional.
- Duas confirmações concorrentes do mesmo slot produzem exatamente um sucesso.

### HU-AGE-003 — Agendar como prestador `Must`

**Como** prestador, **quero** agendar para cliente vinculado, **para** organizar minha operação.  
**RF:** RF-AGE-003, 005, 006 · **RN:** RN-AGD-001–005, 007

- Cliente sem vínculo Ativo, conflito ou antecedência inválida impedem a criação.
- O prestador poderá criar manualmente dentro de um bloqueio próprio; conflitos com outros compromissos continuarão proibidos.
- A regra de um dia útil também será aplicada ao prestador.

### HU-AGE-004 — Consultar agenda `Must`

**Como** usuário, **quero** consultar atendimentos e estados, **para** acompanhar meus compromissos.  
**RF:** RF-AGE-009 · **RN:** RN-AGD-005, 006, 010

- Prestador verá apenas sua operação; cliente verá apenas seus atendimentos separados por prestador.
- Registros terminais permanecerão no histórico com seu estado.

### HU-AGE-005 — Remarcar atendimento `Must`

**Como** participante, **quero** remarcar atendimento Agendado, **para** adequar data e horário.  
**RF:** RF-AGE-007, 008, 010 · **RN:** RN-AGD-003–007, 012

- Novo slot válido será ocupado e o anterior liberado atomicamente.
- Se o novo slot falhar, o horário original permanecerá intacto.

### HU-REC-001 — Criar série recorrente `Must`

**Como** participante, **quero** criar recorrência, **para** evitar agendamentos repetitivos.  
**RF:** RF-REC-001–004 · **RN:** RN-REC-001–008

- Série válida semanal, quinzenal ou mensal criará até 52 ocorrências independentes.
- Se uma ocorrência falhar por agenda, cota ou saldo, nenhuma será criada e os conflitos serão exibidos.

### HU-REC-002 — Alterar ocorrência `Must`

**Como** participante, **quero** alterar uma ocorrência, **para** tratar uma exceção sem afetar a série.  
**RF:** RF-REC-005 · **RN:** RN-REC-002, 003, 008

- Somente a ocorrência escolhida mudará e continuará referenciando a série para auditoria.

### HU-CAN-001 — Cancelar atendimento `Must`

**Como** participante autorizado, **quero** cancelar, **para** liberar o horário preservando o histórico.  
**RF:** RF-CAN-001–004 · **RN:** RN-CAN-001–007

- Atendimento Agendado ficará Cancelado, liberará slot e reserva de saldo e continuará no histórico.
- Estados terminais não poderão ser cancelados; falha da notificação não desfará o cancelamento.

### HU-ATE-001 — Finalizar atendimento `Must`

**Como** prestador, **quero** marcar Concluído ou Não compareceu, **para** fechar a ocorrência.  
**RF:** RF-ATE-001–003 · **RN:** RN-AGD-010, 011, RN-PAC-010, 012

- Apenas o prestador poderá realizar a transição a partir de Agendado.
- Repetição ou concorrência consumirá a reserva no máximo uma vez.

## Épico 4 — Observações e evolução

### HU-OBS-001 — Registrar observação compartilhada `Must`

**Como** participante, **quero** adicionar observações, **para** compartilhar informações do atendimento.  
**RF:** RF-OBS-001, 002 · **RN:** RN-OBS-001–008 · **RNF:** RNF-ARQ-005

- Observação válida exibirá autor e data para ambas as partes.
- Edição ou exclusão será autorizada e auditada; conteúdo malicioso será neutralizado.
- O recurso não terá atualização em tempo real nem comportamento de chat.
- No formulário de agendamento, “Mensagem para o cliente” será compartilhada e “Observação interna” ficará disponível somente ao prestador.
- A API destinada ao cliente omitirá integralmente a observação interna.

### HU-EVO-001 — Registrar evolução `Must`

**Como** prestador, **quero** registrar atividades e progresso, **para** acompanhar o serviço.  
**RF:** RF-EVO-001 · **RN:** RN-PER-003

- Registro será cronológico, autorado e associado a cliente, animal e atendimento quando aplicável.
- Cliente não poderá editar a evolução técnica.

### HU-EVO-002 — Compartilhar evolução `Should`

**Como** prestador, **quero** definir a visibilidade da evolução, **para** separar anotação interna de informação ao cliente.  
**RF:** RF-EVO-002 · **RN:** RN-PER-003

- Evolução será privada por padrão e somente ficará visível ao cliente após marcação explícita de compartilhamento.

## Épico 5 — Pacotes

### HU-PAC-001 — Criar e consultar pacote `Must`

**Como** prestador, **quero** criar pacote com saldo e validade, **para** controlar o contratado.  
**RF:** RF-PAC-001–003 · **RN:** RN-PAC-001, 002, 004, 007, 014

- Saldo inicial será inteiro positivo; validade não poderá ser anterior à criação.
- Usuário autorizado verá saldo disponível, reservado, consumido, validade e movimentações.

### HU-PAC-002 — Reservar e consumir saldo `Must`

**Como** usuário autorizado, **quero** vincular atendimento a pacote, **para** controlar seu uso.  
**RF:** RF-PAC-004–006 · **RN:** RN-PAC-009–014, 016 · **RNF:** RNF-DES-002

- Agendamento reserva uma unidade; conclusão ou falta consome; cancelamento libera.
- Pacote vencido, cancelado, incompatível ou sem saldo não aceitará vínculo.
- Concorrência pela última unidade produzirá exatamente um sucesso.

### HU-PAC-003 — Ajustar saldo `Must`

**Como** prestador, **quero** ajustar saldo com justificativa, **para** corrigir situações operacionais.  
**RF:** RF-PAC-007 · **RN:** RN-PAC-005, 006, 013, 015

- Ajuste não poderá gerar saldo negativo nem reduzir disponível abaixo das reservas.
- Auditoria registrará motivo, ator, instante e valores anterior/posterior.

### HU-PAC-004 — Cancelar pacote `Must`

**Como** prestador, **quero** cancelar pacote, **para** impedir novos usos.  
**RF:** RF-PAC-008 · **RN:** RN-CPA-001–006

- Cancelamento liberará reservas futuras e manterá os atendimentos sem vínculo ao pacote.
- Saldo restante ficará indisponível e histórico será preservado.

## Épico 6 — Financeiro

### HU-FIN-001 — Controlar recebimento `Must`

**Como** prestador, **quero** registrar manualmente valor e status, **para** acompanhar recebimentos.  
**RF:** RF-FIN-001, 002, 004 · **RN:** RN-FIN-001–006

- Lançamento válido terá reais, cliente, origem, vencimento e status permitido.
- A plataforma não solicitará meio de pagamento nem confirmará liquidação bancária.

### HU-FIN-002 — Consultar resumo `Should`

**Como** prestador, **quero** consultar totais por período e status, **para** acompanhar o básico da operação.  
**RF:** RF-FIN-003 · **RN:** RN-FIN-003–005

- Resumo usará somente lançamentos do tenant e não será apresentado como relatório contábil ou fiscal.
- Comissões, despesas avançadas e parcelamentos não farão parte do MVP.

## Épico 7 — Comunicação e arquivos

### HU-COM-001 — Gerenciar preferências `Must`

**Como** usuário, **quero** configurar comunicações por canal e finalidade, **para** controlar envios opcionais.  
**RF:** RF-COM-001 · **RN:** RN-COM-003, 004, 008–010

- Preferências opcionais serão separadas dos documentos obrigatórios, versionadas e revogáveis.
- Recusa de comunicação opcional não bloqueará funções independentes.

### HU-COM-002 — Receber comunicação operacional `Must`

**Como** usuário, **quero** receber confirmações, lembretes e cancelamentos, **para** acompanhar a agenda.  
**RF:** RF-COM-002–004 · **RN:** RN-COM-001, 002, 005–012 · **RNF:** RNF-DIS-002

- Evento enfileirará mensagem mínima em canal habilitado e registrará resultado.
- Falha do provedor não desfará a operação e não haverá editor avançado de template.

### HU-ARQ-001 — Gerenciar anexos `Should`

**Como** prestador, **quero** anexar arquivos autorizados, **para** centralizar documentos relevantes.  
**RF:** RF-ARQ-001, 002 · **RN:** RN-PER-003, 010–012 · **RNF:** RNF-ARQ-001–004

- Tipo ou tamanho inválido será recusado; arquivo válido ficará privado e sujeito à validação de segurança.
- Usuário de outro tenant ou sem vínculo autorizado não poderá listar nem baixar o arquivo.

## Épico 8 — Planos e experiência transversal

### HU-PLN-001 — Experimentar Premium `Must`

**Como** novo prestador, **quero** usar Premium por 30 dias, **para** avaliar o produto.  
**RF:** RF-PLN-001, 002 · **RN:** RN-PLN-001, 002, 013

- Trial será concedido uma vez à identidade verificada, com início e fim registrados.
- Cliente não receberá trial nem contratará plano.

### HU-PLN-002 — Aplicar limite gratuito `Must`

**Como** responsável pelo produto, **quero** limitar o Gratuito, **para** incentivar conversão.  
**RF:** RF-PLN-003 · **RN:** RN-PLN-003, 004, 008–010

- A terceira ocorrência do mesmo dia será recusada sem efeitos parciais.
- Ocorrências recorrentes contam individualmente; cancelamento libera e remarcação transfere a cota.

### HU-PLN-003 — Assinar Premium `Must`

**Como** prestador, **quero** contratar Premium por R$ 29/mês, **para** remover limites e acessar recursos.  
**RF:** RF-PLN-004–007 · **RN:** RN-PLN-005–007, 011–016

- Confirmação idempotente ativa Premium; falha de pagamento não gera ativações duplicadas.
- Downgrade preserva dados e agenda existente, bloqueando apenas novas operações não permitidas.

### HU-PLN-004 — Respeitar horizonte de agendamento do plano `Must`

**Como** prestador, **quero** que o limite de meses à frente para novos agendamentos respeite meu plano atual, **para** ter liberdade total no Premium e um limite claro no Gratuito.
**RF:** RF-PLN-009, 010 · **RN:** RN-PLN-018, 019, 023

- Prestador com Premium ativo (assinatura vigente ou trial em curso) cria e remarca agendamentos em qualquer data futura, sem bloqueio de horizonte.
- Prestador no Plano Gratuito tem novas criações e remarcações recusadas com um código de erro específico quando a data solicitada ultrapassa 1 mês à frente da data atual; agendamentos já existentes além desse limite não são afetados por esta história.
- A validação que efetivamente impede a operação ocorre no servidor; uma eventual checagem na tela é só uma otimização de UX.
- Cada ocorrência de uma série recorrente é avaliada individualmente: uma ocorrência fora do horizonte é recusada sem impedir a criação das demais que estejam dentro do limite, dentro dos limites já vigentes de atomicidade da série (RN-REC-007).

### HU-PLN-005 — Ajustar agenda automaticamente após downgrade `Must`

**Como** responsável pelo produto, **quero** que agendamentos além do novo limite de meses sejam cancelados automaticamente quando o prestador perder o Premium, **para** manter a agenda coerente com o plano vigente sem exigir ação manual do prestador.
**RF:** RF-PLN-011–013 · **RN:** RN-PLN-020–023

- Ao encerrar o período pago (ou o trial, sem conversão), o sistema varre os agendamentos futuros do prestador e cancela automaticamente somente os que ultrapassam o novo limite de 1 mês; os que estão dentro do limite permanecem intactos, mesmo sendo esta uma exceção ao comportamento padrão de preservação no downgrade (RN-PLN-015).
- Cada cancelamento automático registra um motivo padronizado, diferente do texto usado em um cancelamento manual, e fica associado a uma trilha própria para auditoria e eventual reversão.
- O cliente vinculado ao agendamento cancelado automaticamente recebe a mesma notificação de cancelamento já usada para os demais casos (RN-COM-013), sem necessidade de um novo tipo de notificação.
- Reprocessar a varredura para o mesmo evento de downgrade não duplica cancelamento nem notificação (idempotência).

### HU-SEG-001 — Manter dados isolados `Must`

**Como** usuário, **quero** que somente pessoas autorizadas acessem meus dados, **para** preservar privacidade.  
**RF:** RF-SEG-001, 002, RF-PRI-001 · **RN:** RN-PER-010–012 · **RNF:** RNF-SEG-001–008

- Manipular identificadores não permitirá CRUD em outro tenant, vínculo ou usuário.
- Ação crítica autorizada criará auditoria sem copiar conteúdo sensível.

### HU-MUL-001 — Usar em diferentes dispositivos `Must`

**Como** usuário, **quero** acessar por smartphone, tablet e computador, **para** trabalhar no dispositivo disponível.  
**RF:** RF-MUL-001, 002 · **RNF:** RNF-ACE-001–003, RNF-COM-001, 002

- Todos os fluxos Must serão utilizáveis nas plataformas suportadas e sincronizarão pelo back-end.

## Definição de pronto das histórias

Uma HU somente poderá ser concluída quando:

- todos os critérios de aceite estiverem automatizados quando tecnicamente viável;
- permissões positivas e negativas tiverem sido testadas;
- RN, RF e RNF relacionados estiverem atendidos;
- estados, auditoria e efeitos colaterais estiverem validados;
- interface tiver estados de carregamento, vazio, erro e sucesso;
- telemetria não expuser dados sensíveis;
- documentação e matriz de rastreabilidade estiverem atualizadas.

## Histórico

| Versão | Data | Alteração |
|---|---|---|
| 0.1.0 | 02/08/2026 | Catálogo inicial elaborado por Cris, consolidado por Virgil e revisado por Ada |
| 0.2.0 | 02/08/2026 | Histórias e critérios de aceite para confirmação de e-mail e recuperação/alteração de senha |
| 0.3.0 | 19/08/2026 | HU-PLN-004 (horizonte de agendamento de 1 mês no Plano Gratuito, sem limite no Premium) e HU-PLN-005 (cancelamento automático, idempotente e notificado, dos agendamentos além do novo limite após o downgrade) |
