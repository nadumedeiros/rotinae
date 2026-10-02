# Handoff — Componentes reutilizáveis de seleção de data e hora (calendário + colunas roláveis)

| **Data** | **Versão** | **Descrição** | **Projeto** | **Cliente** |
|---|---|---|---|---|
| 14/08/2026 | 1.0 | Criação do documento — arquitetura de experiência de dois componentes novos de design system: Seletor de Data (calendário) e Seletor de Hora (duas colunas roláveis, 24h), a partir de pedido do usuário para substituir a digitação livre em todos os campos de data/hora do app. Complementada, no mesmo dia, com a decisão de comportamento nas bordas do seletor de hora (coluna de hora gira, coluna de minuto trava — seção 6.5.1), fechando lacuna apontada na revisão visual. | Rotinaê | Equipe Rotinaê |

> Preparado para: responsável pelo wiring de frontend (implementação dos componentes e sua aplicação nas telas) e para o especialista de revisão visual (tokens, espaçamento, tipografia, estados de hover/pressed — não decididos aqui).
> Origem: pedido direto do usuário nesta sessão; levantamento técnico prévio confirmou ausência de qualquer biblioteca de date/time picker no projeto — os dois componentes são novos, construídos do zero sobre Expo/RN puro, sem dependência externa.
> Estado: **Proposta de arquitetura de experiência — pendente de aprovação explícita do usuário.** Nenhuma implementação deve começar antes dessa aprovação, salvo indicação em contrário do usuário.

## 1. Objetivo

Substituir, em todos os campos de data e hora do app hoje resolvidos por digitação livre em `TextInput` com máscara (`DD/MM/AAAA` ou `HH:MM`), um mecanismo de seleção assistida por toque/clique: um ícone dentro do próprio campo que, ao ser acionado, abre (a) um calendário para escolha de data ou (b) um seletor de duas colunas roláveis (horas 00–23, minutos) para escolha de hora, sempre em formato 24 horas. Este documento define fluxo, estados, interação, comportamento por plataforma (Web via `react-native-web` e Android nativo) e acessibilidade dos dois componentes. Não define tokens visuais finais (cor, sombra, espaçamento, tipografia — papel do especialista de revisão visual) nem código/interfaces TypeScript (papel de quem faz o wiring).

## 2. O que já existe e este handoff reaproveita sem reabrir

Levantamento de código confirma os seguintes padrões já estabelecidos no app, todos reaproveitados como base dos dois componentes novos — nenhuma "segunda linguagem" de calendário, modal ou interação é introduzida:

- **Grade de mês já existente** (`apps/agendae/app/agenda.tsx`, formulário de novo agendamento, linhas ~1379–1461; `apps/agendae/app/client-booking.tsx`, linhas ~250–262 e ~480–575): cabeçalho de mês/ano com setas de navegação anterior/próximo, linha de rótulos de dia da semana começando no domingo (`["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"]`, ajuste em andamento em paralelo nesta mesma janela de trabalho), grade de 7 colunas com células vazias (`null`) preenchendo o início/fim do mês para completar semanas. Este handoff reaproveita exatamente essa geometria e essa ordem de dias da semana — **sem** os elementos que são específicos do domínio de agenda (ponto indicando dia com atendimento, selo "Bloqueado", múltiplos itens de agendamento dentro da célula), que não fazem sentido para um seletor de data genérico.
- **Modal centralizado com fundo (`backdrop`) e cartão central, nunca popover ancorado** (`apps/agendae/app/agenda.tsx`, ex.: `monthPickerVisible`, linhas 1938–2028; `blockModalVisible`, linhas 1512+): `Modal` do React Native com `transparent`, `animationType="fade"`, cartão central com `modalHeader`/título/subtítulo/botão de fechar (ícone `error`, ação equivalente a "X"), `accessibilityViewIsModal` na View do cartão. Este é o único padrão de sobreposição existente no app — não existe hoje nenhum popover ancorado a um elemento (Web ou nativo). Ver decisão explícita na seção 4.
- **Padrão "campo com ícone que abre um seletor por toque"**, já existente ainda que não dentro de um `TextInput`: o filtro de mês/ano de `agenda.tsx` (`styles.monthFilter`, linhas 927–939) é um `Pressable` com ícone `calendar` + texto + seta, que abre `monthPickerVisible` ao ser tocado. Este handoff estende essa mesma lógica de "elemento tocável com ícone que abre um modal" para dentro da caixa delimitadora de um `TextInput` de verdade.
- **Modais fecham só por controle explícito** (botão "X", "Cancelar"/"Voltar", ou seleção que conclui o fluxo) — nenhum modal do app hoje fecha ao tocar fora dele (`backdrop` não é um `Pressable` de dispensa). Este handoff não introduz esse mecanismo novo pelos dois componentes.
- **Máscara e validação de campo já existentes, por tela**, sem qualquer alteração de contrato: `maskDate`/`validDate` e `maskTime`/`validTime` (`agenda.tsx`, `settings.tsx`), `formatDateInput`/`isValidBrazilianDate` (`clients.tsx`, `payments.tsx`). Ver decisão da seção 4 sobre por que a digitação continua existindo lado a lado com os novos seletores.
- **Padrão de estado desabilitado visível, não escondido** (`opacity.disabled`, já catalogado em handoffs anteriores desta mesma frente de trabalho — `docs/HANDOFF_CANCELAMENTO_CLIENTE_UX_DANTE.md`, `docs/HANDOFF_PAGAMENTOS_STATUS_PAGINACAO_UX_DANTE.md`): reaproveitado para dias fora de `minDate`/`maxDate` no calendário (seção 5.5).
- **Padrão de erro inline** (`errorBox`/`errorText`/`fieldErrorText`, já existente em todas as quatro telas-alvo): permanece o único mecanismo de erro de validação do campo; os dois componentes novos não introduzem um segundo padrão de erro.

