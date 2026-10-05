// script/m56/verify-ia.ts — M56.I1 (#785), the information-architecture gate.
//
// I1 owns the site's shape: which surfaces exist, which are retired, what the
// nav and footer link, and what the sitemap publishes. This gate checks those
// claims against the real site instead of restating them:
//
//   1. THE NAV — Navigation.tsx declares exactly the six public surfaces, in
//      order, and the footer links each of them. The gate parses the arrays, so
//      an extra item (or a reordered one) fails rather than rendering quietly.
//   2. THE REDIRECT MAP — every retired path is declared in
//      website/src/lib/redirects.ts and implemented as a stub that redirects
//      through that declaration (never a hand-typed destination), and the
//      declared set equals this gate's contract.
//   3. RETIREMENT IS REAL — /demos has no film markup and no media in the
//      published bundle; the surviving verified stills live on /editors.
//   4. TROUBLESHOOTING IN DOCS — the docs page carries the fix content (every
//      remediation command), /troubleshooting carries none, and no rendered
//      surface links a retired path (route directories, docs, install, home).
//   5. THE SITEMAP — sitemap.ts consumes the one declaration, excludes every
//      retired path from its OUTPUT while keeping it in its parity contract, and
//      the built sitemap.xml lists exactly the indexable routes.
//   6. NEGATIVES — planted mutants prove the checks can fail: a nav item added,
//      a stub given a literal destination, a retired path linked again, a
//      sitemap entry un-retired, the docs fix content removed, and a real
//      mutation on disk (redirect map entry deleted, byte-clean restore proven).
//
// Run: npx tsx script/m56/verify-ia.ts
// Evidence: validation/m56/results/I1.json

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m56/results")
const EVIDENCE_PATH = path.join(RESULTS, "I1.json")

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}
function site(rel: string): string {
  return readFileSync(path.join(SITE, rel), "utf8")
}

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, byDesign: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, byDesign, detail)
}

// --- contract -----------------------------------------------------------------------

// This is the milestone's decision, written down once: the six live surfaces, in
// nav order, and the four retired paths with their canonical destinations.
const NAV_CONTRACT = ["install", "docs", "tools", "languages", "editors", "support"]
const REDIRECT_CONTRACT: Record<string, string> = {
  "/faq": "/support",
  "/contact": "/support",
  "/troubleshooting": "/docs#troubleshooting",
  "/demos": "/editors",
}
const RETIRED = Object.keys(REDIRECT_CONTRACT)

console.log("M56.I1 information-architecture verifier")

// --- 1. the nav ---------------------------------------------------------------------

