# Rotinaê

**Sua rotina de atendimentos em um só lugar.**

O Rotinaê é um aplicativo em React Native (Expo) para prestadores de serviço, como adestradores de cães, organizarem a rotina: agenda, clientes, serviços e pagamentos em um só app. Ele funciona no Android, no iPhone e no navegador.

## Trabalho final: Desenvolvimento Mobile

- **Professor:** Filipe Lopes
- **Integrantes:** Ana Eduarda, Anette Stefany, Clarice Christine e Joelma Giovanna

O app base foi criado anteriormente para outros projetos e, com autorização do professor, foi usado como ponto de partida. O trabalho do grupo foi desenvolver os conteúdos da disciplina que ainda faltavam, organizando tudo em Git Flow.

### O que o grupo desenvolveu

| Funcionalidade | Conteúdo da aula | Issue | Responsável |
| --- | --- | --- | --- |
| Configuração do Git Flow, da CI e das dependências | Versionamento | #1 | Ana Eduarda |
| Módulo único do SecureStore (token de login) | Persistência de dados | #3 | Ana Eduarda |
| Saída segura da conta (logout que limpa o aparelho) | Persistência e ciclo de vida | #4 | Ana Eduarda |
| Helper do AsyncStorage e migração do armazenamento simples | Persistência de dados | #6 | Anette |
| Seção "Preferências do app" | Persistência de dados | #7 | Anette |
| Banco SQLite para os atendimentos | Persistência de dados | #9 | Clarice |
| Agenda offline (mostra a agenda salva sem internet) | Persistência e web services | #10 | Clarice |
| Lembrete local antes de cada atendimento | Notificações | #11 | Joelma |
| Cancelar e reagendar o lembrete, botões "Adiar" e "Ok" | Notificações | #12 | Joelma |

### Onde cada conteúdo do bimestre aparece

| Conteúdo | No Rotinaê |
| --- | --- |
| Componentes e props | Botões e campos reutilizados em várias telas |
| Navegação | Pilha (clientes → detalhes), abas (barra inferior) e modais |
| Formulários | Teclado certo em cada campo, senha escondida, teclado não cobre o campo |
| Ciclo de vida | Telas buscam dados ao abrir e ao voltar; o app renova o login ao voltar do segundo plano e desloga por inatividade |
| Web services | Supabase (dados e login) e Mercado Pago (assinatura), com carregamento e tratamento de erro |
| Notificações | Interna (janelas de confirmação), central no app (sininho), remota (push) e local (lembrete) |
| AsyncStorage | Preferências do app |
| SecureStore | Token de login |
| SQLite | Agenda offline |
| Git e Git Flow | Issues, branches, Pull Requests com revisão e testes automáticos |

## Tecnologias

- Expo SDK 54, React Native 0.81 e TypeScript
- Expo Router (navegação)
- Supabase (banco de dados e autenticação)
- expo-notifications, AsyncStorage, expo-secure-store e expo-sqlite
- Jest (testes) e GitHub Actions (CI)

## Como rodar

1. Dentro de `apps/agendae`, crie o arquivo `.env.local` a partir do `.env.example`, com a URL e a chave **anon/public** do Supabase. Esse arquivo nunca vai para o GitHub.
2. Instale as dependências:

   ```bash
   cd apps/agendae
   npm ci
   ```

3. Rode o app:

   ```bash
   npx expo start --tunnel
   ```

4. Escaneie o QR code com o **Expo Go na versão do SDK 54**.

Observações:
- No Expo Go, a notificação push e o login com Google não funcionam; para isso, use o APK.
- Para ver no navegador: `npx expo start --web`.

## Testes e verificações

```bash
npm run lint
npm run typecheck
npm test
```

A CI do GitHub roda essas verificações em todo Pull Request para `develop` e `main`.

## Como trabalhamos (Git Flow)

- **main:** versão entregue, marcada com tag (ex.: `v1.1.0`)
- **develop:** onde o trabalho de todas se junta
- **feature/número-da-tarefa:** uma branch por Issue, criada a partir da `develop`
- **release/1.1.0:** preparação da versão de entrega

Fluxo de cada tarefa: Issue → branch → commits → Pull Request para a `develop` → revisão de outra integrante → testes automáticos → merge.
