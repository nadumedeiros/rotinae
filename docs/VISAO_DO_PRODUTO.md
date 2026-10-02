# Documento de Visão do Produto — Rotinaê

> **Versão:** 0.6.0  
> **Status:** Rascunho inicial  
> **Data:** 2 de agosto de 2026  
> **Responsável:** Equipe Rotinaê

## 1. Introdução

O Rotinaê nasce com o objetivo de simplificar a gestão de atendimentos para prestadores de serviço. A plataforma centralizará atividades que hoje costumam estar distribuídas entre diferentes ferramentas, como gestão de agenda, cadastro de clientes, comunicação, acompanhamento de atendimentos e organização operacional.

Embora o primeiro caso de uso seja direcionado a adestradores, a solução será concebida como uma plataforma genérica, modular e escalável. Essa abordagem deverá permitir sua adaptação futura a outros segmentos de prestação de serviços sem mudanças estruturais significativas.

A proposta é oferecer uma experiência simples, intuitiva e eficiente para o cliente final e, ao mesmo tempo, disponibilizar ao prestador um ambiente centralizado para gerenciar sua agenda, seus serviços, seus clientes e seu relacionamento com eles.

O desenvolvimento seguirá uma abordagem incremental, começando por um produto mínimo viável (MVP) enxuto. Serão priorizadas tecnologias com planos gratuitos ou de baixo custo sempre que possível, mantendo uma arquitetura preparada para crescimento, novas integrações e evolução do produto.

Todo o processo será orientado por documentação estruturada, rastreabilidade das decisões e versionamento contínuo. A inteligência artificial poderá apoiar a documentação, o refinamento de requisitos, a validação de cenários e a implementação técnica, sempre com revisão humana das decisões relevantes.

## 2. Problema

Prestadores de serviço frequentemente administram sua operação por meio de ferramentas desconectadas, como agendas pessoais, planilhas, aplicativos de mensagens e anotações. Essa fragmentação dificulta a consulta de informações, aumenta o trabalho manual e pode ocasionar conflitos de horário, falhas de comunicação, perda de histórico e menor previsibilidade da rotina.

No contexto inicial de adestramento, o prestador também precisa relacionar cada atendimento ao cliente e ao animal atendido, acompanhar a evolução do serviço e manter uma comunicação organizada. O cliente final, por sua vez, precisa de uma forma simples de consultar serviços, solicitar ou acompanhar agendamentos e receber informações relevantes.

## 3. Solução proposta

O Rotinaê será uma plataforma multiplataforma de gestão de atendimentos, disponível em smartphones, tablets e computadores, além de contar com uma landing page. A solução deverá reunir, em uma única experiência:

- agenda inteligente, incluindo recorrência e controle de disponibilidade;
- cadastro completo de clientes, documentos e histórico de relacionamento;
- cadastro dos animais vinculados aos clientes no primeiro segmento atendido;
- cadastro dos serviços oferecidos e gestão de pacotes de serviços;
- criação e acompanhamento de agendamentos;
- registro da evolução dos atendimentos, com atividades, observações e anexos;
- gestão financeira operacional;
- lembretes e notificações automáticas por canais integrados, incluindo WhatsApp;
- base técnica para futuras integrações de pagamento, localização e sincronização de calendário.

A modelagem deve preservar um núcleo genérico de clientes, serviços e agendamentos. Informações específicas do segmento de adestramento deverão ser tratadas de maneira modular sempre que isso for tecnicamente viável e não adicionar complexidade desnecessária ao MVP.

## 4. Objetivos do produto

### 4.1 Objetivo principal

Centralizar e simplificar a gestão de atendimentos de prestadores de serviço, reduzindo a fragmentação operacional e melhorando a experiência do prestador e de seus clientes.

### 4.2 Objetivos específicos

- facilitar a organização e a consulta da agenda, incluindo compromissos recorrentes;
- reduzir conflitos, esquecimentos e retrabalho relacionados aos atendimentos;
- concentrar dados de clientes, documentos, serviços, pacotes e histórico operacional;
- permitir o acompanhamento da evolução de cada serviço;
- oferecer visibilidade financeira básica da operação;
- tornar o processo de agendamento mais simples para o cliente final;
- garantir acesso consistente por smartphones, tablets e computadores;
- criar uma base reutilizável para diferentes segmentos de prestação de serviços;
- validar o produto inicialmente no segmento de adestramento;
- manter custos iniciais compatíveis com a fase de validação do negócio.

