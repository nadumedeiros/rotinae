# Design System do MVP — Rotinaê

> **Versão:** 0.4.8  
> **Status:** Baseline visual implementada  
> **Data:** 02/08/2026  
> **Responsável:** Nero — UI e Design System  
> **Fontes:** sete imagens em `Referências/`, Documento de UX v0.1.0 e aplicação universal Expo

## 1. Propósito

Estabelecer uma linguagem visual única para web, Android e iOS, inspirada no UI Kit fornecido, sem copiar conteúdo de saúde nem ampliar o escopo funcional. Este documento é a fonte de verdade dos valores visuais; documentos funcionais devem referenciá-lo sem duplicar cores.

## 2. Evidências da referência

Foram inspecionadas visualmente as sete imagens WebP da pasta `Referências/`. O painel “UI Kit” explicita a fonte **Urbanist** e as cores principais violeta. As demais telas confirmam:

- cabeçalhos e áreas de destaque em gradientes violeta;
- superfícies brancas, fundo lilás muito claro e texto quase preto;
- cartões de 16–24 px de raio, borda discreta e sombra difusa;
- ícones lineares arredondados em contêineres lilás;
- navegação inferior flutuante no celular, com item ativo preenchido;
- dashboards compostos por cartões, resumo, calendário, listas e chips;
- grid mobile de 393 px com margens externas de 24 px e gutters internos de 16 px;
- hierarquia da referência: título 22 px, subtítulo 18 px, seção 14 px e corpo 12 px. Para acessibilidade do produto, corpo padrão foi elevado a 14 px.

## 3. Direção visual

O Rotinaê deve transmitir simplicidade, clareza e controle. Violeta identifica marca e ação principal; lilás organiza áreas secundárias; branco preserva legibilidade. Cor nunca será o único indicador de estado.

## 4. Tokens

Os valores executáveis estão em `apps/agendae/src/theme/tokens.ts`.

### 4.1 Cores primitivas

| Família | Escala | Valor |
|---|---:|---:|
| Violeta | 950 | `#21065F` |
| Violeta | 700 | `#5416FF` |
| Violeta | 600 | `#7135E5` |
| Violeta | 400 | `#A991FF` |
| Violeta | 100 | `#EEE9FF` |
| Violeta | 50 | `#F7F5FF` |
| Neutro | 900 | `#191725` |
| Neutro | 700 | `#555264` |
| Neutro | 200 | `#E8E5EF` |
| Branco | — | `#FFFFFF` |

### 4.2 Cores semânticas

- `brand`, `brandDark`, `brandMid`, `brandSoft`: identidade e hierarquia;
- `canvas`, `surface`, `surfaceSubtle`: planos de fundo;
- `ink`, `muted`, `mutedSoft`: texto;
- `border`, `borderStrong`, `focus`: contorno e foco;
- `success`, `warning`, `danger` e respectivas superfícies suaves: feedback com ícone e texto.

Texto branco sobre `brand` e `brandDark`, e texto escuro sobre superfícies claras, são as combinações preferenciais. Lilás claro não deve receber texto branco.

### 4.3 Tipografia

Urbanist é distribuída sob licença SIL Open Font License e foi incorporada por `@expo-google-fonts/urbanist` nos pesos 400, 500, 600 e 700.

| Papel | Tamanho/altura | Peso |
|---|---|---|
| Display mobile | 40/44 | Bold |
| Título | 22/28 | Bold |
| Subtítulo | 18/24 | SemiBold/Bold |
| Corpo destacado | 16/24 | Regular/Medium |
| Corpo | 14/20 | Regular |
| Legenda | 12/16 | Medium/SemiBold |

Não usar peso como único diferenciador. Respeitar redimensionamento do sistema e texto a 200%.

### 4.4 Espaçamento, forma e elevação

- escala: 2, 4, 8, 16, 24, 32, 48 e 64 px;
- raios: 8, 12, 16, 24, 32 e pílula;
- altura mínima de controle: 48 px; área de toque mínima: 44 × 44 px;
- elevação `card`: sombra curta e difusa; `floating`: sombra mais alta para navegação/modal;
- largura máxima de conteúdo: 1180 px.

