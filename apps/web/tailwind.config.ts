import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#090b10",
        panel: "#11151e",
        muted: "#8992a5",
        accent: "#a78bfa"
      },
      boxShadow: {
        glow: "0 0 80px rgba(139, 92, 246, .16)"
      }
    }
  },
  plugins: []
};

export default config;
