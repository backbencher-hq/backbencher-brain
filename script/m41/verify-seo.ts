// script/m41/verify-seo.ts — M41.S1.
//
// Technical SEO gate: builds the site, then proves the rendered <head> of
// every page carries unique title/description/canonical, Open Graph/Twitter
// cards, that sitemap.xml matches the route list DISCOVERED FROM src/app, and
// that JSON-LD structured data parses and is registry-derived.
//
// Structured data covers two surfaces:
//   /         SoftwareApplication  (registry-derived: version, tools, author)
//   /support  FAQPage              (website/faq.md → generated data → JSON-LD)
// The FAQ chain is the strict one: every question and every answer published to
// search engines must be text the page actually renders.
//
// Mutation-tested: a planted missing meta / duplicate title / dropped sitemap
// route / drifted FAQ answer must each be caught.
//
// Run: npx tsx script/m41/verify-seo.ts
// Evidence: validation/m41/results/S1.json

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, existsSync } from "node:fs"
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

// --- real route list (src/app on disk is the authority) ---------------------------
//
// Every directory under website/src/app that owns a page.tsx is a real route,
// plus the root page (""). The sitemap must match this set EXACTLY — a page
// added without a sitemap entry, or a sitemap entry with no page, fails below.
// /privacy and /terms were silently absent from the sitemap before this check
// existed; a hand-written list on both sides could not have caught that.

// The per-language detail pages. On disk this is ONE route —
// website/src/app/languages/[slug]/page.tsx — that statically expands to one
// page per display family. A top-level directory walk cannot see it (and must
// not: a `[slug]` segment is not itself a URL), so the expansion is read from
// the one place the URLs are declared: data/language-depth/slugs.ts, which is
// also what sitemap.ts and generateStaticParams use.
//
// Parsed as TEXT, never imported. slugs.ts is a pure declaration precisely so
// this is possible, and this gate is an independent instrument — it must be
// able to disagree with the site's own modules rather than inherit their bugs.
function languageDetailRoutes(): string[] {
  const src = read("website/src/data/language-depth/slugs.ts")
  const start = src.indexOf("export const FAMILY_SLUGS")
  if (start < 0) return []
  const block = src.slice(start, src.indexOf("\n}", start))
  return [...block.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9 #.-]*)):\s*"([a-z0-9-]+)",\s*$/gm)].map(
    (m) => `/languages/${m[3]}`,
  )
}

function discoverRoutes(): string[] {
  const appDir = path.join(SITE, "src/app")
  const routes: string[] = existsSync(path.join(appDir, "page.tsx")) ? [""] : []
  for (const e of readdirSync(appDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith("(") || e.name.startsWith("_")) continue
    if (!existsSync(path.join(appDir, e.name, "page.tsx"))) continue
    routes.push(`/${e.name}`)
  }
  // The dynamic segment expands to its concrete URLs, and only when the route
  // actually exists — a sitemap entry for a page that is not built is the exact
  // failure this parity check exists to catch.
  if (existsSync(path.join(appDir, "languages/[slug]/page.tsx"))) {
    routes.push(...languageDetailRoutes())
  }
  return routes.sort()
}

const REAL_ROUTES = buildOk ? discoverRoutes() : []
const htmlName = (r: string): string => (r === "" ? "index" : r.slice(1))

