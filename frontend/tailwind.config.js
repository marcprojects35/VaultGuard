/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        'primary-hover': 'var(--color-primary-hover)',
        'primary-light': 'var(--color-primary-light)',
        accent: 'var(--color-accent)',
        bg: 'var(--color-bg)',
        'bg-secondary': 'var(--color-bg-secondary)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        'surface-hover': 'var(--color-surface-hover)',
        border: 'var(--color-border)',
        muted: 'var(--color-muted)',
        gold: {
          dark: '#AD7B04',
          DEFAULT: '#C78C00',
          light: '#E7A300',
          hover: '#FFB400',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    }
  },
  plugins: [],
}