## 3. Inventário dos campos-alvo (todas as telas, hoje só digitação)

| Tela | Campo(s) | Tipo | Hoje |
|---|---|---|---|
| `app/agenda.tsx` | Início/fim do bloqueio de agenda (2 datas + 2 horas) | Data + Hora | `TextInput` com `maskDate`/`maskTime`, `keyboardType="number-pad"` |
| `app/agenda.tsx` | Data e hora do novo agendamento/edição | Data + Hora | Idem |
| `app/clients.tsx` | "Data inicial"/"Data final" do período permitido de agendamento (política por cliente, RN-AGD-021) | Data | `TextInput` com `formatDateInput`, visível apenas quando o toggle "Livre"/"Definido" está em "Definido" |
| `app/payments.tsx` | Vencimento | Data | `TextInput` com `formatDateInput`, campo obrigatório |
| `app/settings.tsx` | Início/fim do expediente | Hora | `TextInput` com `maskTime`, campos obrigatórios |

Total: 5 campos de Data e 4 campos de Hora (um par data+hora conta uma vez em cada coluna), distribuídos em 4 telas — nenhuma tela nova é criada, nenhum campo novo é adicionado.

**Fora de escopo, explicitado para não gerar dúvida durante a implementação:** `app/client-booking.tsx` **não** está nesta lista. O calendário dessa tela já não é um campo de texto — é um seletor especializado, combinado com disponibilidade real do prestador (`ClientBookingPolicy`, pontos coloridos de disponibilidade, bloqueios), cuja grade de mês serviu aqui só como referência visual (seção 2). Substituir esse fluxo pelos componentes genéricos deste handoff destruiria a lógica de disponibilidade já implementada sem necessidade — não é pedido pelo usuário nem pelo levantamento técnico, que só listou os quatro arquivos da seção 3.

## 4. Decisão-chave: o seletor complementa a digitação, não a substitui

**Decisão: os campos continuam aceitando digitação manual exatamente como hoje (mesma máscara, mesma validação, mesmo teclado numérico). O ícone dentro do campo é um segundo caminho, mais rápido e com menos erro de formato, não uma substituição que remove a possibilidade de digitar.**

Justificativa:

- **Heurística de Nielsen #7 (Flexibilidade e eficiência de uso):** um prestador preenchendo vários bloqueios de agenda em sequência pode preferir digitar rapidamente (fluxo já dominado); um cliente ocasional preenchendo o vencimento de uma cobrança se beneficia do seletor guiado. Os dois públicos coexistem nas mesmas quatro telas.
- **Menor risco de regressão:** toda a lógica de máscara/validação/parsing (`maskDate`, `validDate`, `formatDateInput`, `isValidBrazilianDate`, `brazilianToIso`, `localDateTimeToIso`, etc.) já existe, já é testada e já alimenta os `payload`s enviados às RPCs. Um seletor que só *preenche* o mesmo estado de texto que a digitação já preenche (em vez de introduzir um tipo de dado paralelo) reaproveita esse pipeline inteiro sem alteração de contrato.
- **Consistência de entrada:** independentemente de o valor ter chegado por digitação ou pelo seletor, o campo guarda sempre a mesma string formatada (`DD/MM/AAAA` ou `HH:MM`) e passa pela mesma validação ao enviar o formulário — a interface não precisa saber, depois do fato, qual caminho o usuário usou.

**Consequência de interação:** tocar no texto do campo continua abrindo o teclado para digitar (comportamento padrão de `TextInput`, inalterado); tocar especificamente no ícone abre o seletor correspondente e, se o teclado estiver visível, ele deve ser fechado antes (evita o seletor de horário/calendário competir com o teclado numérico na tela, especialmente em telas pequenas). Ao confirmar uma escolha no seletor, o valor formatado é escrito no mesmo estado que a digitação já escreveria — a mensagem de erro de campo (`fieldErrors.*`) já existente é limpa da mesma forma que já acontece a cada `onChangeText`.