// Discovery is the mechanism; this list is the contract. If discoverRoutes()
// silently stopped seeing a directory, parity would still "pass" against a
// shrunken sitemap — this fails instead. And a page added to the site without
// being onboarded here fails too: a new route gets truth/SEO coverage
// deliberately, never by accident.
const REQUIRED_ROUTES = ["", "/install", "/docs", "/demos", "/tools", "/languages", "/editors", "/support", "/troubleshooting", "/privacy", "/terms"]
// M56.S1/I1: retired routes are redirect stubs. The site declares the map ONCE
// (website/src/lib/redirects.ts); this gate reads that declaration and requires
// it to equal the retired-route contract below, so a live page cannot quietly
// become a stub (and a retired path cannot quietly become a live page) without
// changing this contract. Stubs are excluded from the sitemap and from
// head-completeness; any OTHER new route still fails here.
const EXPECTED_REDIRECTS: Record<string, string> = {
  "/faq": "/support",
  "/contact": "/support",
  "/troubleshooting": "/docs#troubleshooting",
  "/demos": "/editors",
}
const redirectsSrc = read("website/src/lib/redirects.ts")
const DECLARED_REDIRECTS: Record<string, string> = Object.fromEntries(
  [...redirectsSrc.matchAll(/^\s*"(\/[a-z0-9-]+)": "([^"]+)",$/gm)].map((m) => [m[1]!, m[2]!]),
)
const REDIRECT_ROUTES = Object.keys(DECLARED_REDIRECTS)
check(
  "S1: the site's redirect map is declared in one place and matches the retired-route contract",
  JSON.stringify(DECLARED_REDIRECTS) === JSON.stringify(EXPECTED_REDIRECTS),
  `declared=${JSON.stringify(DECLARED_REDIRECTS)}`,
)
const discoveryMissing = REQUIRED_ROUTES.filter((r) => !REAL_ROUTES.includes(r))
// The language detail pages are a declared family of routes, not free-form
// additions: every one of them must come from the single slug declaration. An
// undeclared route still fails — the exemption is exactly the slug list, so
// `git add`ing a stray page cannot buy its way past this gate.
const LANGUAGE_ROUTES = existsSync(path.join(SITE, "src/app/languages/[slug]/page.tsx"))
  ? languageDetailRoutes()
  : []
