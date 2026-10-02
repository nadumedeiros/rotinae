# Preparação do Ambiente de Desenvolvimento — Rotinaê

> **Versão:** 0.1.0  
> **Status:** Ambiente universal preparado; bundles web, Android e iOS validados  
> **Data:** 2 de agosto de 2026  
> **Decisões relacionadas:** [DEC-027 e DEC-028](../BACKLOG.md)  
> **Aplicação:** [`apps/agendae`](../apps/agendae)

## 1. Abordagem escolhida

O MVP utilizará um único aplicativo universal com:

- React Native;
- Expo SDK 54;
- Expo Router;
- React Native Web;
- TypeScript;
- Metro como bundler das três plataformas.

Essa abordagem permite compartilhar rotas, componentes, regras, tokens visuais e a maior parte dos estilos entre web, Android e iOS. Adaptações específicas devem ser usadas somente quando interação, tamanho de tela ou API nativa exigirem.

### Por que esta é a prioridade do MVP

| Critério | Aplicativo universal Expo | Projetos web e mobile separados |
|---|---|---|
| Velocidade inicial | Maior: um scaffold e uma base de componentes | Menor: duas aplicações e integração duplicada |
| Consistência visual | Tokens e componentes compartilhados | Requer sincronização entre projetos |
| Manutenção | Correções comuns em um lugar | Repetição de regras e testes |
| Web, Android e iOS | Suportados pelo mesmo projeto | Exige coordenação adicional |
| Limitações | Algumas APIs e padrões exigem arquivos por plataforma | Mais liberdade específica por plataforma |
| Custo inicial | Servidor local e exportação estática sem infraestrutura adicional | Dois pipelines e possíveis hostings distintos |

O Expo Router fornece navegação baseada em arquivos para Android, iOS e web. A documentação oficial recomenda `create-expo-app` para novos projetos universais. Durante a transição atual, a documentação orienta usar SDK 54 quando o teste em dispositivo físico depender do Expo Go; SDK 57 é a opção atual para development builds.

Referências oficiais:

