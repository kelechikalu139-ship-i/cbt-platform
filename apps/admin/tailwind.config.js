/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Institutional navy-blue. Used for primary actions and accents so the
        // interface reads as an examination department system, not a SaaS template.
        brand: {
          50: '#eef3fb',
          100: '#d9e4f5',
          200: '#b4c9e8',
          300: '#86a6d6',
          400: '#5580c0',
          500: '#3463a6',
          600: '#274e8b',
          700: '#213f70',
          800: '#1e355c',
          900: '#1b2d4d',
          950: '#111e36',
        },
        // Sidebar / chrome surface.
        ink: {
          700: '#1c2942',
          800: '#131d33',
          900: '#0d1526',
          950: '#080d18',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'Segoe UI',
          'system-ui',
          '-apple-system',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        panel: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        pop: '0 10px 30px -10px rgb(15 23 42 / 0.25), 0 2px 6px -2px rgb(15 23 42 / 0.1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-up': 'slide-up 140ms ease-out',
      },
    },
  },
  plugins: [],
}