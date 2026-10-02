# Arquitetura de Backend — Etapa 1 — Rotinaê

> **Versão:** 0.2.0  
> **Status:** Handoff de autenticação reconciliado; demais domínios aguardam contratos próprios  
> **Data:** 2 de agosto de 2026  
> **Responsável:** Cris — Backend  
> **Escopo:** preparação contratual; nenhuma integração Supabase ou credencial real nesta etapa  
> **Fontes:** Visão v0.6.0, Regras de Negócio v0.2.0, RF v0.1.0, RNF v0.1.0, Histórias v0.1.0, UX v0.2.1 e Preparação do Ambiente v0.1.0

## 1. Objetivo e limites da etapa

Esta etapa define a fronteira técnica que permitirá ao front-end trabalhar com uma porta/adaptador mock e, depois, trocar apenas o adaptador pela implementação Supabase. O contrato deve preservar as regras de identidade, perfil, vínculo, consentimento e isolamento desde o primeiro fluxo.

### Incluído

- modelo mínimo de identidade e acesso para Prestador e Cliente;
- limite de tenant e política de autorização com RLS;
- estados, transições e invariantes do primeiro fluxo;
- contrato sugerido para consumo pelo front-end;
- catálogo inicial de erros estáveis;
- classificação das variáveis de ambiente;
- estratégia de ambientes, migrations, seeds e testes;
- critérios de aceite e sequência segura de implementação.

### Não incluído

- criação de projeto, tabelas, migrations ou funções reais no Supabase;
- cadastro, login ou persistência reais;
- credenciais, chaves, secrets ou dados pessoais reais;
- implementação de agenda, pacotes, financeiro, arquivos ou comunicações;
- Edge Functions, webhooks, filas ou provedores externos;
- painel administrativo;
- alteração do aplicativo universal nesta entrega.

O mock não será considerado fonte de verdade nem mecanismo de segurança. Ele existe apenas para desenvolver estados e fluxos da interface. Na integração real, autorização e invariantes serão aplicadas pelo PostgreSQL/RLS e, quando necessário, por funções transacionais no servidor.

## 2. Princípios arquiteturais

1. **Servidor como autoridade:** papel, tenant, vínculo e permissão nunca serão aceitos apenas porque vieram do cliente.
2. **Negar por padrão:** tabela exposta terá RLS habilitada e nenhuma operação será permitida sem política explícita.
3. **Tenant do prestador:** cada Prestador representa inicialmente um tenant operacional independente.
4. **Cliente multi-tenant:** um Cliente poderá participar de vários tenants, sempre por vínculos independentes.
5. **Menor privilégio:** o cliente acessará apenas recursos próprios e explicitamente compartilhados no contexto de vínculo Ativo.
6. **Contratos independentes do fornecedor:** telas consumirão uma porta de aplicação, não chamadas Supabase espalhadas por componentes.
7. **Auditoria sem conteúdo sensível:** ações críticas registrarão metadados e correlação, sem copiar observações, documentos, tokens ou dados financeiros completos.
8. **Tempo consistente:** instantes serão persistidos em UTC; datas da agenda serão interpretadas no fuso IANA do prestador.
9. **Identificadores opacos:** entidades usarão UUID; códigos de vínculo não serão sequenciais nem atuarão como autorização.
10. **Alterações rastreáveis:** mudança de contrato, regra ou arquitetura exige atualização documental e registro no changelog central antes da implementação divergente.

## 3. Limite de tenant e sujeitos de acesso

### 3.1 Definições

| Conceito | Definição inicial |
|---|---|
| Identidade | Usuário autenticado pelo Supabase Auth (`auth.users.id`) |
| Perfil | Registro de domínio com exatamente um papel: `provider` ou `client` |
| Tenant | Espaço operacional pertencente a um Prestador |
| Membro proprietário | Prestador dono do tenant |
| Vínculo | Relação de um Cliente com um tenant, controlada por estado |
| Contexto ativo | Tenant selecionado pelo cliente entre seus vínculos Ativos |

