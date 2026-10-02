# Navegação e diferenças entre web e app

> Estado em 04/08/2026: comportamento implementado no frontend universal Expo.

## 1. Objetivo

O Rotinaê compartilha rotas, componentes e regras de negócio entre web, Android e iOS. A navegação autenticada, porém, segue o padrão de interação de cada plataforma.

Um navegador em largura de celular continua sendo **web**. As diferenças descritas aqui são determinadas por `Platform.OS`, e não apenas pelo breakpoint visual.

## 2. Comportamento por plataforma

| Elemento | Web desktop ou responsiva | Android e iOS |
|---|---|---|
| Cabeçalho autenticado | Logo, sino de notificações e avatar | Logo e botão hambúrguer |
| Navegação principal do cabeçalho | Menus flutuantes de notificações e perfil | Menu em tela cheia aberto pelo hambúrguer |
| Notificações | Menu próprio aberto pelo sino | Seção dentro do menu hambúrguer, com contador de não lidas |
| Saída da conta | Item no menu do perfil | Ação fixa ao final do menu hambúrguer |
| Rodapé institucional | Visível nas telas que o possuem | Não renderizado |
| Abas inferiores mobile | Podem aparecer conforme o breakpoint da tela | Permanecem disponíveis nas áreas Cliente e Prestador |

O app nativo não deve renderizar os pop-ups de perfil e notificações usados no navegador. O menu nativo ocupa a tela, respeita a área segura do aparelho, pode ser fechado pelo botão de fechar ou pelo botão de retorno do Android e encerra ao navegar para outra rota.

## 3. Rotas por perfil no menu nativo

### Prestador

- Início;
- Agenda;
- Clientes;
- Financeiro;
- Planos;
- Alternar ou criar perfil;
- Configurações;
- Manual de uso.

### Cliente

- Início;
- Prestadores;
- Agendar;
- Alternar ou criar perfil;
- Configurações;
- Manual de uso.

### Administrador

- Administrar usuários.

Todos os perfis autenticados possuem a ação **Sair da conta**. As notificações demonstrativas atuais pertencem ao perfil Prestador; o backend deverá fornecer a lista e a contagem reais respeitando o perfil ativo.

## 4. Referência de implementação

O comportamento central está em:

- `apps/agendae/src/components/layout/authenticated-header.tsx`;
- `apps/agendae/src/components/ui/app-icon.tsx`.

Novas telas autenticadas devem usar `AuthenticatedHeader`. Não devem criar outro menu de perfil ou outro menu hambúrguer local.

Rodapés de páginas compartilhadas devem ser exclusivos da web:

```tsx
{Platform.OS === "web" && <View style={styles.footer}>{/* conteúdo */}</View>}
```

Não usar apenas `wide`, `useWindowDimensions` ou breakpoint para essa decisão, pois o navegador responsivo deve continuar exibindo o comportamento web e um tablet nativo deve continuar exibindo o comportamento do app.

Ao adicionar uma rota autenticada, atualizar a coleção `menuItems` do cabeçalho quando ela precisar ficar disponível no menu global. A lista deve continuar sendo filtrada pelo perfil ativo e pelo acesso administrativo.

## 5. Critérios de aceite

### Web

- rodapé institucional continua visível onde foi definido;
- sino abre notificações e avatar abre o menu do perfil;
- clique fora fecha os menus flutuantes;
- navegador em largura mobile não assume o menu nativo.

### Android e iOS

- nenhum rodapé institucional é renderizado;
- somente o hambúrguer é usado como entrada do menu autenticado;
- não existem menus flutuantes de perfil ou notificações;
- o menu apresenta apenas as rotas autorizadas para o perfil atual;
- notificações, marcação como lida e contador funcionam dentro do menu;
- navegar ou sair da conta fecha o menu;
- no Android, o botão de retorno fecha o menu antes de sair da tela;
- cabeçalho e menu respeitam a área segura do aparelho.

## 6. Validação

Após a implementação, foram aprovados:

- TypeScript sem erros;
- lint sem erros;
- 39 testes unitários em 8 suítes;
- verificação de whitespace do diff.

A inspeção visual ainda deve ser repetida em pelo menos um Android e um iPhone antes da publicação. No Windows, a validação de iOS depende de aparelho físico, build em nuvem ou Mac com Xcode.