## 5. Público-alvo

### 5.1 Público inicial

- adestradores autônomos;
- pequenos negócios de adestramento;
- clientes que contratam serviços de adestramento e precisam acompanhar seus agendamentos.

### 5.2 Público futuro

Prestadores autônomos e pequenos negócios cuja operação dependa de atendimentos agendados, cadastro de clientes e acompanhamento de serviços.

Os segmentos futuros ainda não fazem parte do compromisso inicial do produto e deverão ser selecionados após validação do núcleo da plataforma.

## 6. Escopo do MVP

O escopo inicial deverá ser refinado com usuários antes da implementação completa. Neste primeiro documento, considera-se como proposta de MVP:

### 6.1 Agenda inteligente

- visualização e organização dos atendimentos;
- criação, edição, cancelamento e conclusão de agendamentos;
- suporte a agendamentos recorrentes;
- definição e controle de disponibilidade;
- prevenção de conflitos de horário conforme as regras de agenda;
- filtros e formas de visualização adequadas ao dispositivo utilizado.

### 6.2 Pacotes de serviços

- criação e gerenciamento de pacotes;
- controle de quantidade ou saldo contratado;
- definição e acompanhamento da validade;
- consumo do saldo a partir dos atendimentos realizados;
- consulta ao histórico de utilização e ajustes.

### 6.3 Gestão de clientes

- cadastro, edição e consulta de clientes;
- registro de informações e observações relevantes;
- armazenamento controlado de documentos e anexos;
- histórico de relacionamento e atendimentos;
- cadastro e consulta de animais vinculados ao cliente no segmento inicial.

### 6.4 Evolução dos atendimentos

- registro das atividades realizadas;
- inclusão de observações e anexos;
- acompanhamento cronológico do progresso do serviço;
- associação dos registros ao cliente, ao serviço e ao atendimento correspondentes;
- consulta ao histórico por usuários autorizados.

### 6.5 Gestão financeira

- controle de recebimentos;
- controle de despesas;
- situação dos pagamentos vinculados aos serviços ou pacotes;
- indicadores financeiros básicos de desempenho.

A gestão financeira do MVP terá caráter operacional e não substituirá sistemas contábeis, fiscais ou bancários.

### 6.6 Lembretes e notificações

- confirmações e lembretes automáticos de agendamentos;
- notificações de alterações e cancelamentos;
- integração com WhatsApp;
- suporte a outros meios disponibilizados pela plataforma;
- registro do estado de envio quando tecnicamente suportado pelo canal.

### 6.7 Acesso e experiência multiplataforma

- acesso por smartphones, tablets e computadores;
- experiência consistente e adaptada aos diferentes tamanhos de tela;
- autenticação e autorização comuns entre as plataformas;
- mesma conta, permissões, regras de negócio e dados em todas as plataformas, por meio do back-end central;
- alterações feitas no aplicativo ou no sistema web ficarão disponíveis na outra interface após sincronização com o back-end, respeitando conectividade, autorização e atualização da consulta.

### 6.8 Landing page

- apresentação da proposta de valor;
- explicação resumida das funcionalidades;
- chamada para cadastro, demonstração ou lista de interesse;
- canal de contato;
- acesso ao sistema web responsivo;
- links oficiais para download do aplicativo Android e iOS quando as respectivas versões estiverem publicadas;
- antes da publicação nas lojas, chamada alternativa para cadastro, lista de espera ou acesso à versão web, sem apresentar download indisponível;
- páginas legais essenciais, conforme necessidade validada.

### 6.9 Aplicação do prestador

- criação de conta, autenticação e recuperação de acesso;
- escolha do perfil Prestador no cadastro ou acesso;
- configuração de perfil profissional;
- geração e exibição de código para vínculo de clientes;
- acesso às funcionalidades operacionais definidas nas seções 6.1 a 6.7, de acordo com seu perfil e suas permissões.

### 6.10 Experiência do cliente final

- identificação ou acesso seguro com escolha do perfil Cliente;
- vínculo ao prestador por meio do código informado no perfil do cliente;
- consulta dos próprios agendamentos;
- criação, remarcação e cancelamento dos próprios agendamentos, respeitando disponibilidade e antecedência mínima de um dia útil;
- consulta das informações essenciais do serviço;
- inclusão e leitura de observações compartilhadas no atendimento, sem função de chat;
- recebimento de confirmações e lembretes essenciais.

