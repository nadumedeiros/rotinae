import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthenticatedHeader } from "@/src/components/layout/authenticated-header";
import { MobileTabBar } from "@/src/components/layout/mobile-tab-bar";
import { ClientMobileTabBar } from "@/src/components/layout/client-mobile-tab-bar";
import { AppIcon, type AppIconName } from "@/src/components/ui/app-icon";
import { supabaseAuthService as authService } from "@/src/infra/auth/supabase-auth-adapter";
import type { UserRole } from "@/src/domain/auth/types";
import {
  breakpoints,
  colors,
  elevation,
  layout,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";

type Topic = { title: string; summary: string; steps: string[]; tip?: string };
type ManualPage = {
  id: string;
  title: string;
  icon: AppIconName;
  description: string;
  route?: string;
  topics: Topic[];
};

const pages: ManualPage[] = [
  {
    id: "inicio",
    title: "Início",
    icon: "home",
    route: "/dashboard",
    description: "Visão geral da rotina, atalhos, notificações e navegação.",
    topics: [
      {
        title: "Entender os indicadores",
        summary: "Leia clientes, agenda, atendimentos e saldo do período.",
        steps: [
          "Confira o título e o valor de cada KPI.",
          "No celular, deslize os cartões horizontalmente.",
          "Use os pontos abaixo para identificar a posição no carrossel.",
        ],
      },
      {
        title: "Consultar a agenda do dia",
        summary: "Veja rapidamente os próximos compromissos.",
        steps: [
          "Localize o horário e o nome do cliente.",
          "Confira serviço e situação.",
          "Toque em Ver agenda completa para abrir todos os registros.",
        ],
      },
      {
        title: "Usar menus e atalhos",
        summary: "Acesse qualquer área sem voltar à tela inicial.",
        steps: [
          "O sino abre as notificações.",
          "Uma notificação leva diretamente à página relacionada.",
          "O perfil abre Início, Agenda, Clientes, Financeiro, Configurar perfil e Manual.",
          "No celular, Novo permite criar cliente, agendamento ou pagamento.",
        ],
      },
      {
        title: "Preencher formulários com segurança",
        summary: "Evite perder informações digitadas por um toque acidental.",
        steps: [
          "Modais de cadastro e edição não fecham ao clicar fora.",
          "Use o X para sair sem concluir.",
          "Use Cancelar quando essa ação estiver disponível.",
          "Revise os dados e use o botão principal para salvar.",
        ],
        tip: "Seletores, menus e avisos simples podem fechar ao clicar fora porque não mantêm dados de formulário.",
      },
    ],
  },
  {
    id: "servicos",
    title: "Serviços",
    icon: "services",
    route: "/services",
    description: "Catálogo de serviços, durações padrão, valores de referência e serviço padrão.",
    topics: [
      {
        title: "Serviço padrão já criado (Atendimento)",
        summary: "Você já começa com um serviço pronto para uso imediato.",
        steps: [
          "Todo prestador já possui o serviço 'Atendimento' (60 min · R$ 0,00) cadastrado automaticamente.",
          "Você pode utilizá-lo direto na Agenda para marcar horários sem precisar criar nada antes.",
          "Se desejar, use o botão Editar para ajustar a duração ou o valor do seu Atendimento.",
        ],
        tip: "O serviço padrão economiza tempo e permite que novos prestadores comecem a agendar no primeiro minuto.",
      },
      {
        title: "Cadastrar novos serviços",
        summary: "Crie o catálogo de serviços que você oferece aos clientes.",
        steps: [
          "Toque em Novo serviço no canto superior ou pelo atalho do menu.",
          "Informe o nome do serviço (ex.: Consulta, Aula de Pilates, Corte de Cabelo, Avaliação).",
          "Defina a duração em minutos (usada como base para calcular os horários na agenda).",
          "Informe o valor de referência em Reais (R$).",
          "Revise e toque em Salvar.",
        ],
      },
      {
        title: "Editar ou desativar serviços",
        summary: "Mantenha seu catálogo atualizado sem afetar o histórico passado.",
        steps: [
          "No computador, use o botão Editar para alterar nome, duração ou valor.",
          "No celular, toque no botão de três pontinhos (⋮) para abrir as opções de edição ou desativação.",
          "Use o botão Desativar para retirar o serviço da oferta ativa de novos agendamentos.",
          "Serviços desativados não são excluídos e podem ser reativados a qualquer momento pelo botão Ativar.",
        ],
        tip: "Desativar um serviço nunca apaga ou altera agendamentos já criados no passado com aquele serviço.",
      },
      {
        title: "Diferença entre Serviço e Tipo de Agendamento",
        summary: "Entenda como o catálogo se relaciona com Atendimentos e Aulas.",
        steps: [
          "O Catálogo de Serviços define O QUE você faz, o tempo padrão e o preço.",
          "Na Agenda, você escolhe COMO atender: individual (Atendimento) ou em turma (Aula).",
          "Ao criar o agendamento, selecione o serviço do catálogo para que duração e valor sejam preenchidos automaticamente.",
        ],
      },
    ],
  },
  {
    id: "clientes",
    title: "Clientes",
    icon: "clients",
    route: "/clients",
    description: "Cadastro, regras de agenda, vínculo e página individual.",
    topics: [
      {
        title: "Cadastrar um cliente",
        summary: "Crie o cadastro e as regras exclusivas de atendimento.",
        steps: [
          "Toque em Novo cliente.",
          "Preencha nome, e-mail e telefone com DDD.",
          "Escolha se o convite com o código de vínculo será enviado por e-mail ao cadastrar.",
          "Informe o valor do serviço.",
          "Defina limite diário, total permitido e período para solicitações.",
          "Ative Agenda livre nos limites que não devem ser aplicados.",
          "Revise e salve.",
        ],
        tip: "Se o limite total for 1, o cliente poderá manter apenas uma marcação dentro da regra configurada.",
      },
      {
        title: "Editar ou abrir o prontuário",
        summary: "O lápis edita; a seta abre a página exclusiva.",
        steps: [
          "Use o lápis para alterar o cadastro.",
          "Use a seta ou toque na linha para abrir o cliente.",
          "Na página individual, consulte dados e registre anotações do caso.",
        ],
      },
      {
        title: "Vincular por código",
        summary: "O cliente solicita acesso e o prestador decide.",
        steps: [
          "Copie o Código de vínculo.",
          "Envie-o ao cliente.",
          "Aguarde a solicitação aparecer.",
          "Aprove ou rejeite manualmente.",
        ],
        tip: "O código nunca libera acesso automaticamente. Gerar um novo código invalida o anterior.",
      },
      {
        title: "Evitar cliente duplicado no vínculo",
        summary: "Associe a conta ao cadastro que você já criou.",
        steps: [
          "Quando o cliente usar o código, o sistema procura dentro da sua carteira um cadastro com o mesmo e-mail verificado.",
          "Se houver uma única correspondência segura, a aprovação associa a conta ao cadastro existente.",
          "Agenda, pagamentos, limites, serviço e anotações permanecem no mesmo histórico.",
          "Se apenas o telefone coincidir ou houver mais de um cadastro possível, revise manualmente antes de aprovar.",
          "Se o cadastro já estiver associado a outra conta, a operação será bloqueada e exibirá o conflito.",
          "Sem correspondência, a aprovação poderá criar um novo cadastro vinculado.",
        ],
        tip: "Nome ou telefone isolados nunca devem mesclar clientes automaticamente.",
      },
      {
        title: "Gerenciar muitas solicitações",
        summary: "Duas ficam visíveis e as demais permanecem no modal.",
        steps: [
          "Consulte as duas solicitações mais recentes no cartão.",
          "Toque para abrir todas quando houver mais registros.",
          "Aprove ou rejeite cada solicitação no modal.",
        ],
      },
      {
        title: "Buscar e paginar",
        summary: "Encontre registros em listas maiores.",
        steps: [
          "Digite nome ou contato na busca.",
          "Aplique os filtros disponíveis.",
          "Navegue pelas páginas; são exibidos até 10 clientes por página.",
        ],
      },
    ],
  },
  {
    id: "agenda",
    title: "Agenda",
    icon: "calendar",
    route: "/agenda",
    description: "Compromissos únicos, recorrentes, confirmações e calendário.",
    topics: [
      {
        title: "Criar um agendamento",
        summary: "Registre cliente, serviço, data e horário.",
        steps: [
          "Toque em Novo agendamento.",
          "Selecione o cliente.",
          "Preencha serviço, data, horário de início e valor.",
          "Escreva a mensagem visível ao cliente em Observação para o cliente.",
          "Use Observação interna para informações privadas.",
          "Revise e salve.",
        ],
      },
      {
        title: "Criar uma recorrência",
        summary: "Selecione vários dias para o mesmo atendimento.",
        steps: [
          "Em Agendamento recorrente, toque em Sim.",
          "Aguarde o calendário expandir dentro do modal.",
          "Marque de 2 a 24 datas.",
          "As datas usarão o mesmo cliente, serviço e horário.",
          "Confirme e salve a sequência.",
        ],
      },
      {
        title: "Bloquear um período da agenda",
        summary:
          "Impeça novas solicitações de clientes durante uma indisponibilidade.",
        steps: [
          "Toque em Bloquear agenda.",
          "Informe data e horário de início.",
          "Informe data e horário de fim.",
          "Adicione um motivo opcional e confirme.",
          "Se houver compromissos anteriores no intervalo, leia o aviso e escolha revisar ou bloquear mesmo assim.",
          "Durante o bloqueio, clientes não poderão solicitar horários no intervalo.",
          "Se necessário, você poderá cadastrar manualmente um compromisso dentro do período bloqueado e confirmar a exceção no modal.",
        ],
        tip: "O bloqueio nunca cancela compromissos anteriores. Qualquer cancelamento deve ser feito manualmente pelo prestador.",
      },
      {
        title: "Entender avisos de bloqueio",
        summary: "Saiba como o sistema reage em cada cenário.",
        steps: [
          "Datas ou horários incompletos abrem um modal para correção.",
          "Um fim anterior ou igual ao início é recusado.",
          "Se já houver compromissos, o modal informa que eles serão preservados.",
          "Ao concluir, o modal confirma que o bloqueio vale somente para solicitações dos clientes.",
          "Ao criar manualmente dentro do bloqueio, confirme Adicionar mesmo assim ou escolha outro horário.",
          "Conflitos com outro compromisso no mesmo horário continuam proibidos.",
        ],
      },
      {
        title: "Confirmar manualmente",
        summary: "Confirme quando o cliente não responder.",
        steps: [
          "Localize o compromisso A confirmar.",
          "Abra as ações do registro.",
          "Escolha confirmação manual.",
          "Confirme a decisão; o histórico indicará que foi uma ação do prestador.",
        ],
      },
      {
        title: "Cancelar sem apagar o histórico",
        summary: "Libere o horário mantendo o registro para consulta.",
        steps: [
          "Localize o compromisso na visualização em lista.",
          "Toque no ícone de cancelar ao lado das ações.",
          "Se desejar, escreva um motivo para a outra parte.",
          "Revise o aviso e confirme o cancelamento.",
          "O compromisso permanecerá visível com status Cancelado e o horário ficará disponível novamente.",
        ],
        tip: "O motivo é opcional e visível à outra parte: prestador informa ao cliente e cliente informa ao prestador. Use a lixeira somente para corrigir um registro criado por engano.",
      },
      {
        title: "Lista, calendário e filtros",
        summary: "Alterne a visualização conforme a tarefa.",
        steps: [
          "Use Lista para editar e acompanhar cada compromisso.",
          "Use Calendário para visualizar dias ocupados.",
          "Toque em um dia para filtrar.",
          "Escolha mês e ano ou somente o ano.",
          "Selecione uma situação no campo de status.",
          "Use a paginação para navegar de 10 em 10 itens.",
        ],
      },
    ],
  },
  {
    id: "financeiro",
    title: "Financeiro",
    icon: "financial",
    route: "/payments",
    description: "Lançamentos, recebimentos parciais, saldos e consultas.",
    topics: [
      {
        title: "Registrar um pagamento",
        summary: "Crie um lançamento de controle interno.",
        steps: [
          "Toque em Novo pagamento.",
          "Selecione o cliente.",
          "Informe serviço ou origem, valor e vencimento em DD/MM/AAAA.",
          "Escolha Pendente ou Recebido.",
          "Adicione uma observação, se necessário, e salve.",
        ],
        tip: "O Rotinaê não realiza cobrança nem movimentação bancária.",
      },
      {
        title: "Registrar pagamento parcial",
        summary: "Baixe uma parte e recalcule o saldo.",
        steps: [
          "Clique no lápis do lançamento.",
          "Informe o valor recebido.",
          "Confirme a baixa parcial.",
          "O sistema cria uma linha para o valor quitado e mantém o saldo restante como pendente.",
        ],
      },
      {
        title: "Editar ou excluir",
        summary: "Corrija registros feitos de maneira incorreta.",
        steps: [
          "Use o lápis na própria linha para editar.",
          "Use a lixeira para excluir.",
          "Leia a confirmação antes de concluir uma exclusão.",
        ],
      },
      {
        title: "KPIs, busca e período",
        summary: "Consulte resultados financeiros específicos.",
        steps: [
          "Confira Valores recebidos, Valores a receber e Total de pendentes.",
          "Busque por cliente ou serviço.",
          "Filtre por status.",
          "Escolha mês e ano ou deixe o mês vazio para consultar somente o ano.",
          "O mês atual vem selecionado na primeira abertura.",
        ],
      },
    ],
  },
  {
    id: "configuracoes",
    title: "Configurar perfil",
    icon: "user",
    route: "/settings",
    description: "Perfil profissional, disponibilidade e preferências.",
    topics: [
      {
        title: "Atualizar o perfil",
        summary: "Mantenha os dados profissionais corretos.",
        steps: [
          "Abra Configurar perfil pelo menu.",
          "Revise nome de exibição, telefone e dados profissionais.",
          "Salve e aguarde a mensagem de confirmação.",
        ],
      },
      {
        title: "Definir regras padrão",
        summary: "Configure disponibilidade e antecedência.",
        steps: [
          "Informe o horário padrão de atendimento.",
          "Defina a antecedência mínima.",
          "Configure o período de solicitações com datas em DD/MM/AAAA.",
          "Salve as regras.",
        ],
      },
      {
        title: "Escolher notificações",
        summary: "Controle quais eventos geram alertas.",
        steps: [
          "Abra as preferências de notificação.",
          "Ative ou desative vínculos, confirmações e mudanças de agenda.",
          "Salve as preferências.",
        ],
      },
      {
        title: "Alternar ou criar perfil",
        summary: "Use a mesma conta como Cliente e Prestador.",
        steps: [
          "Abra o menu do perfil no header.",
          "Toque em Alternar ou criar perfil.",
          "Se o perfil já existir, escolha Alternar perfil.",
          "Se ainda não existir, escolha Criar perfil.",
          "O sistema abrirá o início correspondente ao contexto selecionado.",
        ],
        tip: "A identidade e o e-mail são os mesmos, mas permissões e dados operacionais permanecem separados por perfil.",
      },
    ],
  },
  {
    id: "erros",
    title: "Erros e segurança",
    icon: "security",
    description: "Validações, privacidade, limites e recuperação de falhas.",
    topics: [
      {
        title: "Corrigir um formulário",
        summary: "Entenda mensagens de validação.",
        steps: [
          "Leia o campo indicado no modal.",
          "Corrija valores, datas ou campos obrigatórios.",
          "Tente novamente; os dados digitados devem permanecer preenchidos.",
        ],
      },
      {
        title: "Falha de conexão ou servidor",
        summary: "Recupere a operação sem perder o trabalho.",
        steps: [
          "Mantenha o modal aberto e confira a mensagem.",
          "Verifique sua conexão.",
          "Feche o aviso e tente salvar novamente.",
          "Se a sessão expirou, entre novamente antes de continuar.",
        ],
      },
      {
        title: "Privacidade das observações",
        summary: "Separe conteúdo externo e interno.",
        steps: [
          "Use o campo para o cliente somente para mensagens que ele pode ler.",
          "Use Observação interna para informações privadas.",
          "Revise o campo antes de salvar.",
        ],
      },
      {
        title: "Bloqueios de agenda",
        summary: "Saiba por que uma solicitação pode ser recusada.",
        steps: [
          "Confira se a data está no período permitido.",
          "Verifique o limite por dia.",
          "Confira o total de agendamentos autorizado.",
          "Valide se o dia ou horário está disponível.",
        ],
      },
    ],
  },
];

const clientPages: ManualPage[] = [
  {
    id: "cliente-inicio",
    title: "Início",
    icon: "home",
    route: "/client-home",
    description:
      "Próximos atendimentos, prestador ativo e solicitações.",
    topics: [
      {
        title: "Usar a Home do cliente",
        summary: "Acompanhe somente os dados do seu perfil cliente.",
        steps: [
          "Confira o prestador em uso.",
          "Veja até três próximos atendimentos.",
          "Consulte solicitações de vínculo pendentes.",
          "Use Ver todos para abrir a lista completa.",
        ],
      },
      {
        title: "Trocar o prestador em uso",
        summary: "Mude o contexto sem misturar informações.",
        steps: [
          "Escolha um prestador no carrossel.",
          "A Home atualiza a agenda de atendimentos para esse vínculo.",
          "Use Ver todos os prestadores para consultar todos os vínculos.",
        ],
      },
    ],
  },
  {
    id: "cliente-prestadores",
    title: "Prestadores",
    icon: "provider",
    route: "/client-providers",
    description: "Vínculos ativos e solicitações por código.",
    topics: [
      {
        title: "Adicionar um prestador",
        summary: "Solicite um vínculo usando o código recebido.",
        steps: [
          "Abra Prestadores.",
          "Digite o código enviado pelo profissional.",
          "Envie a solicitação.",
          "Aguarde a aprovação; o código não libera acesso automaticamente.",
        ],
      },
      {
        title: "Entender a separação dos vínculos",
        summary: "Cada prestador controla os próprios serviços e regras.",
        steps: [
          "Agenda, serviços e disponibilidade pertencem ao prestador selecionado.",
          "Trocar o contexto não transfere regras ou informações entre profissionais.",
          "Uma solicitação pendente ainda não permite agendar.",
        ],
      },
    ],
  },
  {
    id: "cliente-agendamento",
    title: "Agendamento",
    icon: "calendar",
    route: "/client-booking",
    description: "Escolha de dias e horários conforme as regras do prestador.",
    topics: [
      {
        title: "Agendar em vagas publicadas",
        summary: "Escolha somente os dias e horários publicados.",
        steps: [
          "Selecione o prestador.",
          "No calendário, escolha um dia habilitado.",
          "Selecione um dos horários publicados.",
          "Adicione à seleção e repita enquanto houver saldo.",
          "Revise e confirme todos os agendamentos.",
        ],
      },
      {
        title: "Agendar pela disponibilidade do perfil",
        summary: "Use os dias e horários liberados pelo prestador.",
        steps: [
          "Selecione um dia útil habilitado.",
          "Escolha um horário gerado dentro da jornada.",
          "Dias bloqueados, conflitos e intervalos não aparecem como opção.",
          "Navegue entre meses sem perder sua seleção.",
        ],
      },
      {
        title: "Entender limites e exceções",
        summary: "Saiba por que uma escolha pode ser recusada.",
        steps: [
          "O número de agendamentos permitidos depende das regras e limites individuais definidos pelo prestador.",
          "O mesmo horário não pode ser adicionado duas vezes.",
          "Uma vaga ocupada durante a confirmação precisa ser substituída.",
          "Dias e horários fora da regra ficam desabilitados.",
          "Cada confirmação gera uma notificação para o prestador.",
        ],
        tip: "Na versão local, as notificações ficam neste navegador. Entrega push depende do backend.",
      },
    ],
  },
  {
    id: "cliente-seguranca",
    title: "Ajuda e segurança",
    icon: "security",
    description: "Validações, privacidade e recuperação.",
    topics: [
      {
        title: "Resolver uma falha de agendamento",
        summary: "Revise a mensagem sem perder as outras escolhas.",
        steps: [
          "Leia o aviso exibido no modal.",
          "Escolha outro dia ou horário quando a vaga estiver ocupada.",
          "Remova uma escolha do resumo se precisar liberar saldo.",
          "Tente confirmar novamente.",
        ],
      },
    ],
  },
];

export default function ManualScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const [activeRole, setActiveRole] = useState<UserRole>("provider");
  const manualPages = activeRole === "client" ? clientPages : pages;
  const [query, setQuery] = useState("");
  const [activePage, setActivePage] = useState(pages[0].id);
  const [openTopics, setOpenTopics] = useState<string[]>([`${pages[0].id}-0`]);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

  useEffect(() => {
    authService.getSession().then((session) => {
      const role = session?.user.activeRole ?? "provider";
      setActiveRole(role);
      const first = role === "client" ? clientPages[0].id : pages[0].id;
      setActivePage(first);
      setOpenTopics([`${first}-0`]);
    });
  }, []);

  const visiblePages = useMemo(() => {
    if (!normalizedQuery)
      return manualPages.filter((page) => page.id === activePage);
    return manualPages
      .map((page) => ({
        ...page,
        topics: page.topics.filter((topic) =>
          `${page.title} ${topic.title} ${topic.summary} ${topic.steps.join(" ")}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedQuery),
        ),
      }))
      .filter((page) => page.topics.length);
  }, [activePage, manualPages, normalizedQuery]);

  function selectPage(id: string) {
    setQuery("");
    setActivePage(id);
    setOpenTopics([`${id}-0`]);
  }

  function toggleTopic(key: string) {
    setOpenTopics((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AuthenticatedHeader />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>CENTRAL DE AJUDA</Text>
            <Text
              accessibilityRole="header"
              style={[styles.title, !wide && styles.titleMobile]}
            >
              Como podemos ajudar?
            </Text>
            <Text style={styles.description}>
              Escolha uma página ou busque uma funcionalidade específica.
            </Text>
          </View>
          <View style={styles.search}>
            <AppIcon name="search" size={20} color={colors.mutedSoft} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Ex.: pagamento parcial, vínculo, recorrência"
              placeholderTextColor={colors.mutedSoft}
              style={styles.searchInput}
            />
            {!!query && (
              <Pressable
                accessibilityLabel="Limpar busca"
                onPress={() => setQuery("")}
              >
                <AppIcon name="error" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>

          <View style={[styles.manualLayout, wide && styles.manualLayoutWide]}>
            <ScrollView
              horizontal={!wide}
              showsHorizontalScrollIndicator={false}
              style={styles.navigationViewport}
              contentContainerStyle={[
                styles.navigation,
                !wide && styles.navigationMobile,
              ]}
            >
              <Text style={styles.navigationLabel}>PÁGINAS</Text>
              {manualPages.map((page) => {
                const active = page.id === activePage && !normalizedQuery;
                return (
                  <Pressable
                    key={page.id}
                    onPress={() => selectPage(page.id)}
                    style={[
                      styles.navItem,
                      !wide && styles.navItemMobile,
                      active && styles.navItemActive,
                    ]}
                  >
                    <AppIcon
                      name={page.icon}
                      size={20}
                      color={active ? colors.onBrand : colors.brand}
                    />
                    <Text
                      style={[styles.navText, active && styles.navTextActive]}
                    >
                      {page.title}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.article}>
              {normalizedQuery && (
                <Text style={styles.resultCount}>
                  {visiblePages.reduce(
                    (total, page) => total + page.topics.length,
                    0,
                  )}{" "}
                  resultado(s) para “{query.trim()}”
                </Text>
              )}
              {visiblePages.map((page) => (
                <View key={page.id} style={styles.pageSection}>
                  <View style={styles.pageHeader}>
                    <View style={styles.pageIcon}>
                      <AppIcon
                        name={page.icon}
                        size={24}
                        color={colors.brand}
                      />
                    </View>
                    <View style={styles.pageHeaderCopy}>
                      <Text style={styles.pageTitle}>{page.title}</Text>
                      <Text style={styles.pageDescription}>
                        {page.description}
                      </Text>
                    </View>
                    {page.route && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => router.push(page.route as never)}
                        style={styles.openPage}
                      >
                        <Text style={styles.openPageText}>Abrir página</Text>
                        <AppIcon
                          name="forward"
                          size={16}
                          color={colors.brand}
                        />
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.topicList}>
                    {page.topics.map((topic, index) => {
                      const key = `${page.id}-${index}`;
                      const open = normalizedQuery
                        ? true
                        : openTopics.includes(key);
                      return (
                        <View
                          key={topic.title}
                          style={[styles.topic, open && styles.topicOpen]}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ expanded: open }}
                            onPress={() => toggleTopic(key)}
                            style={styles.topicButton}
                          >
                            <View style={styles.topicNumber}>
                              <Text style={styles.topicNumberText}>
                                {index + 1}
                              </Text>
                            </View>
                            <View style={styles.topicCopy}>
                              <Text style={styles.topicTitle}>
                                {topic.title}
                              </Text>
                              <Text style={styles.topicSummary}>
                                {topic.summary}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.chevron,
                                open && styles.chevronOpen,
                              ]}
                            >
                              <AppIcon
                                name="forward"
                                size={16}
                                color={colors.mutedSoft}
                              />
                            </View>
                          </Pressable>
                          {open && (
                            <View style={styles.topicBody}>
                              {topic.steps.map((step, stepIndex) => (
                                <View key={step} style={styles.step}>
                                  <Text style={styles.stepIndex}>
                                    {stepIndex + 1}.
                                  </Text>
                                  <Text style={styles.stepText}>{step}</Text>
                                </View>
                              ))}
                              {topic.tip && (
                                <View style={styles.tip}>
                                  <AppIcon
                                    name="security"
                                    size={18}
                                    color={colors.brand}
                                  />
                                  <Text style={styles.tipText}>
                                    <Text style={styles.tipStrong}>
                                      Importante:{" "}
                                    </Text>
                                    {topic.tip}
                                  </Text>
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
              {!visiblePages.length && (
                <View style={styles.empty}>
                  <AppIcon name="search" size={32} color={colors.mutedSoft} />
                  <Text style={styles.emptyTitle}>Nada encontrado</Text>
                  <Text style={styles.pageDescription}>
                    Tente outro termo ou limpe a busca para navegar pelas
                    páginas.
                  </Text>
                  <Pressable
                    onPress={() => setQuery("")}
                    style={styles.clearButton}
                  >
                    <Text style={styles.clearButtonText}>Limpar busca</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
      {activeRole === "client" ? <ClientMobileTabBar /> : <MobileTabBar />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1 },
  content: {
    width: "100%",
    maxWidth: layout.contentMax,
    alignSelf: "center",
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heading: { gap: spacing.xs },
  eyebrow: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 1.2,
  },
  title: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 36,
  },
  titleMobile: { fontSize: 30 },
  description: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.bodyLarge,
  },
  search: {
    minHeight: 54,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  searchInput: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  manualLayout: { gap: spacing.md },
  manualLayoutWide: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.lg,
  },
  navigationViewport: { flexGrow: 0 },
  navigation: {
    width: 230,
    padding: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  navigationMobile: {
    width: "auto",
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.xs,
  },
  navigationLabel: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: 11,
    letterSpacing: 1,
  },
  navItem: {
    minHeight: 46,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.sm,
  },
  navItemMobile: { minHeight: 42, flexShrink: 0 },
  navItemActive: { backgroundColor: colors.brand },
  navText: {
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  navTextActive: { color: colors.onBrand },
  article: { flex: 1, minWidth: 0, gap: spacing.lg },
  resultCount: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  pageSection: { gap: spacing.lg },
  pageHeader: {
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  pageIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  pageHeaderCopy: { flex: 1, minWidth: 190 },
  pageTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 25,
  },
  pageDescription: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  openPage: {
    minHeight: 42,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  openPageText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  topicList: { gap: spacing.sm },
  topic: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  topicOpen: { borderColor: colors.borderStrong },
  topicButton: {
    minHeight: 78,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  topicNumber: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  topicNumberText: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
  },
  topicCopy: { flex: 1, minWidth: 0 },
  topicTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  topicSummary: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  chevron: { transform: [{ rotate: "90deg" }] },
  chevronOpen: { transform: [{ rotate: "-90deg" }] },
  topicBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stepIndex: {
    width: 22,
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  stepText: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  tip: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  tipText: {
    flex: 1,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  tipStrong: { color: colors.brandDark, fontFamily: typography.family.bold },
  empty: {
    minHeight: 260,
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.subtitle,
  },
  clearButton: {
    marginTop: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  clearButtonText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
  },
});
