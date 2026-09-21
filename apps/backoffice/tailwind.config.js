import defaultTheme from 'tailwindcss/defaultTheme';
import preset from '@repo/tailwind-config';

/** @type {import('tailwindcss').Config} */
export default {
  // Brand palette lives in @repo/tailwind-config so both clients share one source of truth.
  presets: [preset],
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    // Shared components live outside this app; without this glob their classes get purged.
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
