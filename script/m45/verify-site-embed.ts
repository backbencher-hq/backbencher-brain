// script/m45/verify-site-embed.ts — M45.T1 (#711), the website-embed gate.
//
// SCOPE CHANGE (recorded, not deleted — M56.I1, #785): /demos is RETIRED.
// The owner withdrew both films after review (pacing and craft, not truth).
// The hero decision is unchanged (video-free, live verbatim terminal), and the
// machine-verified session stills from the same harness are the proof that
// survives — they now serve on /editors. So this gate still asserts that the
// verified M45 material reaches the site, but the retired page is asserted as
// RETIRED (a redirect, no media, no nav/sitemap entry) rather than live.
//
// Checks:
//   1. Hero figure: HeroTerminal exists, renders REAL verbatim CLI output, and
//      HeroSection actually renders it. The hero is VIDEO-FREE (owner decision
//      2026-09-12): no film lives in the hero. Reduced-motion reveals all lines.
//   2. Retirement: /demos is a redirect stub to /editors through the site's one
//      redirect declaration; the withdrawn media is gone from the published
//      bundle; no source references the /demos/ asset path.
//   3. Discovery: no retired path is linked from Navigation or the footer, and
//      the sitemap keeps /demos only as a parity entry excluded by the
//      RETIRED_ROUTES filter (a sitemap lists canonical URLs only).
//   4. Surviving proof: the verified stills the harness produced ship on
//      /editors under website/public/editors.
//   5. Gates extended honestly: the M41 SEO gate pins the retirement in its
//      redirect contract; the M41 design gate accepts the live terminal hero.
//   6. Build truth: the Next build output still carries the /demos route (as a
//      redirect — the URL stays valid for bookmarks).
//   7. Six planted mutations prove the checks can fail (verbatim line replaced,
//      hero figure unrendered, /demos resurrected as a content page, /demos
//      re-added to the nav, withdrawn media re-added, redirect destination
//      drifted).
//
// Run: npx tsx script/m45/verify-site-embed.ts
// Evidence: validation/m45/results/T1.json

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync, readdirSync } from "node:fs"
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

const RETIRED = ["/demos", "/faq", "/contact", "/troubleshooting"]

// --- 1. hero figure (video-free by owner decision) ----------------------------------

const heroTerminal = read(path.join(SITE, "src/components/HeroTerminal.tsx"))
const heroSection = read(path.join(SITE, "src/components/HeroSection.tsx"))
const globals = read(path.join(SITE, "src/app/globals.css"))
check("T1: HeroTerminal component exists", heroTerminal.length > 200)
check("T1: hero terminal shows verbatim CLI output (not invented)", heroTerminal.includes('"bb --version"') && heroTerminal.includes("Usage: bb [options] [command]"))
check("T1: hero figure is video-free (owner decision 2026-09-12)", !heroSection.includes("<video") && !heroSection.includes("HeroFilm"))
check("T1: HeroSection renders the live terminal", heroSection.includes("<HeroTerminal />"))
check("T1: reduced-motion reveals all lines instantly (CSS gate)", globals.includes(".hero-line") && /reduce\)/.test(globals))

// --- 2. /demos is retired -----------------------------------------------------------

const redirectsSrc = read(path.join(SITE, "src/lib/redirects.ts"))
const demosStub = read(path.join(SITE, "src/app/demos/page.tsx"))
check("T1: the site declares its redirect map in one module", redirectsSrc.includes("export const REDIRECTS") && redirectsSrc.includes("RETIRED_ROUTES"))
check("T1: the declaration retires /demos to /editors", /"\/demos":\s*"\/editors"/.test(redirectsSrc))
check("T1: /demos is a redirect stub, not a page", demosStub.includes('from "@/lib/redirects"') && demosStub.includes('redirect(REDIRECTS["/demos"])'))
check("T1: the retired page carries no film markup", !demosStub.includes("<video") && !demosStub.includes(".mp4") && !demosStub.includes("capture-manifest"))
check("T1: the withdrawn media is gone from the published bundle", !existsSync(path.join(SITE, "public/demos")))
function sourceFilesReferencing(needle: string): string[] {
  const hits: string[] = []
  const stack = ["src/app", "src/components", "src/data", "src/lib"].map((d) => path.join(SITE, d))
  while (stack.length) {
    const p = stack.pop()!
    if (!existsSync(p)) continue
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) stack.push(path.join(p, f))
      continue
    }
    if (/\.(tsx?|css|md)$/.test(p) && read(p).includes(needle)) hits.push(path.relative(ROOT, p))
  }
  return hits
}
const demosAssetRefs = sourceFilesReferencing("/demos/")
check("T1: no site source references the withdrawn /demos/ assets", demosAssetRefs.length === 0, demosAssetRefs.join(","))

// --- 3. discovery -------------------------------------------------------------------