### 6.11 Administração inicial

Não está prevista, neste momento, uma plataforma administrativa completa. Operações de suporte indispensáveis poderão ser atendidas inicialmente por recursos controlados do back-end, desde que haja segurança, registro e acesso restrito.

### 6.12 Regras operacionais consolidadas

- prestador e cliente poderão criar agendamentos respeitando a disponibilidade do prestador;
- agendamentos e remarcações exigirão antecedência mínima de um dia útil;
- cada ocorrência recorrente será independente e poderá ser alterada ou cancelada isoladamente;
- atendimentos concluídos consumirão automaticamente uma unidade do pacote vinculado;
- o prestador poderá ajustar manualmente o saldo sem alterar o histórico de atendimentos;
- cancelamentos manterão o histórico e liberarão o horário na agenda;
- observações do atendimento serão compartilhadas entre prestador e cliente, mas não funcionarão como chat;
- os detalhes e identificadores oficiais estão no [Documento de Regras de Negócio do MVP](./REGRAS_DE_NEGOCIO_MVP.md).

## 7. Modelo de monetização

O Rotinaê adotará inicialmente um modelo SaaS direcionado ao prestador de serviço:

- todo novo prestador terá acesso gratuito ao Plano Premium por 30 dias;
- após o teste, poderá permanecer no Plano Gratuito ou contratar o Plano Premium;
- o Plano Gratuito permitirá até 2 agendamentos por dia, no máximo 5 clientes cadastrados e não permitirá adicionar notas internas na página do cliente;
- o Plano Premium custará inicialmente R$ 29,00 por mês, com agendamentos ilimitados e acesso a todas as funcionalidades da versão contratada;
- o cliente final não contratará plano no modelo inicial.

O preço, a conversão do período de teste e a efetividade dos limites diários e de clientes serão validados durante o MVP.

O MVP não processará pagamentos pelos serviços prestados entre cliente e prestador. O prestador poderá registrar manualmente cliente, valor do serviço e situação necessária ao controle financeiro. A cobrança da assinatura do Rotinaê é separada desse fluxo e terá seu mecanismo definido durante a implementação.

## 8. Premissas

- o primeiro segmento de validação será o de adestradores;
- o produto terá acesso multiplataforma em smartphones, tablets e computadores;
- a landing page será publicada separadamente para apresentação, aquisição inicial, acesso ao sistema web e distribuição do aplicativo;
- o produto será construído com arquitetura multiusuário e separação segura dos dados de cada prestador;
- a plataforma deverá respeitar a legislação aplicável à privacidade e à proteção de dados, incluindo a LGPD;
- tecnologias de baixo custo serão priorizadas durante a validação, sem eliminar requisitos essenciais de segurança e confiabilidade;
- decisões específicas de outros segmentos não deverão ser antecipadas sem validação;
- inteligência artificial será ferramenta de apoio e não substituirá revisão humana em decisões de produto, segurança ou regras de negócio.

## 9. Riscos

| Risco | Impacto potencial | Estratégia inicial de mitigação |
|---|---|---|
| Escopo excessivo para o MVP | Atraso e aumento de custo | Priorizar fluxos essenciais e validar cada expansão |
| Generalização prematura | Complexidade sem valor comprovado | Validar primeiro com adestradores e manter modular apenas o que for necessário |
| Baixa adesão dos prestadores | Produto sem tração | Realizar entrevistas, protótipos e testes de usabilidade desde o início |
| Dependência de serviços externos | Custos, limites ou indisponibilidade | Isolar integrações e acompanhar limites dos planos utilizados |
| Falhas de privacidade ou autorização | Exposição de dados e dano reputacional | Aplicar controle de acesso, políticas de segurança e testes desde a modelagem |
| Notificações não entregues | Faltas e falhas de comunicação | Monitorar entregas e não depender de um único canal como registro operacional |
| Custo ou restrições da integração com WhatsApp | Aumento de custo ou limitação dos fluxos automáticos | Validar provedor, políticas, consentimentos e custos antes da implementação definitiva |
| Complexidade da experiência multiplataforma | Inconsistências entre dispositivos e aumento do esforço de desenvolvimento | Definir estratégia de interface compartilhada e validar os fluxos em diferentes tamanhos de tela |
| Custos crescerem antes da receita | Pressão financeira | Definir métricas, alertas de consumo e limites operacionais |
| Regras de agenda incompletas | Conflitos e frustração | Documentar regras e validar cenários reais antes da implementação |

