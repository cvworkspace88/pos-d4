const path = require('node:path');

// This file lives at the electron-vite renderer root (see electron.vite.config.ts),
// which is where Vite actually looks for a PostCSS config — a copy at the package
// root (apps/desktop/) is silently ignored. The tailwind config lives two levels up,
// so it is pointed at explicitly rather than relying on tailwind's own auto-discovery.
module.exports = {
  plugins: [require('tailwindcss')(path.resolve(__dirname, '../../tailwind.config.js')), require('autoprefixer')],
};
