import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';

import { colors } from '@/src/theme/tokens';

export type AppIconName =
  | 'home' | 'calendar' | 'clock' | 'clients' | 'animals' | 'packages' | 'services' | 'financial'
  | 'notifications' | 'success' | 'warning' | 'error' | 'add' | 'edit'
  | 'delete' | 'search' | 'back' | 'forward' | 'file' | 'attachment'
  | 'security' | 'visibility' | 'schedule' | 'analytics' | 'close'
  | 'user' | 'provider' | 'email' | 'lock' | 'settings' | 'menu' | 'logout' | 'apple' | 'android'
  | 'chevronUp' | 'chevronDown' | 'dots' | 'renew';
  

type FontAwesomeName = ComponentProps<typeof FontAwesome6>['name'];
type MaterialName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const icons: Record<AppIconName, { primary: FontAwesomeName; fallback: MaterialName }> = {
  home: { primary: 'house', fallback: 'home' },
  calendar: { primary: 'calendar-days', fallback: 'calendar-month' },
  clock: { primary: 'clock', fallback: 'clock-outline' },
  clients: { primary: 'user-group', fallback: 'account-group' },
  animals: { primary: 'paw', fallback: 'paw' },
  packages: { primary: 'box-open', fallback: 'package-variant-closed' },
  services: { primary: 'list-check', fallback: 'clipboard-list' },
  financial: { primary: 'wallet', fallback: 'wallet' },
  notifications: { primary: 'bell', fallback: 'bell' },
  success: { primary: 'circle-check', fallback: 'check-circle' },
  warning: { primary: 'triangle-exclamation', fallback: 'alert' },
  error: { primary: 'circle-xmark', fallback: 'close-circle' },
  add: { primary: 'plus', fallback: 'plus' }, edit: { primary: 'pen', fallback: 'pencil' },
  delete: { primary: 'trash', fallback: 'trash-can' }, search: { primary: 'magnifying-glass', fallback: 'magnify' },
  back: { primary: 'arrow-left', fallback: 'arrow-left' }, forward: { primary: 'arrow-right', fallback: 'arrow-right' },
  file: { primary: 'book', fallback: 'book-open' }, attachment: { primary: 'paperclip', fallback: 'paperclip' },
  security: { primary: 'shield', fallback: 'shield' }, visibility: { primary: 'eye', fallback: 'eye' },
  schedule: { primary: 'clock', fallback: 'clock-outline' }, analytics: { primary: 'chart-line', fallback: 'chart-line' },
  close: { primary: 'circle-xmark', fallback: 'close' },
  user: { primary: 'user', fallback: 'account' }, provider: { primary: 'briefcase', fallback: 'briefcase' },
  email: { primary: 'envelope', fallback: 'email' }, lock: { primary: 'lock', fallback: 'lock' },
  settings: { primary: 'gear', fallback: 'cog' },
  menu: { primary: 'bars', fallback: 'menu' }, logout: { primary: 'right-from-bracket', fallback: 'logout' },
  apple: { primary: 'apple', fallback: 'apple' }, android: { primary: 'android', fallback: 'android' },
  // BLG-096/DEC-155: setas verticais de incremento/decremento do Seletor de
  // Hora — nenhum ícone de seta vertical existia no catálogo até então
  // (só `back`/`forward`, horizontais).
  chevronUp: { primary: 'chevron-up', fallback: 'chevron-up' },
  chevronDown: { primary: 'chevron-down', fallback: 'chevron-down' },
  dots: { primary: 'ellipsis-vertical', fallback: 'dots-vertical' },
  // Ação "Renovar" (pacote/política do cliente, Perfil do Cliente) — nenhum
  // ícone de "recarregar/renovar" existia no catálogo até então.
  renew: { primary: 'arrow-rotate-right', fallback: 'refresh' },
};

type Props = { name: AppIconName; size?: number; color?: string; label?: string; family?: 'font-awesome' | 'material-community' };

export function AppIcon({ name, size = 24, color = colors.ink, label, family = 'font-awesome' }: Props) {
  const icon = icons[name];
  const accessibility = label ? { accessible: true, accessibilityLabel: label } : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };
  if (family === 'material-community' || (name === 'close' && Platform.OS !== 'web')) {
    return <MaterialCommunityIcons name={icon?.fallback ?? 'circle-outline'} size={size} color={color} {...accessibility} />;
  }
  return <FontAwesome6 name={icon?.primary ?? 'circle-question'} size={size} color={color} solid {...accessibility} />;
}