const navSrc = read(path.join(SITE, "src/components/Navigation.tsx"))
const footerSrc = read(path.join(SITE, "src/components/SiteFooter.tsx"))
check("T1: no retired path is linked from the navigation", !RETIRED.some((r) => navSrc.includes(`href: '${r}'`)))
check("T1: no retired path is linked from the footer", !RETIRED.some((r) => footerSrc.includes(`href: "${r}"`)))
const sitemapSrc = read(path.join(SITE, "src/app/sitemap.ts"))
check("T1: the sitemap keeps /demos only as a parity entry excluded by the retirement filter", sitemapSrc.includes('"/demos"') && sitemapSrc.includes("RETIRED_ROUTES") && /filter\(\(r\) => !\(RETIRED_ROUTES/.test(sitemapSrc))

// --- 4. surviving proof --------------------------------------------------------------

const editorsPage = read(path.join(SITE, "src/app/editors/page.tsx"))
const editorsData = read(path.join(SITE, "src/data/editors.generated.ts"))
check("T1: /editors renders the surviving capture stills", editorsPage.includes("still.publicPath") && editorsData.includes('"/editors/'))
const stills = [...editorsData.matchAll(/publicPath": "(\/editors\/[A-Za-z0-9._-]+)"/g)].map((m) => m[1]!)
check("T1: every surviving still ships as a real file with a size floor", stills.length >= 3 && stills.every((rel) => {
  const p = path.join(SITE, "public", rel.replace(/^\//, ""))
  return existsSync(p) && statSync(p).size > 100_000
}), `${stills.length} stills`)

// --- 5. gates extended honestly -----------------------------------------------------

const seoGate = read(path.join(ROOT, "script/m41/verify-seo.ts"))
check(
  "T1: the M41 SEO gate pins the /demos retirement in its redirect contract",
  seoGate.includes('"/demos": "/editors"') && seoGate.includes("EXPECTED_REDIRECTS"),
)
check("T1: M41 design gate accepts the live terminal hero", read(path.join(ROOT, "script/m41/verify-design.ts")).includes("HeroTerminal"))

// --- 6. build truth -----------------------------------------------------------------

const buildRoutes = read(path.join(SITE, ".next/app-path-routes-manifest.json"))
check("T1: built site still carries the /demos route (as a redirect)", buildRoutes.includes("/demos"), "run `next build` in website/ first")

// --- 7. mutation proofs (the gate can fail) ------------------------------------------

let mutantsCaught = 0
let mutantsSurvived = 0
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

mutated((s) => s.replace("Usage: bb [options] [command]", "Usage: invented [fake] [lines]"), path.join(SITE, "src/components/HeroTerminal.tsx"), "T1-mutant: verbatim output replaced fails", (s) => s.includes("Usage: bb [options] [command]"))
mutated((s) => s.replace("<HeroTerminal />", "{null}"), path.join(SITE, "src/components/HeroSection.tsx"), "T1-mutant: unrendered hero figure fails", (s) => s.includes("<HeroTerminal />"))
// Resurrect /demos as a content page: the retirement predicate must fail.
mutated(
  (s) => s.replace('redirect(REDIRECTS["/demos"])', '<video src="/demos/hero-cut.mp4" />'),
  path.join(SITE, "src/app/demos/page.tsx"),
  "T1-mutant: /demos resurrected as a content page fails",
  (s) => s.includes('redirect(REDIRECTS["/demos"])') && !s.includes("<video"),
)
// Re-add /demos to the nav: the retired-link predicate must fail.
mutated(
  (s) => s.replace("{ href: '/editors', label: 'Editors' },", "{ href: '/editors', label: 'Editors' },\n  { href: '/demos', label: 'Demos' },"),
  path.join(SITE, "src/components/Navigation.tsx"),
  "T1-mutant: retired path re-added to the nav fails",
  (s) => !RETIRED.some((r) => s.includes(`href: '${r}'`)),
)
// Re-add withdrawn media: the bundle predicate must fail.
{
  const dir = path.join(SITE, "public/demos")
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "hero-cut.mp4"), Buffer.alloc(60_000))
    mutantCheck("T1-mutant: withdrawn media re-added to the bundle fails", !existsSync(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
// Drift the declared destination: the retirement predicate must fail.
mutated(
  (s) => s.replace('"/demos": "/editors"', '"/demos": "/tools"'),
  path.join(SITE, "src/lib/redirects.ts"),
  "T1-mutant: drifted redirect destination fails",
  (s) => /"\/demos":\s*"\/editors"/.test(s),
)

// --- evidence -----------------------------------------------------------------------

const ok = failed === 0
const evidence = {
  gate: "T1",
  issue: 711,
  scopeChange: "M56.I1 (#785): /demos retired by owner decision; withdrawn films removed from the published bundle, retired URL redirects to /editors, surviving verified stills serve on /editors.",
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
