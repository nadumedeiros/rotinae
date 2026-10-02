| **Data** | **Versão** | **Descrição** | **Solicitante** | **Autor** |
|---|---|---|---|---|
| 07/09/2026 | 1.0 | Integração do checkout interno, tokenização de cartão, criação e gestão de assinatura; campos seguros alinhados ao design system | Usuário | Equipe Rotinaê |

# Integração da assinatura Premium com Mercado Pago

## 1. Objetivo e escopo

Concluir o checkout do plano Premium dentro do Rotinaê, com cartão tokenizado diretamente pelo Mercado Pago, 30 dias grátis quando elegível, renovação mensal, troca de cartão e reconciliação por webhook.

O Financeiro operacional entre prestador e cliente (`/payments`) permanece separado da cobrança da assinatura SaaS.

## 2. Arquitetura

- Frontend: React Native, Expo Router, Web/PWA, Android e iOS.
- Hospedagem Web: Netlify.
- Backend: Supabase Edge Functions e PostgreSQL.
- Provedor: API de Assinaturas do Mercado Pago (`/preapproval`).
- Web: formulário seguro isolado em `iframe` com MercadoPago.js.
- Android/iOS: o mesmo formulário isolado em `react-native-webview` 13.15.0, compatível com Expo SDK 54.

Nenhuma atualização de Expo ou React Native faz parte desta entrega.

## 3. Fluxo de dados

1. O prestador abre `/subscription-checkout`.
2. O formulário do Mercado Pago captura e tokeniza os dados do cartão.
3. O app recebe somente o `cardTokenId` descartável.
4. O adapter autenticado chama a Edge Function `mercado-pago-subscriptions`.
5. A Edge Function cria a assinatura autorizada ou atualiza o cartão existente.
6. O webhook assinado consulta novamente o recurso no Mercado Pago.
7. Somente a reconciliação server-side atualiza o entitlement Premium.

## 4. Contrato da Edge Function

### Criar assinatura interna

- Ação: `create_authorized`
- Autenticação: JWT Supabase de prestador.
- Entrada: `cardTokenId`, `idempotencyKey`.
- Saída aceita: `accepted`, `subscriptionId`, `status`.
- Estado inicial local: `pending`, exceto quando um trial local vigente já precisa continuar ativo durante a reconciliação.

### Trocar cartão

- Ação: `update_card`
- Autenticação: JWT Supabase de prestador.
- Entrada: `cardTokenId`, `idempotencyKey`.
- Operação externa: `PUT /preapproval/{id}` com `card_token_id`.
- O cartão anterior permanece válido se o provedor recusar a atualização.

### Erros públicos

- `PAYMENT_PROVIDER_NOT_CONFIGURED`
- `CARD_TOKEN_INVALID`
- `CARD_UPDATE_FAILED`
- `SUBSCRIPTION_NOT_FOUND`
- `CHECKOUT_ALREADY_OPEN`
- `MERCADO_PAGO_ERROR`
- `OPERATION_IN_PROGRESS`
- `SUBSCRIPTION_STORAGE_ERROR`

## 5. Segurança

- Número, validade e CVV não passam pelo adapter nem pelo Supabase.
- O token de cartão é validado por formato, usado uma vez e nunca persistido.
- Access Token e segredo do webhook existem somente nos secrets das Edge Functions.
- A chave pública pode existir no bundle cliente e deve ser separada por ambiente.
- Toda mutação exige sessão válida, perfil de prestador e chave idempotente.
- O webhook valida HMAC e consulta o recurso diretamente no Mercado Pago antes de atualizar o banco.
- O formulário isolado aplica política de conteúdo e aceita mensagens somente do frame criado pela aplicação.

## 6. Configuração manual

### Frontend local e Netlify

`EXPO_PUBLIC_MERCADO_PAGO_PUBLIC_KEY=TEST-...`

### Supabase Edge Function Secrets

- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `MERCADO_PAGO_ENVIRONMENT=test`
- `MERCADO_PAGO_TEST_PAYER_EMAIL`
- `ROTINAE_PREMIUM_PRICE_CENTS=2900` (opcional; o backend usa 2900 como padrão seguro)

### Webhook

Configurar os eventos de assinatura/preapproval para:

`https://dgrnymniplveemkilcjr.supabase.co/functions/v1/mercado-pago-webhook`

## 7. Deploy

1. Configurar a Public Key de teste localmente e na Netlify.
2. Confirmar os secrets no Supabase sem expor seus valores.
3. Publicar a Edge Function atualizada somente junto da liberação da interface.
4. Validar com usuário, cartão e pagador de teste.
5. Fazer um único push da sequência final para evitar deploys intermediários.
6. Gerar novo build Android/iOS porque `react-native-webview` é uma dependência nativa.

Deploy Previews usam a própria origem HTTPS nos callbacks de autenticação. O Supabase Auth aceita `https://**--rotinae.netlify.app/**`; o domínio oficial continua sendo a URL principal de produção.

## 8. Observabilidade

- Não registrar `cardTokenId` nem dados do cartão.
- Registrar apenas ação, resultado, código público, identificador da assinatura e correlation ID quando disponível.
- Monitorar falhas do webhook, divergência prolongada em `pending`, recusas e chaves idempotentes presas sem resposta.

## 9. Testes e aceite

- Tokenização válida e inválida.
- Criação elegível com trial e criação sem novo trial para quem já o utilizou.
- Retentativa idempotente sem assinatura duplicada.
- Premium não liberado antes da reconciliação do webhook.
- Troca de cartão válida e recusada, preservando o cartão anterior na recusa.
- Cancelamento, reativação e cobrança recusada sem regressão.
- Web, Android e iOS responsivos e acessíveis.

## 10. Estado da entrega

Implementação, Edge Function e validações automatizadas concluídas. O artefato Web foi gerado do zero com configuração de produção e auditado sem referências a localhost ou segredos privados. A validação financeira ponta a ponta permanece pendente de um Deploy Preview da Netlify com conta e cartão de teste; a produção pública só deve ser atualizada depois desse aceite e da finalização da interface de Planos.
