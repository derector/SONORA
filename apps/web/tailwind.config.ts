import type { Config } from "tailwindcss";

// Token ramps mirror app/globals.css :root variables so utility classes and
// raw CSS resolve against the same scale.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#080910",
        panel: "#121522",
        muted: "#9ca1af",
        surface: {
          DEFAULT: "rgba(255,255,255,.035)",
          lift: "rgba(255,255,255,.06)"
        },
        accent: {
          DEFAULT: "#8b5cf6",
          teal: "#14b8a6",
          soft: "rgba(139,92,246,.14)"
        }
      },
      borderRadius: {
        tile: "12px",
        card: "16px",
        panel: "20px"
      },
      spacing: {
        "sp-1": "4px",
        "sp-2": "8px",
        "sp-3": "12px",
        "sp-4": "16px",
        "sp-6": "24px",
        "sp-8": "32px"
      },
      fontSize: {
        display: ["clamp(34px,4.2vw,40px)", { lineHeight: "1.08", letterSpacing: "-0.02em", fontWeight: "600" }],
        h2: ["clamp(24px,2.4vw,28px)", { lineHeight: "1.15", letterSpacing: "-0.01em", fontWeight: "600" }],
        row: ["15px", { lineHeight: "1.3", fontWeight: "500" }],
        meta: ["13px", { lineHeight: "1.35" }]
      },
      boxShadow: {
        glow: "0 0 80px rgba(139, 92, 246, .16)",
        card: "0 12px 32px rgba(3, 4, 10, .45)",
        float: "0 18px 60px rgba(0, 0, 0, .55)"
      }
    }
  },
  plugins: []
};
export default config;
