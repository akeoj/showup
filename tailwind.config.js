/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0F14',
        surface: '#131A22',
        surface2: '#1B242E',
        line: '#26313D',
        muted: '#8A9AAB',
        text: '#E8EEF4',
        flame: '#FF6B35',
        lime: '#B6F36B',
        gold: '#FFC93C',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
