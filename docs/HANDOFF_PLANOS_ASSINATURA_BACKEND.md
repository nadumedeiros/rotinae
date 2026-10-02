# Handoff — planos, trial e assinatura Premium

## 1. Objetivo

Substituir o estado local de `/plans` por uma fonte autoritativa no backend, processar a assinatura Premium de R$ 29,00/mês e aplicar os limites do Gratuito em Agenda, Clientes e notas internas.

O pagamento de serviços entre cliente e prestador continua fora da plataforma. Este fluxo cobra somente a assinatura SaaS do Rotinaê.

## 2. Decisão recomendada para o MVP

Usar Mercado Pago Assinaturas por API, mantendo o frontend desacoplado por `SubscriptionPort`. O checkout ocorre em página hospedada pelo provedor; o Rotinaê não recebe nem armazena número de cartão ou código de segurança.

Motivos para a primeira integração:

- operação voltada ao Brasil;
- cobrança recorrente mensal;
- período de teste configurável;
- tentativas automáticas após recusa;
- checkout por link e gestão da assinatura;
- notificações para conciliar pagamentos e estados.

O fornecedor permanece substituível. Identificadores e payloads do Mercado Pago ficam apenas no adaptador do backend.

## 3. Fonte de verdade

O frontend nunca libera Premium apenas porque voltou de uma URL de sucesso. A fonte de verdade é `ProviderEntitlement`, atualizado no servidor após consulta ao provedor e processamento idempotente do webhook.

Fluxo:

1. Prestador solicita checkout com chave de idempotência.
2. Backend valida perfil Prestador, elegibilidade e ausência de assinatura incompatível.
3. Backend cria ou reutiliza o cliente de cobrança e a assinatura no provedor.
4. Frontend abre a URL hospedada.
5. Retorno do checkout mostra estado “processando”; não concede acesso sozinho.
6. Webhook autenticado chega ao backend.
7. Backend busca o recurso diretamente na API do provedor, concilia o evento e atualiza assinatura e entitlement em uma transação.
8. Frontend consulta novamente `GET /v1/me/subscription` e passa a refletir o novo plano.

## 4. Endpoints propostos

| Método | Endpoint | Uso |
|---|---|---|
| `GET` | `/v1/me/subscription` | Plano, trial, cota, limites e estado de cobrança |
| `POST` | `/v1/me/subscription/checkout` | Criar ou reutilizar sessão de checkout Premium |
| `POST` | `/v1/me/subscription/cancel-at-period-end` | Agendar cancelamento no fim do trial/período pago |
| `POST` | `/v1/me/subscription/resume` | Desfazer cancelamento agendado antes do término |
| `POST` | `/v1/me/subscription/billing-portal` | Gerar acesso temporário à gestão de cobrança |
| `POST` | `/v1/webhooks/mercado-pago` | Receber eventos assinados do provedor |
| `PUT` | `/v1/admin/providers/{userId}/plan-override` | Conceder/retirar benefício manual com motivo |
| `DELETE` | `/v1/admin/providers/{userId}/plan-override` | Remover override administrativo com motivo |

Todos os `POST`, `PUT` e `DELETE` de negócio recebem `Idempotency-Key`. Respostas de erro incluem `code`, mensagem segura e `correlationId`.

## 5. Persistência mínima

### `billing_customers`

- `provider_user_id` único;
- `provider_customer_id` único;
- timestamps UTC.

### `billing_subscriptions`

- IDs interno e externo;
- plano, status e origem;
- início/fim do trial;
- início/fim do período corrente;
- `cancel_at_period_end`;
- último evento conciliado;
- versão para concorrência otimista;
- timestamps UTC.

### `plan_entitlements`

- plano efetivo;
- limites efetivos;
- origem (`trial`, `subscription`, `manual_admin`, `free`);
- vigência;
- versão e atualização.

### `billing_webhook_events`