## 10. Arquitetura inicial

### 10.1 Stack recomendada

| Camada | Tecnologia inicial | Responsabilidade |
|---|---|---|
| Landing page | Netlify | Hospedagem e publicação do site institucional |
| Aplicação multiplataforma | React Native, Expo Router e React Native Web | Base universal compartilhada para web responsiva, Android e iOS |
| Back-end | Supabase | Serviços de aplicação e acesso seguro aos dados |
| Banco de dados | PostgreSQL | Persistência dos dados relacionais |
| Autenticação | Supabase Auth | Cadastro, login, sessão e recuperação de acesso |
| Arquivos | Supabase Storage | Armazenamento controlado de arquivos do produto |
| Notificações push | Firebase Cloud Messaging | Entrega de notificações aos dispositivos |
| Versionamento | GitHub | Código, documentação, histórico e colaboração |
| Monitoramento de erros | Sentry | Registro e acompanhamento de falhas da aplicação |

### 10.2 Princípios arquiteturais

- separar o núcleo genérico das extensões específicas de cada segmento;
- aplicar controle de acesso aos dados desde a primeira versão;
- manter ambientes e credenciais separados conforme a evolução do projeto;
- evitar dependência desnecessária da interface em detalhes de fornecedores externos;
- observar custos, limites de uso e condições dos serviços contratados;
- registrar decisões arquiteturais relevantes e suas justificativas.

O aplicativo instalado e o sistema web responsivo não serão produtos isolados nem trocarão dados diretamente entre si. Ambos serão clientes do mesmo back-end Supabase, utilizando a mesma autenticação, banco, armazenamento, autorização e regras de domínio. O back-end será a fonte de verdade operacional.

A escolha definitiva de cada serviço dependerá de uma avaliação técnica dos requisitos, custos e limites vigentes no momento da implementação.

## 11. Integrações atuais e futuras

### 11.1 Integrações previstas para a base inicial

- Supabase Auth;
- Supabase Storage;
- Firebase Cloud Messaging;
- WhatsApp, por provedor oficial a definir;
- Sentry;
- GitHub;
- Netlify.

### 11.2 Integrações futuras possíveis

| Finalidade | Opções iniciais | Status |
|---|---|---|
| Pagamentos e cobranças | Mercado Pago ou solução equivalente para SaaS | A validar |
| Envio de e-mails | Sendy ou SendGrid | A validar |
| Sincronização de agenda | Google Calendar | Futuro |
| Localização e rotas | Google Maps | Futuro |
| Comunicação adicional | Outros canais além do WhatsApp | Futuro |
| Analytics de produto | Firebase Analytics ou PostHog | A validar |

Nenhuma integração futura deve ser considerada requisito confirmado até que seu caso de uso, custo, dependências e impacto sobre privacidade sejam avaliados.

## 12. Critérios de sucesso

Os valores-alvo ainda deverão ser definidos após a pesquisa inicial e a existência de uma linha de base. O MVP será avaliado, no mínimo, pelos seguintes indicadores:

- número de prestadores convidados, cadastrados e ativos;
- percentual de prestadores que concluem a configuração inicial;
- número de agendamentos criados e concluídos pela plataforma;
- frequência de uso da agenda;
- taxa de conflitos ou falhas reportadas em agendamentos;
- retenção dos prestadores após o primeiro período de uso;
- satisfação qualitativa de prestadores e clientes;
- estabilidade da aplicação e incidência de erros críticos;
- custo operacional por prestador ativo;
- intenção de pagamento e conversão, quando o modelo comercial for testado.

O MVP será considerado validado quando demonstrar uso recorrente dos fluxos centrais, redução percebida da desorganização operacional e evidências de disposição do público para continuar utilizando ou pagar pela solução. Metas numéricas serão registradas em versão posterior deste documento.

## 13. Itens fora do escopo inicial

