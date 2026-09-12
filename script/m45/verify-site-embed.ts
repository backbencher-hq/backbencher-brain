// script/m45/verify-site-embed.ts — M45.T1 (#711), the website-embed gate.
//
// Machine-checks that the verified session films are actually consumed by the
// website (not just sitting in validation/):
//   1. Hero figure: HeroTerminal exists, renders REAL verbatim CLI output,
//      and HeroSection actually renders it. The hero is VIDEO-FREE by owner
//      decision (2026-09-12, after five rejected film attempts): the videos
//      live on /demos only. Reduced-motion reveal disabled via CSS.
//   2. /demos page: exists, renders both films, captions bind to the capture
//      manifests (never hand-typed claims), and the page links the evidence.
//   3. Discovery: /demos is reachable from Navigation and SiteFooter, and the
//      sitemap route list includes it.
//   4. Assets: both mp4s + posters exist in website/public/demos with size
//      floors (a zero-byte or truncated copy fails).
//   5. Gates extended honestly: M41 SEO route list contains /demos; M41 design
//      gate accepts the live terminal hero.
//   6. Build truth: the Next build output contains the /demos route.
//   7. Six planted mutations prove the checks can fail (zero-byte mp4,
//      verbatim line replaced, hero figure unrendered, dropped sitemap
//      route, manifest binding removed, nav link removed).
//
// Run: npx tsx script/m45/verify-site-embed.ts
// Evidence: validation/m45/results/T1.json

import { readFileSync, existsSync, statSync } from "node:fs"
import { writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = process.cwd()
const SITE = path.join(ROOT, "website")
const EV = path.join(ROOT, "validation/m45/results")

let passed = 0
let failed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed++
  else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
  }
}
function read(p: string): string {
  return existsSync(p) ? readFileSync(p, "utf8") : ""
}

// --- 1. hero figure (video-free by owner decision) ----------------------------------

const heroTerminal = read(path.join(SITE, "src/components/HeroTerminal.tsx"))
const heroSection = read(path.join(SITE, "src/components/HeroSection.tsx"))
const globals = read(path.join(SITE, "src/app/globals.css"))
check("T1: HeroTerminal component exists", heroTerminal.length > 200)
check("T1: hero terminal shows verbatim CLI output (not invented)", heroTerminal.includes('"bb --version"') && heroTerminal.includes("Usage: bb [options] [command]"))
check("T1: hero figure is video-free (owner decision 2026-09-12)", !heroSection.includes("<video") && !heroSection.includes("HeroFilm"))
check("T1: HeroSection renders the live terminal", heroSection.includes("<HeroTerminal />"))
check("T1: reduced-motion reveals all lines instantly (CSS gate)", globals.includes(".hero-line") && /reduce\)/.test(globals))
check("T1: /demos still consumes the real session films", read(path.join(SITE, "src/app/demos/page.tsx")).includes("hero-cut.mp4"))

// --- 2. /demos page ----------------------------------------------------------------

const demos = read(path.join(SITE, "src/app/demos/page.tsx"))
check("T1: /demos page exists with real content", demos.length > 1000)
check("T1: /demos renders both verified films", demos.includes("hero-cut.mp4") && demos.includes("hero-cut-money.mp4"))
check("T1: captions bind to capture manifests (not hand-typed claims)", demos.includes("capture-manifest.json") && demos.includes("capture-manifest-money.json"))
check("T1: /demos links the machine-verified evidence", demos.includes("validation/m45/results"))

// --- 3. discovery -------------------------------------------------------------------

