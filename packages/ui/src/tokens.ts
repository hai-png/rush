export const radius = { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 } as const;
export const spacing = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;
export const fontSize = { xs: 12, sm: 14, base: 16, lg: 18, xl: 24, '2xl': 32, '3xl': 48 } as const;
export const motion = {
  duration: { fast: 100, base: 200, slow: 300 },
  easing: { in: 'cubic-bezier(.4,0,1,1)', out: 'cubic-bezier(0,0,.2,1)', inOut: 'cubic-bezier(.4,0,.2,1)' },
} as const;
