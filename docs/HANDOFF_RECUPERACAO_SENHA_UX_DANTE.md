# Handoff — UX do fluxo "Esqueci minha senha" (recuperação de senha)

> Responsável por este documento: Dante (arquitetura de experiência)
> Preparado em: 07/08/2026
> Destinatário: ADA (wiring de frontend)
> Estado: **Proposta de arquitetura de experiência — pendente de validação explícita do usuário.** Não é handoff aprovado; ver seção 12 antes de iniciar qualquer implementação.

## 1. Objetivo

Fechar o gap de UX identificado por Chris na seção 7 de `docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md` e registrado como pendência em DEC-067/068 e BLG-044:

- `apps/agendae/app/login.tsx` (linha 61) navega direto para `/change-password` ao clicar em "Esqueci minha senha", sem nenhuma etapa de coleta de e-mail;
- `apps/agendae/app/change-password.tsx` é 100% demonstrativa: não verifica se existe sessão de recuperação ativa e não chama nenhum serviço real, só valida senha localmente e navega para `/feedback?state=password-updated`.

Este documento define a arquitetura estrutural completa do fluxo real — telas, estados, transições, tratamento de erro e critérios de acessibilidade — para a ADA fazer o wiring de frontend contra o contrato já implementado e testado (`AuthRegistrationPort`/`authRegistrationService`, DEC-067/068). Não define UI visual final (papel de Nero) nem implementa código (papel de ADA).

## 2. O que já existe e este handoff não reabre

- `AuthRegistrationPort.requestPasswordReset(email): Promise<void>` — sempre resolve, resposta neutra anti-enumeração (DEC-055); só rejeita por `RATE_LIMITED`, `NETWORK_ERROR` ou `UNKNOWN`.
- `AuthRegistrationPort.updatePassword({ newPassword }): Promise<void>` — exige sessão de recuperação já aberta pelo clique no link (fluxo nativo do Supabase Auth); lança `SESSION_EXPIRED` na ausência dessa sessão.
- `feedback.tsx` — mecanismo genérico de estados (`tone`, `title`, `description`, `action`) com um único ponto de roteamento (`state === 'consent-required' ? '/create-account' : '/'`, todo o resto volta para `/`).
- Estado `link-expired` já existente em `feedback.tsx`, hoje produzido por `AUTH_LINK_INVALID` (link de confirmação de e-mail expirado/inválido/já usado). Este handoff reaproveita o MESMO estado visual para `SESSION_EXPIRED` da recuperação de senha — não cria um estado novo para isso, conforme já indicado na seção 2, regra 6, do handoff de Chris. A razão de reaproveitar (e não criar um estado dedicado) está detalhada na seção 6.3 e no risco descrito na seção 9.
- Estado `password-updated` já existente — inalterado.
- Validação client-side de `change-password.tsx` (senha com 8+ caracteres, confirmação obrigatória) — inalterada.

## 3. Decisão: nova rota `/forgot-password`, não reaproveitamento de tela existente

**Decisão:** criar uma tela nova, `apps/agendae/app/forgot-password.tsx`, dedicada exclusivamente a coletar o e-mail e disparar `requestPasswordReset`. Não reaproveitar `login.tsx` (transformando-o num formulário com dois modos) nem `confirm-email.tsx` (que pressupõe um e-mail já conhecido, vindo do cadastro).

**Justificativa:**