check("T1: /demos reachable from the main navigation", /["']\/demos["']/.test(read(path.join(SITE, "src/components/Navigation.tsx"))))
check("T1: /demos reachable from the footer", read(path.join(SITE, "src/components/SiteFooter.tsx")).includes('"/demos"'))
const sitemapSrc = read(path.join(SITE, "src/app/sitemap.ts"))
check("T1: sitemap route list includes /demos", sitemapSrc.includes('"/demos"'))

// --- 4. assets ----------------------------------------------------------------------

for (const f of ["hero-cut.mp4", "hero-cut-money.mp4", "hero-poster.jpg", "hero-poster-money.jpg"]) {
  const p = path.join(SITE, "public/demos", f)
  const ok = existsSync(p) && statSync(p).size > 50_000
  check(`T1: asset ${f} exists with sane size`, ok, ok ? "" : "missing or <50KB")
}

// --- 5. gates extended honestly -----------------------------------------------------

// The SEO gate no longer keeps its own route list: it DISCOVERS routes from
// website/src/app and demands exact sitemap parity (M41.S1 addendum 2026-09-12).
// That covers /demos more strongly than a hand-copied entry did — a route added
// without a sitemap line now fails S1 by construction — so the honest check is
// that the discovery+parity mechanism is present, and that /demos is still in
// the sitemap it compares against.
check(
  "T1: M41 SEO gate covers /demos by route discovery + sitemap parity",
  read(path.join(ROOT, "script/m41/verify-seo.ts")).includes("discoverRoutes") && sitemapSrc.includes('"/demos"'),
)
check("T1: M41 design gate accepts the live terminal hero", read(path.join(ROOT, "script/m41/verify-design.ts")).includes("HeroTerminal"))

// --- 6. build truth -------------------------------------------------------------------

const buildRoutes = read(path.join(SITE, ".next/app-path-routes-manifest.json"))
check("T1: built site contains the /demos route", buildRoutes.includes("/demos"), "run `next build` in website/ first")

// --- 7. mutation proofs (the gate can fail) -------------------------------------------

let mutantsCaught = 0
let mutantsSurvived = 0
// A mutant is caught when the predicate FAILS under the mutation.
function mutantCheck(name: string, predicateHolds: boolean): void {
  if (predicateHolds) {
    mutantsSurvived++
    console.log(`  MUTANT SURVIVED: ${name}`)
  } else {
    mutantsCaught++
    console.log(`  mutant caught: ${name}`)
  }
}

function mutated(mutator: (s: string) => string, source: string, name: string, predicate: (s: string) => boolean): void {
  const orig = readFileSync(source, "utf8")
  try {
    writeFileSync(source, mutator(orig))
    mutantCheck(name, predicate(read(source)))
  } finally {
    writeFileSync(source, orig)
  }
}

// /demos still carries the films; the zero-byte mutant guards against a
// truncated copy of the REAL evidence reaching the site.
const mp4 = path.join(SITE, "public/demos/hero-cut.mp4")
const { unlinkSync } = await import("node:fs")
const mp4Orig = readFileSync(mp4)
try {
  writeFileSync(mp4, Buffer.alloc(0))
  const zeroOk = existsSync(mp4) && statSync(mp4).size > 50_000
  mutantCheck("T1-mutant: zero-byte asset fails the size floor", zeroOk)
} finally {
  writeFileSync(mp4, mp4Orig)
  if (existsSync(mp4 + ".probe")) unlinkSync(mp4 + ".probe")
}

mutated((s) => s.replace("Usage: bb [options] [command]", "Usage: invented [fake] [lines]"), path.join(SITE, "src/components/HeroTerminal.tsx"), "T1-mutant: verbatim output replaced fails", (s) => s.includes("Usage: bb [options] [command]"))
mutated((s) => s.replace("<HeroTerminal />", "{null}"), path.join(SITE, "src/components/HeroSection.tsx"), "T1-mutant: unrendered hero figure fails", (s) => s.includes("<HeroTerminal />"))
mutated((s) => s.replace('"/demos"', '"/demoz"'), path.join(SITE, "src/app/sitemap.ts"), "T1-mutant: sitemap route dropped fails", (s) => s.includes('"/demos"'))
mutated((s) => s.replace("capture-manifest.json", "captre-manifest.json"), path.join(SITE, "src/app/demos/page.tsx"), "T1-mutant: manifest binding removed fails", (s) => s.includes("capture-manifest.json"))
mutated((s) => s.replace("'/demos'", "'/demoz'"), path.join(SITE, "src/components/Navigation.tsx"), "T1-mutant: nav link removed fails", (s) => s.includes("'/demos'"))

// --- evidence -------------------------------------------------------------------------

const ok = failed === 0
const evidence = {
  gate: "T1",
  issue: 711,
  verifierCommand: "npx tsx script/m45/verify-site-embed.ts",
  currentCommit: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  passed,
  failed,
  negativeCases: mutantsCaught,
  mutantsSurvived,
  verdict: ok ? "PASS" : "FAIL",
  checkedAt: new Date().toISOString(),
  failures,
}
writeFileSync(path.join(EV, "T1.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`\nT1 gate: ${ok ? "VERIFIED" : "FAILED"} (${passed}/${passed + failed} checks, ${mutantsCaught}/6 mutants caught)`)
if (!ok || mutantsSurvived > 0) {
  for (const f of failures) console.log(`  FAIL: ${f}`)
  process.exit(1)
}