## 5. Componentes

### Botões

- **Primário:** fundo violeta, texto branco; em hero violeta, botão branco com texto violeta.
- **Secundário:** superfície clara, borda violeta e texto violeta.
- **Terciário:** texto/ícone sem superfície; alvo mínimo preservado.
- **Destrutivo:** vermelho semântico e confirmação explícita.
- Estados obrigatórios: default, pressed, focus-visible, disabled, loading e sucesso/erro quando aplicável.

### Cartões

Superfície branca, raio de 16–24 px, borda neutra e sombra `card`. Cabeçalho curto, ícone em contêiner `brandSoft`, conteúdo alinhado à esquerda. Cartões clicáveis precisam de papel e feedback de foco/pressão.

### Campos e seletores

Altura mínima de 48 px, raio de 12–16 px, rótulo persistente, placeholder auxiliar e mensagem de erro associada. Focus usa contorno violeta de pelo menos 2 px. Não depender apenas de placeholder.

### Chips e status

Formato pílula, texto curto e ícone opcional. Status usa combinação de ícone, rótulo e cor semântica. Filtros selecionados recebem preenchimento violeta; não selecionados, superfície clara e borda.

### Navegação

- celular: barra inferior para até cinco destinos, item ativo preenchido e rotulado;
- tablet: barra inferior ampliada ou rail conforme espaço e teste de UX;
- desktop: navegação lateral persistente com conteúdo em grid;
- contexto de prestador e perfil deve permanecer visível conforme CE-UX-001/003.

### Calendário, listas e dashboards

Calendário usa seleção violeta preenchida, eventos com ponto + legenda e nunca somente cor. Listas de atendimento usam horário, título, metadado e ação alinhada. Dashboard prioriza próxima ação, agenda do dia e pendências, seguindo a hipótese H-UX-001.

### Feedback

Loading com esqueleto ou indicador rotulado; vazio com explicação e ação; erro com causa segura e recuperação; offline separado de erro; toast apenas para confirmações não críticas. Modais críticos nomeiam o objeto e o efeito.

## 6. Padrões de tela

- **Mobile (<768):** coluna única, margem de 24 px, navegação inferior, ações primárias próximas ao polegar.
- **Tablet (768–1099):** duas colunas quando preservada a leitura; formulários limitados em largura.
- **Desktop (≥1100):** conteúdo até 1180 px, sidebar e grids de 2–3 colunas; evitar esticar cartões e campos.
- Estados de loading, vazio, erro, offline, sucesso e sem autorização são parte da tela, conforme CE-UX-015.

## 7. Acessibilidade

- contraste mínimo WCAG AA; 4,5:1 para texto comum e 3:1 para texto grande/elementos gráficos;
- foco visível e ordem lógica em web/teclado;
- rótulos acessíveis em botões de ícone;
- redução de movimento respeitada; animações não são necessárias à compreensão;
- texto a 200% sem corte; layout deve refluir;
- área de toque mínima e espaçamento entre alvos;
- estado nunca comunicado somente por cor.

## 8. Uso e governança

1. Não introduzir cor, raio, sombra ou família tipográfica diretamente em componentes quando houver token.
2. Novos tokens exigem justificativa e atualização deste documento.
3. Componentes novos devem cobrir estados, responsividade e acessibilidade antes de serem promovidos à baseline.
4. Referências visuais orientam linguagem; regras funcionais permanecem nos artefatos RN/RF/HU.
5. Alterações aprovadas devem ser registradas no backlog central e no histórico abaixo.

## 9. Base estrutural Bootstrap 5.3

Bootstrap 5.3 é adotado como referência conceitual de escala, não como dependência de UI do React Native. Os tokens executáveis preservam a identidade violeta e Urbanist e traduzem:

