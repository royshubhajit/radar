/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0b0e14',
        surface: '#151922',
        'surface-elevated': '#1d2330',
        'surface-hover': '#252d3d',
        border: '#2a3245',
        bullish: '#10b981',
        bearish: '#f43f5e',
        'bearish-dark': '#881337',
        'bearish-glow': 'rgba(244, 63, 94, 0.25)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flash-red': 'flashRed 1.5s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.4 },
        },
        flashRed: {
          '0%, 100%': { backgroundColor: 'rgba(244, 63, 94, 0.2)' },
          '50%': { backgroundColor: 'rgba(244, 63, 94, 0.4)' },
        }
      }
    },
  },
  plugins: [],
}
