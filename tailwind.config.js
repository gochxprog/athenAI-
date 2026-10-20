/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: '#000000',
        cemento: {
          900: '#0B0D11',
          800: '#12151C',
          700: '#2A2D34',
          600: '#3F444E',
          400: '#6B717C',
          300: '#9AA0AA',
          200: '#C5C9D0',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        label: '0.14em',
      },
    },
  },
  plugins: [],
};
