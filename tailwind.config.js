/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        navy: { 950: '#0a1530', 900: '#0f1d3d', 800: '#1a2b52', 700: '#2a3d68', 500: '#5b6b8c', 300: '#a9b4cb', 100: '#e7ebf3', 50: '#f4f6fa' },
        teal: { 700: '#0b7a72', 600: '#0d9488', 500: '#14b8a6', 100: '#ccfbf1', 50: '#f0fdfa' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,29,61,.04), 0 8px 24px -12px rgba(15,29,61,.12)',
      },
    },
  },
  plugins: [],
};
