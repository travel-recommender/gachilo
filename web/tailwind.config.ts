import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50:"#eef3ff",100:"#dae5ff",200:"#bcd0ff",300:"#93b0ff",400:"#6a89fb",
                 500:"#4665f1",600:"#2f45e0",700:"#2635b8",800:"#242f93",900:"#232d75" },
        mint: { 400:"#2fd6a8",500:"#12b98c",600:"#0a9773" },
        coral:{ 400:"#ff7a6b",500:"#f9584a",600:"#dc3c30" },
        ink:  { 900:"#12141a",700:"#3a3f4b",500:"#6b7280",300:"#a6acba" },
        surface: "#f4f5f9",
      },
      fontFamily: { sans: ["Pretendard","-apple-system","BlinkMacSystemFont","Apple SD Gothic Neo","Segoe UI","sans-serif"] },
      borderRadius: { card: "18px" },
      boxShadow: { card: "0 2px 16px rgba(18,20,26,0.06)" },
    },
  },
  plugins: [],
};
export default config;
