/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tinta: '#000000',
        superficie: { DEFAULT: '#0A0A0B', alta: '#111113', hover: '#16161A' },
        borde: { DEFAULT: '#2A2A2E', suave: '#1C1C1F', fuerte: '#3A3A40' },
        plata: { 100: '#F2F3F5', 200: '#D9DBDF', 300: '#B8BBC2', 400: '#8E929A', 500: '#666A72', 600: '#45484E' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: { etiqueta: '0.16em' },
      boxShadow: {
        brillo: '0 0 24px rgba(255,255,255,0.06)',
        panel: 'inset 0 1px 0 0 rgba(255,255,255,0.04), 0 10px 30px -15px rgba(0,0,0,0.9)',
      },
      keyframes: {
        latido: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        barrido: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        latido: 'latido 2.4s ease-in-out infinite',
        barrido: 'barrido 2.2s linear infinite',
      },
    },
  },
  plugins: [],
};
