import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50:  '#f7f7f9',
          100: '#eaebef',
          200: '#cfd1d8',
          300: '#a8acb7',
          400: '#7c818d',
          500: '#5d626d',
          600: '#494d57',
          700: '#363941',
          800: '#1f2127',
          900: '#15171c',
          950: '#0a0b0f',
        },
        accent: {
          50:  '#f3eeff',
          100: '#e6dcff',
          200: '#cbb6ff',
          300: '#aa8aff',
          400: '#8c66ff',
          500: '#7c5cff',
          600: '#6b46f0',
          700: '#5836d6',
          800: '#4628a8',
          900: '#311c75',
          DEFAULT: '#7c5cff',
          fg:      '#ffffff',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightish: '-0.012em',
      },
      boxShadow: {
        soft:  '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.3)',
        glow:  '0 0 0 1px rgba(124,92,255,0.35), 0 10px 32px -8px rgba(124,92,255,0.55)',
        ring:  '0 0 0 1px rgba(255,255,255,0.06) inset',
      },
      backgroundImage: {
        'noise': "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.04 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
      },
      keyframes: {
        'fade-in':   { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pulse-ring':{ '0%, 100%': { transform: 'scale(1)', opacity: '0.6' }, '50%': { transform: 'scale(1.15)', opacity: '0.15' } },
        'shimmer':   { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-in':   'fade-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-ring':'pulse-ring 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer':   'shimmer 2s linear infinite',
      },
      transitionTimingFunction: {
        snap: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
