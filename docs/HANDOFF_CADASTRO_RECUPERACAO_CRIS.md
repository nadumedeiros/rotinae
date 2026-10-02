# Handoff — Cadastro, confirmação de e-mail e recuperação de senha

> Responsável futuro: Cris
> Preparado em: 06/08/2026
> Estado: front-end demonstrativo concluído (BLG-043); contrato TypeScript definido nesta entrega (DEC-067); adaptador Supabase real ainda pendente (BLG-044)

## 1. Objetivo

Definir o contrato que faltava para desbloquear BLG-044: implementar `signUp`, reenvio de confirmação, solicitação de recuperação de senha e efetivação da nova senha contra o Supabase, sem alterar o comportamento visual das telas `create-account.tsx`, `confirm-email.tsx` e `change-password.tsx`, hoje 100% demonstrativas.

Arquivos de contrato:

- `apps/agendae/src/domain/auth/types.ts` — `SignUpInput`, `SignUpLegalAcceptance`, `SignUpResult`, `UpdatePasswordInput`, extensão de `AuthErrorCode`.
- `apps/agendae/src/domain/auth/auth-port.ts` — nova interface `AuthRegistrationPort`.

`AuthRegistrationPort` é **decoupled de `AuthPort`** de propósito: `MockAuthAdapter` e `SupabaseAuthAdapter` já implementam `AuthPort` (`signIn`/`signOut`/`getSession`/`addRole`/`switchRole`) e não devem ser forçados a implementar cadastro/recuperação só porque este contrato foi escrito. Segue o mesmo padrão já usado por `OAuthPort` neste domínio: portas pequenas e decoupled por capacidade, não uma interface monolítica.

```ts
export interface AuthRegistrationPort {
  signUp(input: SignUpInput): Promise<SignUpResult>;
  resendConfirmationEmail(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(input: UpdatePasswordInput): Promise<void>;
}
```

Nenhum método aqui recebe token manual de confirmação/recuperação. O adaptador real segue o fluxo nativo do Supabase Auth: o link do e-mail abre uma sessão temporária detectada pelo próprio SDK (`detectSessionInUrl` na web, deep link + `exchangeCodeForSession`/`verifyOtp` no nativo); a partir dela, `updatePassword` só chama `supabase.auth.updateUser({ password })`. Isso está alinhado à instrução explícita de não inventar um fluxo próprio de tokens — os cinco templates de `docs/HANDOFF_EMAILS_TRANSACIONAIS.md` (seção 3: `confirmation`, `recovery`, `email-change`, `password-changed-notification`, `email-changed-notification`) já usam as variáveis oficiais do GoTrue e continuam válidos sem alteração.

## 2. Regras que não podem mudar

