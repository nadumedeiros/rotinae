# Histórico Financeiro Mensal — Especificação e Validação

| **Data** | **Versão** | **Descrição** | **Solicitante** | **Autor** |
|---|---|---|---|---|
| 03/09/2026 | 1.0 | Definição, implementação e validação do histórico mensal; regra consolidada para transportar pendências entre os meses até o pagamento | Usuário | Equipe Rotinaê |

## 1. Objetivo

Preservar a leitura financeira por mês, separando dinheiro efetivamente recebido, valores previstos e saldos ainda não recebidos. A funcionalidade atende o prestador nos aplicativos Web, Android e iOS e é acessada pela página Financeiro.

## 2. Escopo

Inclui:

- página de histórico mensal acessível pelo Financeiro;
- agrupamento por ano e mês;
- total recebido no mês;
- total previsto para o mês;
- saldo ainda não recebido, acumulado e transportado para os meses seguintes já alcançados;
- suporte a pagamentos totais e parciais;
- estados de carregamento, vazio, erro e nova tentativa;
- isolamento dos dados por prestador autenticado.

Não inclui:

- movimentação bancária ou conciliação automática;
- exportação em PDF ou planilha;
- fechamento contábil imutável;
- alteração automática do status de cobranças vencidas.

## 3. Regras de negócio

| ID | Regra | Contexto | Condição | Ação/Resultado | Restrições |
|---|---|---|---|---|---|
| RN-HFM-001 | O valor recebido pertence ao mês do recebimento real. | Caixa realizado | Pagamento total ou parcial confirmado | Somar pela data de recebimento. | Nunca usar a data de vencimento para deslocar o caixa realizado. |
| RN-HFM-002 | O previsto do mês é o saldo ainda não recebido dos lançamentos cadastrados naquele mês. | Competência prevista | Cobrança criada no mês e ainda pendente ou atrasada | Somar o saldo restante pela data de cadastro (`created_at`). | Recebidos e cancelados ficam fora; pagamentos parciais reduzem o previsto. |
| RN-HFM-003 | O saldo não recebido passa para o mês seguinte. | Pendências | Cobrança pendente ou atrasada com saldo e nova competência já alcançada | Exibir a cobrança na tabela e somar o saldo restante em todos os meses desde o vencimento até o mês atual, enquanto continuar aberta. | Pagamentos parciais reduzem o saldo transportado; competências futuras exibem apenas os valores que vencem nelas. |
| RN-HFM-004 | Cada pagamento parcial pertence ao mês em que ocorreu. | Recebimentos parciais | Existência de recibos filhos | Somar cada recibo no respectivo mês de recebimento. | A cobrança original não é contada novamente como recebida. |
| RN-HFM-005 | O histórico é derivado dos registros financeiros atuais. | Correções operacionais | Registro editado ou excluído de forma autorizada | Recalcular os meses afetados na próxima consulta. | Não há snapshot contábil imutável nesta versão. |
| RN-HFM-006 | Editar uma cobrança recebida não altera o mês do ganho. | Manutenção do registro | Status permanece recebido | Preservar a data original de recebimento. | A data só muda em uma nova transição real para recebido. |

## 4. História de usuário

Como prestador, quero consultar o histórico financeiro por mês para entender quanto recebi, quanto esperava receber e quais valores continuam pendentes, sem perder a referência quando o mês mudar.

### Requisitos funcionais

| ID | Descrição | Prioridade |
|---|---|---|
| RF-HFM-001 | O sistema deve disponibilizar o acesso “Histórico mensal” na página Financeiro. | Essencial |
| RF-HFM-002 | O sistema deve listar os meses com movimentação financeira do mais recente para o mais antigo. | Essencial |
| RF-HFM-003 | O sistema deve apresentar recebido, previsto e ainda não recebido em cada mês. | Essencial |
| RF-HFM-004 | O sistema deve permitir filtrar o histórico por ano. | Importante |
| RF-HFM-005 | O sistema deve informar carregamento, ausência de dados e falha de consulta com opção de nova tentativa. | Essencial |

### Fluxo principal