- provedor e ID externo únicos;
- hash do payload;
- recebido/processado em UTC;
- resultado, tentativas e `correlation_id`.

### `plan_audit_events`

- ator e usuário afetado;
- ação;
- estado anterior e novo;
- motivo;
- instante UTC, resultado e correlação;
- sem update/delete por usuários comuns.

Uma concessão de trial terá restrição única por identidade verificada para impedir repetição por recriação de perfil.

## 6. Regras autoritativas

### Trial

- 30 períodos de 24 horas, concedido uma vez ao perfil Prestador elegível.
- Benefícios Premium são avaliados pela data do atendimento.
- Dentro da vigência do trial, a data usa Premium.
- Depois do fim do trial, enquanto não houver assinatura ativa, a data usa Gratuito.
- Recorrências criadas no trial não atravessam o fim do trial sem assinatura confirmada.
- Cancelar durante o trial mantém Premium até o fim e agenda downgrade automático.

### Gratuito

- até 2 ocorrências por dia no fuso IANA do prestador;
- até 5 clientes cadastrados;
- não cria novas notas internas na página do cliente;
- preserva registros existentes para leitura;
- operações concorrentes validam a cota na mesma transação.

### Premium

- assinatura ativa ou override administrativo vigente;
- agendamentos e clientes sem os limites do Gratuito;
- recursos Premium habilitados conforme entitlement.

### Cobrança

- `active`: Premium ativo;
- `past_due`: aplicar período de tolerância definido pelo produto e informar falha;
- `canceled`: manter até `current_period_ends_at`, depois Gratuito;
- webhook duplicado ou fora de ordem não pode regredir um estado mais novo;
- retorno do checkout nunca substitui o webhook/consulta ao provedor.

## 7. Segurança do webhook

- validar assinatura HMAC, timestamp e tolerância de replay;
- rejeitar corpo alterado;
- armazenar e deduplicar o ID do evento;
- responder rapidamente e processar por fila/outbox;
- consultar o objeto na API do provedor antes de liberar entitlement;
- segredos somente no backend/secret manager;
- logs sem cartão, token de pagamento ou conteúdo pessoal desnecessário.

## 8. Integração do frontend

Contratos preparados:

- `src/domain/subscriptions/types.ts`;
- `src/domain/subscriptions/subscription-port.ts`;
- `SubscriptionPort` para o prestador;
- `AdminSubscriptionPort` para suporte administrativo.

Ao integrar:

1. criar `HttpSubscriptionAdapter`;
2. trocar `agendae:provider-plan:v1` por `getEntitlement()`;
3. abrir `CheckoutSession.url` com navegador seguro;
4. ao retornar, mostrar processamento e fazer polling curto com limite;
5. sincronizar Agenda, Clientes e notas pelo entitlement recebido;
6. remover qualquer decisão de segurança baseada em `localStorage`;
7. manter os mesmos estados visuais de trial, cancelamento agendado, Gratuito, Premium e cobrança pendente.

Telas já preparadas no frontend:

- `/plans` para comparação e comandos;
- `/subscription-return` para processamento, sucesso e falha do checkout;
- `/subscription-billing` para próxima cobrança, método, falha e retomada.

O adaptador local está em `src/infra/subscriptions/local-subscription-adapter.ts` e deve ser substituído por `HttpSubscriptionAdapter` na composição de produção.

## 9. Testes obrigatórios

- trial concedido uma única vez;
- data dentro e fora do trial;
- recorrência atravessando fim do trial;
- terceira ocorrência diária concorrente;
- sexto cliente concorrente;
- nota bloqueada no Gratuito;
- checkout duplicado com mesma idempotência;
- webhook válido, assinatura inválida, replay, duplicata e evento fora de ordem;
- cancelamento durante trial e downgrade no instante correto;
- falha/recuperação de cobrança;
- override administrativo somente para prestador e sempre auditado;
- RLS/autorizações negativas entre usuários e tenants.
