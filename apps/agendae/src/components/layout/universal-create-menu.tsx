import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, elevation, radius, spacing, typography } from '@/src/theme/tokens';
import { AppIcon, type AppIconName } from '../ui/app-icon';

// Query param `openCreate=1` consumido por cada tela de destino para abrir
// automaticamente o respectivo modal de criação (ver `openCreate` em
// `app/clients.tsx`, `app/payments.tsx`, `app/agenda.tsx` e
// `app/services.tsx`) — sem ele o usuário só navega para a tela, sem o
// modal já aberto.
const actions: { icon: AppIconName; title: string; description: string; route: string }[] = [
  { icon: 'clients', title: 'Novo cliente', description: 'Cadastre ou vincule um cliente.', route: '/clients?openCreate=1' },
  { icon: 'financial', title: 'Registro financeiro', description: 'Registre um pagamento ou valor.', route: '/payments?openCreate=1' },
  { icon: 'calendar', title: 'Novo agendamento', description: 'Adicione um compromisso à agenda.', route: '/agenda?openCreate=1' },
  { icon: 'services', title: 'Novo serviço', description: 'Cadastre um serviço do seu catálogo.', route: '/services?openCreate=1' },
];

export function UniversalCreateMenu() {
  const [visible, setVisible] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Abrir menu de novo registro" onPress={() => setVisible(true)} style={styles.trigger}><View style={styles.triggerIcon}><AppIcon name="add" size={24} color={colors.onBrand} /></View><Text style={styles.triggerLabel}>Novo</Text></Pressable>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}><Pressable onPress={() => setVisible(false)} style={styles.backdrop}><Pressable accessibilityViewIsModal onPress={(event) => event.stopPropagation()} style={styles.sheet}><View style={styles.handle} /><View style={styles.header}><View style={styles.headerCopy}><Text style={styles.eyebrow}>AÇÃO RÁPIDA</Text><Text style={styles.title}>O que deseja criar?</Text></View><Pressable accessibilityLabel="Fechar menu" onPress={() => setVisible(false)} style={styles.close}><AppIcon name="error" size={20} color={colors.muted} /></Pressable></View><View style={styles.actions}>{actions.map((item) => <Pressable key={item.title} onPress={() => { setVisible(false); router.push(item.route as never); }} style={styles.action}><View style={styles.actionIcon}><AppIcon name={item.icon} size={20} color={colors.brand} /></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>{item.title}</Text><Text style={styles.actionDescription}>{item.description}</Text></View><AppIcon name="forward" size={16} color={colors.mutedSoft} /></Pressable>)}</View></Pressable></Pressable></Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { flex: 1, alignItems: 'center', gap: spacing.xs }, triggerIcon: { width: 46, height: 46, marginTop: -24, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand, borderWidth: 4, borderColor: colors.canvas }, triggerLabel: { color: colors.mutedSoft, fontFamily: typography.family.medium, fontSize: 10 }, backdrop: { flex: 1, padding: spacing.sm, justifyContent: 'flex-end', backgroundColor: colors.overlay }, sheet: { width: '100%', maxWidth: 520, maxHeight: '92%', alignSelf: 'center', padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, ...elevation.floating }, handle: { width: 42, height: 4, alignSelf: 'center', marginBottom: spacing.md, borderRadius: radius.pill, backgroundColor: colors.borderStrong }, header: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm }, headerCopy: { flex: 1, minWidth: 0 }, eyebrow: { color: colors.brand, fontFamily: typography.family.bold, fontSize: typography.size.caption, letterSpacing: 1.1 }, title: { marginTop: spacing.xs, color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.title }, close: { width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceSubtle }, actions: { marginTop: spacing.md, gap: spacing.sm }, action: { minHeight: 68, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceSubtle }, actionIcon: { width: 42, height: 42, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.brandSoft }, actionCopy: { flex: 1, minWidth: 0 }, actionTitle: { color: colors.ink, fontFamily: typography.family.bold, fontSize: typography.size.bodyLarge }, actionDescription: { marginTop: spacing.xs, color: colors.muted, fontFamily: typography.family.regular, fontSize: typography.size.caption },
});
