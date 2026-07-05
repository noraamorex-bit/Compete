/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        mist: "#F3F5FA",
        paper: "#FFFFFF",
        ink: {
          DEFAULT: "#1A2240",
          soft: "#59627D",
          faint: "#8B93AB",
        },
        night: {
          DEFAULT: "#0C101D",
          card: "#141A2D",
          edge: "#232B47",
          text: "#E9EDF8",
          soft: "#98A1BC",
        },
        marigold: {
          DEFAULT: "#EE9B1E",
          deep: "#C77C08",
          soft: "#FBEBD0",
        },
        ember: "#E5484D",
        leaf: "#2EA46D",
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "system-ui", "sans-serif"],
        sans: ['"Instrument Sans"', "system-ui", "sans-serif"],
        mono: ['"Spline Sans Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,26,45,.04), 0 8px 24px -12px rgba(20,26,45,.10)",
        lift: "0 2px 4px rgba(20,26,45,.05), 0 18px 44px -16px rgba(20,26,45,.20)",
        modal: "0 24px 80px -24px rgba(8,11,22,.45)",
        glow: "0 0 0 1px rgba(238,155,30,.25), 0 8px 32px -8px rgba(238,155,30,.25)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pop: {
          from: { opacity: "0", transform: "scale(.96) translateY(8px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        fade: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        sheet: {
          from: { opacity: "0", transform: "translateY(28px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        rise: "rise .45s cubic-bezier(.22,.9,.3,1) both",
        pop: "pop .28s cubic-bezier(.22,.9,.3,1) both",
        fade: "fade .2s ease both",
        sheet: "sheet .32s cubic-bezier(.22,.9,.3,1) both",
      },
    },
  },
  plugins: [],
};