O `tenant_id` deverá existir em toda entidade operacional que pertença à operação de um prestador. O valor não será inferido de um campo livre enviado pela interface sem validação de propriedade ou vínculo.

### 3.2 Matriz mínima de acesso

| Recurso | Prestador proprietário | Cliente Pendente | Cliente Ativo | Cliente Rejeitado/Revogado | Anônimo |
|---|:---:|:---:|:---:|:---:|:---:|
| Próprio perfil | Sim | Sim, apenas o próprio | Sim, apenas o próprio | Sim, apenas o próprio | Não |
| Próprio tenant | Sim | Não | Somente identificação mínima autorizada | Não | Não |
| Solicitação de vínculo | Gerencia no próprio tenant | Consulta a própria | Consulta a própria | Consulta a própria | Não |
| Dados operacionais do tenant | Sim | Não | Somente dados próprios/compartilhados | Não | Não |
| Consentimentos | Somente os próprios | Somente os próprios | Somente os próprios | Somente os próprios | Não |
| Auditoria técnica | Sem CRUD direto | Não | Não | Não | Não |

O acesso do cliente será sempre a interseção de: identidade autenticada, perfil `client`, vínculo `active`, tenant correto, propriedade/participação no recurso e regra de visibilidade do domínio.

## 4. Modelo mínimo inicial

Este é um modelo lógico, não uma migration pronta.

### 4.1 `profiles`

| Campo | Tipo conceitual | Regra |
|---|---|---|
| `user_id` | UUID, PK/FK Auth | Igual à identidade autenticada |
| `role` | enum | `provider` ou `client`; imutável no MVP |
| `display_name` | texto | Obrigatório, com limite a definir |
| `phone` | texto anulável | Normalizado; política de verificação em aberto |
| `status` | enum | `active`, `blocked`, `deleted` |
| `created_at`, `updated_at` | timestamptz | UTC, gerenciados pelo servidor |

Invariante: uma identidade possui exatamente um perfil. Uma pessoa que precise dos dois papéis usará contas distintas no MVP.

### 4.2 `tenants`

| Campo | Tipo conceitual | Regra |
|---|---|---|
| `id` | UUID, PK | Identificador opaco |
| `owner_user_id` | UUID, unique | Deve referenciar perfil `provider` |
| `display_name` | texto | Nome público/profissional |
| `timezone` | texto IANA | Obrigatório antes de operar agenda |
| `status` | enum | `active`, `suspended`, `closed` |
| `created_at`, `updated_at` | timestamptz | UTC |

Invariante inicial: cada Prestador possui no máximo um tenant e é seu único proprietário. Equipes não fazem parte do MVP.

### 4.3 `provider_link_codes`

| Campo | Tipo conceitual | Regra |
|---|---|---|
| `id` | UUID, PK | Identificador interno |
| `tenant_id` | UUID, FK | Tenant emissor |
| `token_hash` | texto, unique | Hash do segredo; nunca consultar por texto puro armazenado |
| `display_prefix` | texto | Trecho não sensível para identificação/auditoria |
| `status` | enum | `active`, `revoked`, `expired` |
| `expires_at` | timestamptz anulável | Política final em aberto |
| `created_at`, `revoked_at` | timestamptz | UTC |

O código será produzido por CSPRNG com pelo menos 128 bits de entropia. Informá-lo cria solicitação Pendente e não concede acesso. Busca e respostas não poderão permitir enumeração.

**Ponto de produto pendente:** RF-VIN-001 pede gerar, exibir, revogar e regenerar. A recomendação de segurança é revelar o código completo somente na geração/regeneração e depois mostrar apenas o prefixo, evitando texto puro persistente. Caso “exibir sempre” seja obrigatório, será necessária estratégia de criptografia server-side e gestão de chave. Esta decisão precisa entrar no changelog central antes da migration.

