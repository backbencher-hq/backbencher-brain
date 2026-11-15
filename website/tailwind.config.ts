import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0E0A07",
        foreground: "#F1E9DD",
        // Warm-dark editorial palette (M41.D1) — mapped from the cream/terracotta
        // identity of ishaq2321.github.io onto a dark canvas.
        warm: {
          bg: "#0E0A07",
          surface: "#16110B",
          "surface-2": "#1E1710",
          ink: "#F1E9DD",
          body: "#B8AC9B",
          muted: "#83786A",
        },
        ember: {
          300: "#FF8A6B",
          400: "#F06A4C",
          500: "#E2553B",
          600: "#C3422B",
          700: "#9E301E",
        },
        // The old violet identity is remapped to the warm ember family so the
        // entire site (including legacy subpages) speaks one accent language.
        violet: {
          50: "#FEF1EC",
          100: "#FDE0D6",
          200: "#FAC2B2",
          300: "#F59E8A",
          400: "#EF7A5D",
          500: "#E2553B",
          600: "#C3422B",
          700: "#9E301E",
          800: "#7B2216",
          900: "#5A1910",
          950: "#330D08",
        },
        // shadcn/ui primitives read these names
        primary: {
          DEFAULT: "#E2553B",
          foreground: "#FFFFFF",
        },
        // zinc (legacy neutral classes across the subpages) is remapped to the
        // warm sand family so no cool-gray leaks survive anywhere on the site.
        zinc: {
          50: "#FAF7F2",
          100: "#F2ECE2",
          200: "#E6DCCB",
          300: "#CFC2AE",
          400: "#B0A493",
          500: "#94897A",
          600: "#75695C",
          700: "#5C5348",
          800: "#332B23",
          900: "#241E18",
          950: "#17120C",
        },
        // Premium brand colors
        brand: {
          fuchsia: "#d946ef",
          purple: "#8b5cf6",
          cyan: "#06b6d4",
          emerald: "#10b981",
        },
        // Accent scales
        accent: {
          50: "#fdf4ff",
          100: "#fae8ff",
          200: "#f5d0fe",
          300: "#f0abfc",
          400: "#e879f9",
          500: "#d946ef",
          600: "#c026d3",
          700: "#a21caf",
          800: "#86198f",
          900: "#701a75",
        },
      },
      fontFamily: {
        sans: ["var(--font-hanken)", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["var(--font-jbmono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
        display: ["var(--font-fraunces)", "Georgia", "serif"],
      },
      animation: {
        // Floating animations
        float: "float 6s ease-in-out infinite",
        "float-slow": "float 8s ease-in-out infinite",
        "float-delayed": "float 6s ease-in-out infinite 2s",
        // Pulse and glow
        "pulse-glow": "pulse-glow 4s ease-in-out infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        // Gradient animations
        "gradient-shift": "gradient-shift 15s ease infinite",
        "gradient-x": "gradient-x 5s ease infinite",
        // Movement
        shimmer: "shimmer 3s infinite linear",
        shine: "shine 3s infinite",
        marquee: "marquee 30s linear infinite",
        "marquee-reverse": "marquee-reverse 30s linear infinite",
        orbit: "orbit 20s linear infinite",
        // Reveal animations
        "reveal-up": "reveal-up 0.8s ease-out forwards",
        "reveal-down": "reveal-down 0.8s ease-out forwards",
        "reveal-left": "reveal-left 0.8s ease-out forwards",
        "reveal-right": "reveal-right 0.8s ease-out forwards",
        "reveal-scale": "reveal-scale 0.6s ease-out forwards",
        // Typing/blinking
        blink: "blink 1s infinite",
        typewriter: "typewriter 2s steps(40, end)",
        // Bounce variants
        "bounce-slow": "bounce 3s infinite",
        // Spin variants
        "spin-slow": "spin 8s linear infinite",
        // Scale
        "scale-in": "scale-in 0.3s ease-out forwards",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.5", transform: "scale(1)" },
          "50%": { opacity: "0.8", transform: "scale(1.05)" },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "200% 0" },
          "50%": { backgroundPosition: "0% 0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
        shine: {
          "0%": { left: "-100%" },
          "100%": { left: "100%" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "marquee-reverse": {
          "0%": { transform: "translateX(-50%)" },
          "100%": { transform: "translateX(0)" },
        },
        orbit: {
          "0%": { transform: "rotate(0deg) translateX(120px) rotate(0deg)" },
          "100%": { transform: "rotate(360deg) translateX(120px) rotate(-360deg)" },
        },
        "reveal-up": {
          from: { opacity: "0", transform: "translateY(40px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "reveal-down": {
          from: { opacity: "0", transform: "translateY(-40px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "reveal-left": {
          from: { opacity: "0", transform: "translateX(-40px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "reveal-right": {
          from: { opacity: "0", transform: "translateX(40px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "reveal-scale": {
          from: { opacity: "0", transform: "scale(0.9)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        blink: {
          "0%, 50%": { opacity: "1" },
          "51%, 100%": { opacity: "0" },
        },
        typewriter: {
          from: { width: "0" },
          to: { width: "100%" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "gradient-mesh":
          "radial-gradient(at 40% 20%, rgba(217, 70, 239, 0.3) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(6, 182, 212, 0.2) 0px, transparent 50%), radial-gradient(at 0% 50%, rgba(139, 92, 246, 0.2) 0px, transparent 50%)",
      },
      boxShadow: {
        "glow-sm": "0 0 20px rgba(217, 70, 239, 0.2)",
        glow: "0 0 40px rgba(217, 70, 239, 0.3), 0 0 80px rgba(217, 70, 239, 0.1)",
        "glow-lg": "0 0 60px rgba(217, 70, 239, 0.4), 0 0 120px rgba(217, 70, 239, 0.2)",
        "glow-cyan": "0 0 40px rgba(6, 182, 212, 0.3), 0 0 80px rgba(6, 182, 212, 0.1)",
        "glow-purple": "0 0 40px rgba(139, 92, 246, 0.3), 0 0 80px rgba(139, 92, 246, 0.1)",
        "inner-glow": "inset 0 0 40px rgba(217, 70, 239, 0.1)",
      },
      backdropBlur: {
        xs: "2px",
      },
      transitionDuration: {
        "400": "400ms",
      },
    },
  },
  plugins: [],
}
export default config