- marketplace público de prestadores;
- suporte completo a múltiplos segmentos no lançamento;
- contabilidade completa, emissão fiscal e conciliação bancária avançada;
- folha de pagamento ou gestão avançada de equipes;
- videochamadas ou atendimento remoto nativo;
- inteligência artificial autônoma tomando decisões operacionais;
- automações avançadas de marketing;
- integrações simultâneas com múltiplos provedores de pagamento;
- roteirização avançada e acompanhamento em tempo real;
- sincronização bidirecional completa com calendários externos;
- personalizações profundas por empresa;
- painel administrativo completo, salvo se validado como indispensável ao MVP.

## 14. Questões em aberto

As seguintes decisões deverão ser investigadas e registradas antes de influenciarem a implementação:

- quais regras complementares definem duração, intervalo, feriados, fuso horário e conflito simultâneo;
- se o vínculo por código é imediato ou exige aprovação, e se o cliente pode ter vários prestadores;
- se o prestador poderá trabalhar com equipe já no MVP;
- quais informações do animal e do atendimento são indispensáveis;
- quais formatos, limites e políticas de retenção serão aplicados a documentos e anexos;
- qual provedor oficial e quais modelos de mensagem serão usados na integração com WhatsApp;
- quais funcionalidades eventualmente exigirão adaptação específica entre aplicativo instalado e interface web;
- quais metas quantitativas e categorias adicionais serão aplicadas ao controle financeiro após a validação básica;
- como os limites de 2 agendamentos por dia e 5 clientes do Gratuito influenciam a conversão sem inviabilizar o uso inicial;
- qual mecanismo realizará a cobrança da assinatura Premium;
- quais consentimentos, prazos de retenção e políticas de exclusão de dados serão adotados;
- quais metas quantitativas determinarão o sucesso da primeira validação.

## 15. Governança e versionamento

Este documento é a principal fonte de verdade do produto. Toda mudança relevante de requisito, escopo, regra de negócio, integração ou decisão técnica deverá ser registrada primeiro aqui. Depois, os agentes, especificações, design, código, testes e demais artefatos deverão ser atualizados para refletir a nova versão.

O arquivo [BACKLOG.md](../BACKLOG.md) é o registro central transversal do trabalho e das decisões. Toda decisão deverá receber um identificador `DEC-NNN` no backlog e também constar no histórico do documento afetado. A Visão permanece como fonte de verdade do escopo; o backlog registra a decisão, seus impactos, sua execução e a rastreabilidade entre artefatos.

Cada alteração deve informar:

- versão e data;
- autor ou responsável;
- descrição resumida da mudança;
- motivação;
- artefatos impactados, quando aplicável.

Sugestão de versionamento:

- **correção** (`0.1.1`): ajustes de redação sem alteração de significado;
- **evolução menor** (`0.2.0`): novos requisitos, refinamentos ou decisões compatíveis com a visão atual;
- **evolução maior** (`1.0.0`): visão validada para execução ou mudança estrutural relevante após a primeira versão estável.

## 16. Histórico de alterações

| Versão | Data | Responsável | Alteração |
|---|---|---|---|
| 0.1.0 | 02/08/2026 | Equipe Rotinaê | Criação do primeiro documento de visão a partir das definições iniciais do produto |
| 0.2.0 | 02/08/2026 | Equipe Rotinaê | Definição das funcionalidades principais do MVP: agenda inteligente, pacotes, cadastro completo, evolução dos atendimentos, finanças, notificações com WhatsApp e acesso multiplataforma |
| 0.3.0 | 02/08/2026 | Equipe Rotinaê | Consolidação das regras de agendamento, recorrência, observações, pacotes, cancelamentos, perfis, vínculo por código, comunicação e estratégia de planos |
| 0.4.0 | 02/08/2026 | Equipe Rotinaê | Ajustes da revisão multidisciplinar: vínculo aprovado e multi-prestador, estados, recorrência atômica, reserva de saldo, matriz de planos, retirada de comissões e criação de RF, RNF e HU |
| 0.5.0 | 02/08/2026 | Equipe Rotinaê | Instituição do BACKLOG.md raiz como registro central de decisões e rastreabilidade transversal (DEC-025) |
| 0.6.0 | 02/08/2026 | Equipe Rotinaê | Definição da landing como canal de acesso e distribuição, com links oficiais das lojas, e confirmação de aplicativo e web responsiva compartilhando autenticação, regras e dados no mesmo back-end |
