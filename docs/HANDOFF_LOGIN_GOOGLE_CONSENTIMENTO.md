# Handoff — Login Google, sessão e consentimento

## Situação atual

O login em localhost usa um adaptador mock. A sessão web é restaurada do armazenamento local enquanto válida, somente para demonstração. No Android/iOS, o adaptador já usa `expo-secure-store`. Em produção, o web deve migrar para cookie seguro emitido pelo backend e não persistir token sensível em `localStorage`.

## Google OAuth

Para ativar Google em web, Android e iOS:

1. Criar/configurar o projeto no Google Cloud, a tela de consentimento e clientes OAuth separados por plataforma.
2. Registrar origens web e redirects exatos de desenvolvimento e produção; configurar `scheme`/deep link no app nativo.
3. Usar Authorization Code com PKCE e somente `openid email profile`.
4. Trocar o código exclusivamente no backend; validar `iss`, `aud`, `exp`, `state` e `nonce`. Nunca embarcar client secret no app.
5. Reconciliar a conta pela identidade Google validada. A escolha Prestador/Cliente só pode criar o papel inicial após validação do servidor.
6. Emitir sessão própria: cookie `HttpOnly`, `Secure` e `SameSite` no web; armazenamento seguro no Android/iOS; suportar renovação, revogação e expiração.
7. Cobrir cancelamento do popup, redirect inválido, código expirado/reutilizado, conflito de conta, conta desativada, sessão revogada e indisponibilidade.

No Expo, o fluxo universal pode usar `expo-auth-session`/PKCE; integrações nativas exigem development build. O front já expõe `OAuthPort` e `GoogleAuthorizationInput`, exibe o botão oficial e possui feedbacks para preparação, cancelamento, erro de callback e conflito de conta. Variáveis públicas contêm somente client IDs e redirects.

## Consentimento obrigatório

O cadastro bloqueia o avanço sem aceite dos Termos de Uso e da Política de Privacidade e apresenta um resumo do escopo do Rotinaê. O backend deve persistir:

- usuário, versões dos documentos, data/hora e plataforma;
- evidência de auditoria suficiente, com minimização de IP/user-agent;
- nova coleta quando uma alteração material exigir novo aceite;
- consentimentos opcionais separados do contrato obrigatório, especialmente WhatsApp e marketing.

O resumo na interface não substitui os documentos jurídicos completos. Antes da produção ainda são necessárias as rotas públicas dos Termos e da Política, com versionamento e conteúdo revisado.

## Dependências e configuração pendentes

- credenciais OAuth do Google Cloud para web, Android e iOS;
- URLs finais de produção e callbacks autorizados;
- endpoint backend de início/callback/troca de código;
- implementação real do adaptador OAuth usando o armazenamento nativo já instalado (`expo-secure-store`);
- cookie seguro para web e política de refresh/revogação;
- URLs e versões publicadas de Termos e Política de Privacidade;
- testes E2E nas três plataformas e testes negativos de autorização.

## Cobertura automatizada preparada

- Jest/`jest-expo`: cadastro válido, normalização, nome/e-mail/telefone inválidos, senha curta, confirmação divergente e aceite ausente;
- sessão: válida, expirada, data inválida e token ausente;
- WhatsApp: confirmação/lembrete autorizados, telefone ausente/inválido/não verificado, vínculo inativo e consentimento ausente por finalidade;
- Maestro: cadastro e abertura dos documentos legais, navegação mobile universal e estado front-end do Google.

Executar `npm test` para unitários. Os arquivos `.maestro/*.yaml` exigem development build, Maestro instalado e emulador/aparelho; eles não substituem validação em dispositivos físicos.
