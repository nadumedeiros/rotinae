# Disponibilidade definida pelo perfil do prestador

## Regra funcional

Os dias de atendimento, o horário inicial, o horário final e o intervalo entre horários são definidos em **Configurações > Agenda e notificações**.

Ao salvar, esses valores passam a ser a disponibilidade padrão exibida na Agenda do prestador e na seleção de datas e horários do cliente.

Uma vaga específica publicada na Agenda substitui a grade padrão somente naquela data. Em datas sem vagas específicas, a aplicação volta a usar a configuração do perfil.

## Dados utilizados

- `allowedWeekdays`: dias da semana atendidos, usando `0` para domingo e `6` para sábado.
- `workdayStart`: início da jornada no formato `HH:MM`.
- `workdayEnd`: término da jornada no formato `HH:MM`.
- `intervalMinutes`: intervalo da grade em minutos.

No protótipo web, os valores são persistidos em `agendae:provider-settings:v1`. O evento `agendae:provider-settings-updated` atualiza as telas abertas no mesmo navegador. Na integração definitiva, esses valores devem vir do perfil do prestador no backend.

## Menu do cliente

O menu do cabeçalho do perfil Cliente contém todas as rotas funcionais disponíveis para esse papel: Início, Prestadores, Agendar, Alternar ou criar perfil, Configurações e Manual de uso.