- espaçamento `0–5`: 0, 4, 8, 16, 24 e 48 px;
- tipografia `h1–h6`, corpo e small, com line-height tight/base/loose;
- breakpoints xs/sm/md/lg/xl/xxl: 0, 576, 768, 992, 1200 e 1400 px;
- containers máximos: 540, 720, 960, 1140 e 1320 px;
- grid de 12 colunas; gutter padrão 24 px e compacto 16 px;
- bordas 0/1/2 px; raios none/sm/default/lg/xl/xxl/pill;
- sombras de cartão e elemento flutuante;
- z-index de dropdown, sticky, fixed, backdrop, modal, popover e tooltip;
- opacidade disabled/subtle/visible/opaque;
- controles de 40, 48 e 56 px, alvo mínimo de 44 px;
- estados default, hover web, pressed, focus-visible, disabled, loading, valid e invalid.

Os nomes legados de tokens permanecem disponíveis para evitar quebra da implementação.

## 10. Sistema de ícones

### 10.1 Decisão técnica

**Font Awesome 6 Free** é a família principal. **Material Community Icons** é o fallback universal. Ambas são gratuitas, maduras e já distribuídas pelo `@expo/vector-icons`, funcionando na mesma API em web, Android e iOS.

Bootstrap Icons foi avaliado e permanece como referência de linguagem visual — traço simples, cantos suaves e metáfora direta. A biblioteca oficial é voltada a SVG/web e não fornece um componente React Native oficial. Adicionar wrappers comunitários introduziria dependência e conversão SVG desnecessárias; por isso ela não é runtime do MVP.

O componente `AppIcon` centraliza semântica, família, tamanho e acessibilidade. Telas não devem importar famílias diretamente.

### 10.2 Matriz semântica

| Domínio | Semântica | Principal FA6 | Fallback MCI | Tamanho |
|---|---|---|---|---:|
| Navegação | Início | house | home-outline | 24 |
| Agenda | Calendário | calendar-days | calendar-month-outline | 24 |
| Agenda | Horário | clock | clock-outline | 20 |
| Clientes | Pessoas | user-group | account-group-outline | 24 |
| Animais | Animal | paw | paw-outline | 24 |
| Pacotes | Pacote | box-open | package-variant-closed | 24 |
| Financeiro | Carteira | wallet | wallet-outline | 24 |
| Notificações | Alerta | bell | bell-outline | 24 |
| Estados | Sucesso | circle-check | check-circle-outline | 20 |
| Estados | Atenção | triangle-exclamation | alert-outline | 20 |
| Estados | Erro | circle-xmark | close-circle-outline | 20 |
| Ações | Adicionar/editar/excluir | plus/pen/trash | plus/pencil-outline/trash-can-outline | 20 |
| Ações | Buscar/voltar/avançar | magnifying-glass/arrow-left/arrow-right | magnify/arrow-left/arrow-right | 20 |
| Arquivos | Documento/anexo | file-lines/paperclip | file-document-outline/paperclip | 20 |
| Segurança | Proteção/visibilidade | shield-halved/eye | shield-check-outline/eye-outline | 20 |
| Indicadores | Desempenho | chart-line | chart-line | 24 |

Ícone decorativo deve ser ocultado das tecnologias assistivas. Ícone sem texto visível exige `label`. Tamanhos permitidos: 16, 20, 24 e 32 px; o controle que o contém continua respeitando alvo mínimo de 44 px. Não misturar estilos sólido e contorno dentro do mesmo grupo funcional sem indicar estado.

## 11. Histórico

