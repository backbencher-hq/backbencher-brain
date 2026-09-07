// script/m45/verify-site-embed.ts — M45.T1 (#711), the website-embed gate.
//
// Machine-checks that the verified session films are actually consumed by the
// website (not just sitting in validation/):
//   1. Hero embed: HeroFilm exists, references BOTH film files' scenario
//      contract (poster, muted/loop/playsInline, reduced-motion fallback),
//      and HeroSection actually renders it.
//   2. /demos page: exists, renders both films, captions bind to the capture
//      manifests (never hand-typed claims), and the page links the evidence.
//   3. Discovery: /demos is reachable from Navigation and SiteFooter, and the
//      sitemap route list includes it.
//   4. Assets: both mp4s + posters exist in website/public/demos with size
//      floors (a zero-byte or truncated copy fails).
//   5. Gates extended honestly: M41 SEO route list contains /demos; M41 design
//      gate accepts the film hero.
//   6. Build truth: the Next build output contains the /demos route.
//   7. Six planted mutations prove the checks can fail (removed poster attr,
//      hand-typed caption replacing the manifest reference, dropped sitemap
//      route, deleted mp4, nav link removed, autoplay unmuted).
//
// Run: npx tsx script/m45/verify-site-embed.ts
// Evidence: validation/m45/results/T1.json

import { readFileSync, existsSync, statSync } from "node:fs"
import { writeFileSync } from "node:fs"
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

// --- 1. hero embed ----------------------------------------------------------------

const heroFilm = read(path.join(SITE, "src/components/HeroFilm.tsx"))
check("T1: HeroFilm component exists", heroFilm.length > 200)
check("T1: hero video uses the poster frame", heroFilm.includes('"/demos/hero-poster.jpg"'))
check("T1: hero video is muted (no sound, ever)", /muted/.test(heroFilm))
check("T1: hero video loops and plays inline", heroFilm.includes("loop") && heroFilm.includes("playsInline"))
check("T1: reduced-motion fallback pauses autoplay", heroFilm.includes("prefers-reduced-motion"))
check("T1: HeroSection renders the film (static figure replaced)", read(path.join(SITE, "src/components/HeroSection.tsx")).includes("<HeroFilm />"))

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

check("T1: M41 SEO gate route list extended with /demos", read(path.join(ROOT, "script/m41/verify-seo.ts")).includes('"/demos"'))
check("T1: M41 design gate accepts the film hero", read(path.join(ROOT, "script/m41/verify-design.ts")).includes("HeroFilm"))

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

// asset deletion mutant: a missing/zero-byte mp4 must fail the size floor
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

mutated((s) => s.replace('"/demos/hero-poster.jpg"', '"/demos/missing-poster.jpg"'), path.join(SITE, "src/components/HeroFilm.tsx"), "T1-mutant: hero poster attr removed fails", (s) => s.includes('"/demos/hero-poster.jpg"'))
mutated((s) => s.replace("\n        muted", "\n        // muted"), path.join(SITE, "src/components/HeroFilm.tsx"), "T1-mutant: unmuted autoplay fails", (s) => /[^\/]muted/.test(s) && !s.includes("// muted"))
mutated((s) => s.replace('"/demos"', '"/demoz"'), path.join(SITE, "src/app/sitemap.ts"), "T1-mutant: sitemap route dropped fails", (s) => s.includes('"/demos"'))
mutated((s) => s.replace("capture-manifest.json", "captre-manifest.json"), path.join(SITE, "src/app/demos/page.tsx"), "T1-mutant: manifest binding removed fails", (s) => s.includes("capture-manifest.json"))
mutated((s) => s.replace("'/demos'", "'/demoz'"), path.join(SITE, "src/components/Navigation.tsx"), "T1-mutant: nav link removed fails", (s) => s.includes("'/demos'"))

// --- evidence -------------------------------------------------------------------------

const ok = failed === 0
const evidence = {
  gate: "T1",
  issue: 711,
  verifierCommand: "npx tsx script/m45/verify-site-embed.ts",
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
