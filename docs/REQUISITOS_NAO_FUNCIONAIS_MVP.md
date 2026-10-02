# Requisitos Não Funcionais do MVP — Rotinaê

> **Versão:** 0.1.0  
> **Status:** Baseline técnico e de qualidade  
> **Data:** 2 de agosto de 2026  
> **Origem:** [Visão v0.4.0](./VISAO_DO_PRODUTO.md) · [Regras v0.2.0](./REGRAS_DE_NEGOCIO_MVP.md) · [RF v0.1.0](./REQUISITOS_FUNCIONAIS_MVP.md)
> **Governança:** [Backlog e Registro de Decisões](../BACKLOG.md)

## Convenções

- **P0:** obrigatório para lançamento.
- **P1:** importante para a qualidade operacional do MVP.
- **P2:** melhoria desejável.
- Itens `[JUR]` dependem de validação jurídica/DPO; teste técnico não substitui essa validação.

## Segurança e isolamento

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-SEG-001 | P0 | Todas as entidades operacionais terão autorização server-side e RLS com bloqueio por padrão. | Revisão das migrations e testes por tabela. |
| RNF-SEG-002 | P0 | Um tenant não poderá executar CRUD em dados de outro, mesmo conhecendo UUID ou URL. | Testes negativos de IDOR/RLS com dois tenants. |
| RNF-SEG-003 | P0 | Toda mutação validará identidade, perfil, vínculo Ativo, tenant e propriedade. | Matriz automatizada de autorização. |
| RNF-SEG-004 | P0 | Perfil será persistido no servidor; parâmetros do app não elevarão privilégio. | Adulteração de payload/token. |
| RNF-SEG-005 | P0 | Segredos privilegiados não estarão no app, bundle, repositório ou logs. | Secret scan e inspeção de bundles. |
| RNF-SEG-006 | P0 | Tráfego externo usará TLS 1.2+ e dados persistidos usarão criptografia do provedor. | Scanner TLS e evidência de configuração. |
| RNF-SEG-007 | P1 | Login, recuperação e vínculo terão rate limiting documentado antes do go-live. | Teste excedendo limites. |
| RNF-SEG-008 | P0 | Dependência com vulnerabilidade crítica conhecida bloqueará o release. | SCA no pipeline de CI. |

## Vínculo seguro

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-VIN-001 | P0 | Código será não sequencial, gerado por CSPRNG com pelo menos 128 bits de entropia, revogável e rotacionável. | Testes unitários e revisão de implementação. |
| RNF-VIN-002 | P0 | Informar código não dará acesso; somente vínculo Ativo autorizará operações. | Testes de estados e RLS. |
| RNF-VIN-003 | P0 | Respostas e limites impedirão enumeração de códigos e prestadores. | Teste de abuso e força bruta. |
| RNF-VIN-004 | P0 | Revogação bloqueará novos acessos em até 60 segundos. | Teste ponta a ponta. |

## Privacidade e LGPD

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-PRI-001 | P0 | Antes do go-live haverá inventário de dados, finalidades, bases legais, agentes, destinatários e retenção. `[JUR]` | Checklist aprovado por responsável jurídico/DPO. |
| RNF-PRI-002 | P0 | Termos, ciência da Política e consentimentos serão registros separados e versionados. `[JUR]` | Teste funcional e inspeção do banco. |
| RNF-PRI-003 | P0 | Consentimento opcional será revogável por finalidade/canal sem bloquear funções independentes. `[JUR]` | Teste ponta a ponta. |
| RNF-PRI-004 | P0 | Mensagens transacionais e opcionais terão regras e bases legais distintas. `[JUR]` | Matriz finalidade/base legal. |
| RNF-PRI-005 | P0 | Existirá processo autenticado para acesso, correção, exportação e eliminação quando aplicável. `[JUR]` | Simulação de solicitação. |
| RNF-PRI-006 | P0 | Retenção e descarte serão definidos por categoria, incluindo tratamento de backups. `[JUR]` | Teste de ciclo de vida. |
| RNF-PRI-007 | P0 | Suboperadores e transferências internacionais serão avaliados antes da ativação. `[JUR]` | Contratos/DPA e checklist. |
| RNF-PRI-008 | P0 | Haverá procedimento de resposta a incidente com responsáveis e prazos aplicáveis. `[JUR]` | Exercício de simulação. |
| RNF-PRI-009 | P1 | Analytics, Sentry e logs não capturarão observações, arquivos, tokens, códigos ou dados financeiros completos. | Inspeção de eventos e payloads. |

## Arquivos e conteúdo

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-ARQ-001 | P0 | Buckets serão privados; acesso usará RLS e URL assinada com validade máxima de 5 minutos. | Testes anônimo, outro tenant e expiração. |
| RNF-ARQ-002 | P0 | Upload validará tipo real, extensão, tamanho e limites documentados. | Suíte de arquivos inválidos e limítrofes. |
| RNF-ARQ-003 | P0 | Arquivo ficará em quarentena até validação antimalware, ou o risco será formalmente aceito. | Teste EICAR/evidência da decisão. |
| RNF-ARQ-004 | P0 | Nomes e caminhos não conterão PII nem serão enumeráveis. | Inspeção de objetos e URLs. |
| RNF-ARQ-005 | P0 | Observações serão limitadas, escapadas e sanitizadas contra XSS armazenado. | Testes de conteúdo malicioso. |