### 4.4 `provider_client_links`

| Campo | Tipo conceitual | Regra |
|---|---|---|
| `id` | UUID, PK | Identificador do vínculo |
| `tenant_id` | UUID, FK | Contexto do prestador |
| `client_user_id` | UUID, FK | Deve referenciar perfil `client` |
| `status` | enum | `pending`, `active`, `rejected`, `revoked` |
| `requested_at` | timestamptz | UTC |
| `decided_at`, `revoked_at` | timestamptz anulável | UTC |
| `decided_by`, `revoked_by` | UUID anulável | Ator autorizado |

Constraints mínimas:

- no máximo um vínculo não terminal por par `tenant_id + client_user_id`;
- aprovação/rejeição somente pelo proprietário do tenant;
- revogação preserva o registro e bloqueia novas operações;
- vínculo Ativo não é criado diretamente pelo cliente;
- vínculos do mesmo cliente com tenants diferentes são independentes.

### 4.5 `legal_documents`

| Campo | Tipo conceitual | Regra |
|---|---|---|
| `id` | UUID, PK | Documento/versionamento |
| `kind` | enum | `terms` ou `privacy_policy` |
| `version` | texto | Identificador estável da versão |
| `published_at` | timestamptz | UTC |
| `effective_at` | timestamptz | UTC |
| `status` | enum | `draft`, `active`, `retired` |

O texto legal poderá ser hospedado fora da tabela; o registro deve identificar de forma inequívoca o conteúdo aceito. Validação jurídica continua obrigatória.

### 4.6 `legal_acknowledgements`

| Campo | Tipo conceitual | Regra |
|---|---|---|
| `id` | UUID, PK | Registro imutável |
| `user_id` | UUID, FK | Titular autenticado |
| `document_id` | UUID, FK | Versão aceita/cientificada |
| `action` | enum | `accepted_terms` ou `acknowledged_privacy` |
| `occurred_at` | timestamptz | Gerado pelo servidor |
| `source` | enum | `web`, `android`, `ios` |

Termos e ciência da Política serão registros separados. Não serão modelados como consentimento opcional.

### 4.7 `communication_preferences` e `consent_events`

`communication_preferences` representa o estado atual por `user_id + channel + purpose`. Canais iniciais conceituais: `email`, `push`, `whatsapp`. Finalidades serão estáveis e restritas, por exemplo `appointment_reminder` e `product_updates`, após revisão jurídica.

`consent_events` será uma trilha append-only com:

- usuário;
- canal e finalidade;
- ação `granted` ou `revoked`;
- versão do aviso apresentado;
- instante UTC e origem;
- correlation ID.

Invariantes:

- recusar ou revogar comunicação opcional não bloqueia funcionalidade independente;
- preferências opcionais não substituem aceite ou ciência legal;
- comunicação transacional e opcional terão fundamento e finalidade separados, sujeitos à validação jurídica;
- o usuário altera somente suas próprias preferências;
- histórico de eventos não é editável por usuários comuns.

### 4.8 `audit_events`

Registro append-only contendo `actor_user_id`, `tenant_id` quando aplicável, `action`, `resource_type`, `resource_id`, `occurred_at`, `result` e `correlation_id`. Não armazenará código completo, token, conteúdo de observação, arquivo, documento pessoal ou payload financeiro completo.

## 5. Estados e transições

### 5.1 Perfil

```text
active -> blocked -> active
active -> deleted
blocked -> deleted
```

`deleted` é terminal no modelo lógico; eliminação física dependerá da política de retenção e LGPD.

### 5.2 Vínculo

```text
pending -> active
pending -> rejected
pending -> revoked
active  -> revoked
```

- `rejected` e `revoked` são terminais para aquele registro;
- nova tentativa autorizada cria novo registro, sem reabrir histórico;
- somente `active` autoriza dados operacionais;
- revogação deve impedir novos acessos em até 60 segundos;
- transição inválida retorna erro estável e não produz efeito parcial.

