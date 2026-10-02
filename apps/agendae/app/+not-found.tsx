import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/src/theme/tokens';

export default function NotFoundScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.code}>404</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Essa página não está na agenda.
        </Text>
        <Text style={styles.description}>
          O endereço pode ter mudado ou ainda não faz parte desta versão do Rotinaê.
        </Text>
        <Link href="/" style={styles.link}>
          Voltar ao início
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: spacing.xl,
    gap: spacing.md,
  },
  code: {
    color: colors.brand,
    fontFamily: typography.family.bold,
    fontSize: 18,
  },
  title: {
    color: colors.ink,
    fontFamily: typography.family.bold,
    fontSize: 38,
    lineHeight: 43,
  },
  description: {
    color: colors.muted,
    fontFamily: typography.family.regular,
    fontSize: 17,
    lineHeight: 26,
  },
  link: {
    marginTop: spacing.md,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    color: colors.onBrand,
    fontFamily: typography.family.semibold,
    fontSize: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
});