## Auditoria

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-AUD-001 | P0 | Evento sensível registrará ator, tenant, ação, recurso, instante UTC, resultado e correlation ID, sem conteúdo sensível. | Matriz evento-log. |
| RNF-AUD-002 | P0 | Auditoria cobrirá vínculos, perfil, documentos, saldo, financeiro, estados, consentimento e administração. | Testes automatizados por evento. |
| RNF-AUD-003 | P0 | Usuários comuns não poderão alterar nem excluir auditoria. | Testes de permissão. |
| RNF-AUD-004 | P1 | Datas serão persistidas em UTC e exibidas no fuso IANA do prestador. | Testes de fuso e horário de verão. |

## Desempenho e consistência

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-DES-001 | P1 | Na carga-alvo documentada, p95 de leituras será ≤2 s e de gravações ≤3 s, excluindo terceiros. | Teste de carga em staging. |
| RNF-DES-002 | P0 | Agenda, recorrência, cota e saldo serão atômicos e idempotentes. | Testes concorrentes e repetidos. |
| RNF-DES-003 | P1 | Listas serão paginadas e consultas críticas não farão varredura integral na carga-alvo. | Teste de volume e plano de consulta. |
| RNF-DES-004 | P2 | Interface responderá visualmente em até 300 ms e mostrará progresso para ações acima de 1 s. | Teste instrumentado de UX. |

## Disponibilidade, integrações e recuperação

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-DIS-001 | P1 | Serviço principal terá meta mensal de disponibilidade de 99,5%, excluindo manutenção comunicada. | Relatório de uptime. |
| RNF-DIS-002 | P0 | Falha de comunicação não desfará operação; envios serão assíncronos, idempotentes e retentáveis. | Teste com provedor indisponível. |
| RNF-DIS-003 | P0 | Transações e constraints preservarão agenda, saldo e financeiro após falha parcial. | Fault injection. |
| RNF-INT-001 | P0 | Webhooks validarão assinatura, timestamp e replay e serão idempotentes. | Testes de assinatura, replay e duplicata. |
| RNF-INT-002 | P0 | Payload a terceiros conterá apenas campos aprovados para a finalidade. `[JUR]` | Contract tests e revisão jurídica. |
| RNF-INT-003 | P1 | Cada integração terá timeout, retry com backoff, limite, fallback e reprocessamento documentados. | Testes de falha e runbook. |
| RNF-BKP-001 | P0 | Banco terá backup diário, RPO ≤24 h e RTO ≤8 h. | Evidência e restauração. |
| RNF-BKP-002 | P0 | Restauração será testada trimestralmente em ambiente isolado. | Ata e checklist do exercício. |
| RNF-BKP-003 | P0 | Storage e configurações críticas terão recuperação documentada. | Simulação amostral. |

## Acessibilidade e compatibilidade

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-ACE-001 | P1 | Fluxos web críticos atenderão WCAG 2.2 AA em teclado, foco, contraste, rótulos e erros. | Axe/Lighthouse e teste manual. |
| RNF-ACE-002 | P1 | Mobile terá nomes acessíveis, foco correto e texto a 200% sem perda funcional. | TalkBack/VoiceOver. |
| RNF-ACE-003 | P1 | Estado e erro não serão comunicados somente por cor. | Revisão manual. |
| RNF-COM-001 | P1 | Web suportará as duas últimas versões de Chrome, Edge, Firefox e Safari, entre 360 e 1440 px. | Matriz de navegadores. |
| RNF-COM-002 | P1 | Mobile suportará versões definidas pelo Expo SDK e pelo menos 90% da base-alvo levantada. | Matriz de dispositivos. |

## Observabilidade

| ID | Pri. | Requisito verificável | Verificação |
|---|:---:|---|---|
| RNF-OBS-001 | P0 | Erros não tratados gerarão evento com ambiente, versão e correlation ID, sem PII ou segredos. | Teste sintético no Sentry/logs. |
| RNF-OBS-002 | P1 | Alertas cobrirão erro, latência, indisponibilidade, fila e custo anormal. | Disparo controlado. |
| RNF-OBS-003 | P1 | Release ligará commit, migration, versão do app e evento de erro. | Auditoria de release. |
| RNF-OBS-004 | P1 | Logs terão retenção, menor privilégio e mascaramento testados. | Testes de vazamento e acesso. |

## Histórico

| Versão | Data | Alteração |
|---|---|---|
| 0.1.0 | 02/08/2026 | Catálogo inicial de RNFs elaborado por Ada e consolidado com a revisão de Virgil e Cris |