1. Toda conta nova exige confirmação de e-mail antes de qualquer sessão operacional (DEC-055). `signUp` **nunca** devolve `Session`; devolve `SignUpResult { email, emailConfirmationRequired: true }`.
2. `role` define o perfil inicial no cadastro. Regra posterior de produto substitui a leitura de DEC-042/043: a mesma identidade pode provisionar Cliente e Prestador por `addRole` e alternar o contexto ativo por `switchRole`; `signUp` continua sem alterar uma conta já existente.
3. Reenvio de confirmação e solicitação de recuperação de senha têm **resposta neutra e anti-enumeração** (DEC-055): `resendConfirmationEmail` e `requestPasswordReset` sempre resolvem com sucesso, independentemente de o e-mail existir, já estar confirmado, ou de a conta estar bloqueada. Só podem rejeitar por `RATE_LIMITED`, `NETWORK_ERROR` ou `UNKNOWN` — nunca por um código que revele o estado da conta.
4. Pelo mesmo motivo de anti-enumeração, **`signUp` também não deve revelar que o e-mail já está cadastrado.** Isso não é uma regra nova inventada por este documento: é o comportamento padrão do GoTrue/Supabase Auth quando confirmação de e-mail é obrigatória — um `signUp` repetido com e-mail já existente (confirmado ou não) tende a devolver sucesso aparente ou reenviar a confirmação, sem expor a diferença ao chamador. O adaptador não deve tentar mapear isso para um erro distinto do tipo "e-mail já cadastrado"; a tela sempre mostra o mesmo destino (`/confirm-email`).
5. Links de confirmação e de recuperação são temporários e de uso único (DEC-055). Um link expirado, inválido ou já consumido produz sempre o mesmo código genérico `AUTH_LINK_INVALID`, roteado para o estado já existente `feedback.tsx` → `link-expired` — sem diferenciar "expirado" de "já usado" de "nunca existiu".
6. `updatePassword` não recebe token: depende de uma sessão de recuperação já aberta pelo clique no link. Ausência dessa sessão (por exemplo, alguém navega direto para `/change-password` sem passar pelo e-mail — o gap atual do protótipo, ver seção 7) lança `SESSION_EXPIRED`, reaproveitando o código já existente em vez de criar um novo com a mesma semântica.
7. Telefone é capturado e normalizado em E.164 (`+55...`) pela tela, mas **não é verificado** neste contrato — não existe fluxo de OTP por SMS/WhatsApp aqui. Isso continua uma questão aberta e não decidida (seção 14 de `ARQUITETURA_BACKEND_ETAPA_1.md`); não implementar verificação de telefone sem uma decisão de produto explícita.
8. Senha e confirmação de senha nunca trafegam como parâmetro de rota; a normalização de nome/e-mail/telefone que hoje viaja em `router.push` (`create-account.tsx` → `confirm-email.tsx`) já exclui senha — preservar esse comportamento ao integrar.
9. O aceite de Termos e a ciência da Política continuam eventos distintos e auditáveis (nunca um único "aceite genérico" na tabela), mesmo que a tela apresente as duas em um único checkbox — ver seção 4.
10. Consentimento de marketing continua opcional, revogável e sem gerar evento quando a caixa não é marcada (ausência de evento = estado `unset`, nunca `revoked`) — ver seção 4.

## 3. Operações esperadas

| Porta | Implementação Supabase sugerida |
|---|---|
| `signUp` | `supabase.auth.signUp({ email, password, options: { data: { name, phone, role, consentVersion, marketingConsent, source }, emailRedirectTo } })`; nenhum dado sensível fora de `email`/`password` no nível raiz |
| `resendConfirmationEmail` | `supabase.auth.resend({ type: 'signup', email })`, sempre resolvendo do ponto de vista da UI |
| `requestPasswordReset` | `supabase.auth.resetPasswordForEmail(email, { redirectTo })`, sempre resolvendo do ponto de vista da UI |
| `updatePassword` | `supabase.auth.updateUser({ password: newPassword })` usando a sessão de recuperação ativa no momento da chamada |

### 3.1 Onde a lacuna real está: criação de `profiles` e `legal_acknowledgements` no cadastro

Esta é a parte que faltava para o contrato fechar, e o motivo pelo qual BLG-044 estava bloqueado além da ausência do próprio método `signUp`.

As migrations já existentes (`supabase/migrations/20260806100100_profiles.sql`, `..._legal_acknowledgements.sql`, `..._consent_events.sql`) exigem `to authenticated` + `auth.uid() = user_id` para `insert`. Mas com confirmação de e-mail obrigatória, `supabase.auth.signUp()` **não devolve sessão** (`data.session = null`) até o e-mail ser confirmado — ou seja, no momento do cadastro **não existe `auth.uid()`** para satisfazer essas policies. As telas não conseguiriam criar `profiles`/`legal_acknowledgements` client-side logo depois do `signUp`, mesmo com sessão restaurada, porque a sessão simplesmente não existe ainda.

Recomendação: um trigger `SECURITY DEFINER` em `auth.users` (padrão consolidado do Supabase, geralmente `handle_new_user()`), disparado em `after insert`, que:

1. lê `raw_user_meta_data->>'name'`, `->>'phone'`, `->>'role'` e insere a linha em `public.profiles` (`status` continua `active` por padrão — isso não conflita com DEC-055, porque o bloqueio de sessão operacional acontece na camada do GoTrue via `email_confirmed_at`, não em `profiles.status`; ver seção 5);
2. resolve os `id`s vigentes em `legal_documents` para `kind = 'terms'` e `kind = 'privacy_policy'` a partir de `raw_user_meta_data->>'consentVersion'` (ambos os documentos precisam estar publicados com o **mesmo valor de `version`**, já que a tela apresenta um único aceite combinado — ver regra 9 e seção 4) e insere duas linhas em `legal_acknowledgements` (`action = 'accepted_terms'` e `action = 'acknowledged_privacy'`), cada uma com seu próprio `document_id`;
3. se `raw_user_meta_data->>'marketingConsent' = 'true'`, insere uma linha em `consent_events` (`channel = 'email'`, `purpose = 'marketing'`, `action = 'granted'`, `notice_version = consentVersion`); se `'false'`, não insere nada (estado inicial permanece `unset`, nunca `revoked` — seção 5.4 do handoff de arquitetura).

As policies `profiles_insert_self`, `legal_acknowledgements_insert_self` e `consent_events_insert_self` continuam válidas para os casos em que o próprio usuário autenticado precisar reescrever/registrar algo depois (por exemplo, revogar/conceder marketing já logado); elas não precisam ser removidas — só não são o caminho usado durante o cadastro em si, porque não há sessão nesse momento.

Este trigger é trabalho de schema/migration (Chris), não de contrato TypeScript — mas sem ele, `signUp` não tem como persistir perfil e aceites com a topologia de RLS já existente.

### 3.2 Confirmação de e-mail: sem endpoint próprio

Não existe (e não deve existir) um método de porta do tipo `confirmEmail(token)`. A confirmação é inteiramente responsabilidade do SDK do Supabase ao abrir o link recebido por e-mail — a aplicação só precisa de uma rota capaz de receber o retorno (`type=signup` + `token_hash`, ou sessão implícita na URL) e então navegar para `feedback?state=email-confirmed`. Essa é uma decisão de roteamento/deep link, não uma assinatura de método; recomenda-se confirmar com Dante/Cris qual rota concreta recebe esse retorno na web e no nativo antes da implementação (`emailRedirectTo` precisa apontar para ela).

### 3.3 Recuperação de senha: o mesmo vale para o link de `recovery`

`requestPasswordReset` dispara o e-mail; o clique no link deve abrir uma sessão de recuperação detectada pelo SDK antes que `/change-password` seja útil. Hoje, `login.tsx` navega direto para `/change-password` ao clicar em "Esqueci minha senha", **sem pedir o e-mail antes** — esse é um gap real do protótipo (ver seção 7), não uma decisão de contrato: a versão real do fluxo precisa de uma etapa intermediária que colete o e-mail e chame `requestPasswordReset`, e a rota de retorno do e-mail (que a integração de infraestrutura vai apontar via `redirectTo`) precisa cair em `/change-password` só depois que a sessão de recuperação já existir.

## 4. Tabelas e segurança

Usar como fonte de verdade `docs/ARQUITETURA_BACKEND_ETAPA_1.md` e as migrations já aplicadas em `apps/agendae/supabase/migrations/`, especialmente:

- `profiles` (`role` espelha o contexto ativo; `profile_roles` registra os papéis provisionados; alterações de contexto só ocorrem pelas RPCs autoritativas; `status` não modela confirmação de e-mail, só bloqueio/exclusão);
- `legal_documents` (`kind` = `terms` | `privacy_policy`; cada kind tem sua própria `version` e `status`; leitura pública quando `status = 'active'`);
- `legal_acknowledgements` (uma linha por `document_id` aceito; `action` = `accepted_terms` | `acknowledged_privacy`; append-only);
- `consent_events` (append-only; projeção do último evento válido é a preferência atual — nunca sobrescrever, sempre inserir novo evento).

Policies mínimas já existentes e que devem ser preservadas:

- todas as quatro tabelas nascem com RLS deny-by-default;
- `profiles_select_self`/`_update_self`/`_insert_self`, `legal_acknowledgements_select_self`/`_insert_self`, `consent_events_select_self`/`_insert_self` exigem `authenticated` + `auth.uid() = user_id`;
- nenhuma dessas tabelas tem policy de `delete`;
- o caminho de cadastro (sem sessão) só pode escrever nessas tabelas via função `SECURITY DEFINER` (seção 3.1), nunca via `service_role` exposto ao cliente.

