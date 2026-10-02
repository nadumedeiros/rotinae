# Planos e limites no frontend

## Gratuito

- Até 2 agendamentos por dia, somando criações do prestador e de seus clientes.
- Até 5 clientes cadastrados.
- Não permite adicionar novas notas internas na página do cliente.
- Agendamentos, clientes e notas existentes são preservados após downgrade.

## Premium

- Prestadores elegíveis recebem um único período de teste gratuito de 30 dias.
- Se o Premium for cancelado durante o teste, o acesso permanece ativo até completar os 30 dias. O downgrade para o Gratuito é agendado e ocorre automaticamente no término do período.
- R$ 29,00 por mês no preço inicial definido para validação.
- Agendamentos e clientes sem os limites do Gratuito.
- Permite adicionar notas internas e acessar os demais recursos Premium documentados.

## Comportamento da interface

A página `/plans` só pode ser usada pelo perfil Prestador. Alterações do protótipo são persistidas em `agendae:provider-plan:v1` e notificadas pelo evento `agendae:provider-plan-updated`.

O card Premium recebe maior destaque visual. Em telas móveis ele aparece antes do Gratuito; em telas maiores, os dois permanecem lado a lado para comparação.

As telas de Agenda, Clientes e detalhes do cliente reagem ao plano atual. O backend deverá repetir todas as verificações de forma autoritativa e auditável; o bloqueio do frontend não é uma medida de segurança.

O protótipo guarda `trialEndsAtIso` e `cancelAtPeriodEnd`. Ao carregar a página de Planos e durante sua permanência em tela, um teste vencido é convertido automaticamente para Gratuito.

## Fluxo de assinatura

- `/plans`: comparação, situação atual, início do checkout, cancelamento e retomada.
- `/subscription-return`: retorno do checkout nos estados processando, aprovado e falhou.
- `/subscription-billing`: próxima cobrança, forma de pagamento, falha de cobrança e gestão da assinatura.

O formulário de cartão não pertence ao Rotinaê. Em produção, o botão abre o checkout hospedado pelo provedor e a tela de retorno só mostra Premium após receber o entitlement confirmado pelo backend.
