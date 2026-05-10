import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f6f7',
          100: '#e7e8ea',
          200: '#cdd0d4',
          300: '#a8acb3',
          400: '#7c818a',
          500: '#5d626c',
          600: '#494d56',
          700: '#3a3d44',
          800: '#22252b',
          900: '#15171c',
          950: '#0c0d11',
        },
        accent: {
          DEFAULT: '#7c5cff',
          fg: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
