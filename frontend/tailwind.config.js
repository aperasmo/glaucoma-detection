/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Match our existing design system exactly
        bg:        "#0C1220",
        surface:   "#131D2E",
        surface2:  "#1A2840",
        surface3:  "#1F3050",
        accent:    "#3B9EFF",
        accent2:   "#5BB8FF",
        pos:       "#22C994",
        neg:       "#FF6B6B",
        warn:      "#FFB84D",
        text1:     "#E8EEF7",
        text2:     "#8FA3BF",
        text3:     "#4E6580",
      },
      fontFamily: {
        sans:  ["DM Sans", "sans-serif"],
        mono:  ["DM Mono", "monospace"],
        serif: ["Playfair Display", "serif"],
      },
      borderColor: {
        DEFAULT: "rgba(255,255,255,0.07)",
        strong:  "rgba(255,255,255,0.12)",
      },
    },
  },
  plugins: [],
}