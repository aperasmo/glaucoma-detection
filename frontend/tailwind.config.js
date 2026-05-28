/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:       "rgb(var(--bg-rgb) / <alpha-value>)",
        surface:  "rgb(var(--surface-rgb) / <alpha-value>)",
        surface2: "rgb(var(--surface2-rgb) / <alpha-value>)",
        surface3: "rgb(var(--surface3-rgb) / <alpha-value>)",

        accent:  "rgb(var(--accent-rgb) / <alpha-value>)",
        accent2: "rgb(var(--accent2-rgb) / <alpha-value>)",

        pos:  "rgb(var(--pos-rgb) / <alpha-value>)",
        neg:  "rgb(var(--neg-rgb) / <alpha-value>)",
        warn: "rgb(var(--warn-rgb) / <alpha-value>)",

        text1: "rgb(var(--text1-rgb) / <alpha-value>)",
        text2: "rgb(var(--text2-rgb) / <alpha-value>)",
        text3: "rgb(var(--text3-rgb) / <alpha-value>)",

        border:  "var(--border)",
        border2: "var(--border2)",

        sbBg:         "rgb(var(--sb-bg-rgb) / <alpha-value>)",
        sbSurface2:   "rgb(var(--sb-s2-rgb) / <alpha-value>)",
        sbText:       "rgb(var(--sb-t-rgb) / <alpha-value>)",
        sbText2:      "rgb(var(--sb-t2-rgb) / <alpha-value>)",
        sbText3:      "rgb(var(--sb-t3-rgb) / <alpha-value>)",
        sbActiveText: "rgb(var(--sb-at-rgb) / <alpha-value>)",
        sbBar:        "rgb(var(--sb-bar-rgb) / <alpha-value>)",
        sbHover:      "var(--sb-hov)",
        sbActive:     "var(--sb-act)",
        sbBorder:     "var(--sb-brd)",
      },
      fontFamily: {
        sans:  ["DM Sans", "sans-serif"],
        mono:  ["DM Mono", "monospace"],
        serif: ["Playfair Display", "serif"],
      },
      borderColor: {
        DEFAULT: "var(--border)",
        strong:  "var(--border2)",
        border:  "var(--border)",
        border2: "var(--border2)",
      },
    },
  },
  plugins: [],
};