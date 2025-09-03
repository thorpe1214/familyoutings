/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#14B8A6", // teal
          dark: "#0F766E",
          light: "#99F6E4",
          tint: "#ECFDF5",
        },
        ink: "#0F172A",      // title text
        muted: "#64748B",    // secondary text
        border: "#E5E7EB",   // soft borders
        surface: "#FFFFFF",
        canvas: "#F8FAFC",   // page background
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 6px 20px rgba(2, 6, 23, 0.06)",
        soft: "0 2px 8px rgba(2, 6, 23, 0.05)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
        display: ["var(--font-jakarta)", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
