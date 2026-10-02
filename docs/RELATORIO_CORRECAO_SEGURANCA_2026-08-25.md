| **Data** | **Versão** | **Descrição** | **Solicitante** | **Autor** |
|---|---|---|---|---|
| 25/08/2026 | 1.0 | Triagem e correção conservadora dos achados do GitGuard | Usuário | Fábrica de Software |

# Relatório de correção de segurança

## Contexto

O relatório GitGuard do commit `b9ecefbdeccc6e11dee316ba64dc592eae3af3ea` apresentou 22 achados: 6 de dependências, 1 detecção de chave GCP e 15 alertas SAST. A correção foi executada preservando o Expo SDK 54 e evitando migração principal de framework.

## Dependências corrigidas

As dependências vulneráveis são transitivas. Foram aplicados overrides explícitos no manifesto e no lockfile:

| Pacote | Versão anterior | Versão aplicada | Origem na árvore |
|---|---:|---:|---|
| `postcss` | 8.4.49 | 8.5.23 | `expo` → `@expo/metro-config` |
| `uuid` | 7.0.3 | 11.1.1 | `expo` → `@expo/config-plugins` → `xcode` |
| `brace-expansion` | 1.1.18 e outras | 5.0.9 | ESLint, Expo, glob e minimatch |

Os overrides foram aceitos apenas depois de testes, typecheck, lint, leitura da configuração Expo e exportação web.

## Classificação dos achados de código

### Chave GCP em `google-services.json`

Classificação: identificador de cliente Firebase/Android, não credencial privada por si só.

O arquivo é exigido pela configuração Android do Expo e seu conteúdo é incorporado ao aplicativo distribuído. Removê-lo ou rotacionar a chave sem coordenação pode interromper builds e serviços Firebase. A proteção aplicável é restringir a chave no Google Cloud às APIs necessárias e ao aplicativo Android correto. Essa restrição externa não foi verificada nesta execução.

### Senhas embutidas

Classificação: falsos positivos nos casos localizados.

As ocorrências são valores fictícios em testes automatizados e um marcador interno usado somente para validar o cadastro OAuth. Nenhuma credencial real foi localizada nesses pontos e os valores não são enviados como senha no fluxo Google.

### Valores variáveis em `href`

Classificação: falsos positivos nos templates transacionais revisados.

Os links de ação passam por `URL`, aceitam HTTPS ou HTTP limitado a localhost e recebem escape HTML antes da interpolação. Existe teste automatizado que rejeita `javascript:alert(1)`.

### Sanitização com `replaceAll`

Classificação: falso positivo.

A rotina aplica escape sequencial de `&`, `<`, `>`, aspas duplas e simples. Existe teste automatizado com payload HTML/XSS.

### Regex DoS

Classificação: não confirmado.

As expressões localizadas são ancoradas ou operam com separadores determinísticos e entradas pequenas. Não foi identificado padrão de backtracking catastrófico nos pontos revisados.

### Exposição genérica de erros

Classificação: requer monitoramento, sem vulnerabilidade explorável confirmada no achado sem localização.

O relatório gratuito não informa arquivo ou linha. O aplicativo possui mapeamentos de erro de domínio e mensagens genéricas em fluxos sensíveis. Logs técnicos existentes devem permanecer fora da interface do usuário e ser revisados quando o scanner fornecer a localização exata.

## Evidências de validação

- 49 suítes de teste aprovadas.
- 459 testes aprovados.
- TypeScript aprovado sem erros.
- ESLint aprovado sem erros; 32 avisos preexistentes.
- Configuração pública do Expo processada com SDK 54.
- Exportação web concluída com 28 rotas estáticas.
- Árvore instalada confirmou `postcss 8.5.23`, `uuid 11.1.1` e `brace-expansion 5.0.9`.

## Riscos residuais

O `npm audit` permanece com 8 alertas altos propagados pelo Metro/Expo. A correção sugerida pelo npm exige Expo 57, uma migração principal fora do escopo desta correção conservadora. Esses avisos devem ser tratados numa migração planejada, com validação mobile, web, plugins nativos e publicação.

Também permanece necessária a verificação das restrições da chave Firebase no console do Google Cloud. Nenhuma chave foi exibida, removida ou rotacionada nesta execução.

## Critério de aceite

As vulnerabilidades de dependência explicitamente listadas no relatório foram corrigidas sem regressão detectada. Os achados SAST foram classificados com base no código e nos testes existentes. Uma nova execução do GitGuard é necessária para confirmar como o scanner reconhece os overrides e para obter eventuais localizações remanescentes.

## Parecer de prontidão

**Aprovado com ressalvas para esta correção de segurança.** Não há bloqueador confirmado introduzido pelas mudanças. As ressalvas são a migração futura do Expo para tratar os 8 alertas residuais do npm, a validação das restrições da chave Firebase no Google Cloud e a nova execução do GitGuard.