1. O prestador abre Financeiro.
2. Seleciona “Histórico mensal”.
3. O sistema carrega os agregados autorizados do prestador.
4. O sistema apresenta a visão geral e os meses do ano selecionado.
5. O prestador pode trocar o ano e retornar ao Financeiro.

### Critérios de aceite

- Um recebimento feito em setembro aparece em “Recebido no mês” de setembro, mesmo quando a cobrança venceu em agosto.
- Uma cobrança vencida em agosto e ainda pendente aparece na tabela de agosto e passa também para a tabela de setembro após a virada do mês.
- Depois de paga em setembro, a cobrança deixa de compor as pendências e o valor recebido permanece registrado em setembro.
- Uma cobrança cadastrada em setembro e ainda não recebida compõe o “Previsto para o mês” de setembro pelo saldo restante, mesmo que seu vencimento seja posterior.
- Uma pendência cadastrada em agosto pode aparecer na tabela de setembro por transporte, mas não aumenta o previsto dos cadastros de setembro.
- Uma cobrança cancelada não aumenta previsto nem saldo aberto.
- Uma cobrança parcialmente paga reduz o saldo aberto e registra a parcela recebida no mês real do recebimento.
- Editar descrição, valor, vencimento ou observação de uma cobrança recebida não muda o mês do recebimento.
- Um usuário não pode consultar histórico financeiro de outro prestador.

## 5. Arquitetura da experiência

Fluxo de navegação:

```mermaid
flowchart LR
  A[Financeiro] -->|Histórico mensal| B[Histórico financeiro]
  B --> C[Selecionar ano]
  C --> D[Consultar meses]
  B -->|Voltar| A
```

A página utiliza a mesma área autenticada, cabeçalho e barra móvel do Financeiro. Em telas largas, os três indicadores mensais aparecem lado a lado; em telas menores, ficam empilhados. Os controles possuem alvo mínimo de toque e estados selecionados expostos para tecnologias assistivas.

## 6. Arquitetura técnica

- Frontend: React Native/Expo Router com TypeScript, compartilhado entre Web, Android e iOS.
- Backend: Supabase/PostgreSQL com as funções RPC `list_manual_payments()` e `get_financial_monthly_history()` executadas como invocador.
- Autenticação: sessão Supabase existente.
- Autorização: tenant ativo pertencente ao usuário autenticado e RLS em `manual_payments`.
- Performance: uma única consulta agregada retorna uma linha por mês com movimentação, sem transferir todas as cobranças para o dispositivo.
- Segurança: a policy financeira qualifica explicitamente os campos de tenant da cobrança e do cliente, eliminando a comparação ambígua existente.

## 7. Estratégia de testes

| Item | Cobertura | Status |
|---|---|---|
| Regra de competência mensal | Testes unitários de classificação e resumo | Aprovado |
| Contrato frontend/backend | Testes do adapter e mapeamento da RPC | Aprovado |
| Tipagem | TypeScript sem emissão | Aprovado |
| Estilo e qualidade estática | ESLint e `git diff --check` | Aprovado com avisos preexistentes |
| Regressão | 52 suítes e 477 testes automatizados | Aprovado |
| Rota Web | Exportação estática Expo com `/payments/history` entre as 31 rotas | Aprovado |
| Funções PostgreSQL | Migrations local e remota alinhadas até `20260903140000`; schema lint sem erro nas funções financeiras alteradas | Aprovado e aplicado |
| Fluxo real em produção | Teste autenticado Web/Android | Pendente de validação visual |

## 8. Riscos e limitações

- O histórico é operacional e recalculável, não um livro contábil imutável.
- O lint remoto ainda aponta um erro preexistente e fora deste escopo em `get_provider_dashboard_snapshot()` por referência a `provider_settings`; não há apontamento nas funções financeiras alteradas.
- A validação visual e de interação autenticada em dispositivo real permanece pendente porque o navegador integrado não estava disponível nesta sessão.

## 9. Parecer de prontidão

Status atual: **Aprovado com ressalvas**. Código, contrato automatizado, exportação Web e migration remota estão aprovados; a validação visual autenticada em Web/Android permanece necessária antes de encerrar a validação da funcionalidade.
