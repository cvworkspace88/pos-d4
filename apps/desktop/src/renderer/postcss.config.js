const path = require('node:path');

// Sits at the electron-vite renderer root (Vite's `root`). postcss-load-config searches
// upward from there, so tailwind.config.js two levels up would be found either way — it is
// passed explicitly so the resolved path is stated rather than inferred.
module.exports = {
  plugins: [require('tailwindcss')(path.resolve(__dirname, '../../tailwind.config.js')), require('autoprefixer')],
};