Segurança operacional para os novos métodos:

- `resendConfirmationEmail` e `requestPasswordReset` precisam de rate limiting por e-mail e por IP/dispositivo — o GoTrue já limita nativamente, mas a resposta ao cliente deve continuar neutra mesmo quando o limite é atingido de forma menos agressiva (ex.: aumentar o atraso da resposta em vez de expor `RATE_LIMITED` cedo demais, se isso vazar informação sobre existência da conta — avaliar caso a caso; se `RATE_LIMITED` só ocorrer por volume de tentativas do mesmo remetente, não há risco de enumeração e o código pode ser usado normalmente);
- tokens de confirmação/recuperação são de uso único e de curta duração — comportamento nativo do GoTrue; não deve ser reimplementado;
- `accessToken`/tokens de recuperação nunca são registrados em logs, analytics ou mensagens de erro, mesma regra já vigente para `AuthPort`.

## 5. Erros públicos

O adaptador converte GoTrue/Postgres para os códigos abaixo. Os cinco primeiros já são canônicos de `AuthPort`; os quatro novos entram junto com `AuthRegistrationPort`.

| Código | Quando ocorre | Resposta da UI |
|---|---|---|
| `RATE_LIMITED` | Muitas tentativas de `signUp`, reenvio ou recuperação | Informar espera sem detalhes |
| `NETWORK_ERROR` | Falha local/rede | Preservar campos e permitir nova tentativa |
| `UNKNOWN` | Falha não classificada | Mensagem genérica, correlação segura |
| `AUTH_EMAIL_NOT_CONFIRMED` | `signIn` chamado com e-mail correto/senha correta mas `email_confirmed_at` nulo no GoTrue | Direcionar para `/confirm-email` com opção de reenvio, **não** para "fale com o suporte" |
| `AUTH_LINK_INVALID` | Link de confirmação ou de recuperação expirado, malformado ou já usado | `feedback?state=link-expired`, resposta única sem diferenciar o motivo |
| `AUTH_WEAK_PASSWORD` | Senha rejeitada pelo backend (ex.: proteção de senha vazada do Supabase) mesmo tendo passado da validação client-side de 8+ caracteres | Manter formulário e pedir senha diferente, sem reexpor a senha rejeitada |
| `AUTH_PASSWORD_REUSED` | Reservado — ver seção 6, decisão pendente | Não implementar sem decisão de produto |

Nota importante para `mapSupabaseAuthError` em `supabase-auth-adapter.ts`: hoje esse mapeador não trata a mensagem nativa do GoTrue `"Email not confirmed"`. Como o GoTrue rejeita `signInWithPassword` **antes** de qualquer consulta a `profiles`, o bloqueio de sessão para e-mail não confirmado (DEC-055) precisa ser resolvido nesse mapeamento, adicionando `AUTH_EMAIL_NOT_CONFIRMED` — e não no branch existente de `profile.status !== 'active'`, que trata bloqueio/exclusão de conta, um caso diferente.

## 6. Decisão pendente antes da implementação: senha diferente das anteriores

`change-password.tsx` promete visualmente "Escolha uma senha segura e diferente das utilizadas anteriormente." O Supabase não oferece histórico de senha nativamente; cumprir essa promessa exigiria armazenar hashes anteriores (ou ao menos o hash atual antes da troca) e comparar no momento de `updateUser`, uma função customizada adicional. Registrar como decisão pendente: manter a promessa e implementar a comparação (usando `AUTH_PASSWORD_REUSED`), ou ajustar o texto da tela para não prometer o que ainda não será verificado. Recomenda-se abrir esta questão com produto antes de tratar como concluído — não implementar a comparação silenciosamente sem decisão, nem deixar o texto da tela prometendo algo que o backend não verifica.

## 7. Achado de UX fora do escopo de contrato: fluxo de "Esqueci minha senha"

