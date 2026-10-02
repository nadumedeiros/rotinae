# Handoff — Multiperfil e bloqueio de agenda

Atualizado em 04/08/2026.

## Uma conta, dois perfis

Uma identidade autenticada pode possuir `roles: (provider | client)[]` e exatamente um `activeRole`. Criar o segundo perfil não cria outro usuário, não troca o e-mail e não duplica vínculos.

- `addRole` cria somente o perfil ausente, de forma idempotente;
- `switchRole` aceita apenas um papel já provisionado e emite/atualiza contexto de sessão;
- toda autorização no servidor usa perfil ativo, tenant e propriedade; esconder menus no front não concede segurança;
- dados profissionais e dados de Cliente permanecem em recursos/contextos separados;
- alternar perfil invalida caches do contexto anterior e nenhuma notificação privada atravessa contextos;
- auditoria registra criação de perfil e alternância, sem tratá-las como novo login;
- remoção/desativação de um perfil não exclui automaticamente a identidade nem o outro perfil.

O front possui `/switch-profile`, diferencia **Criar perfil** de **Alternar perfil**, oferece um início isolado em `/client-home` e mantém compatibilidade temporária com sessões antigas pelo campo `role`.

## Bloqueio de agenda

`AppointmentPort` expõe `listAvailabilityBlocks`, `createAvailabilityBlock` e `deleteAvailabilityBlock`. O bloqueio contém início, fim, timezone, motivo opcional e `conflictPolicy: keep_existing`.

- início deve ser anterior ao fim; datas civis são convertidas para UTC no servidor usando o fuso do prestador;
- sobreposição retorna `AGENDA_BLOCK_OVERLAP` ou segue política explícita de consolidação;
- compromissos existentes não são cancelados automaticamente em nenhuma hipótese;
- novas criações/remarcações solicitadas por cliente no intervalo retornam `AGENDA_BLOCKED` somente enquanto houver sobreposição com um bloqueio ativo;
- inclusões manuais autenticadas como prestador ignoram o bloqueio de disponibilidade, mas continuam sujeitas a conflito de horário e às demais invariantes;
- criação/exclusão exigem Prestador, tenant ativo, auditoria e proteção contra concorrência;
- o Cliente visualiza indisponibilidade, nunca o motivo interno;
- exclusão inexistente retorna `AGENDA_BLOCK_NOT_FOUND`.

O front possui botão **Bloquear agenda**, modal responsivo, validação de início/fim, motivo opcional, lista de períodos ativos e indicação **Bloqueado** nos dias correspondentes do calendário. O comando de criação carrega `requestedBy`, mas o backend deve derivar e validar essa origem pela sessão autenticada, nunca confiar apenas no payload. Persistência e conflito transacional dependem do adaptador backend.

O modal de bloqueio preserva os dados quando o usuário clica fora e só fecha pelo `X` ou pelas ações explícitas. Há estados próprios para intervalo inválido, compromissos preexistentes, sucesso e inclusão manual do prestador dentro do bloqueio.