## 5. Componente 1 — Seletor de Data (calendário)

### 5.1 Gatilho: ícone dentro do campo

Ícone de calendário posicionado dentro da caixa delimitadora do `TextInput`, alinhado à direita (padrão solicitado pelo usuário e já comum em formulários de data em qualquer plataforma). É um elemento tocável independente do campo de texto — isso exige que cada campo-alvo passe a ter um contêiner (`View` em linha) envolvendo o `TextInput` e o ícone, mesmo princípio estrutural já usado pelo campo de busca de `agenda.tsx` (`styles.search`: ícone + `TextInput` dentro de um mesmo `View`), só que com o ícone do lado oposto.

- `accessibilityRole="button"` no ícone, `accessibilityLabel`: `"Abrir seletor de data para o campo {rótulo do campo}"` (ex.: "Abrir seletor de data para o campo Vencimento") — foco alcançável por Tab no Web e ativável por Enter/Espaço, mesmo comportamento padrão de qualquer `Pressable` já usado no app.
- Toque no ícone: fecha o teclado se estiver aberto, então abre o modal do calendário (seção 5.2).

### 5.2 Contêiner: modal centralizado, não popover — decisão e justificativa

**Decisão: modal centralizado (`Modal` + `backdrop` + cartão), reaproveitando exatamente o padrão já usado por `monthPickerVisible`/`blockModalVisible` em `agenda.tsx`. Não é introduzido um popover ancorado ao campo.**

Motivos:

1. **Não existe hoje nenhum popover no app**, em nenhuma tela, Web ou nativo. Introduzir esse padrão exigiria resolver do zero posicionamento relativo ao elemento-gatilho (cálculo de espaço disponível acima/abaixo, comportamento ao rolar a tela, ancoragem diferente em mobile vs desktop), o que é bem mais custoso de implementar de forma equivalente em Web e Android do que reaproveitar um modal que já funciona em ambas as plataformas hoje, sem nenhum código de posicionamento condicional.
2. **Consistência (heurística de Nielsen #4):** todo o app resolve "escolher algo de uma lista maior que a tela permite mostrar inline" com o mesmo modal centralizado (seleção de status, seleção de mês/ano, confirmação de ações). Um popover seria uma exceção visual e de interação só para esses dois campos novos, sem ganho que justifique a divergência.
3. Um modal centralizado também resolve, de graça, o problema de espaço em telas mobile estreitas (320–414px), onde um popover ancorado a um campo no meio de um formulário longo frequentemente não tem espaço vertical suficiente para se abrir sem cobrir outros campos.

### 5.3 Conteúdo do modal

Reaproveita a estrutura de cabeçalho já usada (`modalHeader`, título, botão de fechar com ícone `error`):

- Título: **"Selecionar data"** (genérico; quem aplica o componente pode sobrepor um título mais específico via prop, ex.: "Selecionar vencimento").
- Corpo: exatamente a grade de mês descrita na seção 2 — cabeçalho de mês/ano (ex.: "Agosto de 2026") com setas de navegação anterior/próximo, linha de rótulos de dia da semana começando no domingo, grade de 6×7 células.
- Botão de fechar (ícone `error`, canto superior direito) — fecha sem selecionar nada, mesmo comportamento de "Cancelar" implícito.

### 5.4 Estados da célula do dia

| Estado | Quando | Tratamento |
|---|---|---|
| Padrão | Dia dentro do mês, dentro de `minDate`/`maxDate` | Tocável, sem destaque |
| Hoje | Dia corresponde à data atual | Destaque distinto do "selecionado" (ex.: contorno ou marcador, decisão de token do especialista de revisão visual) — orienta o usuário sem exigir que ele calcule "que dia é hoje" (Nielsen #6, reconhecimento sobre memorização) |
| Selecionado | Dia corresponde ao valor atual do campo (se o campo já tiver um valor válido ao abrir) | Preenchido, mesmo tratamento visual já usado por `calendarCellSelected` nos calendários existentes |
| Fora de `minDate`/`maxDate` | Dia anterior a `minDate` ou posterior a `maxDate` | **Visível, com opacidade reduzida (`opacity.disabled`), não tocável** — mesmo princípio já usado em handoffs anteriores desta frente para não esconder o que existe (Nielsen #1/#6); `accessibilityState={{ disabled: true }}` |
| Célula vazia (preenchimento de início/fim de mês) | Dias fora do mês corrente exibido | Sem número, sem interação — idêntico ao padrão já existente |

### 5.5 `minDate`/`maxDate` — regra de aplicação, não de negócio

O componente aceita `minDate`/`maxDate` como propriedades opcionais. **Nenhuma regra de negócio nova é definida aqui** — cada tela que usa o componente decide seus próprios limites com base nas regras já existentes (ex.: a tela de novo agendamento aplicaria a antecedência mínima já calculada por `minimum_bookable_instant`/RN-AGD-004/008/009; o vencimento de pagamento plausivelmente não precisa de nenhum limite; o período do cliente em `clients.tsx` já tem seu próprio toggle "Livre"/"Definido" e pode ou não precisar de limite). Quando nenhuma das duas props é informada, todos os dias são navegáveis e selecionáveis sem restrição.

### 5.6 Interação de seleção e fechamento

**Decisão: tocar em um dia válido seleciona e fecha o modal imediatamente — não há botão "Confirmar" para a data.** Diferente do seletor de hora (seção 6), aqui há uma única decisão a tomar (um dia), então uma etapa de confirmação separada seria um passo redundante sem ganho (Nielsen #8, design minimalista) — o próprio toque no dia já é uma ação inequívoca e final. Ao selecionar, o valor formatado (`DD/MM/AAAA`) é escrito no campo, o erro de validação do campo é limpo (mesmo comportamento já disparado por `onChangeText` hoje) e o modal fecha.

### 5.7 Estado vazio e valor inicial ao abrir

- Campo já preenchido com uma data válida: o calendário abre já no mês/ano dessa data, com o dia marcado como "Selecionado".
- Campo vazio: o calendário abre no mês/ano atual, com o dia de hoje destacado como "Hoje" (mas nenhum dia previamente "Selecionado", já que não há valor ainda) — a menos que hoje esteja fora de `minDate`/`maxDate`, caso em que abre no mês de `minDate` (ou `maxDate`, se `maxDate` for anterior a hoje), para não abrir numa vista onde todos os dias visíveis estão desabilitados.

### 5.8 Navegação de mês — decisão de escopo mínimo (sem atalho de ano nesta versão)

O componente inclui apenas as setas de navegação de mês anterior/próximo, já presentes na grade reaproveitada (seção 2) — **não inclui**, nesta primeira versão, o atalho de seleção rápida de ano/mês que já existe em `agenda.tsx` (`monthPickerVisible`, seções "Ano"/"Mês" com scroll horizontal e grade de meses). Decisão deliberada de escopo (YAGNI): dos quatro campos-alvo, só o período do cliente em `clients.tsx` plausivelmente se beneficiaria de navegar muitos meses para trás; os demais (bloqueio de agenda, novo agendamento, vencimento) operam em datas próximas ao presente. Se o uso real mostrar que clicar a seta várias vezes é uma fricção real nesse campo específico, adicionar esse atalho depois é uma extensão aditiva sobre o mesmo modal (o padrão visual já existe e pode ser reaproveitado sem inventar nada novo) — não implementado nesta rodada por não haver caso de uso comprovado.

## 6. Componente 2 — Seletor de Hora (duas colunas roláveis, 24h)

### 6.1 Gatilho: ícone dentro do campo

Mesmo padrão da seção 5.1, com ícone de relógio no lugar do calendário. `accessibilityLabel`: `"Abrir seletor de horário para o campo {rótulo do campo}"`.

### 6.2 Contêiner

Mesmo modal centralizado da seção 5.2 (não popover), pelos mesmos motivos. Título: **"Selecionar horário"** (sobrescrevível por prop).

### 6.3 Estrutura: duas colunas independentes

- Coluna esquerda: horas, `00` a `23` (24 valores, sempre com dois dígitos, formato 24h conforme pedido explícito do usuário — nunca AM/PM).
- Coluna direita: minutos, em intervalos fixos (ver decisão de granularidade, seção 6.4).
- Um separador visual `:` fixo entre as duas colunas (não rolável).
- Uma faixa de destaque fixa e centralizada, sobreposta às duas colunas, indicando qual linha de cada coluna está "selecionada no momento" — os valores acima e abaixo dessa faixa continuam legíveis, mas com menor ênfase (peso/opacidade — decisão de token do especialista de revisão visual), reforçando visualmente que o valor sob a faixa central é o que será usado se o usuário confirmar (Don Norman — mapeamento: a posição vertical central mapeia diretamente para "isto é o que está selecionado").

### 6.4 Granularidade dos minutos — decisão e justificativa

**Decisão: intervalos de 15 minutos (`00`, `15`, `30`, `45` — 4 valores por hora), com a decisão registrada como um valor razoável e ajustável, não uma regra de negócio.**

Verificação feita antes de decidir: `durationMinutes` (`apps/agendae/src/domain/services/types.ts`, `service-form-validation.ts`) é um inteiro livre definido pelo prestador ao cadastrar um serviço, sem nenhuma restrição de múltiplo — os próprios testes do domínio usam exemplos como 45 e 50 minutos, valores que não são múltiplos de 15 nem de 30. Nenhuma regra de negócio (`RN-AGD-*`, `RN-SRV-*`) formaliza uma duração mínima de slot ou uma granularidade de agenda. Ou seja, não há nenhum número "correto" derivável das regras já existentes.

Diante disso, 15 minutos foi escolhido por ser o intervalo mais comum em ferramentas de agenda de serviços em geral (nem tão granular quanto 5 minutos, que exigiria rolar por até 12 posições para alcançar um valor redondo comum como `:30`, nem tão grosso quanto 30 minutos, que impediria representar um expediente terminando às `:15`/`:45`, algo plausível). **Isto não é uma regra de negócio nova** — é só o passo do seletor. A digitação manual (seção 4) continua sem essa restrição: um prestador pode digitar `08:07` diretamente no campo, já que o `validTime` existente não impõe múltiplo de 15; o seletor simplesmente não tem uma posição própria para `:07` (o usuário que precisar desse valor específico usa a digitação, não o seletor — os dois caminhos continuam coexistindo, seção 4).

### 6.5 Interação de rolagem e "soltar" (snap)

- **Toque e arraste (nativo, mobile) / arraste com clique ou gesto de rolagem de dois dedos no trackpad (Web):** cada coluna é uma lista vertical rolável; ao soltar (fim do gesto), a coluna anima até o valor mais próximo do centro ficar exatamente alinhado com a faixa de destaque (comportamento de "roleta"/"drum picker", já familiar em seletores de hora nativos de iOS/Android, ainda que este projeto não use nenhum componente pronto de terceiros — é reconstruído aqui com o mesmo comportamento esperado pelo usuário).
- **Rolagem do mouse (Web, sem trackpad):** o evento de scroll do mouse sobre a coluna move a lista, com o mesmo snap ao soltar/parar de rolar — comportamento nativo de uma lista rolável em `react-native-web`, sem necessidade de lógica adicional além do próprio snap.
- **Toque direto num valor visível (mobile e Web):** tocar/clicar em qualquer número visível na coluna (mesmo fora da faixa central) já o seleciona e anima a coluna até centralizá-lo — alternativa explícita ao gesto de rolar, para quem prefere apontar e clicar em vez de arrastar (importante sobretudo no mouse, onde arrastar uma lista é menos natural que num touchscreen).
- **Setas de incremento/decremento (Web e mobile):** cada coluna tem um pequeno controle de seta para cima/para baixo, acima e abaixo da faixa central, que avança ou recua um passo por toque/clique — alternativa para quem não quer rolar nem mirar num valor específico, e também o mecanismo usado por quem opera via teclado (seção 6.8).

### 6.5.1 Comportamento nas bordas do intervalo — girar (hora) vs. travar (minuto)

**Decisão: a coluna de HORA gira (carrossel infinito — `23` seguido de `00` continuamente, em qualquer direção); a coluna de MINUTO trava (para em `00` ou `45`, sem passar; é preciso inverter o gesto para voltar). As duas colunas não compartilham o mesmo comportamento de borda.**

Justificativa:

- **Hora (24 valores) gira:** um relógio não tem início/fim dentro do dia — `23h` seguido de `00h` é a correspondência exata com o mundo real (Nielsen #2) e o comportamento já esperado de qualquer seletor de hora conhecido. Travar em `23` ou `00` criaria uma parede artificial onde não existe limite real a comunicar.
- **Minuto (4 valores) trava:** um carrossel de apenas 4 itens completa uma volta a cada gesto curto, o que passa sensação de instabilidade em vez do comportamento de "roleta" esperado, e aumenta o risco de o usuário passar direto pelo valor pretendido logo após uma borda por causa da inércia do gesto. Travar em `00`/`45` dá um limite físico perceptível (Nielsen #5, prevenção de erros; Don Norman, restrições).
- **Por que as duas colunas não precisam do mesmo comportamento (Nielsen #4 não se aplica aqui como argumento a favor da uniformidade):** a diferença de escala (24 valores vs. 4) é grande o suficiente para que forçar o mesmo comportamento prejudicasse a usabilidade de uma das duas. O que permanece idêntico entre as colunas — e é o que realmente precisa ser consistente — é o mecanismo de interação (arrastar, tocar num valor, setas de incremento/decremento, snap ao soltar); só a regra do que acontece exatamente na borda muda, de forma justificada pelo tamanho do conjunto, não por inconsistência arbitrária.

Consequência para o achado registrado na revisão visual (seção 2.7 do handoff visual): como o minuto trava, o tratamento de "linha vazia" nas bordas do viewport (mesmo princípio de célula vazia do calendário — sem número, opacidade reduzida, sem interação) se aplica normalmente à coluna de minuto quando `00` ou `45` estiver próximo do centro. A coluna de hora, por girar, nunca precisa desse tratamento — por ser cíclica, sempre há um valor real preenchendo as 5 linhas visíveis, em qualquer posição de rolagem.

### 6.6 Confirmação: botão explícito, não fechamento automático

**Decisão: o modal exige um botão "Confirmar" — não fecha sozinho ao ajustar uma ou as duas colunas.**

Justificativa: diferente do calendário (seção 5.6), aqui há duas decisões independentes (hora e minuto). Fechar automaticamente após a primeira coluna tocada fecharia o modal antes de o usuário ajustar a segunda; fechar só quando "as duas colunas tiverem sido tocadas alguma vez" é um critério frágil e não observável pelo usuário (ele não sabe quando o modal vai decidir que ele "terminou"). Um botão explícito remove essa ambiguidade e dá controle total ao usuário sobre quando a escolha está pronta (Nielsen #3, controle do usuário) — reaproveitando o mesmo par de botões primário/secundário já usado por todos os modais de confirmação do app (`confirmActions`/botão de ação primária + "Cancelar"/"Voltar").

- Botão primário: **"Confirmar"** — grava `HH:MM` no campo (mesmo valor que a digitação escreveria) e fecha o modal.
- Botão secundário: **"Cancelar"** — fecha sem alterar o campo.

### 6.7 Valor inicial ao abrir

- Campo já preenchido com um horário válido: as colunas abrem já posicionadas nesse valor (a hora exata; o minuto no valor de grade mais próximo — arredondamento para baixo — caso o valor digitado não seja múltiplo de 15, sem alterar o campo até que o usuário toque "Confirmar").
- Campo vazio: as colunas abrem no horário atual arredondado para cima até o próximo múltiplo de 15 — evita que o usuário sempre precise rolar a partir de `00:00` para chegar a um horário plausível perto do momento em que está preenchendo o formulário (reduz esforço, análogo ao princípio de reconhecimento sobre memorização).

### 6.8 Acessibilidade — teclado (Web) e leitor de tela

Cada coluna (não cada item individual da lista) é um único elemento focável, evitando dezenas de paradas de Tab para percorrer 24 horas ou 4 minutos — mesmo princípio já usado por controles do tipo "ajustável" em interfaces nativas:

- `accessibilityRole="adjustable"` em cada coluna, com o valor atual anunciado por leitor de tela (ex.: "Horas, 8" / "Minutos, 30") e ações de incremento/decremento associadas (`accessibilityActions`/`onAccessibilityAction`, já suportado nativamente pelo React Native para VoiceOver/TalkBack via gesto de deslizar para cima/baixo sobre o elemento em foco — nenhum mecanismo novo de acessibilidade nativa é inventado, apenas usado).
- **No Web**, o mesmo elemento em foco (alcançável por Tab) deve responder às teclas seta para cima/seta para baixo com o mesmo efeito de incrementar/decrementar um passo — mesmo resultado funcional do gesto nativo, exposto de outra forma porque teclado não tem gesto de deslizar. Sem isso, um usuário de teclado no Web não teria como operar o seletor sem mouse/toque, o que não seria aceitável dado o pedido de acessibilidade.
- As setas de incremento/decremento visíveis (seção 6.5) também servem como alternativa totalmente por clique/toque para quem usa leitor de tela com navegação por Tab em vez de gesto — cada seta é um botão comum (`accessibilityRole="button"`, rótulo "Aumentar hora"/"Diminuir hora"/"Aumentar minuto"/"Diminuir minuto"), sem depender do suporte a `adjustable` do leitor de tela em uso.
- O botão "Confirmar" só é necessário tocar uma vez ao final — nenhuma navegação adicional por teclado é exigida além de ajustar as duas colunas e ativar o botão.

## 7. Comportamento comum aos dois componentes

- Fecham somente por controle explícito (botão "X" no calendário; "Confirmar"/"Cancelar" no seletor de hora; seleção de um dia no calendário) — nunca ao tocar fora do modal, mesma consistência já estabelecida (seção 2).
- `accessibilityViewIsModal` no cartão central de ambos, reaproveitando o atributo já usado pelos modais existentes.
- Teclado do sistema (mobile) é sempre fechado antes de abrir qualquer um dos dois modais, evitando sobreposição entre teclado numérico e o seletor.
- Nenhum dos dois componentes impede a tela de continuar exibindo mensagens de erro de validação já existentes (`fieldErrorText`) — a validação final do valor (formato, obrigatoriedade, `min`/`max` de negócio específico da tela) continua ocorrendo do mesmo jeito que ocorre hoje para um valor digitado, porque o valor gravado pelo seletor é indistinguível de um valor digitado (seção 4).

## 8. Aplicação por tela (orientação, não prescrição de `minDate`/`maxDate`)

| Tela / campo | Componente | Observação |
|---|---|---|
| `agenda.tsx` — início/fim do bloqueio de agenda | Data + Hora | Sem `minDate`/`maxDate` definido por este handoff; se a tela quiser impedir bloqueio em datas passadas, a decisão e o valor de `minDate` cabem a quem aplica o componente, não a este documento. |
| `agenda.tsx` — data/hora do novo agendamento/edição | Data + Hora | Idem — plausivelmente usaria a mesma antecedência mínima já calculada hoje pela regra de agendamento (`RN-AGD-004/008/009`), mas o valor exato de `minDate` é decisão de quem aplica, não deste handoff. |
| `clients.tsx` — "Data inicial"/"Data final" do período do cliente | Data | Nenhum botão "Limpar" é adicionado ao componente: o campo só aparece quando o toggle já existente está em "Definido"; voltar para "Livre" já esvazia a necessidade do valor, sem exigir uma ação de limpeza dentro do próprio seletor (YAGNI — nenhum dos quatro campos-alvo é, de fato, opcional dentro do próprio seletor). |
| `payments.tsx` — Vencimento | Data | Campo obrigatório, sem indicação de restrição de `minDate`/`maxDate` nas regras já existentes (`RN-FIN-*`); nenhuma é proposta aqui. |
| `settings.tsx` — início/fim do expediente | Hora | Sem restrição de intervalo entre os dois campos dentro do próprio seletor — a validação já existente ("início deve ser anterior ao término") continua ocorrendo depois, no envio do formulário, exatamente como hoje. |

## 9. Fora de escopo explícito desta rodada

- `app/client-booking.tsx` (seção 3) — fluxo especializado de disponibilidade real, não um campo de texto a decorar.
- Qualquer regra de negócio nova sobre antecedência mínima, granularidade de agendamento ou limites de data — os dois componentes só expõem `minDate`/`maxDate` como propriedades; os valores de cada campo continuam decisão de quem aplica o componente, com base nas regras já existentes.
- Tokens visuais finais (cor, espaçamento, tipografia, sombra, estados de hover/pressed) — papel do especialista de revisão visual, que recebe este documento em seguida.
- Restrição de intervalo de horas/minutos (equivalente a `minDate`/`maxDate`, mas para hora) — nenhum dos quatro campos de hora hoje precisa dessa restrição; se um campo futuro precisar, é uma extensão aditiva sobre o mesmo componente, não decidida aqui.
- Atalho de navegação rápida de ano/mês no calendário (seção 5.8) — registrado como possível extensão futura, não implementado nesta rodada.

## 10. Componentização (inventário de reaproveitamento)

| Componente/padrão já existente | Uso nestes dois componentes novos |
|---|---|
| Grade de mês (`calendarGrid`/`calendarCells`/cabeçalho de mês/ano/setas), `agenda.tsx` e `client-booking.tsx` | Reaproveitada como esqueleto visual do Seletor de Data (seções 2, 5.3), sem os elementos específicos de domínio (pontos de agendamento, selo "Bloqueado"). |
| `Modal` + `backdrop` + cartão central + `modalHeader`/botão de fechar, já usado por `monthPickerVisible`/`blockModalVisible` (`agenda.tsx`) | Contêiner dos dois componentes novos (seções 5.2, 6.2) — nenhum popover introduzido. |
| `styles.monthFilter` (`Pressable` com ícone + texto que abre um modal, `agenda.tsx`) | Referência de interação para "elemento com ícone que abre seletor por toque", adaptada para dentro de um `TextInput` real (seção 5.1). |
| `styles.search` (ícone + `TextInput` dentro do mesmo contêiner, `agenda.tsx`) | Referência estrutural para o contêiner ícone+campo dos dois componentes, com o ícone espelhado para a direita. |
| `opacity.disabled` (já catalogado em handoffs anteriores desta frente) | Estado "fora de `minDate`/`maxDate`" no calendário (seção 5.4). |
| `errorBox`/`errorText`/`fieldErrorText` (já existente em todas as quatro telas-alvo) | Mecanismo de erro de validação do valor final, inalterado (seção 7). |
| `confirmActions`/par de botões primário+secundário (já existente em todos os modais de confirmação do app) | Botões "Confirmar"/"Cancelar" do Seletor de Hora (seção 6.6). |
| `maskDate`/`validDate`/`maskTime`/`validTime`/`formatDateInput`/`isValidBrazilianDate` (já existentes, por tela) | Pipeline de validação do valor final, inalterado — o seletor só escreve no mesmo estado que a digitação já escreve (seção 4). |

Nenhum átomo, molécula ou organismo visual novo é introduzido além dos dois componentes explicitamente pedidos nesta rodada.

## 11. Heurísticas e acessibilidade aplicadas

- **Nielsen #1 — Visibilidade do status:** dia "Hoje" sempre destacado no calendário; faixa central sempre indicando o valor que seria confirmado no seletor de hora; dias fora de `minDate`/`maxDate` visíveis (não escondidos), comunicando por que não são tocáveis.
- **Nielsen #3 — Controle do usuário:** seleção de hora exige confirmação explícita, nunca aplicando um valor parcialmente ajustado; "Cancelar"/fechar sem selecionar sempre disponíveis nos dois componentes.
- **Nielsen #4 — Consistência:** ambos os componentes reaproveitam o único padrão de sobreposição já existente no app (modal centralizado com `backdrop`), a mesma geometria de grade de mês já usada em duas telas, e o mesmo par de botões de confirmação já usado em todos os modais existentes.
- **Nielsen #6 — Reconhecimento sobre memorização:** destaque do dia atual no calendário; posicionamento inicial do seletor de hora próximo ao horário atual quando o campo está vazio, evitando que o usuário precise rolar a partir de `00:00`.
- **Nielsen #7 — Flexibilidade e eficiência de uso:** digitação manual preservada lado a lado com os seletores (seção 4); múltiplos caminhos de interação no seletor de hora (arrastar, tocar num valor, usar as setas, usar teclado) atendendo diferentes dispositivos de entrada.
- **Nielsen #8 — Design minimalista:** calendário fecha com um único toque, sem etapa de confirmação redundante para uma escolha unidimensional.
- **Don Norman — Affordance/Mapeamento:** ícone dentro do campo é claramente tocável (mesmo tratamento visual de qualquer botão do app); faixa central do seletor de hora mapeia visualmente qual valor será usado.
- **Acessibilidade (WCAG AA):** `accessibilityLabel` descritivo nos dois ícones-gatilho e nas setas de incremento/decremento; `accessibilityRole="adjustable"` com ações de incremento/decremento nas colunas do seletor de hora, replicado por teclas de seta no Web para paridade sem depender de gesto; `accessibilityState={{ disabled: true }}` nos dias fora de `minDate`/`maxDate`; nenhum estado comunicado só por cor (dia "Hoje"/"Selecionado" sempre com tratamento adicional de forma/contorno, não só tonalidade — decisão final de token do especialista de revisão visual, mas o requisito de não depender só de cor é definido aqui).

## 12. Riscos e achados registrados, não decididos aqui

1. **Granularidade de 15 minutos é uma escolha razoável, não uma regra de negócio (seção 6.4).** Ajustável no futuro sem impacto em nenhuma regra já formalizada, já que nenhuma regra existente define slot mínimo de agenda.
2. **Ausência de atalho de navegação rápida de ano/mês no calendário (seção 5.8).** Pode se mostrar insuficiente para o campo de período do cliente em `clients.tsx` se, na prática, os prestadores precisarem navegar muitos meses para trás com frequência — não implementado nesta rodada por falta de evidência de uso real (YAGNI).
3. **`minDate`/`maxDate` de cada campo permanecem decisão de quem aplica o componente, tela por tela**, com base nas regras de negócio já existentes — este handoff não atribui nenhum valor concreto a nenhum dos cinco campos de data.
4. **Estrutura de contêiner (ícone + `TextInput` no mesmo `View`) precisa ser introduzida em todos os nove campos-alvo**, já que hoje nenhum deles tem essa estrutura — é uma mudança estrutural pequena, mas toca as quatro telas listadas na seção 3.

## 13. Critérios de aceite

- Os nove campos listados na seção 3 exibem um ícone (calendário ou relógio, conforme o tipo) dentro da caixa do campo, alinhado à direita, sem remover a possibilidade de digitação manual já existente.
- Tocar no ícone abre o modal correspondente (calendário ou seletor de hora); tocar no texto do campo continua abrindo o teclado para digitação, comportamento inalterado.
- Calendário: grade reaproveita a geometria e a ordem de dias da semana já usada em `agenda.tsx`/`client-booking.tsx` (domingo primeiro); dia "Hoje" destacado; dias fora de `minDate`/`maxDate` (quando informados pela tela) visíveis com opacidade reduzida e não tocáveis; tocar num dia válido grava o valor formatado no campo e fecha o modal imediatamente.
- Seletor de hora: duas colunas independentes (horas 00–23, minutos em passos de 15) com snap ao soltar, suporte a toque direto num valor, setas de incremento/decremento, e suporte a rolagem por scroll do mouse no Web; botão "Confirmar" grava o valor no campo; botão "Cancelar" fecha sem alterar nada; ambas as colunas acessíveis por teclado no Web (seta para cima/baixo) com o mesmo efeito das ações de acessibilidade nativas (`accessibilityRole="adjustable"`).
- Nenhuma alteração de validação, máscara ou formato de valor gravado nos nove campos — o valor gravado pelo seletor é idêntico em formato ao valor que a digitação já gravaria, reaproveitando o mesmo pipeline de validação já existente por tela.
- Nenhuma mudança de comportamento em `app/client-booking.tsx`.

## 14. Registro em BACKLOG.md

Registrada como **DEC-155, Estado: Proposta** — pendente de aprovação explícita do usuário antes de qualquer implementação. Dois novos itens de backlog criados como **Proposto**: `BLG-095` (componente Seletor de Data) e `BLG-096` (componente Seletor de Hora), ambos referenciando este documento e as quatro telas da seção 3.