### 5.3 Código de vínculo

```text
active -> revoked
active -> expired
```

Rotação revoga o código atual e cria outro atomicamente. Solicitações já existentes não mudam de estado automaticamente.

### 5.4 Consentimento opcional

```text
unset <-> granted <-> revoked
```

Cada alteração cria evento imutável; a preferência atual é uma projeção consistente do último evento válido.

## 6. Contrato acordado com o front-end

O handoff foi comparado integralmente com `apps/agendae/FRONTEND_CONTRACTS.md` v0.1.0. Nesta Etapa 1, o único contrato acordado é a porta de autenticação e sessão. Cadastro, recuperação, perfil, documentos legais, consentimentos e vínculo permanecem fora do contrato implementado e exigirão portas próprias em etapas posteriores.

### 6.1 `AuthPort` vigente

O adaptador Supabase futuro deverá implementar exatamente a porta consumida pelas telas, sem alterar sua assinatura:

```ts
interface AuthPort {
  signIn(input: SignInInput): Promise<Session>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
}

type SignInInput = {
  email: string;
  password: string;
  selectedRole?: 'provider' | 'client';
};
```

`selectedRole` é contexto visual e não autoridade. O adaptador não o persistirá nem o usará para modificar o papel. A sessão devolvida pelo servidor/perfil persistido determina as permissões e o destino após o login. Uma divergência entre seleção visual e papel persistido deve ser tratada como contexto de navegação, nunca como elevação de privilégio.

### 6.2 Sessão entregue à aplicação

```ts
type Session = {
  accessToken: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    role: 'provider' | 'client';
    displayName: string;
  };
};
```

- `expiresAt` usa ISO 8601 em UTC;
- o adaptador poderá compor Auth e `profiles`, mas entregará uma única sessão consistente;
- ausência de perfil válido não produzirá sessão operacional completa;
- armazenamento, restauração e renovação segura pertencem ao adaptador por plataforma;
- `accessToken` nunca será registrado em logs, telemetria, mensagens ou auditoria;
- a presença de `role` no objeto da aplicação não substitui RLS nem autorização server-side.

### 6.3 Erros do contrato vigente

Nesta porta, falhas são lançadas/rejeitadas no formato normalizado já consumido pelo front, e não retornadas em `Result<T>`. Os códigos públicos acordados são:

```ts
type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';
```

O adaptador converte mensagens e códigos de Supabase/PostgreSQL para esse conjunto. Texto técnico do fornecedor não chega às telas. Correlation ID poderá ser anexado ao erro normalizado sem alterar o código público, após o formato concreto do erro ser definido no contrato TypeScript.

### 6.4 Portas futuras, ainda não acordadas

As seguintes capacidades continuam previstas pela arquitetura, mas não fazem parte de `AuthPort` v0.1.0:

- `signUp` e onboarding com escolha imutável do papel;
- recuperação de senha;
- consulta e atualização do próprio perfil;
- aceite de Termos e ciência da Política;
- preferências e eventos de consentimento;
- geração, rotação e uso do código de vínculo;
- aprovação, rejeição, listagem e revogação de vínculos;
- seleção do contexto de tenant pelo cliente.

Cada capacidade deverá receber contrato de front versionado antes do adaptador real correspondente. O modelo lógico das seções 3 a 5 permanece como preparação do backend, não como promessa de assinatura TypeScript.

### 6.5 Matriz de reconciliação do handoff