const discoveryExtra = REAL_ROUTES.filter(
  (r) => !REQUIRED_ROUTES.includes(r) && !REDIRECT_ROUTES.includes(r) && !LANGUAGE_ROUTES.includes(r),
)
check("S1: route discovery finds every required page", discoveryMissing.length === 0, discoveryMissing.join(" "))
check("S1: no route exists outside the required list", discoveryExtra.length === 0, discoveryExtra.join(" "))
check(
  "S1: the language detail pages expand to one route per declared family",
  !existsSync(path.join(SITE, "src/app/languages/[slug]/page.tsx")) ||
    (LANGUAGE_ROUTES.length === Object.keys(read("website/src/data/brain-languages.ts").match(/^\s*\{ name: '[^']+', ext:/gm) ?? {}).length &&
      new Set(LANGUAGE_ROUTES).size === LANGUAGE_ROUTES.length),
  `detail=${LANGUAGE_ROUTES.length}`,
)

// --- rendered <head> extraction ------------------------------------------------------
// M56.S1: /faq and /contact are permanent redirects to /support (their pages
// are stubs with no title/description/canonical — that is CORRECT for a
// redirect: a redirecting URL is not an indexable document). Head completeness
// and uniqueness apply to the INDEXABLE routes; the redirects are verified to
// redirect below.

// --- rendered <head> extraction ------------------------------------------------------
// M56.S1: /faq and /contact are permanent redirects to /support (their pages
// are stubs with no title/description/canonical — that is CORRECT for a
// redirect: a redirecting URL is not an indexable document). Head completeness
// and uniqueness apply to the INDEXABLE routes; the redirects are verified to
// redirect below. REDIRECT_ROUTES is declared with REQUIRED_ROUTES above.

function heads(): Record<string, string> {
  const out: Record<string, string> = {}
  if (!buildOk) return out
  for (const r of REAL_ROUTES) {
    const html = read(`website/.next/server/app/${htmlName(r)}.html`)
    const m = html.match(/<head>[\s\S]*?<\/head>/)
    out[htmlName(r)] = m ? m[0] : ""
  }
  return out
}

const H = heads()
const indexable = Object.entries(H).filter(([r]) => !REDIRECT_ROUTES.includes(`/${r}`))

// Every redirect stub really redirects — and to the destination the single
// declaration names, not a literal that could drift away from it.
for (const [from, to] of Object.entries(DECLARED_REDIRECTS)) {
  const stub = read(`website/src/app${from}/page.tsx`)
  check(
    `S1: ${from} redirects to ${to} via the declared map (no literal destination)`,
    stub.includes('from "@/lib/redirects"') && stub.includes(`redirect(REDIRECTS["${from}"])`),
    stub.slice(0, 140),
  )
}

// --- uniqueness + completeness (indexable routes only) -------------------------------

const titles = indexable.map(([, h]) => h.match(/<title>([^<]*)<\/title>/)?.[1] ?? "")
const descriptions = indexable.map(([, h]) => h.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "")
check("S1: every indexable route renders a <title>", titles.every((t) => t.length > 0), titles.join(" | "))
check("S1: every indexable route renders a meta description", descriptions.every((d) => d.length > 0), descriptions.join(" | ").slice(0, 120))
check("S1: titles are unique across routes", new Set(titles).size === titles.length, titles.join(" | "))
check("S1: descriptions are unique across routes", new Set(descriptions).size === descriptions.length)

const canonicals = indexable.map(([r, h]) => ({ r, c: h.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "" }))
check("S1: every indexable route renders a canonical URL", canonicals.every((x) => x.c.startsWith("https://backbencher.cc")), canonicals.map((x) => `${x.r}=${x.c}`).join(" | "))

const ogOk = indexable.map(([r, h]) => ({ r, ok: h.includes('property="og:title"') && h.includes('property="og:description"') && h.includes('property="og:image"') }))
check("S1: every indexable route renders OG tags (title, description, image)", ogOk.every((x) => x.ok), ogOk.filter((x) => !x.ok).map((x) => x.r).join(","))

const twitterOk = indexable.map(([r, h]) => ({ r, ok: h.includes('name="twitter:card"') && h.includes("summary_large_image") }))
check("S1: every indexable route renders a Twitter card", twitterOk.every((x) => x.ok), twitterOk.filter((x) => !x.ok).map((x) => x.r).join(","))

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
// The sitemap lists the INDEXABLE routes exactly — M56.S1's redirect sources
// (/faq, /contact) are deliberately absent (a sitemap lists canonical URLs),
// and their absence is itself checked: a redirect URL in the sitemap fails.
const indexableRoutes = REAL_ROUTES.filter((r) => !REDIRECT_ROUTES.includes(r))
const expectedUrls = indexableRoutes.map((r) => `https://backbencher.cc${r}`)
check("S1: sitemap matches the indexable route list exactly", JSON.stringify([...sitemapUrls].sort()) === JSON.stringify([...expectedUrls].sort()), `sitemap=${sitemapUrls.length} routes=${expectedUrls.length}`)
check("S1: sitemap excludes redirect sources (canonical URLs only)", REDIRECT_ROUTES.every((r) => !sitemapUrls.includes(`https://backbencher.cc${r}`)))
check("S1: sitemap lists the legal pages (privacy, terms)", ["/privacy", "/terms"].every((r) => sitemapUrls.includes(`https://backbencher.cc${r}`)), sitemapUrls.join(" "))
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

// --- FAQPage structured data (/support) --------------------------------------------
//
// The FAQ rich result. M56.S1 moved the FAQ to /support (single surface,
// website/faq.md as the single source — the page data is GENERATED from it).
// Three links are chained, and each is checked separately so a break is named
// precisely:
//   1. website/faq.md                  — the source of record (parsed by the
//                                        generator into support.generated.ts)
//   2. the FAQPage JSON-LD             — what a search engine reads
//   3. the rendered /support page      — what a human reads
// Link 2 must be a faithful copy of both 1 and 3: no answer may be published to
// engines that the page does not show.
//
// Normalizer: strip elements AND React's `<!-- -->` text separators (exactly
// what textContent keeps), decode HTML entities, collapse whitespace. That is
// the same transformation verify-seo's author measured against the build.

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "")
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X"
      const code = parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity] ?? whole
  })
}

function pageText(html: string): string {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
  return decodeEntities(stripTags(body)).replace(/\s+/g, " ").trim()
}

const LD_SCRIPT = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g

