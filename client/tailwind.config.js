/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f0f11',
          card: '#18181b',
          input: '#1c1c20',
        },
        accent: {
          DEFAULT: '#10b981',
          hover: '#059669',
          soft: '#ecfdf5',
          text: '#047857',
        },
        ink: {
          DEFAULT: '#fafafa',
          muted: '#a1a1aa',
          dim: '#71717a',
        },
        border: {
          DEFAULT: '#27272a',
          light: '#e4e4e7',
        },
      },
      borderRadius: {
        modal: '1rem',
        input: '0.5rem',
        pill: '9999px',
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Geist Mono', 'JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        diffusion: '0 20px 40px -15px rgba(0,0,0,0.05)',
        'diffusion-dark': '0 20px 40px -15px rgba(0,0,0,0.3)',
        pane: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
      },
      animation: {
        shimmer: 'shimmer 2s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite',
        pulse: 'pulse-soft 3s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.6 },
        },
      },
    },
  },
  plugins: [],
}