| Tema | Estado | Resultado da comparação |
|---|:---:|---|
| Porta desacoplada do fornecedor | Compatível | Telas consomem `AuthPort`; SDK fica no adaptador |
| Métodos de autenticação atuais | Compatível | `signIn`, `signOut` e `getSession` são o escopo vigente |
| Papel único por conta | Compatível | `provider` ou `client`, persistido no servidor |
| `selectedRole` | Compatível | Contexto opcional da UI; nunca concede privilégio |
| Sessão | Reconciliado | Adotado o formato do front com token, expiração e usuário/perfil composto |
| Forma de sucesso/erro | Reconciliado | `AuthPort` usa retorno direto e exceção normalizada; `Result<T>` não será imposto à porta atual |
| Códigos de erro de autenticação | Reconciliado | Os cinco códigos sem prefixo `AUTH_` são canônicos para a UI atual |
| Conta bloqueada | Reconciliado | `profiles.status = blocked` mapeia para `ACCOUNT_DISABLED` |
| Restauração/renovação de sessão | Compatível, pendente de implementação | Responsabilidade do adaptador e armazenamento por plataforma ainda a definir |
| Perfil ausente/incompleto | Pendente | Front atual não define estado/rota; necessário no contrato de onboarding |
| E-mail anulável | Reconciliado para esta porta | Sessão operacional do front exige `email: string`; casos sem e-mail ficam fora do fluxo atual |
| Correlation ID no erro | Pendente | Necessário definir shape concreto sem quebrar a UI |
| Cadastro e recuperação | Pendente de contrato futuro | Explicitamente fora da Etapa 1 do front |
| Consentimentos e documentos legais | Pendente de contrato futuro | Modelo preparado; porta ainda não acordada |
| Vínculo e tenant selecionado | Pendente de contrato futuro | Modelo preparado; porta ainda não acordada |
| Código de vínculo completo | Pendente de decisão de produto/segurança | Resolver exibição única versus persistência criptografada |
| Paginação/listas | Pendente de contrato futuro | Não se aplica ao `AuthPort` atual |

Não restou divergência bloqueadora para desenvolver telas com o mock. O adaptador Supabase real de autenticação continua bloqueado até serem definidos o armazenamento seguro por plataforma, o shape concreto do erro e o comportamento de perfil ausente.

## 7. Catálogo de erros estáveis

Os cinco primeiros códigos são o contrato público canônico do `AuthPort` atual. Os demais são candidatos reservados para contratos futuros e não devem ser enviados às telas atuais antes de versionamento explícito.

| Código | Situação | Retry | Exposição recomendada |
|---|---|:---:|---|
| `INVALID_CREDENTIALS` | Credenciais inválidas | Não | Mensagem genérica; canônico no Auth atual |
| `ACCOUNT_DISABLED` | Perfil/conta bloqueada | Não | Orientar suporte; canônico no Auth atual |
| `RATE_LIMITED` | Limite de tentativas | Sim | Informar espera sem detalhes; canônico no Auth atual |
| `NETWORK_ERROR` | Falha local/rede | Sim | Preservar campos; canônico no Auth atual |
| `UNKNOWN` | Falha não classificada | Talvez | Mensagem genérica; canônico no Auth atual |
| `AUTH_EMAIL_NOT_VERIFIED` | E-mail ainda não verificado | Não | Candidato futuro; fluxo ainda não contratado |
| `AUTH_SESSION_EXPIRED` | Sessão ausente/expirada | Não | Candidato futuro; UI atual trata sessão ausente |
| `PROFILE_NOT_FOUND` | Sessão válida sem onboarding concluído | Não | Direcionar ao onboarding |
| `PROFILE_ROLE_IMMUTABLE` | Tentativa de trocar papel | Não | Explicar regra do MVP |
| `PROFILE_FORBIDDEN` | Operação incompatível com papel/estado | Não | Negar sem dados internos |
| `LEGAL_DOCUMENT_OUTDATED` | Versão apresentada não é mais vigente | Não | Recarregar documentos |
| `LEGAL_ACKNOWLEDGEMENT_REQUIRED` | Aceite/ciência obrigatórios ausentes | Não | Direcionar ao aceite |
| `LINK_CODE_INVALID` | Código inválido, revogado ou expirado | Não | Resposta única, anti-enumeração |
| `LINK_RATE_LIMITED` | Muitas tentativas de código | Sim | Informar espera genérica |
| `LINK_ALREADY_EXISTS` | Par já possui vínculo não terminal | Não | Exibir estado existente |
| `LINK_NOT_FOUND` | Vínculo inexistente ou invisível | Não | Não distinguir ID alheio |
| `LINK_NOT_ACTIVE` | Operação exige vínculo Ativo | Não | Informar necessidade de aprovação |
| `LINK_INVALID_TRANSITION` | Transição incompatível com estado | Não | Atualizar estado da tela |
| `TENANT_CONTEXT_REQUIRED` | Cliente não selecionou contexto | Não | Solicitar seleção |
| `FORBIDDEN` | Autorização negada | Não | Sem explicar política interna |
| `CONFLICT` | Concorrência/estado mudou | Sim | Recarregar e tentar novamente |
| `VALIDATION_ERROR` | Input inválido | Não | Pode incluir `field` seguro |
| `SERVICE_UNAVAILABLE` | Dependência temporariamente indisponível | Sim | Exibir correlation ID |