- [Create Expo App](https://docs.expo.dev/more/create-expo/)
- [Introdução ao Expo Router](https://docs.expo.dev/router/introduction/)
- [Configuração do ambiente](https://docs.expo.dev/get-started/set-up-your-environment/)
- [Iniciar o desenvolvimento](https://docs.expo.dev/get-started/start-developing/)
- [Emulador Android](https://docs.expo.dev/workflow/android-studio-emulator/)
- [Publicação/exportação web](https://docs.expo.dev/guides/publishing-websites/)

## 2. Estado verificado nesta máquina

| Ferramenta | Estado verificado |
|---|---|
| Node.js | Instalado: `v24.13.1` |
| npm | Instalado: `11.10.1` |
| Visual Studio Code | Instalado |
| Dependências do projeto | Instaladas em `apps/agendae/node_modules` |
| Java/JDK | Não encontrado |
| Android SDK / ADB | Não encontrado |
| Android Emulator | Não encontrado |
| `ANDROID_HOME` | Não configurado |
| `JAVA_HOME` | Não configurado |

O navegador e o Expo Go em dispositivo físico podem ser usados imediatamente. O emulador Android exige a instalação descrita na seção 8.

## 3. Estrutura inicial

```text
ROTINAÊ/
├── apps/
│   └── agendae/
│       ├── app/                  # rotas do Expo Router
│       │   ├── _layout.tsx       # navegação raiz
│       │   └── index.tsx         # tela inicial responsiva
│       ├── src/
│       │   ├── components/       # componentes compartilhados
│       │   └── theme/            # tokens visuais e breakpoints
│       ├── assets/               # ícones, splash e imagens
│       ├── .env.example          # contrato de variáveis públicas
│       ├── app.json              # configuração Expo
│       ├── package.json          # scripts e dependências do app
│       └── tsconfig.json
├── docs/                         # documentação do produto
├── BACKLOG.md                    # decisões e rastreabilidade
├── package.json                  # comandos do workspace
└── README.md
```

À medida que as funcionalidades forem iniciadas, a pasta `src` deverá evoluir para:

```text
src/
├── components/       # UI compartilhada e acessível
├── features/         # módulos por domínio: agenda, pacotes, clientes...
├── services/         # Supabase e integrações
├── store/            # estado do cliente, se necessário
├── theme/            # cores, tipografia, espaçamento e breakpoints
├── types/            # contratos TypeScript
└── utils/            # funções puras compartilhadas
```

## 4. Dependências

### Obrigatórias para web e Expo Go

- Node.js LTS;
- npm;
- Git;
- editor como Visual Studio Code;
- navegador atualizado;
- Expo Go no celular para validação inicial.

As dependências JavaScript já estão registradas em `apps/agendae/package-lock.json`. Em uma nova máquina, instale-as com:

```powershell
npm --prefix apps/agendae ci
```

Principais versões instaladas:

- `expo ~54.0.35`;
- `react-native 0.81.5`;
- `react 19.1.0`;
- `react-native-web ~0.21.0`;
- `expo-router ~6.0.24`;
- `typescript ~5.9.2`.

Não é necessário instalar a Expo CLI globalmente. Os scripts usam a CLI local do projeto. O EAS CLI só será necessário para development builds e publicação.

## 5. Variáveis de ambiente

Copie o contrato de exemplo:

```powershell
Copy-Item apps\agendae\.env.example apps\agendae\.env.local
```

Variáveis previstas:

| Variável | Finalidade | Necessária agora |
|---|---|:---:|
| `EXPO_PUBLIC_APP_ENV` | Identificar desenvolvimento, staging ou produção | Sim |
| `EXPO_PUBLIC_SUPABASE_URL` | URL pública do projeto Supabase | Quando o back-end for conectado |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Chave pública `anon` protegida por RLS | Quando o back-end for conectado |
| `EXPO_PUBLIC_SENTRY_DSN` | Destino público do Sentry | Quando o monitoramento for conectado |

Variáveis `EXPO_PUBLIC_*` são incorporadas ao aplicativo e não são secretas. Nunca colocar `SUPABASE_SERVICE_ROLE_KEY`, credenciais de WhatsApp, FCM server key ou segredos de assinatura no cliente.

## 6. Abrir a versão web

Na raiz do projeto:

```powershell
npm run web
```

Endereço padrão:

```text
http://localhost:8081
```

Também é possível executar diretamente:

```powershell
cd apps\agendae
npm run web
```

Atalhos no terminal do Expo:

- `w`: abre a web;
- `a`: abre o Android quando um emulador/dispositivo estiver disponível;
- `r`: recarrega;
- `m`: abre o menu de desenvolvimento;
- `Ctrl+C`: encerra o servidor.

### Validar a exportação web

```powershell
npm run export:web
```

O resultado será criado em `apps/agendae/dist`. Essa exportação estática poderá ser hospedada no Netlify posteriormente.

Para servir essa exportação localmente sem o Metro:

```powershell
npm run preview:web
```

O preview também responde em `http://localhost:8081` e é útil para conferir o resultado compilado. Para desenvolvimento com Fast Refresh, use `npm run web`.

## 7. Visualizar no celular com Expo Go

### Programas e conta

1. Instale o Expo Go pela Play Store ou App Store.
2. Uma conta Expo é recomendada para serviços em nuvem, mas não é obrigatória para abrir o projeto local pelo QR em LAN.
3. Conecte computador e celular à mesma rede Wi-Fi.

### Execução

Na raiz:

```powershell
npm run start
```

No Android:

1. abra o Expo Go;
2. escolha a leitura do QR code;
3. leia o QR exibido pelo terminal.

No iPhone:

1. abra a câmera do iOS;
2. leia o QR code;
3. confirme a abertura no Expo Go.

### Quando LAN não conectar

Use túnel:

```powershell
npm --prefix apps/agendae run start -- --tunnel
```

O modo túnel pode ser mais lento, mas contorna isolamento de rede, Wi-Fi público, configurações de roteador e alguns firewalls.

## 8. Instalar e usar emulador Android

O Android Studio, Java, ADB e Android SDK ainda não estão disponíveis nesta máquina.

### Instalação

1. Instale o Android Studio pelo site oficial.
2. No instalador, mantenha Android SDK, Android SDK Platform e Android Virtual Device selecionados.
3. Abra `More Actions > SDK Manager` e instale uma plataforma compatível com o SDK Expo adotado.
4. Abra `Device Manager` e crie um dispositivo virtual com Google APIs.
5. Configure as variáveis do usuário no Windows:

```text
ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
```

Adicione ao `Path`:

```text
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\emulator
```

O Android Studio inclui runtime Java para suas tarefas. Caso o fluxo nativo exija JDK separado, configure `JAVA_HOME` conforme a versão recomendada pela documentação do Expo/Android adotada.

### Verificação

Feche e abra o PowerShell e execute:

```powershell
adb --version
emulator -list-avds
adb devices
```

### Execução

1. Inicie o AVD no Device Manager.
2. Na raiz do projeto, execute:

```powershell
npm run android
```

Ou inicie o servidor com `npm run start` e pressione `a`.

## 9. Dispositivo Android físico conectado

Para Expo Go, o cabo USB não é necessário: use LAN ou túnel. Para validar conexão ADB:

1. ative as Opções do desenvolvedor no Android;
2. habilite Depuração USB;
3. conecte por um cabo com transferência de dados;
4. aceite a chave RSA exibida no aparelho;
5. execute:

```powershell
adb devices
```

O aparelho deve aparecer como `device`, não `unauthorized`. Com o Expo Go instalado, execute `npm run start` e abra o projeto pelo QR. Development builds poderão ser instalados via ADB em uma etapa posterior.

## 10. Testar como tablet

### No navegador

1. execute `npm run web`;
2. abra `http://localhost:8081`;
3. pressione `F12`;
4. ative a barra de dispositivos (`Ctrl+Shift+M` no Chrome/Edge);
5. escolha um tablet ou informe dimensões como `768 × 1024` e `1024 × 768`;
6. teste retrato e paisagem, zoom de 200% e navegação por teclado.

### Em emulador

Crie um AVD de tablet no Android Studio e execute `npm run android`.

### Em dispositivo físico

Instale Expo Go no tablet e use o mesmo QR do comando `npm run start`.

## 11. Limitações de iOS

- No Windows não existe iOS Simulator, pois ele depende de macOS e Xcode.
- É possível testar a base atual em iPhone físico com Expo Go.
- Expo Go é adequado para esta validação inicial, mas possui um conjunto fixo de módulos nativos e não representa um binário de produção.
- Quando houver módulo nativo personalizado, será necessário um development build.
- Builds iOS podem ser gerados na nuvem com EAS; instalação e distribuição exigem os requisitos de conta e assinatura da Apple aplicáveis.
- Para build e simulador locais de iOS, é necessário um Mac com Xcode.

Fluxo futuro de development build:

```powershell
npm install --global eas-cli
eas login
cd apps\agendae
eas build:configure
eas build --platform ios --profile development
```

Uma conta Expo será necessária para EAS. Uma assinatura ativa do Apple Developer Program é necessária para instalar development builds iOS conforme o fluxo oficial de provisionamento.

## 12. Testar responsividade

Breakpoints iniciais centralizados em `apps/agendae/src/theme/tokens.ts`:

| Categoria | Faixa inicial |
|---|---|
| Celular | `< 768 px` |
| Tablet | `768–1099 px` |
| Desktop | `≥ 1100 px` |

Checklist mínimo:

- `360 × 800`: celular compacto;
- `390 × 844`: celular comum;
- `768 × 1024`: tablet retrato;
- `1024 × 768`: tablet paisagem;
- `1280 × 720`: notebook;
- `1440 × 900`: desktop;
- orientação retrato e paisagem;
- texto ampliado e zoom de 200%;
- teclado, foco visível e leitor de tela nos fluxos críticos;
- conteúdo sem corte, rolagem lateral ou ação inacessível.

O rodapé da tela inicial exibe a largura atual e a categoria detectada, facilitando a verificação dos breakpoints.

## 13. Problemas comuns de conexão

| Sintoma | Causa provável | Correção |
|---|---|---|
| QR não abre no celular | Redes diferentes | Colocar os dois dispositivos na mesma Wi-Fi |
| Expo Go fica carregando | Isolamento do roteador ou firewall | Executar com `--tunnel` |
| Porta ocupada | Outro Metro em execução | Aceitar outra porta ou encerrar o processo anterior |
| Alteração não aparece | Cache do Metro | Recarregar; depois usar `npx expo start --clear` |
| Expo Go informa incompatibilidade | SDK do app não suportado pela versão instalada | Atualizar Expo Go e confirmar SDK 54 |
| `adb` não reconhecido | SDK fora do Path | Configurar `ANDROID_HOME` e `platform-tools` |
| Dispositivo aparece `unauthorized` | RSA não aceita | Desconectar, revogar autorizações USB e aceitar novamente |
| Emulador não inicia | Virtualização desabilitada | Habilitar virtualização e recurso de hipervisor no Windows |
| Celular acessa web, mas não Metro | Firewall bloqueando Node | Permitir Node.js em redes privadas ou usar túnel |

Limpeza de cache:

```powershell
cd apps\agendae
npx expo start --clear
```

Diagnóstico do projeto:

```powershell
cd apps\agendae
npx expo-doctor
```

## 14. Comandos disponíveis

Execute na raiz:

| Comando | Ambiente |
|---|---|
| `npm run start` | Metro + QR para Expo Go, Android, iOS e web |
| `npm run web` | Navegador em `http://localhost:8081` |
| `npm run android` | Emulador ou Android conectado |
| `npm run ios` | Simulator no macOS; não funciona no Windows |
| `npm run lint` | Qualidade estática do código |
| `npm run typecheck` | Verificação TypeScript |
| `npm run export:web` | Gera a web estática em `apps/agendae/dist` |
| `npm run preview:web` | Serve a exportação local em `http://localhost:8081` |
| `npm run check` | Lint + TypeScript + exportação web |

## 15. O que está sendo executado em cada plataforma

| Plataforma | Runtime | Renderização | Navegação | Como testar agora |
|---|---|---|---|---|
| Navegador desktop | JavaScript no navegador | React Native Web | Expo Router web | `npm run web` |
| Navegador em modo tablet/celular | Mesmo runtime web | CSS gerado pelo React Native Web | Expo Router web | DevTools responsivo |
| Android com Expo Go | React Native dentro do Expo Go | Views nativas Android | Expo Router nativo | QR ou `npm run android` |
| iPhone com Expo Go | React Native dentro do Expo Go | Views nativas iOS | Expo Router nativo | QR em aparelho físico |
| Android Emulator | React Native no emulador | Views nativas Android | Expo Router nativo | Android Studio + `npm run android` |
| iOS Simulator | React Native no simulador | Views nativas iOS | Expo Router nativo | Apenas macOS + Xcode |

As regras de interface que diferenciam navegador e aplicativo nativo estão consolidadas em [Navegação e diferenças entre web e app](./NAVEGACAO_WEB_APP_FRONTEND.md). Em especial, o web mantém rodapés e menus flutuantes, enquanto Android e iOS usam menu hambúrguer em tela cheia e não renderizam rodapé institucional.

## 16. Critérios concluídos nesta preparação

- scaffold universal criado;
- dependências instaladas e bloqueadas em `package-lock.json`;
- tela inicial compartilhada e responsiva criada;
- suporte a tablet habilitado no app iOS;
- identificadores Android e iOS configurados;
- variáveis públicas documentadas sem segredos;
- lint aprovado;
- TypeScript aprovado;
- exportação web gerada em `dist`;
- bundle Android gerado com sucesso pelo Metro;
- bundle iOS/iPadOS gerado com sucesso pelo Metro;
- comandos centralizados na raiz;
- execução web, Expo Go, Android físico/emulador, tablet e limitações iOS documentadas.

A renderização foi confirmada no navegador via `localhost` com HTTP 200. Os bundles nativos foram compilados, mas a execução visual em emulador/dispositivo ainda depende de instalar o Android Studio ou conectar um aparelho com Expo Go, conforme este guia.

## 17. Histórico

| Versão | Data | Responsável | Alteração |
|---|---|---|---|
| 0.1.0 | 02/08/2026 | Equipe Rotinaê | Preparação inicial do ambiente universal Expo, tela responsiva, comandos, validações e guia multiplataforma |
| 0.2.0 | 04/08/2026 | Equipe Rotinaê | Referência adicionada para as diferenças de navegação e rodapé entre web, Android e iOS |