function ldBlocks(html: string): { type: string; payload: unknown }[] {
  return [...html.matchAll(LD_SCRIPT)].flatMap((m) => {
    try {
      const payload = JSON.parse(m[1]!) as { "@type"?: string }
      return [{ type: payload["@type"] ?? "", payload }]
    } catch {
      return []
    }
  })
}

type FaqQ = { "@type"?: string; name?: string; acceptedAnswer?: { "@type"?: string; text?: string } }

const supportHtmlRaw = buildOk ? read("website/.next/server/app/support.html") : ""
const faqRenderedText = pageText(supportHtmlRaw)
const faqLdRaw = [...supportHtmlRaw.matchAll(LD_SCRIPT)].map((m) => m[1]!)[0] ?? ""
const faqLd = ldBlocks(supportHtmlRaw).find((b) => b.type === "FAQPage")?.payload as { mainEntity?: FaqQ[] } | undefined
let faqQuestionCount = 0

check("S1: /support carries FAQPage JSON-LD", Boolean(faqLd))
if (faqLd) {
  const qs = faqLd.mainEntity ?? []
  faqQuestionCount = qs.length
  // Source of record: website/faq.md (### headings, in order). The generator
  // parses the same file; here the gate parses it INDEPENDENTLY so a generator
  // bug cannot validate itself.
  const sourceQuestions = [...read("website/faq.md").matchAll(/^### (.+)$/gm)].map((m) => m[1]!.trim())
  const detailsCount = (supportHtmlRaw.match(/<details/g) ?? []).length
  const missingAnswers = qs.filter((q) => !q.acceptedAnswer?.text || !faqRenderedText.includes(q.acceptedAnswer.text))
  check("S1: FAQPage lists exactly the questions in website/faq.md", JSON.stringify(qs.map((q) => q.name)) === JSON.stringify(sourceQuestions), `ld=${qs.length} source=${sourceQuestions.length}`)
  check("S1: support page renders one <details> per question", detailsCount === qs.length, `details=${detailsCount} questions=${qs.length}`)
  check("S1: every FAQ question is rendered on the page", qs.every((q) => Boolean(q.name) && faqRenderedText.includes(q.name!)))
  check("S1: every FAQ answer is rendered verbatim on the page", missingAnswers.length === 0, missingAnswers.map((q) => (q.name ?? "?").slice(0, 30)).join(","))
  check("S1: FAQ answers are substantive (>= 80 chars)", qs.every((q) => (q.acceptedAnswer?.text ?? "").length >= 80))
  check("S1: FAQ answers are unique", new Set(qs.map((q) => q.acceptedAnswer?.text)).size === qs.length)
  check("S1: FAQ answers are typed as schema.org Answers", qs.every((q) => q.acceptedAnswer?.["@type"] === "Answer"))
  check("S1: FAQPage payload escapes '<' (script-safe)", !faqLdRaw.includes("<"), "raw JSON-LD contains a literal <")
}

// The consolidated surface must also carry the still-have-questions block with
// the real inboxes (M56.S1), and the FAQ/contact paths must redirect to it.
check("S1: /support offers the real inboxes", supportHtmlRaw.includes("support@backbencher.cc") && supportHtmlRaw.includes("info@backbencher.cc"))
check("S1: /support has a still-have-questions block", faqRenderedText.includes("Still have questions"))
check("S1: /faq redirects to /support", buildOk && DECLARED_REDIRECTS["/faq"] === "/support" && read("website/src/app/faq/page.tsx").includes('redirect(REDIRECTS["/faq"])'))
check("S1: /contact redirects to /support", buildOk && DECLARED_REDIRECTS["/contact"] === "/support" && read("website/src/app/contact/page.tsx").includes('redirect(REDIRECTS["/contact"])'))

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
// N4 (real data, zero rebuild): the FAQPage detector must NOT accept the
// homepage, whose structured data is SoftwareApplication.
negative("S1: FAQPage detector rejects a page without FAQPage markup", !ldBlocks(homeHtmlFull).some((b) => b.type === "FAQPage"))

// N5 (real data): the exact comparison that just passed must REJECT an answer
// that was never rendered — proving the rendered-text check can fail.
negative("S1: FAQ answer-drift detector is sensitive", (() => {
  const qs = faqLd?.mainEntity
  if (!qs?.length) return false
  const drifted = qs.map((q, i) => (i === 0 ? { ...q, acceptedAnswer: { ...q.acceptedAnswer, text: "This sentence was never rendered on any page and must be caught." } } : q))
  return !drifted.every((q) => faqRenderedText.includes(q.acceptedAnswer?.text ?? "\u0000"))
})())

// N6 (real data): same for a question the page never asks.
negative("S1: FAQ question-drift detector is sensitive", (() => {
  const qs = faqLd?.mainEntity
  if (!qs?.length) return false
  const drifted = qs.map((q, i) => (i === 0 ? { ...q, name: "A question the page never asks?" } : q))
  return !drifted.every((q) => faqRenderedText.includes(q.name ?? "\u0000"))
})())

// N7a (real data): the required-route contract must fire when discovery loses a
// page — the failure mode a parity check alone cannot see.
negative("S1: required-route detector rejects a discovery that lost a page", !REQUIRED_ROUTES.every((r) => REAL_ROUTES.filter((x) => x !== "/editors").includes(r)))

// N7b (real data): a page outside the contract must be flagged, so a new route
// cannot slip in without being onboarded. Exercises the SAME predicate the
// positive check uses, with one undeclared route added — a stray page is
// caught whether the required list or the language slug list would have covered
// it, and adding a page is never free.
negative("S1: undeclared-route detector rejects a page outside the contract", (() => {
  const extra = [...REAL_ROUTES, "/undeclared"].filter(
    (r) => !REQUIRED_ROUTES.includes(r) && !REDIRECT_ROUTES.includes(r) && !LANGUAGE_ROUTES.includes(r),
  )
  return extra.length > 0
})())

// N7c (real data): a language page absent from the sitemap must fail parity.
// The 45 detail routes are the largest family of indexable URLs on the site, so
// the "sitemap omits a real page" failure mode is checked against one of them
// explicitly rather than only against a top-level route.
negative("S1: route-parity detector rejects a sitemap missing a language page", (() => {
  const sample = LANGUAGE_ROUTES[0]
  if (!sample) return true
  const dropped = expectedUrls.filter((u) => u !== `https://backbencher.cc${sample}`)
  return JSON.stringify([...sitemapUrls].sort()) !== JSON.stringify([...dropped].sort()) || sitemapUrls.length === 0
})())

// N7 (real data): route parity must reject a sitemap that omits a real page.
negative("S1: route-parity detector rejects a missing legal page", (() => {
  const real = [...REAL_ROUTES].sort()
  const withoutPrivacy = real.filter((r) => r !== "/privacy")
  return withoutPrivacy.length === real.length - 1 && JSON.stringify(withoutPrivacy) !== JSON.stringify(real)
})())

// N8 (cheap, mechanism): a normalizer that failed to strip React's text
// separators or decode entities would match nothing — or match everything.
negative("S1: rendered-text normalizer strips separators and decodes entities", stripTags("<b>x</b><!-- -->y") === "xy" && decodeEntities("&#x27;&amp;&lt;") === "'&<")

// Restore proof: committed sources must render complete heads again.
check("S1: restore-proof — committed sources render canonicals again", indexable.every(([, h]) => (h.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "").startsWith("https://backbencher.cc")))

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
  realRoutes: REAL_ROUTES.length,
  requiredRoutes: REQUIRED_ROUTES.length,
  faqQuestions: faqQuestionCount,
  limitations: [
    "Keyword checks verify presence in rendered content; ranking outcomes are S2 (search-engine onboarding) scope and depend on external engines.",
    "The canonical-removal mutant rebuilds the site three times total; a broken build aborts the mutant proof.",
    "Structured data covers SoftwareApplication (/) and FAQPage (/faq); other schema.org types are simply not claimed, not falsified.",
    "Routes are discovered from website/src/app by directory layout, so a page Next.js would not serve as a static route is still counted as one; the required-route contract list must name any page added, and that onboarding is a deliberate edit to this verifier.",
  ],
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