Erros de existência e autorização deverão evitar IDOR e enumeração. Logs técnicos podem conter causa interna, mas nunca senha, token, código completo ou dados pessoais desnecessários.

## 8. Política RLS deny-by-default

### 8.1 Regras gerais

- RLS habilitada em todas as tabelas expostas;
- ausência de política significa negação;
- grants mínimos para `anon` e `authenticated`;
- nenhuma policy baseada apenas em `tenant_id` enviado pelo cliente;
- `service_role` proibida no app, web bundle e chamadas diretas do usuário;
- views usam `security_invoker` quando expostas;
- funções privilegiadas usam `security definer` somente quando indispensável, com `search_path` fixo, input validado e privilégio de execução mínimo;
- mutações críticas e transições serão funções transacionais/RPC quando policies isoladas não garantirem a invariante;
- auditoria e eventos de consentimento não permitem update/delete por usuários comuns.

### 8.2 Predicados conceituais

```text
is_self(user_id) := auth.uid() = user_id
is_provider_owner(tenant_id) := tenant.owner_user_id = auth.uid()
has_active_link(tenant_id) := existe vínculo do auth.uid() com status active
can_read_client_resource := is_provider_owner(tenant_id)
                            OU (has_active_link(tenant_id) E recurso pertence ao cliente autenticado
                                E visibilidade permite cliente)
```

Esses predicados são explicativos; a implementação deverá evitar recursão de policies e avaliar índices/plano de consulta.

### 8.3 Testes negativos obrigatórios

- usuário A lê/altera UUID de usuário B;
- prestador A lê/altera tenant B;
- cliente Pendente, Rejeitado ou Revogado acessa recurso operacional;
- cliente Ativo em tenant A acessa tenant B sem vínculo;
- cliente altera `tenant_id`, `owner_user_id`, `role`, estado ou timestamps;
- anônimo acessa qualquer tabela privada;
- usuário comum altera/exclui auditoria ou consent event;
- URL/código conhecido concede acesso sem vínculo;
- revogação corta acesso dentro do limite de 60 segundos.

## 9. Variáveis de ambiente

Somente nomes e classificação; nenhum valor real será criado nesta etapa.

### 9.1 Públicas no cliente

| Variável | Classificação | Uso |
|---|---|---|
| `EXPO_PUBLIC_APP_ENV` | Pública | Identificar ambiente |
| `EXPO_PUBLIC_SUPABASE_URL` | Pública | Endpoint do projeto |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Pública | Chave cliente, protegida por RLS |
| `EXPO_PUBLIC_SENTRY_DSN` | Pública | Destino de telemetria cliente |

O prefixo `EXPO_PUBLIC_` implica inclusão no bundle. Essas variáveis nunca conterão segredo.

