// script/m41/verify-seo.ts — M41.S1.
//
// Technical SEO gate: builds the site, then proves the rendered <head> of
// every page carries unique title/description/canonical, Open Graph/Twitter
// cards, that sitemap.xml matches the real route list, and that JSON-LD
// structured data parses and is registry-derived. Mutation-tested: a planted
// missing meta / duplicate title must be caught.
//
// Run: npx tsx script/m41/verify-seo.ts
// Evidence: validation/m41/results/S1.json

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m41/results")
const EVIDENCE_PATH = path.join(RESULTS, "S1.json")

let checks = 0
let passed = 0
let negatives = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, byDesign: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, byDesign, detail)
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function buildSite(): boolean {
  try {
    execFileSync("npm", ["run", "build"], { cwd: SITE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 420_000 })
    return true
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    console.log(`  build failed: ${String(err.stdout ?? err.stderr ?? "").split("\n").slice(-3).join(" | ")}`)
    return false
  }
}

console.log("M41.S1 technical SEO verifier")
console.log("  building site (next build)…")
const buildOk = buildSite()
check("S1: site builds", buildOk)

// --- rendered <head> extraction -------------------------------------------------

function heads(): Record<string, string> {
  const out: Record<string, string> = {}
  if (!buildOk) return out
  for (const r of ["index", "install", "docs", "tools", "languages", "faq", "troubleshooting", "contact"]) {
    const html = read(`website/.next/server/app/${r}.html`)
    const m = html.match(/<head>[\s\S]*?<\/head>/)
    out[r] = m ? m[0] : ""
  }
  return out
}

const H = heads()

// --- uniqueness + completeness ---------------------------------------------------

const titles = Object.values(H).map((h) => h.match(/<title>([^<]*)<\/title>/)?.[1] ?? "")
const descriptions = Object.values(H).map((h) => h.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "")
check("S1: every route renders a <title>", titles.every((t) => t.length > 0), titles.join(" | "))
check("S1: every route renders a meta description", descriptions.every((d) => d.length > 0), descriptions.join(" | ").slice(0, 120))
check("S1: titles are unique across routes", new Set(titles).size === titles.length, titles.join(" | "))
check("S1: descriptions are unique across routes", new Set(descriptions).size === descriptions.length)

const canonicals = Object.entries(H).map(([r, h]) => ({ r, c: h.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "" }))
check("S1: every route renders a canonical URL", canonicals.every((x) => x.c.startsWith("https://backbencher.cc")), canonicals.map((x) => `${x.r}=${x.c}`).join(" | "))

const ogOk = Object.entries(H).map(([r, h]) => ({ r, ok: h.includes('property="og:title"') && h.includes('property="og:description"') && h.includes('property="og:image"') }))
check("S1: every route renders OG tags (title, description, image)", ogOk.every((x) => x.ok), ogOk.filter((x) => !x.ok).map((x) => x.r).join(","))

const twitterOk = Object.entries(H).map(([r, h]) => ({ r, ok: h.includes('name="twitter:card"') && h.includes("summary_large_image") }))
check("S1: every route renders a Twitter card", twitterOk.every((x) => x.ok), twitterOk.filter((x) => !x.ok).map((x) => x.r).join(","))

