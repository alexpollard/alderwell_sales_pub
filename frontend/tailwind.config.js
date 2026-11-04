/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html",
    "./src/**/*.{js,jsx}",],
  theme: {
    extend: {
      colors: {
        brand: {
          deep: '#5b9486',
          sage: '#abc8a0',
          cream: '#dddec8',
          mist: '#9fbfb6',
        },
      },
    },
  },
  plugins: [],
}