export const palette = {
  purple950: '#21065F',
  purple900: '#2F0B82',
  purple800: '#3D0EAA',
  purple700: '#5416FF',
  purple600: '#7135E5',
  purple500: '#8655ED',
  purple400: '#A991FF',
  purple300: '#C7B6FF',
  purple200: '#DDD4FF',
  purple100: '#EEE9FF',
  purple50: '#F7F5FF',
  neutral900: '#191725',
  neutral700: '#555264',
  neutral500: '#7B778B',
  neutral300: '#D8D4E2',
  neutral200: '#E8E5EF',
  neutral100: '#F4F2F8',
  white: '#FFFFFF',
  amber600: '#C97000',
  amber100: '#FFF0CF',
  green700: '#287A47',
  green100: '#DDF8E5',
  red700: '#B73545',
  red100: '#FDE4E8',
} as const;

export const colors = {
  canvas: palette.purple50,
  surface: palette.white,
  surfaceSubtle: palette.neutral100,
  surfaceStrong: palette.white,
  ink: palette.neutral900,
  muted: palette.neutral700,
  mutedSoft: palette.neutral500,
  brand: palette.purple700,
  brandDark: palette.purple950,
  brandMid: palette.purple600,
  brandSoft: palette.purple100,
  accent: palette.purple400,
  accentSoft: palette.purple200,
  border: palette.neutral200,
  borderStrong: palette.purple300,
  onBrand: palette.white,
  success: palette.green700,
  successSoft: palette.green100,
  warning: palette.amber600,
  warningSoft: palette.amber100,
  danger: palette.red700,
  dangerSoft: palette.red100,
  focus: palette.purple700,
  overlay: 'rgba(33, 6, 95, 0.56)',
} as const;

export const typography = {
  family: {
    regular: 'Urbanist_400Regular',
    medium: 'Urbanist_500Medium',
    semibold: 'Urbanist_600SemiBold',
    bold: 'Urbanist_700Bold',
  },
  size: { caption: 12, body: 14, bodyLarge: 16, subtitle: 18, title: 22, display: 40 },
  lineHeight: { caption: 16, body: 20, bodyLarge: 24, subtitle: 24, title: 28, display: 44 },
} as const;

// xxs–md ficam como estão (usados em espaçamento fino: ícone+texto, padding de
// botão, linhas de tabela/lista). lg em diante controlam o respiro vertical
// entre seções, blocos e grupos de botões — aumentados para dar mais ar entre
// blocos empilhados, sem mexer na densidade horizontal/tabelas.
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 16, lg: 28, xl: 40, xxl: 56, xxxl: 80 } as const;
export const radius = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, pill: 999 } as const;
export const elevation = {
  card: { shadowColor: palette.purple950, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 24, elevation: 4 },
  floating: { shadowColor: palette.purple950, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 32, elevation: 8 },
} as const;
export const breakpoints = { tablet: 768, desktop: 1100 } as const;
export const layout = { contentMax: 1180, mobileGutter: 24, desktopGutter: 32, controlMinHeight: 48, touchTarget: 44 } as const;

// Escalas estruturais inspiradas no Bootstrap 5.3 e adaptadas a React Native.
export const bootstrap = {
  spacer: 16,
  spacing: { 0: 0, 1: 4, 2: 8, 3: 16, 4: 24, 5: 48 },
  fontSize: { 1: 40, 2: 32, 3: 28, 4: 24, 5: 20, 6: 16, base: 16, small: 14 },
  lineHeight: { tight: 1.25, base: 1.5, loose: 2 },
  breakpoints: { xs: 0, sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1400 },
  containerMax: { sm: 540, md: 720, lg: 960, xl: 1140, xxl: 1320 },
  grid: { columns: 12, gutter: 24, gutterCompact: 16 },
  borderWidth: { none: 0, default: 1, strong: 2 },
  radius: { none: 0, sm: 4, default: 6, lg: 8, xl: 16, xxl: 32, pill: 999 },
  opacity: { disabled: 0.5, subtle: 0.65, visible: 0.8, opaque: 1, pressed: 0.7 },
  zIndex: { base: 0, dropdown: 1000, sticky: 1020, fixed: 1030, backdrop: 1040, modal: 1055, popover: 1070, tooltip: 1080 },
  control: { sm: 40, md: 48, lg: 56, touchTarget: 44 },
} as const;

export const border = { width: 1, widthStrong: 2, color: colors.border, colorStrong: colors.borderStrong } as const;
export const opacity = bootstrap.opacity;
export const zIndex = bootstrap.zIndex;
export const grid = bootstrap.grid;
export const containers = { fluid: '100%', sm: 540, md: 720, lg: 960, xl: 1140, xxl: 1320 } as const;
export const control = {
  heightSm: bootstrap.control.sm,
  heightMd: bootstrap.control.md,
  heightLg: bootstrap.control.lg,
  touchTarget: bootstrap.control.touchTarget,
  paddingHorizontal: spacing.md,
  disabledOpacity: bootstrap.opacity.disabled,
  focusWidth: 2,
} as const;
export const motion = { fast: 120, normal: 200, slow: 320 } as const;
