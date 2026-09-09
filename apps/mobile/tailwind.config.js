/** @type {import('tailwindcss').Config} */
module.exports = {
  // Brand palette lives in @repo/tailwind-config so both clients share one source of truth.
  presets: [require('nativewind/preset'), require('@repo/tailwind-config')],
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      // React Native treats each weight as its own font family (font-weight doesn't switch
      // between them like on the web), so these are named `poppins*` rather than reusing
      // Tailwind's weight-named keys (e.g. `medium`) — that would collide with the existing
      // `font-medium` font-weight utility and produce two rules named `font-medium`.
      fontFamily: {
        poppins: ['Poppins_400Regular'],
        'poppins-medium': ['Poppins_500Medium'],
        'poppins-semibold': ['Poppins_600SemiBold'],
        'poppins-bold': ['Poppins_700Bold'],
      },
    },
  },
  plugins: [],
};