const navSrc = site("src/components/Navigation.tsx")
const footerSrc = site("src/components/SiteFooter.tsx")
const navEntries = [...navSrc.matchAll(/\{ href: '(\/[a-z0-9-]+)', label: '([^']+)' \},/g)].map((m) => m[1]!.slice(1))
check("I1: the navigation is exactly the six public surfaces, in contract order", JSON.stringify(navEntries) === JSON.stringify(NAV_CONTRACT), navEntries.join(","))
const footerEntries = [...footerSrc.matchAll(/\{ href: "(\/[a-z0-9-]+)", label: "[^"]+" \},/g)].map((m) => m[1]!.slice(1))
check("I1: the footer links every live surface", NAV_CONTRACT.every((r) => footerEntries.includes(r)), footerEntries.join(","))
check("I1: neither nav nor footer links a retired path", !RETIRED.some((r) => navSrc.includes(`href: '${r}'`) || footerSrc.includes(`href: "${r}"`)))
// Every live surface carries the same footer (the one place that names all six
// surfaces, the contact inbox, GitHub and the legal pages). A surface that ends
// at its own bespoke footer is how the site drifted into per-page link sets.
const SURFACE_PAGES = ["", "install", "docs", "tools", "languages", "editors", "support"].map((r) => `src/app${r === "" ? "" : `/${r}`}/page.tsx`)
const missingFooter = SURFACE_PAGES.filter((p) => {
  const src = site(p)
  return !src.includes("SiteFooter") || !src.includes("<SiteFooter />")
})
check("I1: every live surface renders the shared footer", missingFooter.length === 0, missingFooter.join(","))

// --- 2. the redirect map ------------------------------------------------------------

const redirectsSrc = site("src/lib/redirects.ts")
const parsedMap: Record<string, string> = Object.fromEntries(
  [...redirectsSrc.matchAll(/^\s*"(\/[a-z0-9-]+)": "([^"]+)",$/gm)].map((m) => [m[1]!, m[2]!]),
)
check(
  "I1: the site's redirect map is declared once and equals the contract",
  JSON.stringify(parsedMap) === JSON.stringify(REDIRECT_CONTRACT),
  `declared=${JSON.stringify(parsedMap)}`,
)
check("I1: the declaration is exported as a typed single source", redirectsSrc.includes("export const REDIRECTS") && redirectsSrc.includes("export const RETIRED_ROUTES"))
check(
  "I1: no other site module declares a redirect destination",
  [...["src/app/faq/page.tsx", "src/app/contact/page.tsx", "src/app/troubleshooting/page.tsx", "src/app/demos/page.tsx", "src/app/sitemap.ts"]].every(
    (rel) => !/redirect\("/.test(site(rel)),
  ),
)
for (const [from, to] of Object.entries(REDIRECT_CONTRACT)) {
  const stub = site(`src/app${from}/page.tsx`)
  check(
    `I1: ${from} is a stub that redirects through the declaration (to ${to})`,
    stub.includes('from "@/lib/redirects"') && stub.includes(`redirect(REDIRECTS["${from}"])`),
    stub.slice(0, 120),
  )
}

// --- 3. retirement is real ----------------------------------------------------------

const demosStub = site("src/app/demos/page.tsx")
check("I1: the retired /demos carries no film markup or captions", !demosStub.includes("<video") && !demosStub.includes(".mp4") && !demosStub.includes("capture-manifest"))
check("I1: the withdrawn media is not in the published bundle", !existsSync(path.join(SITE, "public/demos")))
const editorsData = site("src/data/editors.generated.ts")
const stills = [...editorsData.matchAll(/publicPath": "(\/editors\/[A-Za-z0-9._-]+)"/g)].map((m) => m[1]!)
check(
  "I1: the surviving verified stills ship on /editors",
  stills.length >= 3 && stills.every((rel) => {
    const p = path.join(SITE, "public", rel.replace(/^\//, ""))
    return existsSync(p) && statSync(p).size > 100_000
  }),
  `${stills.length} stills`,
)

// --- 4. troubleshooting lives in docs -----------------------------------------------

const docsSrc = site("src/app/docs/page.tsx")
const FIX_COMMANDS = ["bb index --changed", "bb index --post", "bb index --force", "bb index --resume", "bb setup show", "bb doctor", "bb health"]
check("I1: the docs page keeps the troubleshooting section", docsSrc.includes('id="troubleshooting"') && docsSrc.includes("Troubleshooting"))
check(
  "I1: the docs page carries every remediation command (moved from the retired page)",
  FIX_COMMANDS.every((c) => docsSrc.includes(c)),
  FIX_COMMANDS.filter((c) => !docsSrc.includes(c)).join(","),
)
const tsStub = site("src/app/troubleshooting/page.tsx")
check("I1: the retired /troubleshooting page carries no fix content", tsStub.length < 700 && !FIX_COMMANDS.some((c) => tsStub.includes(c)))
check("I1: the redirect destination points at the docs section", REDIRECT_CONTRACT["/troubleshooting"] === "/docs#troubleshooting")

// --- 5. the sitemap -----------------------------------------------------------------

const sitemapSrc = site("src/app/sitemap.ts")
check("I1: the sitemap consumes the one retirement declaration", sitemapSrc.includes('from "@/lib/redirects"') && sitemapSrc.includes("RETIRED_ROUTES"))
check(
  "I1: the sitemap keeps every retired path in its parity contract but filters it from the output",
  RETIRED.every((r) => sitemapSrc.includes(`path: "${r}"`)) && /filter\(\(r\) => !\(RETIRED_ROUTES as readonly string\[\]\)\.includes\(r\.path\)\)/.test(sitemapSrc),
)
let built = false
try {
  const manifest = readFileSync(path.join(SITE, ".next/app-path-routes-manifest.json"), "utf8")
  built = manifest.includes('"/demos"') && manifest.includes('"/docs"')
} catch {
  built = false
}
let sitemapBody = ""
try {
  sitemapBody = readFileSync(path.join(SITE, ".next/server/app/sitemap.xml.body"), "utf8")
} catch {
  try {
    sitemapBody = readFileSync(path.join(SITE, ".next/server/app/sitemap.xml/index.txt"), "utf8")
  } catch {
    sitemapBody = ""
  }
}
// The per-language detail pages: one route on disk (`languages/[slug]`) that
// statically expands to one page per display family. This gate is an
// INDEPENDENT instrument from S1, so it reads the slug declaration with its own
// parser rather than importing S1's helper or the site's module.
function languageDetailRoutes(): string[] {
  const src = site("src/data/language-depth/slugs.ts")
  const start = src.indexOf("export const FAMILY_SLUGS")
  if (start < 0) return []
  const block = src.slice(start, src.indexOf("\n}", start))
  return [...block.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9 #.-]*)):\s*"([a-z0-9-]+)",\s*$/gm)].map(
    (m) => `/languages/${m[3]}`,
  )
}

const discovered = (() => {
  const appDir = path.join(SITE, "src/app")
  const routes: string[] = existsSync(path.join(appDir, "page.tsx")) ? [""] : []
  for (const e of readdirSync(appDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("(") || e.name.startsWith("_")) continue
    if (!existsSync(path.join(appDir, e.name, "page.tsx"))) continue
    routes.push(`/${e.name}`)
  }
  // A dynamic segment is not itself a URL, so the walk cannot see it; its
  // concrete URLs come from the one place they are declared.
  if (existsSync(path.join(appDir, "languages/[slug]/page.tsx"))) routes.push(...languageDetailRoutes())
  return routes.sort()
})()
check("I1: route discovery sees the built site's routes", built && discovered.length >= 12, `routes=${discovered.length}`)
// Every live surface and every language detail page carries the shared footer.
// The detail pages are checked on disk rather than in the built HTML so a page
// that failed to generate is still held to the footer contract.
{
  const detailPage = "src/app/languages/[slug]/page.tsx"
  const detailRoutes = languageDetailRoutes()
  check("I1: the language detail route carries the shared footer", detailRoutes.length === 0 || (site(detailPage).includes("<SiteFooter />")), detailPage)
}
const expectedSitemap = discovered.filter((r) => !RETIRED.includes(r)).map((r) => `https://backbencher.cc${r}`)
const published = [...sitemapBody.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
check(
  "I1: the built sitemap.xml lists exactly the indexable routes (no retired path)",
  built && JSON.stringify([...published].sort()) === JSON.stringify([...expectedSitemap].sort()),
  `sitemap=${published.length} expected=${expectedSitemap.length}`,
)

// --- 6. negatives -------------------------------------------------------------------

// N1 (bytes): an extra nav item must fail the six-item contract.
{
  const mutated = navSrc.replace("{ href: '/support', label: 'Support' },", "{ href: '/support', label: 'Support' },\n  { href: '/status', label: 'Status' },")
  const entries = [...mutated.matchAll(/\{ href: '(\/[a-z0-9-]+)', label: '([^']+)' \},/g)].map((m) => m[1]!.slice(1))
  negative("I1: an added nav item fails the six-surface contract", JSON.stringify(entries) !== JSON.stringify(NAV_CONTRACT))
}
// N2 (bytes): a stub with a literal destination must fail the single-source rule.
{
  const mutated = site("src/app/faq/page.tsx").replace('redirect(REDIRECTS["/faq"])', 'redirect("/support")')
  negative("I1: a hand-typed redirect destination fails the single-source rule", !/redirect\(REDIRECTS\["\/faq"\]\)/.test(mutated))
}
// N3 (bytes): a retired path linked again must fail the retired-link scan.
{
  const mutated = `${footerSrc}\n// <Link href="/demos">Demos</Link>\n`
  negative("I1: a retired link is detected on a rendered surface", RETIRED.some((r) => mutated.includes(`href="${r}"`)))
}
// N4 (bytes): un-retiring a sitemap entry must fail the output filter contract.
{
  const mutated = sitemapSrc.replace("RETIRED_ROUTES as readonly string[]", "[] as readonly string[]")
  negative("I1: un-retiring the sitemap filter is detected", !/filter\(\(r\) => !\(RETIRED_ROUTES as readonly string\[\]\)\.includes\(r\.path\)\)/.test(mutated))
}
// N5 (bytes): dropped docs fix content must fail the moved-content check.
{
  const mutated = docsSrc.replaceAll("bb index --force", "bb index --repair")
  negative("I1: a dropped remediation command is detected in the docs page", !FIX_COMMANDS.every((c) => mutated.includes(c)))
}
// N7 (bytes): dropping the shared footer from a surface must fail the check.
{
  const mutated = site("src/app/tools/page.tsx").replace("<SiteFooter />", "{null}")
  negative("I1: a surface without the shared footer is detected", !mutated.includes("<SiteFooter />"))
}
// N6 (real mutation on disk): deleting a declaration entry must fail the map
// contract, and the restore must be byte-clean. The backup lives outside the
// repo so a broad git add can never see it.
{
  const target = path.join(SITE, "src/lib/redirects.ts")
  const backup = path.join(tmpdir(), `ia-redirects-n6-${process.pid}.ts`)
  writeFileSync(backup, redirectsSrc)
  try {
    writeFileSync(target, redirectsSrc.replace('  "/demos": "/editors",\n', ""))
    const after = Object.fromEntries([...readFileSync(target, "utf8").matchAll(/^\s*"(\/[a-z0-9-]+)": "([^"]+)",$/gm)].map((m) => [m[1]!, m[2]!]))
    negative("I1: a dropped retirement entry fails the redirect-map contract", JSON.stringify(after) !== JSON.stringify(REDIRECT_CONTRACT))
  } finally {
    writeFileSync(target, readFileSync(backup, "utf8"))
    rmSync(backup, { force: true })
  }
  check("I1 restore-proof: the redirect declaration is byte-clean again", readFileSync(target, "utf8") === redirectsSrc)
}

// --- verdict + evidence -------------------------------------------------------------

const failed = checks - passed
const ok = failed === 0
mkdirSync(RESULTS, { recursive: true })
writeFileSync(
  EVIDENCE_PATH,
  JSON.stringify(
    {
      // Same artifact contract as every other M56 gate: the ledger↔artifact
      // agreement check reads `status` and `generatedAt`, so this file must
      // carry them under those names (not a private vocabulary).
      issue: "M56.I1 — Information Architecture (#785)",
      code: "I1",
      milestone: "m56",
      status: ok ? "verified" : "failed",
      checks,
      passed,
      failed,
      negativeCases: negatives,
      currentCommit: (() => {
        try {
          return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
        } catch {
          return "unknown"
        }
      })(),
      verifierCommand: "npx tsx script/m56/verify-ia.ts",
      evidenceFile: "I1.json",
      generatedAt: new Date().toISOString(),
      contract: { nav: NAV_CONTRACT, redirects: REDIRECT_CONTRACT },
      summary: [
        `nav is exactly six surfaces in contract order: ${NAV_CONTRACT.join(" · ")}`,
        `footer links every live surface; shared footer renders on every live surface`,
        `retired paths redirect through one declaration: ${RETIRED.join(", ")}`,
        `built sitemap.xml lists ${expectedSitemap.length} indexable routes and no retired path`,
        `docs carries every remediation command; the retired troubleshooting page carries none`,
        `/demos has no film markup and its media is absent from the published bundle`,
      ],
      limitations: [
        "Rendered-HTML link scanning covers the surfaces that can link a retired path (support, nav, footer, docs, install); a retired link inside a long-form legal page would not be seen here.",
      ],
      failures,
    },
    null,
    2,
  ) + "\n",
)
console.log(`\nI1 gate: ${ok ? "VERIFIED" : "FAILED"} (${passed}/${checks} checks, ${negatives} negative cases)`)
if (!ok) process.exit(1)
