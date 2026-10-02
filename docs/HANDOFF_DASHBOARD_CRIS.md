# Handoff — Home autenticada

> Responsável futuro: Cris  
> Preparado em: 03/08/2026  
> Estado: UI demonstrativa concluída; agregações reais pendentes

## Contrato

A Home deverá consumir `DashboardPort`, definido em `apps/agendae/src/domain/dashboard/dashboard-port.ts`. O adaptador Supabase retorna um único `DashboardSnapshot`, evitando consultas independentes e estados inconsistentes entre KPIs.

## Origem dos dados

| Informação | Fonte esperada |
|---|---|
| Clientes ativos/novos | carteira do tenant e vínculos ativos |
| Agenda do dia | atendimentos no fuso configurado pelo prestador |
| Concluídos/pendentes | estados dos atendimentos da data |
| Saldo em serviços | lançamentos manuais autorizados; não representa saldo bancário |
| Próximos compromissos | atendimentos ordenados por `starts_at`, excluindo cancelados quando aplicável |

## Regras

- usuário, papel e tenant são derivados da sessão;
- data civil é calculada no fuso do prestador, não no dispositivo;
- valores trafegam em centavos e são formatados somente na UI;
- snapshot informa `generatedAt` e `timeZone`;
- nenhuma agregação mistura tenants ou vínculos do mesmo cliente;
- RLS continua deny-by-default; RPC/view não pode contornar autorização;
- falha preserva a tela anterior, mostra modal e permite tentar novamente;
- sessão expirada retorna ao login sem expor detalhes técnicos.

## Implementação sugerida

1. Criar `SupabaseDashboardAdapter implements DashboardPort` em `src/infra/dashboard`.
2. Preferir uma RPC/view segura para snapshot consistente e reduzir round-trips.
3. Mapear falhas para `DashboardError` e códigos públicos estáveis.
4. Substituir constantes locais de `/dashboard` pela porta sem mudar componentes.
5. Recarregar ao focar a rota e após mutações relevantes; definir cache/invalidação com `BLG-038`.
6. Implementar feed de notificações com `resource_type`, `resource_id`, destino permitido e `read_at`; nunca aceitar URL arbitrária do payload.

## Testes de aceite

- zero dados retorna KPIs zerados e agenda vazia;
- virada de dia respeita o fuso do prestador;
- cancelamento/conclusão atualiza os KPIs após invalidação;
- tenant A não inclui clientes, agenda ou valores do tenant B;
- valores negativos/positivos e mês de referência são formatados corretamente;
- sessão expirada, rede indisponível e erro desconhecido produzem estados recuperáveis;
- web, Android e iOS exibem o mesmo snapshot para a mesma sessão.
- notificação de agenda abre `/agenda`, notificação de vínculo abre `/clients` e recurso sem autorização não é revelado;
- leitura individual e “marcar todas” persistem por usuário após sincronização.
