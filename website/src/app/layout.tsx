import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { Navigation } from "@/components/Navigation"
import { GoatCounter } from "@/components/GoatCounter"
import { TRUTH } from "@/data/truth.generated"

// Warm-dark editorial identity (M41.D1). All three families are self-hosted
// variable fonts (latin subset) — zero external font requests, no FOUT, and
// no dependence on Google's CDN at build or runtime.
const fraunces = localFont({
  src: "../fonts/fraunces-latin.woff2",
  variable: "--font-fraunces",
  weight: "100 900",
  display: "swap",
})

const frauncesItalic = localFont({
  src: "../fonts/fraunces-i-latin.woff2",
  variable: "--font-fraunces-italic",
  weight: "100 900",
  style: "italic",
  display: "swap",
})

const hanken = localFont({
  src: "../fonts/hanken-latin.woff2",
  variable: "--font-hanken",
  weight: "100 900",
  display: "swap",
})

const jetbrainsMono = localFont({
  src: "../fonts/jbmono-latin.woff2",
  variable: "--font-jbmono",
  weight: "100 800",
  display: "swap",
})

// The 2026-11-08 site identity (docs/website/DESIGN.md v2): one grotesque for
// display and body, one mono for code and data. Archivo is self-hosted (latin
// subset, zero external requests) because its tight, industrial caps carry the
// product's "engineered, not decorated" voice at display sizes.
const archivo = localFont({
  src: "../fonts/archivo-latin.woff2",
  variable: "--font-archivo",
  weight: "400 900",
  display: "swap",
})

// Hallmark Cobalt (2026-11-08): the dealt theme's two faces, self-hosted.
const familjen = localFont({
  src: "../fonts/familjen-latin.woff2",
  variable: "--font-familjen",
  weight: "400 700",
  display: "swap",
})

const plexSans = localFont({
  src: [
    { path: "../fonts/plex-400-latin.woff2", weight: "400" },
    { path: "../fonts/plex-500-latin.woff2", weight: "500" },
    { path: "../fonts/plex-600-latin.woff2", weight: "600" },
  ],
  variable: "--font-plex",
  display: "swap",
})

const TOOL_COUNT = TRUTH.tools.length
const SITE_URL = "https://backbencher.cc"

const DESCRIPTION =
  "bb builds a local SQLite index of symbols, imports and relationships for AST-precise code search, call-graph analysis and MCP tools your agents use."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // Kept ≤ 60 characters so a search result shows the whole title; keywords
    // live in the description and the lead copy, not stuffed into the title.
    default: "Backbencher (bb) — local code intelligence & code search",
    template: "%s | Backbencher",
  },
  description: DESCRIPTION,
  keywords: [
    "bb",
    "bb cli",
    "bb mcp",
    "bb tools",
    "Backbencher",
    "AI Coding",
    "AST",
    "Tree-sitter",
    "WASM",
    "Codebase OS",
    "Developer Tools",
    "Copilot Alternative",
    "Cursor Alternative",
    "MCP",
    "local code index",
    "code search",
    "semantic code search",
    "call graph",
    "code graph",
    "symbol extraction",
    "relationship mapping",
  ],
  authors: [{ name: "Backbencher" }],
  // NOTE: no layout-level canonical — canonical must be declared per-page or a
  // page without one silently claims the homepage as canonical (duplicate
  // content). The S1 verifier mutant enforces exactly this failure mode.
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    title: "Backbencher | Local Code Intelligence for Agents",
    description: `A local AST-first code index and ${TOOL_COUNT} agent tools for symbol search, graph analysis, diagnostics, and guarded source operations.`,
    siteName: "Backbencher",
    images: [
      {
        url: "/social-share.png",
        width: 1280,
        height: 721,
        alt: "Backbencher - Local Code Intelligence for Agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Backbencher | Local Code Intelligence for Agents",
    description: `A local AST-first code index and ${TOOL_COUNT} agent tools for symbol search, graph analysis, diagnostics, and guarded source operations.`,
    images: ["/social-share.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`scroll-smooth ${fraunces.variable} ${frauncesItalic.variable} ${hanken.variable} ${jetbrainsMono.variable} ${archivo.variable} ${familjen.variable} ${plexSans.variable}`}
      suppressHydrationWarning
    >
      <body
        className="antialiased bg-[#0E0A07] text-[#F1E9DD] font-sans selection:bg-[#E2553B]/40 selection:text-white pt-[64px]"
        suppressHydrationWarning
      >
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        <Navigation />
        {/* tabIndex so the skip link actually moves focus into the content; the
            nav is repeated above and on every page (M56.I1), which is exactly
            the "bypass blocks" case WCAG 2.4.1 names. */}
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
        <GoatCounter />
      </body>
    </html>
  )
}
