/**
 * Shared brand palette for every client. Consumed as a Tailwind preset so the desktop renderer
 * and the Expo tablet resolve `bg-primary` to the same hex, and one edit here moves both.
 *
 * Colors only. Everything else is platform-specific and stays in the app's own config:
 * `content` globs, `corePlugins`, NativeWind's preset, and `fontFamily` — the web uses one
 * Poppins family with font-weight utilities, while React Native needs a separate family per
 * weight because font-weight does not switch between them there.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        // Primary
        primary: {
          DEFAULT: '#6161FF',
          dark: '#4F4FE0',
          light: '#DBDBFF',
          lighter: '#E7ECFF',
        },

        // Neutrals / Text. Named `ink` so utilities read `text-ink-secondary`.
        ink: {
          primary: '#333333',
          secondary: '#535768',
          tertiary: '#676879',
          muted: '#6B7280',
          dark: '#374151',
        },

        // Backgrounds. Named `surface` so utilities read `bg-surface-light`
        surface: {
          DEFAULT: '#F5F6F8',
          light: '#F9FAFB',
        },

        // Borders / Dividers
        border: {
          DEFAULT: '#D0D4E4',
          light: '#DDDFEB',
          subtle: '#E0E2EA',
          gray: '#E5E7EB',
          muted: '#F3F4F6',
        },

        // Status — Danger / Red
        danger: {
          DEFAULT: '#E2445C',
          dark: '#A11111',
          light: '#FFE0E4',
          alt: '#EF4444',
        },

        // Status — Success / Green
        success: {
          DEFAULT: '#00C875',
          dark: '#1F7A3D',
          light: '#BCFE90',
        },

        // Status — Warning / Orange
        warning: {
          DEFAULT: '#FDAB3D',
          dark: '#8A5200',
          light: '#FFF4E5',
          lighter: '#FFECCC',
        },

        // Status — Info / Blue
        info: {
          DEFAULT: '#579BFC',
        },

        // Status — Teal
        teal: {
          DEFAULT: '#0B6B7D',
          light: '#ABF0FF',
          lighter: '#D1FAFF',
        },

        // Accent — lavender
        lavender: {
          light: '#EDDFF7',
        },

        // Accent — Pink
        pink: {
          light: '#FCD0F8',
        },
      },
    },
  },
};