1. **Consistência com a convenção já estabelecida no projeto.** Cada etapa do fluxo de autenticação já é uma rota própria: `create-account.tsx` → `confirm-email.tsx` → login; `login.tsx` → `change-password.tsx` → `feedback.tsx`. Não existe precedente de tela com múltiplos modos internos alternando formulário — introduzir isso quebraria o padrão sem necessidade.
2. **Separação de responsabilidade e de estado.** `login.tsx` já gerencia estado de credenciais, erro de autenticação e loading do `signIn`. Empilhar um segundo formulário (coleta de e-mail para recuperação) no mesmo componente aumenta a complexidade condicional da tela sem ganho de UX — o usuário não se beneficia de ver os dois formulários no mesmo lugar, e o clique em "Esqueci minha senha" já é uma troca de contexto (Nielsen #3, controle do usuário: uma ação explícita e nomeada leva a uma tela dedicada e nomeada).
3. **`confirm-email.tsx` não serve porque resolve um problema diferente.** Ali o e-mail já é conhecido (acabou de ser digitado no cadastro) e a tela existe para reenviar uma confirmação já disparada. Na recuperação de senha, o e-mail é desconhecido no momento em que o usuário clica em "Esqueci minha senha" a partir do login — a tela precisa primeiro coletá-lo.
4. **Nome de rota alinhado à convenção existente** (arquivos em kebab-case, em inglês, com texto de interface em português): `forgot-password.tsx`, no mesmo padrão de `change-password.tsx`, `create-account.tsx`, `confirm-email.tsx`, `select-profile.tsx`.

## 4. Sitemap afetado

```
Login (/)
 └─ [Esqueci minha senha] → Recuperar senha (/forgot-password)   [NOVA ROTA]
      ├─ e-mail enviado (sempre, resposta neutra)
      │     → Feedback: link enviado (/feedback?state=password-reset-requested)   [NOVO ESTADO]
      │         └─ [Voltar ao login] → Login (/)
      ├─ RATE_LIMITED / NETWORK_ERROR / UNKNOWN
      │     → erro inline, permanece em /forgot-password (campo preservado)
      └─ [Cancelar e voltar] → Login (/)

(fora do app — e-mail do usuário)
 └─ clique no link de recuperação
      → SDK do Supabase abre sessão de recuperação (web: detectSessionInUrl; nativo: deep link)
      → app abre Nova senha (/change-password)
           ├─ [ao montar] sem sessão de recuperação
           │     → Feedback: link expirado (/feedback?state=link-expired)   [ESTADO REAPROVEITADO, sem tela de formulário exibida]
           ├─ [ao montar] com sessão → formulário de nova senha (inalterado)
           │     ├─ sucesso → Feedback: senha alterada (/feedback?state=password-updated)   [ESTADO EXISTENTE, inalterado]
           │     ├─ SESSION_EXPIRED no submit (sessão caiu entre o mount e o clique)
           │     │     → mesmo destino do caso "sem sessão" acima
           │     ├─ AUTH_WEAK_PASSWORD → erro inline, permanece em /change-password
           │     └─ RATE_LIMITED / NETWORK_ERROR / UNKNOWN → erro inline, permanece em /change-password
           └─ [Cancelar e voltar] → Login (/)   [JÁ EXISTENTE, inalterado]
```

## 5. Fluxo estrutural

### Caminho feliz

| Passo | Ator | Ação |
|---|---|---|
| 1 | Usuário | Na tela de login, clica em "Esqueci minha senha". |
| 2 | Sistema | Navega para `/forgot-password`, pré-preenchendo o campo de e-mail se o usuário já havia digitado algo no campo de e-mail do login (não obrigatório, só recuperação de recall — ver seção 8). |
| 3 | Usuário | Confirma ou digita o e-mail e toca em "Enviar link de recuperação". |
| 4 | Sistema | Valida formato do e-mail no cliente; chama `requestPasswordReset(email)`; exibe indicador de carregamento. |
| 5 | Sistema | Resposta neutra (sempre sucesso do ponto de vista da UI, independentemente de o e-mail existir) → navega para `/feedback?state=password-reset-requested`. |
| 6 | Usuário | Abre o e-mail recebido (se a conta existir) e clica no link de recuperação. |
| 7 | Sistema (SDK) | O SDK do Supabase processa o link e estabelece uma sessão de recuperação temporária (`detectSessionInUrl` na web; deep link + `exchangeCodeForSession`/`verifyOtp` no nativo). |
| 8 | Sistema | Abre `/change-password`; ao montar, verifica a sessão de recuperação; como ela existe, exibe o formulário de nova senha. |
| 9 | Usuário | Preenche nova senha e confirmação, toca em "Salvar nova senha". |
| 10 | Sistema | Valida localmente (8+ caracteres, confirmação igual); chama `updatePassword({ newPassword })`. |
| 11 | Sistema | Sucesso → navega para `/feedback?state=password-updated`. |
| 12 | Usuário | Toca em "Entrar com a nova senha" → volta ao login e autentica com a senha nova. |

### Alternativos e exceções

```
ALT01 — E-mail informado em /forgot-password não corresponde a nenhuma conta.
  Comportamento idêntico ao caminho feliz a partir do passo 5 (resposta sempre
  neutra); nenhuma mensagem, tempo de resposta ou destino diferencia esse caso
  do e-mail existente (DEC-055, anti-enumeração).

ALT02 — Usuário chega a /change-password sem ter passado pelo link (ex.: aba
  antiga, favorito, digitou a URL direto, ou o link já foi usado uma vez).
  Não existe sessão de recuperação → tela nunca exibe o formulário → redireciona
  direto para /feedback?state=link-expired.

EXC01 — requestPasswordReset falha por RATE_LIMITED.
  Erro inline em /forgot-password, mensagem neutra sobre limite de tentativas,
  sem revelar se o e-mail existe; campo de e-mail preservado.

EXC02 — requestPasswordReset falha por NETWORK_ERROR ou UNKNOWN.
  Erro inline em /forgot-password, convite a tentar novamente; campo de e-mail
  preservado (nunca perder o que o usuário digitou).

EXC03 — Sessão de recuperação expira entre o carregamento de /change-password e
  o clique em "Salvar nova senha" (ex.: usuário demorou para preencher).
  updatePassword lança SESSION_EXPIRED → mesmo destino do ALT02
  (/feedback?state=link-expired), nunca um erro inline nesta tela.

EXC04 — updatePassword falha por AUTH_WEAK_PASSWORD (ex.: proteção de senha
  vazada do Supabase, mesmo após passar da validação client-side de 8+
  caracteres).
  Erro inline em /change-password pedindo outra senha; formulário permanece
  preenchido e editável; a senha rejeitada não é reexposta em log, analytics
  ou qualquer lugar além do próprio campo de entrada do usuário.

EXC05 — updatePassword falha por RATE_LIMITED, NETWORK_ERROR ou UNKNOWN.
  Erro inline em /change-password, convite a tentar novamente; campos
  preservados.

EXC06 — Usuário toca em "Cancelar e voltar" em qualquer uma das duas telas
  novas/alteradas.
  Volta ao login (/) sem disparar nenhuma chamada de rede (comportamento já
  existente em change-password.tsx, replicado em forgot-password.tsx).
```

## 6. Especificação estrutural das telas

Nenhuma especificação abaixo define cor, tipografia ou layout novo — todas reaproveitam os átomos/moléculas já existentes (`AuthLayout`, `TextField`, `Button`, `AuthFeedback`, `ActivityIndicator`) exatamente como usados hoje em `login.tsx`/`change-password.tsx`/`confirm-email.tsx`.

### 6.1 `login.tsx` — mudança pontual

- O botão "Esqueci minha senha" (hoje `onPress={() => router.push('/change-password')}`) passa a navegar para `/forgot-password`.
- Se o campo de e-mail do login já tiver algum valor digitado no momento do clique, esse valor deve ser passado como parâmetro de rota (`{ email: email.trim() }`) para pré-preencher o campo equivalente em `/forgot-password` — reconhecimento em vez de memorização (Nielsen #6). Se estiver vazio, nenhum parâmetro é enviado e o campo nasce vazio.
- Nenhuma outra mudança nesta tela.

### 6.2 `/forgot-password` (nova rota)

Estrutura (usando os mesmos blocos de `AuthLayout` já usados em `login.tsx`/`change-password.tsx`):

- **Eyebrow:** "Recuperação de acesso" — igual ao já usado em `change-password.tsx`, para que o usuário perceba que está numa jornada contínua (Gestalt: continuidade; Norman: consistência).
- **Título:** "Vamos recuperar seu acesso."
- **Descrição:** "Informe o e-mail da sua conta. Se ele estiver cadastrado, você vai receber um link para criar uma nova senha."
- **Campo:** `TextField` "E-mail" (`icon="email"`, `autoCapitalize="none"`, `autoComplete="email"`, `keyboardType="email-address"`), valor inicial a partir do parâmetro `email` recebido de `login.tsx` quando presente.
- **Validação client-side (antes de qualquer chamada de rede):** campo vazio → "Informe seu e-mail."; formato inválido (sem `@`/domínio) → "Informe um e-mail válido." Mesmo padrão de erro de campo já usado em `login.tsx` (prevenção de erro, Nielsen #5 — evita gastar uma chamada de rede e a espera de resposta com um valor que já sabemos estar malformado).
- **Botão primário:** "Enviar link de recuperação" (`icon="forward"`), com `ActivityIndicator` visível durante a chamada, mesmo padrão do botão "Entrar" em `login.tsx` (visibilidade do status, Nielsen #1).
- **Botão secundário:** "Cancelar e voltar" (`variant="ghost"`, `icon="back"`) → `router.replace('/')`, mesmo padrão já usado em `change-password.tsx`.
- **Erro inline (RATE_LIMITED/NETWORK_ERROR/UNKNOWN):** mesmo bloco visual de erro já usado em `login.tsx`/`change-password.tsx` (`accessibilityRole="alert"`), texto neutro, campo de e-mail preservado.
- **Ao submeter com sucesso:** `router.replace({ pathname: '/feedback', params: { state: 'password-reset-requested' } })`. Uso de `replace`, não `push`, para que o botão "voltar" do navegador/dispositivo não devolva o usuário a um formulário já enviado (mesmo padrão já usado por `change-password.tsx` ao concluir).

### 6.3 `/change-password` — comportamento novo obrigatório no carregamento

Hoje esta tela não verifica nada ao montar. Passa a ter três estados de renderização, nesta ordem:

1. **Verificando (novo, transitório):** ao montar, antes de decidir se mostra o formulário, a tela deve resolver se existe uma sessão de recuperação ativa. Enquanto essa verificação não terminar, exibir um estado neutro de carregamento (ex.: `ActivityIndicator` centralizado dentro do `AuthLayout`, com um texto companheiro como "Verificando seu link de recuperação…"). **Este passo é estrutural, não cosmético:** no fluxo real, a sessão de recuperação pode ser estabelecida de forma assíncrona pelo SDK (parsing da URL na web, resolução de deep link no nativo) — decidir "sem sessão" antes dessa resolução terminar produziria falsos negativos (usuário com link válido sendo mandado para "link expirado" só porque a tela verificou cedo demais). Nunca pular direto para "sem sessão" no primeiro render.
2. **Sem sessão de recuperação:** verificação concluída e nenhuma sessão encontrada → `router.replace({ pathname: '/feedback', params: { state: 'link-expired' } })`. O formulário de senha NUNCA é exibido neste caso — é prevenção de erro (Nielsen #5): não deixar o usuário preencher e confirmar uma nova senha só para descobrir no fim que não havia sessão válida.
3. **Com sessão de recuperação:** exibe o formulário já existente, sem mudanças na validação local.

No envio do formulário (submit):

- Sucesso em `updatePassword` → antes de navegar para `/feedback?state=password-updated`, a sessão de recuperação deve ser encerrada explicitamente (ex.: `signOut`), para que "Entrar com a nova senha" (texto já existente no estado `password-updated`) seja uma ação real, não uma etiqueta sobre um usuário que já está tecnicamente autenticado pela sessão temporária de recuperação. Sem esse encerramento explícito, a promessa que a própria tela de feedback já faz deixa de ser verdadeira.
- `SESSION_EXPIRED` no submit → mesmo destino do caso "sem sessão" (item 2 acima): `/feedback?state=link-expired`. Nunca um erro inline para este código específico.
- `AUTH_WEAK_PASSWORD` → erro inline no campo de senha, formulário preservado, pedir senha diferente (ver EXC04).
- `RATE_LIMITED`/`NETWORK_ERROR`/`UNKNOWN` → erro inline, formulário preservado (ver EXC05).

**Por que reaproveitar `link-expired` em vez de criar um estado dedicado para "sessão de recuperação ausente":** este handoff considerou e rejeitou criar um novo estado (ex.: `recovery-session-expired`) com texto mais específico. `link-expired` já é a mesma resposta usada quando o link de CONFIRMAÇÃO de e-mail expira (`AUTH_LINK_INVALID`, ver regra 5 do handoff de Chris) — os dois casos (link de confirmação inválido e sessão de recuperação ausente) já compartilham deliberadamente o mesmo código de erro público e o mesmo destino visual, por decisão anterior do projeto (DEC-056, "sem diferenciar o motivo"). Criar um estado novo só para a recuperação de senha romperia essa consistência já estabelecida sem necessidade.

### 6.4 `feedback.tsx` — novo estado `password-reset-requested`

Adicionar uma entrada ao mapa `states` já existente, no mesmo formato das demais:

```
'password-reset-requested': {
  tone: 'info',
  title: 'Verifique seu e-mail',
  description: 'Se este e-mail estiver cadastrado, você vai receber um link para criar uma nova senha em poucos minutos.',
  action: 'Voltar ao login',
}
```

- Nenhuma mudança na lógica de roteamento do componente é necessária: este estado cai no branch padrão (`state === 'consent-required' ? ... : '/'`), assim como `google-pending`, `session-expired` etc.
- Tom `info` reaproveita o mesmo ícone (`email`) já usado por `google-pending` — nenhum ícone novo é necessário.
- **Restrição de copy não negociável:** a descrição nunca deve confirmar nem negar a existência da conta — "se este e-mail estiver cadastrado" é a formulação mínima que preserva a neutralidade também na camada de texto, não só no código de erro (reforço estrutural de DEC-055). Qualquer ajuste de texto feito por Nero deve preservar essa condicional.
- **Opção considerada e descartada:** ecoar o e-mail digitado na própria mensagem (como `confirm-email.tsx` faz para o fluxo de cadastro). Rejeitada aqui para não estender o mecanismo estático de `feedback.tsx` (que hoje não interpola parâmetros dinâmicos em nenhum dos estados existentes) só para este caso — a mensagem já é suficientemente clara sem repetir o e-mail, e evita introduzir capacidade de templating no componente por um único consumidor.
- **Reenvio:** esta tela não oferece um botão de "reenviar". Se o e-mail não chegar, o caminho de recuperação é voltar ao login e clicar em "Esqueci minha senha" novamente, o que decorre uma nova chamada de `requestPasswordReset` (funcionalmente equivalente a um reenvio). Decisão deliberada de manter o escopo mínimo pedido; se o produto perceber que esse caminho não é suficientemente descoberto pelos usuários, um botão de reenvio dedicado (no mesmo padrão de `confirm-email.tsx`) pode ser adicionado depois, sem impacto estrutural no restante deste fluxo.

## 7. Componentização

Nenhum átomo, molécula ou organismo novo é necessário. Inventário de reaproveitamento:

| Componente | Uso nesta entrega |
|---|---|
| `AuthLayout` | Envelope institucional das telas `/forgot-password` e `/change-password` (estado de verificação) — inalterado. |
| `TextField` | Campo de e-mail em `/forgot-password` — mesma configuração já usada em `login.tsx`. |
| `Button` (`primary`/`ghost`) | Ações de envio e cancelamento — mesmas variantes já catalogadas. |
| `AuthFeedback` | Renderização do novo estado `password-reset-requested` em `feedback.tsx` — sem alteração no componente. |
| `ActivityIndicator` | Estado de carregamento do envio em `/forgot-password` e do novo estado "verificando" em `/change-password` — mesmo padrão já usado em `login.tsx`. |

## 8. Heurísticas e acessibilidade aplicadas (somente onde fazem diferença real)

- **Nielsen #1 — Visibilidade do status:** indicador de carregamento durante `requestPasswordReset`; estado explícito de "verificando sessão" em `/change-password` antes de decidir entre formulário e redirecionamento — evita uma tela em branco ou um salto abrupto sem explicação.
- **Nielsen #5 — Prevenção de erros:** `/change-password` nunca exibe um formulário que já sabemos, antes de qualquer digitação, que vai falhar por falta de sessão; validação de formato de e-mail em `/forgot-password` acontece antes de qualquer chamada de rede.
- **Nielsen #6 — Reconhecimento em vez de memorização:** e-mail já digitado no login é pré-preenchido em `/forgot-password`.
- **Nielsen #4 — Consistência:** mesmos átomos visuais, mesmo padrão de "Cancelar e voltar", mesmo mecanismo de estados de `feedback.tsx`, mesmo estado `link-expired` para ambos os tipos de link inválido — nenhuma linguagem visual nova é introduzida.
- **Nielsen #9 — Ajudar a reconhecer, diagnosticar e recuperar-se de erros:** mensagens neutras e acionáveis para `RATE_LIMITED`/`NETWORK_ERROR`, sempre preservando o que o usuário já digitou.
- **Segurança como requisito de UX (DEC-055):** a neutralidade anti-enumeração já garantida pelo contrato de erro se estende à camada de copy do novo estado de feedback (seção 6.4) — sem isso, a arquitetura de erro ficaria neutra no código mas vazaria informação no texto exibido.
- **Acessibilidade:** erros inline mantêm `accessibilityRole="alert"` (padrão já usado no projeto); o estado de "verificando sessão" em `/change-password`, por ser novo e sensível a uma condição de corrida, deve ser perceptível por leitor de tela (rótulo acessível associado ao indicador de carregamento) para que quem usa tecnologia assistiva não fique sem informação sobre o que está acontecendo enquanto a verificação ocorre. Nenhum novo requisito de navegação por teclado surge aqui além do que `TextField`/`Button` já garantem nativamente.

## 9. Riscos, dependências e decisões pendentes

### 9.1 Dependência crítica ainda não resolvida — autenticação real vs. mock

`AuthRegistrationPort` só tem uma implementação no código (`SupabaseAuthRegistrationAdapter`/`authRegistrationService`) — não existe (e não deveria existir) uma versão mock. Isso significa que, tecnicamente, `/forgot-password` e `/change-password` só podem chamar o serviço real do Supabase; não há alternativa.

O problema: **todas as telas hoje, incluindo `login.tsx`, autenticam exclusivamente contra `MockAuthAdapter`** (`apps/agendae/src/infra/auth/mock-auth-adapter.ts`, exportado como `authService`), cujo `signIn` aceita qualquer e-mail com "@" e qualquer senha com 6+ caracteres, sem qualquer relação com o Supabase real. Existe uma implementação real equivalente (`SupabaseAuthAdapter`/`supabaseAuthService`), mas nenhuma tela a importa hoje (`BLG-041` está `Pronto`, não iniciado).

Consequência prática: se este fluxo for implementado exatamente como especificado, ele vai efetivamente trocar a senha de uma conta real no Supabase — mas a etapa final ("Entrar com a nova senha", que leva de volta a `login.tsx`) continuará autenticando contra o `MockAuthAdapter`, que nunca vai validar essa senha real. O laço da jornada ("recuperei minha senha → consigo entrar com ela") não se fecha de fato, mesmo com a arquitetura de experiência corretamente desenhada.

Isso também afeta a verificação de sessão de recuperação descrita na seção 6.3: ela precisa necessariamente consultar `supabaseAuthService.getSession()` (real), não `authService.getSession()` (mock) — são dois armazenamentos de sessão completamente independentes hoje.

**Isto não é uma decisão que me cabe tomar sozinho** — ver pergunta na seção 12.

### 9.2 Dependência de infraestrutura já registrada (não é gap novo)

`emailRedirectTo`/`redirectTo` em `supabase-auth-registration-adapter.ts` continuam apontando para domínios-placeholder (`https://rotinae.example/...`), pendência já registrada em DEC-068. A rota de retorno do e-mail de recuperação precisa apontar para `/change-password` (web) e para o deep link equivalente (nativo) — isso é dependência de infraestrutura de deploy, fora do escopo deste handoff e já sinalizado anteriormente.

### 9.3 Decisão de produto pendente, não decidida aqui

`change-password.tsx` promete "Escolha uma senha segura e diferente das utilizadas anteriormente", mas o Supabase não verifica isso nativamente (`AUTH_PASSWORD_REUSED` está reservado, sem uso — seção 6 do handoff de Chris, DEC-067). Esta arquitetura de UX não resolve essa pendência; apenas a mantém visível para decisão de produto futura (implementar a verificação ou ajustar o texto da tela).

### 9.4 Edge case aceito, não resolvido

Uma pessoa já autenticada no app (sessão comum, não de recuperação) que navegue manualmente para `/change-password` também vai encontrar uma sessão válida no `getSession()` e ver o formulário normalmente — o contrato atual (`updatePassword`) não distingue "sessão de recuperação" de "sessão comum", ambas são apenas "sessão". Isso permite, como efeito colateral aceitável, uma troca de senha autoatendida por alguém já logado — comportamento não descrito como objetivo, mas também não é um requisito deste fluxo resolver ou impedir. Registrado para conhecimento, não para ação.

## 10. Critérios de aceite para a ADA

- Clicar em "Esqueci minha senha" em `login.tsx` navega para `/forgot-password`, nunca mais direto para `/change-password`.
- E-mail já digitado no login aparece pré-preenchido em `/forgot-password` quando presente; campo nasce vazio quando não há valor prévio.
- Envio de `/forgot-password` produz sempre o mesmo destino visual (`/feedback?state=password-reset-requested`) para e-mail existente, inexistente, confirmado ou não — nenhuma variação de tempo de resposta perceptível ou texto que permita distinguir os casos.
- `RATE_LIMITED`/`NETWORK_ERROR`/`UNKNOWN` em `/forgot-password` produzem erro inline, nunca navegação para outra tela; campo de e-mail nunca é limpo nesses casos.
- `/change-password` nunca renderiza o formulário de senha antes de confirmar a existência de uma sessão de recuperação; ausência de sessão redireciona para `/feedback?state=link-expired` sem exibir o formulário em nenhum momento.
- `SESSION_EXPIRED` disparado no submit de `/change-password` produz o mesmo destino do caso "sem sessão" (`/feedback?state=link-expired`), nunca um erro inline.
- Sucesso em `updatePassword` encerra explicitamente a sessão de recuperação antes de navegar para `/feedback?state=password-updated`.
- `AUTH_WEAK_PASSWORD`, `RATE_LIMITED`, `NETWORK_ERROR` e `UNKNOWN` no submit de `/change-password` produzem erro inline com o formulário preservado, nunca navegação para outra tela.
- Nenhuma senha, token de recuperação ou sessão é logada, enviada a analytics ou exposta em mensagem de erro, em nenhuma das duas telas.
- Web e nativo completam o mesmo fluxo (coleta de e-mail → e-mail recebido → link → nova senha → login), respeitando a particularidade de deep link de cada plataforma.

## 11. Registro em BACKLOG.md

Este handoff gera a entrada `DEC-075`, registrada com status `Proposta` (não `Aprovada`) até validação explícita do usuário — ver `BACKLOG.md`, seção 4.

## 12. Pendências de validação explícita

Este documento não deve ser tratado como pronto para a ADA iniciar o wiring até que o usuário confirme os pontos abaixo. (Nota: a ferramenta de pergunta interativa não estava disponível nesta execução — as perguntas estão registradas aqui e devem ser respondidas antes de avançar.)

1. **O fluxo estrutural descrito nas seções 3 a 6** (nova rota `/forgot-password`, verificação de sessão no mount de `/change-password`, reaproveitamento do estado `link-expired`, novo estado `password-reset-requested`) está de acordo com o esperado, ou algum ponto precisa ser revisto antes de seguir para a ADA?
2. **Dependência crítica da seção 9.1:** este fluxo só funciona de ponta a ponta (incluindo o login final com a senha nova) se `login.tsx` também passar a autenticar contra `supabaseAuthService` (real) em vez de `MockAuthAdapter`. Isso está fora do escopo original que me foi passado (que falava em "wiring" apenas deste gap específico). Como devo tratar isso: (a) registrar como escopo adicional deste mesmo esforço, ampliando o que a ADA vai implementar; (b) tratar como limitação conhecida e aceita por agora — a recuperação funciona contra o Supabase real, mas o login continuado depende de BLG-041 ser resolvido separadamente, e devo registrar isso explicitamente como uma limitação no handoff/BACKLOG; ou (c) outra direção que você prefira?
