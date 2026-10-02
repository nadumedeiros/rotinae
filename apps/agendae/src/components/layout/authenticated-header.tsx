import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabaseAuthService as authService } from "@/src/infra/auth/supabase-auth-adapter";
import type { UserRole } from "@/src/domain/auth/types";
import type { NotificationDestination, NotificationRecord } from "@/src/domain/notifications/types";
import { prepareNotificationNavigation } from "@/src/domain/notifications/notification-navigation";
import { notificationService } from "@/src/infra/notifications/supabase-notification-adapter";
import { pushRegistrationService } from "@/src/infra/notifications/push-registration";
import {
  breakpoints,
  colors,
  elevation,
  layout,
  radius,
  spacing,
  typography,
} from "@/src/theme/tokens";
import { AppIcon, type AppIconName } from "../ui/app-icon";
import {
  getAuthenticatedHeaderSurface,
  nativeOverlayPresentation,
} from "./authenticated-header-platform";

type HeaderNotification = {
  id: string;
  title: string;
  description: string;
  time: string;
  icon: AppIconName;
  route: NotificationDestination;
  read: boolean;
};

type HeaderMenuItem = {
  icon: AppIconName;
  label: string;
  route: string;
};

type HeaderCache = {
  activeRole: UserRole;
  isAdmin: boolean;
  displayName: string;
  notifications: HeaderNotification[];
  unreadCount: number;
};

// As telas autenticadas compartilham o mesmo cabeçalho. O cache em nível de
// módulo preserva o estado visual quando o Expo Router desmonta uma rota e
// monta a próxima, evitando nome/menu/notificações piscarem vazios.
let headerCache: HeaderCache | null = null;

const notificationIcons: Record<NotificationRecord["type"], AppIconName> = {
  appointment: "calendar",
  link: "clients",
  payment: "financial",
  account: "settings",
};

function toHeaderNotification(item: NotificationRecord): HeaderNotification {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    time: new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt)),
    icon: notificationIcons[item.type],
    route: item.destination,
    read: item.readAt !== null,
  };
}

