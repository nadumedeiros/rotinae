# Cenários automatizados do front-end

Atualizado em 04/08/2026.

## Executáveis agora

Comando: `npm test` em `apps/agendae`.

| Área | Cenários |
|---|---|
| Cadastro | sucesso com normalização; nome, e-mail e telefone inválidos; senha curta; senhas diferentes; aceite obrigatório ausente |
| Sessão | sessão válida; expirada; expiração inválida; token ausente |
| WhatsApp | confirmação e lembrete autorizados; telefone ausente ou fora de E.164; número não verificado; vínculo inativo; consentimento ausente por finalidade |
| Reconciliação de cliente | mesmo e-mail verificado; identidade já associada; telefone coincidente com revisão; e-mail interno duplicado; nenhuma correspondência |

## E2E preparados

Fluxos em `apps/agendae/.maestro`:

- `registration-consent.yaml`: preenche cadastro, abre Termos e Privacidade, aceita e avança;
- `mobile-navigation.yaml`: autentica, percorre todas as abas e abre o menu Novo;
- `google-front-state.yaml`: abre o estado preparado do botão Google e retorna ao login.

Esses fluxos dependem de development build e emulador/aparelho. Devem ser executados em Android e iOS antes de publicação.

## Estados visuais disponíveis

`/feedback?state=` aceita: `google-pending`, `google-cancelled`, `google-callback-error`, `google-account-conflict`, `session-expired`, `consent-required`, `email-delivery-failed` e `whatsapp-not-authorized`, além dos estados anteriores de sucesso e erro.

## Limites desta cobertura

- OAuth, e-mail e WhatsApp reais exigem backend, credenciais e ambientes de homologação;
- revisão jurídica exige profissional habilitado e publicação versionada dos documentos;
- acessibilidade automática reduz regressões, mas não substitui leitor de tela, contraste, teclado e testes manuais;
- testes em simulador não substituem aparelhos físicos e condições reais de rede.

## Saúde das dependências em 04/08/2026

- `expo-doctor`: 18/18 verificações aprovadas;
- `npm audit --omit=dev`: 14 avisos transitivos (13 moderados e 1 alto) ligados à cadeia do Expo 54 (`postcss`/`uuid`);
- a correção automática disponível migraria para Expo 57 e é uma alteração incompatível. Não executar `npm audit fix --force`; planejar atualização controlada do SDK, repetir testes e verificar advisories antes da publicação.
