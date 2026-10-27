/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef8ff',
          100: '#d8eeff',
          200: '#b9e1ff',
          300: '#89cfff',
          400: '#52b3fe',
          500: '#2a91fa',
          600: '#1473ef',
          700: '#0d5cdc',
          800: '#124bb2',
          900: '#15428c',
          950: '#122a55',
        },
        ink: {
          900: '#0f172a',
          700: '#334155',
          500: '#64748b',
          300: '#cbd5e1',
          100: '#f1f5f9',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.06)',
      },
    },
  },
  plugins: [],
};