### 9.2 Exclusivas de servidor/CI

| Variável | Classificação | Uso futuro |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Segredo | Automação Supabase CLI/CI |
| `SUPABASE_PROJECT_REF` | Configuração sensível | Identificar projeto remoto no CI |
| `SUPABASE_DB_PASSWORD` | Segredo | Operação controlada de banco |
| `SUPABASE_SERVICE_ROLE_KEY` | Segredo crítico | Rotinas server-side privilegiadas |
| `LINK_CODE_PEPPER` | Segredo crítico | Proteção adicional do hash do código |
| `SENTRY_AUTH_TOKEN` | Segredo | Upload/configuração de releases |

Segredos ficarão no cofre do provedor/CI, separados por ambiente, com rotação e menor privilégio. Nunca irão para `.env.example` com valor, aplicativo, logs ou repositório.

## 10. Estratégia Supabase local e remota

### 10.1 Ambientes

| Ambiente | Finalidade | Dados |
|---|---|---|
| Local | migrations, seed determinístico e testes rápidos | Sintéticos |
| Staging | integração front/back, E2E, RLS e homologação | Sintéticos/pseudonimizados |
| Produção | operação real | Reais, acesso restrito |

Não usar produção como ambiente de desenvolvimento. Projetos, chaves, Auth, Storage e Sentry serão separados.

### 10.2 Migrations

- migrations SQL versionadas e append-only depois de compartilhadas;
- toda tabela nasce com constraints, índices e RLS na mesma mudança lógica;
- migration não depende de ação manual invisível no painel;
- mudança incompatível usa expandir/migrar/contrair;
- nome e ordem determinísticos;
- rollback será operacionalmente planejado; rollback de dados não será presumido seguro;
- release relacionará commit, migrations e versão do app.

### 10.3 Seeds

Seed local mínimo, sem PII real:

- dois prestadores/tenants isolados;
- dois clientes;
- cliente com vínculo Ativo em um tenant e Pendente em outro;
- vínculo Rejeitado/Revogado para testes negativos;
- versões ativas de Termos e Política;
- preferências concedida e revogada por finalidade;
- código de teste exclusivamente local.

Seeds de Auth devem ser reprodutíveis por script/ferramenta e nunca compartilhar credenciais com staging ou produção.

### 10.4 Testes

1. testes de schema, constraints e transições;
2. matriz RLS positiva e negativa usando tokens de usuários diferentes;
3. testes de RPC/transação e concorrência;
4. contract tests entre porta do front e adaptador Supabase;
5. testes de migrations a partir de banco vazio e versão anterior;
6. testes de idempotência e repetição;
7. testes de sanitização de logs e telemetria;
8. E2E de cadastro, aceite, login, vínculo pendente, aprovação e revogação.

O CI deverá falhar se uma tabela exposta estiver sem RLS/policy esperada ou se houver dependência crítica conhecida.

## 11. Critérios de aceite desta preparação

- [x] limites da Etapa 1 declarados sem criação de backend real;
- [x] Prestador definido como tenant inicial e Cliente como participante multi-tenant;
- [x] identidade, perfil, tenant, vínculo e consentimento separados;
- [x] estados e invariantes de perfil, vínculo, código e consentimento definidos;
- [x] porta sugerida sem acoplar telas ao Supabase;
- [x] catálogo de erros estáveis definido;
- [x] variáveis classificadas como públicas ou segredo, sem valores;
- [x] RLS deny-by-default e testes negativos especificados;
- [x] estratégia local, staging, produção, migrations, seeds e testes descrita;
- [x] `AuthPort` comparada e reconciliada com `FRONTEND_CONTRACTS.md` v0.1.0 da Ada;
- [ ] contratos de onboarding, consentimento e vínculo produzidos e reconciliados em etapas próprias;
- [ ] decisões em aberto registradas no changelog central antes da implementação real.

## 12. Sequência segura de implementação futura