| Versão | Data | Responsável | Alteração |
|---|---|---|---|
| 0.1.0 | 02/08/2026 | Nero — UI e Design System | Inventário e análise de sete referências; criação da baseline com paleta violeta, Urbanist, tokens, componentes, responsividade e acessibilidade; aplicação inicial no Expo e Lean Inception HTML |
| 0.2.0 | 02/08/2026 | Nero — UI e Design System | Escalas estruturais baseadas no Bootstrap 5.3, decisão de Font Awesome 6 + Material Community Icons, matriz semântica e componente universal tipado |
| 0.2.1 | 02/08/2026 | Equipe Rotinaê | Layout de autenticação desktop definido como split view em largura total, com painel institucional violeta encostado às bordas esquerda, superior e inferior da viewport |
| 0.2.2 | 02/08/2026 | Equipe Rotinaê | Inclusão de ícones semânticos decorativos em superfícies glass de baixo contraste no painel institucional, sem interação e ocultos da árvore de acessibilidade |
| 0.2.3 | 02/08/2026 | Equipe Rotinaê | Grid desktop das telas de autenticação refinado para colunas 56/44, com área funcional contínua e conteúdo centralizado em coluna de até 440 px; mobile preservado em coluna única |
| 0.2.4 | 02/08/2026 | Equipe Rotinaê | Ícone decorativo de animal substituído por clientes e animação suave aplicada às superfícies glass, respeitando a preferência de redução de movimento do sistema |
| 0.2.5 | 02/08/2026 | Equipe Rotinaê | Ícone glass intermediário generalizado para usuário individual, evitando associação visual com um segmento ou estrutura de equipe específica |
| 0.2.6 | 02/08/2026 | Equipe Rotinaê | Composição glass corrigida para exatamente três ícones posicionados em relação ao painel completo, com distribuição triangular específica para desktop e mobile |
| 0.2.7 | 02/08/2026 | Equipe Rotinaê | Superfícies glass ampliadas para 72/92 px com pictogramas de 32 px; componente Button ganhou hover centralizado por variante com elevação visual sutil |
| 0.2.8 | 02/08/2026 | Equipe Rotinaê | Destaques glass ampliados para 88/112 px e pictogramas decorativos para 40/48 px; escala AppIcon expandida, mantendo tamanhos grandes restritos a decoração e destaques |
| 0.2.9 | 02/08/2026 | Equipe Rotinaê | Ícones glass animados limitados ao breakpoint desktop (≥1100 px) e removidos das composições de tablet e celular |
| 0.3.0 | 02/08/2026 | Equipe Rotinaê | Conteúdo institucional aprovado preservado no painel esquerdo e formulário de login promovido diretamente para a rota inicial, eliminando a etapa intermediária de entrada |
| 0.4.0 | 02/08/2026 | Equipe Rotinaê | Fotografia centralizada tratada com degradê violeta aplicada como fundo full-bleed do painel; criação dos padrões de confirmação de e-mail, alteração de senha e feedback de autenticação |
| 0.4.1 | 02/08/2026 | Equipe Rotinaê | Variante fotográfica vertical exclusiva para celular, com mulher posicionada à direita e área escura à esquerda; desktop e tablet preservam o asset horizontal |
| 0.4.2 | 02/08/2026 | Equipe Rotinaê | Composição mobile corrigida para tornar a mulher claramente visível: painel de 520 px, overlay reduzido e bloco textual limitado a 61% da largura esquerda |
| 0.4.3 | 02/08/2026 | Equipe Rotinaê | Fotografia de autenticação passou a ser camada absoluta explícita no fundo do painel, com overlay mobile reduzido a 8%, garantindo a presença da mulher atrás do conteúdo |
| 0.4.4 | 02/08/2026 | Equipe Rotinaê | Mobile e desktop unificados na mesma intensidade de tratamento violeta; apenas enquadramento e asset permanecem específicos por breakpoint |
| 0.4.5 | 02/08/2026 | Equipe Rotinaê | Renderização desktop restaurada integralmente ao ImageBackground anterior; camada Image absoluta passa a existir somente no mobile abaixo de 768 px |
| 0.4.6 | 02/08/2026 | Equipe Rotinaê | Mobile simplificado com fundo violeta sólido, sem fotografia e sem frase de apoio; painel reduzido para 260 px para antecipar o formulário na viewport |
| 0.4.7 | 02/08/2026 | Equipe Rotinaê | Conteúdo mobile corrigido: selo reduzido para “Bem-vindo”, descrição multiplataforma ocultada e frase curta “Sua rotina de atendimentos em um só lugar” preservada |
| 0.4.8 | 02/08/2026 | Equipe Rotinaê | Selo da tela inicial padronizado como “Bem-vindo” em desktop, tablet e celular |