`login.tsx` navega direto para `/change-password` ao clicar em "Esqueci minha senha", sem nenhuma etapa de coleta de e-mail. Isso funciona no protótipo porque não há backend real, mas não é compatível com o fluxo real do Supabase Auth: é preciso primeiro coletar o e-mail e chamar `requestPasswordReset`, e só then a pessoa chega em `/change-password` — pelo link recebido, com uma sessão de recuperação já aberta. Esse é um ajuste de tela (nova etapa "Informe seu e-mail" antes de `/change-password`, ou reaproveitamento de uma tela existente), não uma mudança de contrato TypeScript. Recomenda-se registrar como item de backlog e envolver Dante/Nero antes da integração de Cris tocar essa tela, já que a mudança tem impacto de UX e não é coberta por esta entrega.

## 8. Migração das telas

1. Criar `SupabaseAuthRegistrationAdapter implements AuthRegistrationPort` em `src/infra/auth` (nome sugerido; manter no mesmo diretório de `supabase-auth-adapter.ts`).
2. Exportar a composição como `authRegistrationService`, seguindo o padrão de `authService`/`supabaseAuthService`.
3. Resolver o gap descrito na seção 7 (nova etapa de e-mail antes de `/change-password`) antes ou junto da integração — sem essa etapa, `requestPasswordReset` não tem de onde ser chamado.
4. Atualizar `mapSupabaseAuthError` em `supabase-auth-adapter.ts` para reconhecer `"Email not confirmed"` e devolver `AUTH_EMAIL_NOT_CONFIRMED`.
5. Implementar o trigger `SECURITY DEFINER` descrito na seção 3.1 antes de considerar `signUp` funcional de ponta a ponta.
6. Configurar `emailRedirectTo`/`redirectTo` e as rotas de retorno (confirmação e recuperação) para web e nativo antes de testar em produção.
7. Manter `create-account.tsx`, `confirm-email.tsx` e `change-password.tsx` como estão nesta etapa — a integração troca a implementação por trás dos botões, não os estados visuais já aprovados (DEC-056).

## 9. Testes de aceite

- `signUp` bem-sucedido nunca devolve `Session`; a tela sempre segue para `/confirm-email` com o e-mail informado;
- `signUp` repetido com e-mail já cadastrado (confirmado ou não) não expõe essa diferença ao chamador — mesmo destino visual;
- `signIn` com e-mail e senha corretos mas e-mail não confirmado retorna `AUTH_EMAIL_NOT_CONFIRMED`, distinto de `ACCOUNT_DISABLED`;
- `resendConfirmationEmail` sempre resolve, para e-mail existente, inexistente ou já confirmado;
- `requestPasswordReset` sempre resolve, para e-mail existente ou inexistente;
- link de confirmação ou recuperação expirado, malformado ou reutilizado produz sempre `AUTH_LINK_INVALID`, nunca uma mensagem diferenciada;
- `updatePassword` sem sessão de recuperação ativa lança `SESSION_EXPIRED`;
- `updatePassword` bem-sucedido invalida o link/sessão de recuperação para uso futuro (uso único);
- cadastro cria exatamente uma linha em `profiles`, duas em `legal_acknowledgements` (`accepted_terms` e `acknowledged_privacy`, cada uma com seu próprio `document_id`) e, quando marketing foi aceito, exatamente uma em `consent_events`;
- cadastro com marketing não marcado não cria nenhuma linha em `consent_events` (estado permanece `unset`, não `revoked`);
- `role` enviado em `signUp` nunca é alterável depois — tentativa de reenviar `signUp` para o mesmo e-mail com papel diferente não muda `profiles.role`;
- senha rejeitada por proteção de senha vazada do backend retorna `AUTH_WEAK_PASSWORD` e preserva os demais campos preenchidos;
- nenhum log, analytics ou mensagem de erro expõe senha, token de confirmação ou token de recuperação;
- web, Android e iOS completam o mesmo fluxo de cadastro → confirmação → primeiro login, e o mesmo fluxo de recuperação → nova senha → login, considerando as particularidades de deep link de cada plataforma.