1. registrar no changelog as decisões reconciliadas deste handoff;
2. definir armazenamento/renovação de sessão por plataforma, shape concreto do erro e estado de perfil ausente;
3. criar configuração Supabase local sem credenciais remotas;
4. implementar enums, tabelas e constraints mínimas de identidade/perfil;
5. habilitar RLS e policies deny-by-default na mesma entrega;
6. criar seed sintético de contas e perfis isolados;
7. automatizar matriz RLS negativa antes de conectar o front;
8. implementar o adaptador Supabase aderente a `AuthPort` e os mesmos testes do mock;
9. executar contract tests de login, logout, restauração e erro;
10. produzir e reconciliar contratos próprios antes de implementar onboarding, consentimentos ou vínculo;
11. ampliar migrations, seeds e testes para dois tenants e todos os estados de vínculo;
12. revisar LGPD, rate limiting, logs, backup e recuperação antes do go-live;
13. promover migrations controladamente e monitorar correlação/erros.

## 13. Achados e decisões para o changelog central

Os itens abaixo devem ser registrados no `BACKLOG.md` pelo responsável pela consolidação; este documento não altera o registro central diretamente.

1. **Tenant inicial:** cada Prestador é proprietário de um tenant; Cliente pode ter vínculos independentes com vários tenants.
2. **Porta/adaptador:** front-end consome contrato independente de Supabase; mock e adaptador real implementam a mesma porta.
3. **RLS:** todas as tabelas operacionais expostas nascem com RLS deny-by-default e matriz automatizada de testes negativos.
4. **Código de vínculo:** recomendação de revelar o valor completo apenas ao gerar/rotacionar e persistir somente hash/prefixo; decisão de produto pendente por possível conflito com “exibir código”.
5. **Consentimento:** aceite de Termos, ciência da Política e preferências opcionais são registros distintos, versionados e auditáveis.
6. **Erros:** interface reage a códigos estáveis e não interpreta mensagens cruas de fornecedor/banco.
7. **Ambientes:** local, staging e produção separados; somente dados sintéticos fora de produção por padrão.
8. **Contrato Auth reconciliado:** `AuthPort` v0.1.0 possui `signIn`, `signOut` e `getSession`, retornos diretos e falhas normalizadas; telas não conhecem Supabase.
9. **Erros Auth canônicos:** `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`, `RATE_LIMITED`, `NETWORK_ERROR` e `UNKNOWN` são os únicos códigos públicos da porta atual.
10. **Escopo incremental:** cadastro, recuperação, perfil, consentimentos e vínculo exigem contratos próprios antes de seus adaptadores reais.
11. **Sessão composta:** o adaptador entrega token, expiração e usuário com papel/nome obtidos de Auth + perfil persistido, sem transformar o papel selecionado na UI em autorização.

## 14. Questões ainda abertas

- política definitiva de exibição, expiração e rotação do código de vínculo;
- verificação obrigatória de e-mail e/ou telefone no onboarding;
- conteúdo, versões e validação jurídica dos documentos legais;
- finalidades e bases legais por canal de comunicação;
- política de retenção e eliminação por entidade;
- limites e mensagens de rate limiting;
- formato definitivo de paginação do contrato;
- necessidade de aprovação adicional para alterações de dados sensíveis;
- estratégia de recuperação de conta e tratamento de identidade duplicada.

## 15. Histórico

| Versão | Data | Responsável | Alteração |
|---|---|---|---|
| 0.1.0 | 02/08/2026 | Cris — Backend | Preparação contratual da Etapa 1: modelo mínimo, tenant/RLS, estados, porta sugerida, erros, ambientes e sequência segura |
| 0.2.0 | 02/08/2026 | Cris — Backend | Handoff reconciliado com `FRONTEND_CONTRACTS.md` v0.1.0; adoção de `AuthPort`, sessão e erros canônicos do front, com matriz de compatibilidade e pendências futuras |
