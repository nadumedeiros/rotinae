# Auditoria — rodapés e dados de páginas internas

Data: 11/08/2026

## Rodapés

Todos os rodapés encontrados nas rotas Expo estão condicionados explicitamente a `Platform.OS === "web"`. Não foi encontrado rodapé renderizado no Android ou iOS. Barras de navegação mobile não foram classificadas como rodapé editorial e permanecem inalteradas.

## Dados internos

- `agenda.tsx`: usa `appointmentService`/adapter Supabase real; nenhum seed de agendamento foi encontrado.
- `admin-users.tsx`: removidos usuários demonstrativos e hidratação/persistência por `localStorage`. Como não existe porta de administração, a tela agora exibe estado indisponível.
- `dashboard.tsx`: existe `DashboardPort`, mas não existe adapter/serviço de infraestrutura. Zeros estáticos foram substituídos por `—` e mensagens explícitas de integração pendente.
- `client-home.tsx`: o envio de código criava um prestador fictício em memória. Agora informa que nenhum pedido foi enviado.
- `client-providers.tsx`: removidos prestadores fictícios e falso feedback de sucesso. A tela apresenta estado vazio.

## Pendências de contrato

1. Implementar adapter de `DashboardPort` para o snapshot agregado da Home.
2. Definir uma porta autorizada para o cliente listar vínculos e solicitar vínculo por código.
3. Definir uma porta administrativa server-side para listar usuários e alterar entitlement Premium.