export function AuthenticatedHeader() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.tablet;
  const headerSurface = getAuthenticatedHeaderSurface(Platform.OS);
  const usesNativeFullscreen = headerSurface === "native-fullscreen";
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [nativeMenuOpen, setNativeMenuOpen] = useState(false);
  const [nativeNotificationsOpen, setNativeNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<HeaderNotification[]>(() => headerCache?.notifications ?? []);
  const [unreadCount, setUnreadCount] = useState(() => headerCache?.unreadCount ?? 0);
  const [notificationsLoading, setNotificationsLoading] = useState(() => headerCache === null);
  const [notificationsError, setNotificationsError] = useState("");
  const [activeRole, setActiveRole] = useState<UserRole>(() => headerCache?.activeRole ?? "provider");
  const [isAdmin, setIsAdmin] = useState(() => headerCache?.isAdmin ?? false);
  const [displayName, setDisplayName] = useState(() => headerCache?.displayName ?? "");
  const visibleNotifications = notifications;
  const unread = unreadCount;
  const menuItems: HeaderMenuItem[] = [
    ...(isAdmin
      ? [
          {
            icon: "security" as const,
            label: "Administrar usuários",
            route: "/admin-users",
          },
        ]
      : []),
    {
      icon: "home",
      label: "Início",
      route: activeRole === "provider" ? "/dashboard" : "/client-home",
    },
    ...(activeRole === "provider"
      ? [
          { icon: "services" as const, label: "Serviços", route: "/services" },
          { icon: "calendar" as const, label: "Agenda", route: "/agenda" },
          { icon: "clients" as const, label: "Clientes", route: "/clients" },
          { icon: "financial" as const, label: "Financeiro", route: "/payments" },
          { icon: "packages" as const, label: "Planos", route: "/plans" },
        ]
      : [
          { icon: "provider" as const, label: "Prestadores", route: "/client-providers" },
          { icon: "calendar" as const, label: "Agendar", route: "/client-booking" },
        ]),
    { icon: "user", label: "Configurar perfil", route: "/settings" },
    { icon: "file", label: "Manual de uso", route: "/manual" },
  ];

  // BLG-075: assim como `loadPortfolio` em `app/clients.tsx`, este header é
  // montado em toda tela autenticada e tem duas fontes independentes que
  // podem acionar `loadNotifications` quase ao mesmo tempo (o listener de
  // `AppState` e o de push em primeiro plano); a trava evita sobrepor
  // requisições e amplificar uma falha persistente do backend em múltiplas
  // chamadas/erros simultâneos.
  const loadingNotificationsRef = useRef(false);
  const loadNotifications = useCallback(async () => {
    if (loadingNotificationsRef.current) return;
    loadingNotificationsRef.current = true;
    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const firstPage = await notificationService.listNotifications({ page: 1, pageSize: 10 });
      const nextNotifications = firstPage.items.map(toHeaderNotification);
      setNotifications(nextNotifications);
      setUnreadCount(firstPage.unreadCount);
      headerCache = {
        activeRole: headerCache?.activeRole ?? activeRole,
        isAdmin: headerCache?.isAdmin ?? isAdmin,
        displayName: headerCache?.displayName ?? displayName,
        notifications: nextNotifications,
        unreadCount: firstPage.unreadCount,
      };
    } catch (error) {
      setNotifications([]);
      setUnreadCount(0);
      setNotificationsError(error instanceof Error ? error.message : "Não foi possível carregar as notificações.");
    } finally {
      setNotificationsLoading(false);
      loadingNotificationsRef.current = false;
    }
  }, [activeRole, displayName, isAdmin]);

  useEffect(() => {
    authService.getSession().then((session) => {
      if (!session) return;
      const alreadyHydrated = headerCache !== null;
      setActiveRole(session.user.activeRole);
      setIsAdmin(Boolean(session.user.isAdmin));
      setDisplayName(session.user.displayName);
      headerCache = {
        activeRole: session.user.activeRole,
        isAdmin: Boolean(session.user.isAdmin),
        displayName: session.user.displayName,
        notifications: headerCache?.notifications ?? [],
        unreadCount: headerCache?.unreadCount ?? 0,
      };
      if (!alreadyHydrated) void loadNotifications();
    });
  }, [loadNotifications]);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadNotifications();
    });
    const removeForegroundListener = pushRegistrationService.subscribeToReceived(() => {
      void loadNotifications();
    });
    return () => {
      appStateSubscription.remove();
      removeForegroundListener();
    };
  }, [loadNotifications]);

  async function markAllNotificationsRead() {
    try {
      await notificationService.markAllAsRead();
      setNotifications((current) => {
        const next = current.map((item) => ({ ...item, read: true }));
        if (headerCache) headerCache = { ...headerCache, notifications: next, unreadCount: 0 };
        return next;
      });
      setUnreadCount(0);
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "Não foi possível atualizar as notificações.");
    }
  }

  async function clearAllNotifications() {
    try {
      await notificationService.clearNotifications();
      setNotifications([]);
      setUnreadCount(0);
      if (headerCache) headerCache = { ...headerCache, notifications: [], unreadCount: 0 };
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "Não foi possível limpar as notificações.");
    }
  }

  async function openNotification(item: HeaderNotification) {
    try {
      const nextRole = await prepareNotificationNavigation(authService, item.route);
      if (nextRole) {
        setActiveRole(nextRole);
        if (headerCache) headerCache = { ...headerCache, activeRole: nextRole };
      }
      if (!item.read) await notificationService.markAsRead(item.id);
      setNotifications((current) => {
        const next = current.map((notification) => notification.id === item.id ? { ...notification, read: true } : notification);
        if (headerCache) headerCache = { ...headerCache, notifications: next };
        return next;
      });
      if (!item.read) setUnreadCount((current) => {
        const next = Math.max(0, current - 1);
        if (headerCache) headerCache = { ...headerCache, unreadCount: next };
        return next;
      });
      navigateTo(item.route);
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "Não foi possível abrir a notificação.");
    }
  }

  async function leave() {
    setNativeMenuOpen(false);
    await pushRegistrationService.unregisterCurrentDevice().catch(() => undefined);
    await authService.signOut();
    headerCache = null;
    router.replace("/");
  }

  function navigateTo(route: string) {
    setProfileOpen(false);
    setNotificationsOpen(false);
    setNativeMenuOpen(false);
    setNativeNotificationsOpen(false);
    router.push(route as never);
  }

  return (
    <View style={styles.header}>
      {!usesNativeFullscreen && (profileOpen || notificationsOpen) && (
        <Pressable
          accessibilityLabel="Fechar menu"
          onPress={() => {
            setProfileOpen(false);
            setNotificationsOpen(false);
          }}
          style={styles.menuBackdrop}
        />
      )}
      <View style={[styles.headerInner, !wide && styles.headerInnerMobile]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ir para o início"
          onPress={() => {
            setProfileOpen(false);
            setNotificationsOpen(false);
            router.replace(isAdmin ? "/admin-users" : activeRole === "provider" ? "/dashboard" : "/client-home");
          }}
          style={styles.brandBlock}
        >
          <Text style={styles.logo}>
            rotina<Text style={styles.accent}>ê</Text>
          </Text>
        </Pressable>
        <View style={styles.actions}>
          {!usesNativeFullscreen ? (
            <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Notificações, ${unread} não lidas`}
            accessibilityState={{ expanded: notificationsOpen }}
            onPress={() => {
              if (!notificationsOpen) void loadNotifications();
              setNotificationsOpen((open) => !open);
              setProfileOpen(false);
            }}
            style={styles.notificationButton}
          >
            <AppIcon name="notifications" size={22} color={colors.brand} />
            {unread > 0 && <View style={styles.notificationDot} />}
          </Pressable>
          {notificationsOpen && (
            <View
              style={[
                styles.notificationsMenu,
                !wide && styles.notificationsMenuMobile,
              ]}
            >
              <View style={styles.menuHeader}>
                <View>
                  <Text style={styles.menuTitle}>Notificações</Text>
                  <Text style={styles.menuSubtitle}>
                    {unread ? `${unread} não lidas` : "Tudo em dia"}
                  </Text>
                </View>
                <View style={styles.menuHeaderActions}>
                  {unread > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Marcar todas como lidas"
                      onPress={() => void markAllNotificationsRead()}
                    >
                      <Text style={styles.markAll}>Marcar todas</Text>
                    </Pressable>
                  )}
                  {visibleNotifications.length > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Limpar notificações"
                      onPress={() => void clearAllNotifications()}
                    >
                      <Text style={styles.clearAll}>Limpar</Text>
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.notificationList}>
                {notificationsLoading && <Text style={styles.menuSubtitle}>Carregando notificações...</Text>}
                {!notificationsLoading && !!notificationsError && <Pressable onPress={() => void loadNotifications()}><Text style={styles.notificationError}>{notificationsError} Tentar novamente</Text></Pressable>}
                {!notificationsLoading && !notificationsError && visibleNotifications.length === 0 && <Text style={styles.menuSubtitle}>Nenhuma notificação por aqui ainda.</Text>}
                {visibleNotifications.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => void openNotification(item)}
                    style={[
                      styles.notificationItem,
                      !item.read && styles.notificationUnread,
                    ]}
                  >
                    <View style={styles.notificationIcon}>
                      <AppIcon
                        name={item.icon}
                        size={20}
                        color={colors.brand}
                      />
                    </View>
                    <View style={styles.notificationCopy}>
                      <View style={styles.notificationTitleRow}>
                        <Text style={styles.notificationTitle}>
                          {item.title}
                        </Text>
                        {!item.read && <View style={styles.unreadDot} />}
                      </View>
                      <Text style={styles.notificationDescription}>
                        {item.description}
                      </Text>
                      <Text style={styles.notificationTime}>{item.time}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir menu principal"
            accessibilityState={{ expanded: profileOpen }}
            onPress={() => {
              setProfileOpen((open) => !open);
              setNotificationsOpen(false);
            }}
            style={styles.avatar}
          >
            <AppIcon name="menu" size={24} color={colors.brand} />
          </Pressable>
          {profileOpen && (
            <View
              accessibilityRole="menu"
              style={[styles.profileMenu, !wide && styles.profileMenuMobile]}
            >
              <View style={styles.profileHeader}>
                <View style={styles.profileAvatar}>
                  <AppIcon name="user" size={20} color={colors.brand} />
                </View>
                <View>
                  <Text style={styles.profileName}>{displayName || "Minha conta"}</Text>
                  <Text style={styles.profileRole}>{isAdmin ? "Administrador" : activeRole === "provider" ? "Prestador" : "Cliente"}</Text>
                </View>
              </View>
              <View style={styles.divider} />
              {menuItems.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="menuitem"
                  onPress={() => {
                    navigateTo(item.route);
                  }}
                  style={styles.profileItem}
                >
                  <AppIcon name={item.icon} size={20} color={colors.brand} />
                  <Text style={styles.profileItemText}>{item.label}</Text>
                  <AppIcon name="forward" size={16} color={colors.mutedSoft} />
                </Pressable>
              ))}
              {!isAdmin && (
                <Pressable accessibilityRole="menuitem" onPress={() => navigateTo("/switch-profile")} style={styles.profileItem}>
                  <AppIcon name="provider" size={20} color={colors.brand} />
                  <Text style={styles.profileItemText}>Alternar conta</Text>
                  <AppIcon name="forward" size={16} color={colors.mutedSoft} />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="menuitem"
                onPress={leave}
                style={[styles.profileItem, styles.logoutItem]}
              >
                <AppIcon name="logout" size={20} color={colors.danger} />
                <Text style={styles.logoutText}>Sair da conta</Text>
              </Pressable>
            </View>
          )}
            </>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Notificações, ${unread} não lidas`}
                accessibilityState={{ expanded: nativeNotificationsOpen }}
                onPress={() => {
                  void loadNotifications();
                  setNativeNotificationsOpen(true);
                }}
                style={styles.hamburgerButton}
              >
                <AppIcon name="notifications" size={22} color={colors.brandDark} />
                {unread > 0 && <View style={styles.hamburgerBadge}><Text style={styles.hamburgerBadgeText}>{unread}</Text></View>}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir menu principal"
                accessibilityState={{ expanded: nativeMenuOpen }}
                onPress={() => setNativeMenuOpen(true)}
                style={[styles.hamburgerButton, styles.plainHamburgerButton]}
              >
                <AppIcon name="menu" size={24} color={colors.brandDark} />
              </Pressable>
            </>
          )}
        </View>
      </View>
      {usesNativeFullscreen && (
        <Modal
          animationType="slide"
          onRequestClose={() => setNativeMenuOpen(false)}
          presentationStyle={nativeOverlayPresentation}
          visible={nativeMenuOpen}
        >
          <SafeAreaView style={styles.nativeMenuSafe}>
            <View style={styles.nativeMenuHeader}>
              <Text style={styles.logo}>
                rotina<Text style={styles.accent}>ê</Text>
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar menu principal"
                onPress={() => setNativeMenuOpen(false)}
                style={styles.nativeCloseButton}
              >
                <AppIcon name="close" size={24} color={colors.brandDark} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.nativeMenuScroll}
              contentContainerStyle={styles.nativeMenuContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.profileHeader}>
                <View style={styles.profileAvatar}>
                  <AppIcon name="user" size={20} color={colors.brand} />
                </View>
                <View>
                  <Text style={styles.profileName}>{displayName || "Minha conta"}</Text>
                  <Text style={styles.profileRole}>
                    {isAdmin ? "Administrador" : activeRole === "provider" ? "Prestador" : "Cliente"}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />
              <Text style={styles.nativeSectionLabel}>NAVEGAÇÃO</Text>
              {menuItems.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  onPress={() => navigateTo(item.route)}
                  style={styles.nativeMenuItem}
                >
                  <View style={styles.nativeMenuIcon}>
                    <AppIcon name={item.icon} size={20} color={colors.brand} />
                  </View>
                  <Text style={styles.profileItemText}>{item.label}</Text>
                  <AppIcon name="forward" size={16} color={colors.mutedSoft} />
                </Pressable>
              ))}
              {!isAdmin && (
                <Pressable accessibilityRole="button" onPress={() => navigateTo("/switch-profile")} style={styles.nativeMenuItem}>
                  <View style={styles.nativeMenuIcon}><AppIcon name="provider" size={20} color={colors.brand} /></View>
                  <Text style={styles.profileItemText}>Alternar conta</Text>
                  <AppIcon name="forward" size={16} color={colors.mutedSoft} />
                </Pressable>
              )}
            </ScrollView>

            <View style={styles.nativeMenuFooter}>
              <Pressable accessibilityRole="button" onPress={leave} style={styles.nativeLogoutButton}>
                <AppIcon name="logout" size={20} color={colors.danger} />
                <Text style={styles.logoutText}>Sair da conta</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Modal>
      )}

      {usesNativeFullscreen && (
        <Modal
          animationType="slide"
          onRequestClose={() => setNativeNotificationsOpen(false)}
          presentationStyle={nativeOverlayPresentation}
          visible={nativeNotificationsOpen}
        >
          <SafeAreaView style={styles.nativeMenuSafe}>
            <View style={styles.nativeMenuHeader}>
              <Text style={styles.menuTitle}>Notificações</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fechar notificações"
                onPress={() => setNativeNotificationsOpen(false)}
                style={styles.nativeCloseButton}
              >
                <AppIcon name="close" size={24} color={colors.brandDark} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.nativeMenuScroll}
              contentContainerStyle={styles.nativeMenuContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.nativeSectionHeader}>
                <Text style={styles.menuSubtitle}>
                  {unread ? `${unread} não lidas` : "Tudo em dia"}
                </Text>
                <View style={styles.menuHeaderActions}>
                  {unread > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Marcar todas como lidas"
                      onPress={() => void markAllNotificationsRead()}
                    >
                      <Text style={styles.markAll}>Marcar todas</Text>
                    </Pressable>
                  )}
                  {visibleNotifications.length > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Limpar notificações"
                      onPress={() => void clearAllNotifications()}
                    >
                      <Text style={styles.clearAll}>Limpar</Text>
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={styles.notificationList}>
                {notificationsLoading && <Text style={styles.menuSubtitle}>Carregando notificações...</Text>}
                {!notificationsLoading && !!notificationsError && <Pressable onPress={() => void loadNotifications()}><Text style={styles.notificationError}>{notificationsError} Tentar novamente</Text></Pressable>}
                {!notificationsLoading && !notificationsError && visibleNotifications.length === 0 && (
                  <Text style={styles.menuSubtitle}>Nenhuma notificação por aqui ainda.</Text>
                )}
                {visibleNotifications.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => void openNotification(item)}
                    style={[
                      styles.notificationItem,
                      !item.read && styles.notificationUnread,
                    ]}
                  >
                    <View style={styles.notificationIcon}>
                      <AppIcon name={item.icon} size={20} color={colors.brand} />
                    </View>
                    <View style={styles.notificationCopy}>
                      <View style={styles.notificationTitleRow}>
                        <Text style={styles.notificationTitle}>{item.title}</Text>
                        {!item.read && <View style={styles.unreadDot} />}
                      </View>
                      <Text style={styles.notificationDescription}>{item.description}</Text>
                      <Text style={styles.notificationTime}>{item.time}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 72, justifyContent: "center", zIndex: 20 },
  headerInner: {
    width: "100%",
    maxWidth: layout.contentMax,
    minHeight: 72,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    zIndex: 2,
  },
  headerInnerMobile: {
    paddingHorizontal: spacing.md,
  },
  menuBackdrop: {
    position: "fixed",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 1,
    backgroundColor: "transparent",
  } as never,
  brandBlock: { flexShrink: 0, justifyContent: "center" },
  logo: {
    color: colors.brandDark,
    fontFamily: typography.family.bold,
    fontSize: 28,
  },
  accent: { color: colors.brand },
  actions: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    zIndex: 3,
  },
  notificationButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: "transparent",
  },
  notificationDot: {
    position: "absolute",
    right: 8,
    top: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  avatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: "transparent",
  },
  hamburgerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  plainHamburgerButton: {
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
    backgroundColor: "transparent",
  },
  hamburgerBadge: {
    position: "absolute",
    right: 3,
    top: 3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  hamburgerBadgeText: {
    color: colors.onBrand,
    fontFamily: typography.family.bold,
    fontSize: 9,
  },
  notificationsMenu: {
    position: "absolute",
    width: 360,
    right: 48,
    top: 54,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  notificationsMenuMobile: {
    position: "fixed",
    width: "auto",
    left: spacing.md,
    right: spacing.md,
    top: 64,
  } as never,
  menuHeader: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  menuTitle: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  menuSubtitle: {
    marginTop: spacing.xxs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  menuHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  markAll: {
    color: colors.brand,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  clearAll: {
    color: colors.muted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.caption,
  },
  divider: {
    height: 1,
    marginVertical: spacing.xs,
    backgroundColor: colors.border,
  },
  notificationList: { gap: spacing.sm },
  notificationItem: {
    minHeight: 96,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  notificationUnread: { backgroundColor: colors.brandSoft },
  notificationIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  notificationTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand,
  },
  notificationDescription: {
    marginTop: spacing.sm,
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  notificationTime: {
    marginTop: spacing.sm,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: 10,
  },
  notificationError: { color: colors.danger, fontFamily: typography.family.semibold, fontSize: typography.size.caption },
  profileMenu: {
    position: "absolute",
    width: 360,
    right: 0,
    top: 54,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...elevation.floating,
  },
  profileMenuMobile: {
    position: "fixed",
    width: "auto",
    left: spacing.md,
    right: spacing.md,
    top: 64,
  } as never,
  profileHeader: {
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  profileName: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: typography.size.bodyLarge,
  },
  profileRole: {
    marginTop: spacing.xxs,
    color: colors.mutedSoft,
    fontFamily: typography.family.regular,
    fontSize: typography.size.caption,
  },
  profileItem: {
    minHeight: 46,
    paddingHorizontal: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderRadius: 0,
  },
  logoutItem: { borderBottomWidth: 0 },
  profileItemText: {
    flex: 1,
    color: colors.ink,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  logoutText: {
    flex: 1,
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  nativeMenuSafe: { flex: 1, backgroundColor: colors.surface },
  nativeMenuHeader: {
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  nativeCloseButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  nativeMenuContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  nativeMenuScroll: { flex: 1 },
  nativeSectionLabel: {
    color: colors.mutedSoft,
    fontFamily: typography.family.bold,
    fontSize: typography.size.caption,
    letterSpacing: 0.8,
  },
  nativeMenuItem: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  nativeMenuIcon: {
    width: 28,
    height: 36,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  nativeNotificationsSection: { marginTop: spacing.sm },
  nativeSectionHeader: {
    marginBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  nativeMenuFooter: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  nativeLogoutButton: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 0,
    borderRadius: 0,
  },
});