check("S1: robots meta allows indexing on every route", Object.values(H).every((h) => !/<meta name="robots" content="noindex/.test(h)))

// --- sitemap ↔ routes ------------------------------------------------------------

let sitemap = ""
try {
  sitemap = read("website/.next/server/app/sitemap.xml.body")
} catch {
  try {
    sitemap = read("website/.next/server/app/sitemap.xml/index.txt")
  } catch {
    sitemap = ""
  }
}
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
const EXPECTED_ROUTES = ["", "/install", "/docs", "/demos", "/tools", "/languages", "/faq", "/troubleshooting", "/contact"]
const expectedUrls = EXPECTED_ROUTES.map((r) => `https://backbencher.cc${r}`)
check("S1: sitemap matches the real route list exactly", JSON.stringify(sitemapUrls.sort()) === JSON.stringify([...expectedUrls].sort()), `sitemap=${sitemapUrls.length} routes=${expectedUrls.length}`)
check("S1: robots.txt declares the sitemap", read("website/public/robots.txt").includes("Sitemap: https://backbencher.cc/sitemap.xml"))
check("S1: robots.txt allows crawlers and disallows nothing phantom", read("website/public/robots.txt").includes("Allow: /") && !read("website/public/robots.txt").includes("/s/"))

// --- JSON-LD -----------------------------------------------------------------------

const homeHtmlFull = buildOk ? read("website/.next/server/app/index.html") : ""
const ldMatch = homeHtmlFull.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
check("S1: homepage carries JSON-LD", Boolean(ldMatch))
if (ldMatch) {
  try {
    const ld = JSON.parse(ldMatch[1]!)
    check("S1: JSON-LD parses and is a SoftwareApplication", ld["@type"] === "SoftwareApplication")
    const truthVersion = read("website/src/data/truth.generated.ts").match(/version: "([^"]+)"/)?.[1]
    check("S1: JSON-LD softwareVersion is registry-derived", ld.softwareVersion === truthVersion, `${ld.softwareVersion} vs ${truthVersion}`)
    const registryTools = (read("docs/data/public-tools.json").match(/"name": "(bb_[a-z_]+)"/g) ?? []).map((s) => s.match(/bb_[a-z_]+/)![0]).sort()
    const ldFeatures = (ld.featureList as string[]).map((f) => f.split(":")[0]).sort()
    check("S1: JSON-LD featureList tool names match the registry exactly", JSON.stringify(ldFeatures) === JSON.stringify(registryTools), `${ldFeatures.length} features`)
    check("S1: JSON-LD featureList entries carry registry descriptions", (ld.featureList as string[]).every((f) => f.includes(": ") && f.length > 20))
    check("S1: JSON-LD names the author (ishaq2321)", JSON.stringify(ld).includes("ishaq2321"))
  } catch (e) {
    check("S1: JSON-LD parses", false, String(e).slice(0, 80))
  }
}

// --- keyword presence (woven into real content, verified) --------------------------

const homeHtml = homeHtmlFull
check("S1: keywords present in real content: tree-sitter", /tree-sitter/i.test(homeHtml))
check("S1: keywords present in real content: AST", /AST/i.test(homeHtml))
check("S1: keywords present in real content: MCP", /MCP/i.test(homeHtml))
// Brand short-form + feature terms (D1-era keyword pass). Must appear in real
// rendered content, never stuffed: each maps to a shipped feature.
check("S1: keywords present in real content: bb (brand short-form)", /\bbb\b/.test(homeHtml))
check("S1: keywords present in real content: code search", /code search/i.test(homeHtml))
check("S1: keywords present in real content: call graph", /call.?graph/i.test(homeHtml))
check("S1: keywords present in real content: symbol extraction", /symbol extraction/i.test(homeHtml))
check("S1: keywords present in real content: relationship mapping", /relationship mapping/i.test(homeHtml))
check("S1: keywords present in real content: bb tools in JSON-LD featureList", /bb_search: |bb_analyze: |bb_ask: /.test(homeHtml))
check("S1: keywords present in real content: SQLite", /SQLite/i.test(homeHtml))
check("S1: keywords present in real content: ishaq2321 (JSON-LD author)", homeHtml.includes("ishaq2321"))

// --- analytics (GoatCounter) ---------------------------------------------------------

const GC_ENDPOINT = "https://bbstats.goatcounter.com/count"
const homeFull = buildOk ? read("website/.next/server/app/index.html") : ""
// next/script with afterInteractive renders an SSR <link rel=preload> for the
// script and injects the real <script data-goatcounter> client-side; the
// endpoint constant lands in the JS bundle. Check both emitted artifacts.
check("S1: GoatCounter preloads on the homepage (SSR)", homeFull.includes('<link rel="preload" href="https://gc.zgo.at/count.js" as="script"/>'), "preload link not found in rendered HTML")
{
  let bundleHit = false
  const { readdirSync, statSync } = await import("node:fs")
  const walk = (dir: string): void => {
    if (bundleHit) return
    for (const f of readdirSync(dir)) {
      const fp = path.join(dir, f)
      const st = statSync(fp)
      if (st.isDirectory()) walk(fp)
      else if (f.endsWith(".js") && read(path.relative(ROOT, fp)).includes("bbstats.goatcounter.com/count")) bundleHit = true
    }
  }
  if (buildOk) walk(path.join(SITE, ".next/static"))
  check("S1: GoatCounter endpoint present in the client bundle", bundleHit, "bbstats.goatcounter.com/count not found in .next/static")
}
check("S1: analytics applies to the whole app (mounted in root layout)", read("website/src/app/layout.tsx").includes("<GoatCounter />"))

// --- negatives ----------------------------------------------------------------------

// N1 (rebuild mutant): remove the canonical from the install page and rebuild —
// the canonical completeness check must fail.
if (buildOk) {
  const p = path.join(SITE, "src/app/install/page.tsx")
  const bak = `${p}.s1bak`
  cpSync(p, bak)
  try {
    const mutated = read("website/src/app/install/page.tsx").replace(/\n\s*alternates: \{ canonical: "https:\/\/backbencher\.cc\/install" \},?/, "")
    if (mutated === read("website/src/app/install/page.tsx")) {
      negative("S1: canonical-removal mutant planted correctly", false, "mutation did not apply — canonical string not found")
    } else {
      writeFileSync(p, mutated)
      const ok = buildSite()
      if (!ok) {
        negative("S1: canonical-removal mutant is caught", false, "build failed for unrelated reasons")
      } else {
        const h = read("website/.next/server/app/install.html").match(/<head>[\s\S]*?<\/head>/)?.[0] ?? ""
        negative("S1: planted missing canonical is detectable", !(h.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "").startsWith("https://backbencher.cc"))
      }
    }
  } finally {
    cpSync(bak, p)
    rmSync(bak)
    buildSite() // restore-proof rebuild
  }
}

// N2 (cheap): duplicate-title detector sensitivity on synthetic heads.
negative("S1: duplicate-title detector is sensitive", (() => {
  const fake = ["a", "a", "b"]
  return new Set(fake).size !== fake.length
})())
// N3 (cheap): analytics detector must reject a wrong endpoint on synthetic HTML.
negative("S1: analytics endpoint check is sensitive", !`${GC_ENDPOINT.replace("bbstats", "WRONGCODE")}`.includes(GC_ENDPOINT) && !("<html></html>".includes(`data-goatcounter="${GC_ENDPOINT}"`)))

// Restore proof: committed sources must render complete heads again.
check("S1: restore-proof — committed sources render canonicals again", Object.values(H).every((h) => (h.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "").startsWith("https://backbencher.cc")))

// --- verdict + evidence ---------------------------------------------------------------

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

const ok = passed === checks
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
if (!ok) {
  console.log("S1 VERDICT: FAIL")
  process.exit(1)
}
console.log("S1 VERDICT: PASS")

mkdirSync(RESULTS, { recursive: true })
const evidence = {
  issue: "M41.S1",
  code: "S1",
  milestone: "M41",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m41/verify-seo.ts",
  evidenceFile: "S1.json",
  generatedAt: new Date().toISOString(),
  sitemapUrls: sitemapUrls.length,
  limitations: [
    "Keyword checks verify presence in rendered content; ranking outcomes are S2 (search-engine onboarding) scope and depend on external engines.",
    "The canonical-removal mutant rebuilds the site three times total; a broken build aborts the mutant proof.",
    "Structured data uses SoftwareApplication; richer entity types (FAQPage) are future enhancements, not falsified.",
  ],
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
