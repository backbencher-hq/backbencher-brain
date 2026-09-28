// script/m56/verify-support-page.ts — M56.S1 (#784), support consolidation.
//
// Machine-checks the consolidated support surface WITHOUT trusting the
// generator that built it:
//   1. Single source — website/faq.md is the only FAQ source; faqs.tsx and
//      FaqJsonLd.tsx are gone; support.generated.ts agrees with faq.md
//      (independently parsed here) and with the engine truth numbers.
//   2. The rendered /support page — every question and every answer published
//      to search engines (FAQPage JSON-LD) is rendered verbatim on the page;
//      one <details> per question; the four real inboxes; still-have-questions.
//   3. Redirects — /faq and /contact redirect to /support; nothing else links
//      to the retired paths; sitemap lists /support and NOT the redirect
//      sources (canonical URLs only).
//   4. Mutants — a drifted answer, a dropped question, a stale generated file,
//      a wrong inbox, a sitemap entry for a redirect source: each detected.
//
// Run: npx tsx script/m56/verify-support-page.ts

import path from "node:path"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SITE = path.join(ROOT, "website")
const RESULTS = path.join(ROOT, "validation/m56/results")
const EVIDENCE_PATH = path.join(RESULTS, "S1.json")

let checks = 0
let passed = 0
let failed = 0
let negatives = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): boolean {
  checks++
  if (condition) {
    passed++
    return true
  }
  failed++
  failures.push(detail ? `${label} — ${detail}` : label)
  console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  return false
}
function negative(label: string, byDesign: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, byDesign, detail)
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

console.log("M56.S1 support consolidation verifier")

// --- 1. single source ---------------------------------------------------------------

check("S1: website/faq.md exists as the FAQ source of record", existsSync(path.join(ROOT, "website/faq.md")))
check("S1: the hand-written FAQ data file is gone (no shadow copy)", !existsSync(path.join(SITE, "src/data/faqs.tsx")))
check("S1: the /faq-only JSON-LD component is gone (moved to SupportJsonLd)", !existsSync(path.join(SITE, "src/components/FaqJsonLd.tsx")))
check("S1: support.generated.ts is generated from faq.md (declares the source)", read("website/src/data/support.generated.ts").includes("website/faq.md"))

// Parse faq.md INDEPENDENTLY of the generator (own regexes, own normalizer).
// `m` flag is required: heading regexes are anchored and applied to a
// multi-line document (observed once: without `m`, ^### only ever matched at
// byte 0 and the count came out 0 — a check that could never fail).
interface MdQA {
  q: string
  section: string
  a: string
}
function parseFaqMd(md: string): { sections: string[]; qas: MdQA[] } {
  const sections: string[] = []
  const qas: MdQA[] = []
  let section = ""
  let q: string | null = null
  let body: string[] = []
  const flush = () => {
    if (section && q !== null && body.join("").trim()) {
      qas.push({ q, section, a: mdToText(body.join("\n")) })
    }
    body = []
    q = null
  }
  for (const raw of md.split("\n")) {
    const h2 = raw.match(/^## (.+)$/)
    const h3 = raw.match(/^### (.+)$/)
    if (h2) {
      flush()
      section = h2[1]!.trim()
      sections.push(section)
      continue
    }
    if (h3) {
      flush()
      q = h3[1]!.trim()
      continue
    }
    if (q !== null) body.push(raw)
  }
  flush()
  return { sections, qas }
}

function mdToText(md: string): string {
  const lines: string[] = []
  for (const raw of md.split("\n")) {
    let line = raw
    if (/^```/.test(line.trim())) continue
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) =>
      href.startsWith("/") || href.startsWith("http") ? `${label} (${href})` : `${label}`,
    )
    line = line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1")
    if (/^\|/.test(line.trim())) {
      line = line.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\|/g, " | ")
      if (/^[\s|:-]+$/.test(line)) continue
    }
    lines.push(line.trim())
  }
  return lines.join(" ").replace(/\s+/g, " ").trim()
}

const md = read("website/faq.md")
const mdParsed = parseFaqMd(md)
check("S1: faq.md parses into sections and questions", mdParsed.sections.length >= 4 && mdParsed.qas.length >= 15, `sections=${mdParsed.sections.length} qas=${mdParsed.qas.length}`)

// The generated data must agree with the independent parse: every question in
// faq.md appears in support.generated.ts with the same normalized answer.
// The generated literal is unquoted-key TS (`q: "..."`, 4-space indent inside
// SUPPORT_QA). Anchored, multiline, quote-aware regexes — JSON.parse decodes
// escapes so the comparison is against real strings, not source bytes.
const gen = read("website/src/data/support.generated.ts")
const genQuestions = [...gen.matchAll(/^    q: ("(?:[^"\\]|\\.)*"),$/gm)].map((m) => JSON.parse(m[1]!) as string)
const genAnswers = [...gen.matchAll(/^    a: ("(?:[^"\\]|\\.)*"),$/gm)].map((m) => JSON.parse(m[1]!) as string)
check(
  "S1: support.generated.ts carries every faq.md question, in order",
  JSON.stringify(genQuestions) === JSON.stringify(mdParsed.qas.map((x) => x.q)),
  `gen=${genQuestions.length} md=${mdParsed.qas.length}`,
)
check(
  "S1: support.generated.ts answers equal the independent faq.md parse",
  JSON.stringify(genAnswers) === JSON.stringify(mdParsed.qas.map((x) => x.a)),
  genAnswers.length === mdParsed.qas.length ? "first divergence: " + firstDiff(genAnswers, mdParsed.qas.map((x) => x.a)) : `gen=${genAnswers.length} md=${mdParsed.qas.length}`,
)

function firstDiff(a: string[], b: string[]): string {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      const x = a[i] ?? "(missing)"
      const y = b[i] ?? "(missing)"
      for (let j = 0; j < Math.min(x.length, y.length); j++) if (x[j] !== y[j]) return `q#${i} at +${j}: "${x.slice(Math.max(0, j - 20), j + 20)}" vs "${y.slice(Math.max(0, j - 20), j + 20)}"`
      return `q#${i}: length ${x.length} vs ${y.length}`
    }
  }
  return "none"
}

// Truth cross-check: the numbers faq.md states must agree with the engine.
const truth = read("website/src/data/truth.generated.ts")
const tables = Number(truth.match(/tables: (\d+)/)?.[1])
const langs = Number(truth.match(/classified: (\d+)/)?.[1])
const parsers = Number(truth.match(/dedicatedParsers: (\d+)/)?.[1])
const tools = (truth.match(/"bb_[a-z_]+"/g) ?? []).length
check("S1: engine truth numbers are readable", Boolean(tables && langs && parsers && tools), `tables=${tables} langs=${langs} parsers=${parsers} tools=${tools}`)
check("S1: faq.md states the real table count", md.includes(`${tables} tables`))
check("S1: faq.md states the real tool count", md.includes(`${tools} agent tools`) && md.includes(`${tools} MCP tools`) && md.includes(`${tools} bb tools`))
check("S1: faq.md states the real language counts", md.includes(`${langs} languages`) && md.includes(`${parsers} with dedicated`))

// --- 2. the rendered /support page ----------------------------------------------------

interface Build {
  ok: boolean
}
const build: Build = { ok: false }
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
console.log("  building site (next build)…")
build.ok = buildSite()
check("S1: site builds", build.ok)

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

const supportHtmlRaw = build.ok ? read("website/.next/server/app/support.html") : ""
const rendered = pageText(supportHtmlRaw)
const faqLd = ldBlocks(supportHtmlRaw).find((b) => b.type === "FAQPage")?.payload as { mainEntity?: FaqQ[] } | undefined

check("S1: /support builds and renders", supportHtmlRaw.length > 5_000, `bytes=${supportHtmlRaw.length}`)
check("S1: /support carries FAQPage JSON-LD", Boolean(faqLd))
if (faqLd) {
  const qs = faqLd.mainEntity ?? []
  const missingAnswers = qs.filter((q) => !q.acceptedAnswer?.text || !rendered.includes(q.acceptedAnswer.text))
  check("S1: FAQPage lists exactly the faq.md questions", JSON.stringify(qs.map((q) => q.name)) === JSON.stringify(mdParsed.qas.map((x) => x.q)), `ld=${qs.length} md=${mdParsed.qas.length}`)
  const detailsCount = (supportHtmlRaw.match(/<details/g) ?? []).length
  check("S1: one <details> per question on the page", detailsCount === qs.length, `details=${detailsCount} questions=${qs.length}`)
  check("S1: every question is rendered", qs.every((q) => Boolean(q.name) && rendered.includes(q.name!)))
  check("S1: every answer is rendered verbatim", missingAnswers.length === 0, missingAnswers.map((q) => (q.name ?? "?").slice(0, 30)).join(","))
  check("S1: answers are substantive (>= 80 chars)", qs.every((q) => (q.acceptedAnswer?.text ?? "").length >= 80))
  check("S1: answers are unique", new Set(qs.map((q) => q.acceptedAnswer?.text)).size === qs.length)
  check("S1: answers typed as schema.org Answers", qs.every((q) => q.acceptedAnswer?.["@type"] === "Answer"))
  const faqLdRaw = [...supportHtmlRaw.matchAll(LD_SCRIPT)].map((m) => m[1]!)[0] ?? ""
  check("S1: FAQPage payload escapes '<' (script-safe)", !faqLdRaw.includes("<"))
}

// The still-have-questions block: the human escalation path, with the real
// inboxes. (M41.T3 verified these emails for /contact; S1 carries the same
// rule onto the consolidated page.)
check("S1: still-have-questions block is present", rendered.includes("Still have questions"))
check("S1: the real support inbox renders", supportHtmlRaw.includes("support@backbencher.cc"))
check("S1: the real general/press inbox renders", supportHtmlRaw.includes("info@backbencher.cc"))
check("S1: no other inbox renders on /support", !/[\w.+-]+@[\w-]+\.[\w.]+/.test(supportHtmlRaw.replace(/support@backbencher\.cc/g, "").replace(/info@backbencher\.cc/g, "").replace(/goatcounter/g, "")))

// --- 3. redirects and discovery hygiene -------------------------------------------------

// M56.I1: every retired path redirects through the site's single declaration
// (website/src/lib/redirects.ts); M41.S1 pins that declaration to its contract.
check("S1: /faq redirects to /support", read("website/src/app/faq/page.tsx").includes('redirect(REDIRECTS["/faq"])') && read("website/src/lib/redirects.ts").includes('"/faq": "/support"'))
check("S1: /contact redirects to /support", read("website/src/app/contact/page.tsx").includes('redirect(REDIRECTS["/contact"])') && read("website/src/lib/redirects.ts").includes('"/contact": "/support"'))
check("S1: sitemap lists /support", build.ok && read("website/.next/server/app/sitemap.xml.body").includes("https://backbencher.cc/support"))
const sitemapBody = build.ok ? read("website/.next/server/app/sitemap.xml.body") : ""
check("S1: sitemap lists no retired route (canonical URLs only)", !["/faq", "/contact", "/troubleshooting", "/demos"].some((r) => sitemapBody.includes(`${r}</loc>`)))
// M56.I1 widened this from the two FAQ paths to every retired path: a retired
// URL must never be linked from a surface a visitor reads.
const retiredHrefs = ["/faq", "/contact", "/troubleshooting", "/demos"]
const linkSurfaces: Array<[string, string]> = [
  ["the rendered /support page", supportHtmlRaw],
  ["Navigation", read("website/src/components/Navigation.tsx")],
  ["SiteFooter", read("website/src/components/SiteFooter.tsx")],
  ["the docs page", read("website/src/app/docs/page.tsx")],
  ["the install page", read("website/src/app/install/page.tsx")],
]
check(
  "S1: no rendered link points at a retired path (faq, contact, troubleshooting, demos)",
  retiredHrefs.every((r) => linkSurfaces.every(([, src]) => !src.includes(`href="${r}"`))),
  linkSurfaces.filter(([, src]) => retiredHrefs.some((r) => src.includes(`href="${r}"`))).map(([n]) => n).join(","),
)

// --- 4. mutants --------------------------------------------------------------------------

// M1 (real file, zero rebuild): a drifted answer in faq.md must break the
// generated-data agreement check (this is the class of bug the single source
// exists to kill).
{
  const p = path.join(ROOT, "website/faq.md")
  const bak = p + ".bak-m56s1"
  const original = readFileSync(p, "utf8")
  try {
    const mutated = original.replace("No. Indexing, storage, and analysis are all local.", "No. Indexing, storage, and analysis are mostly local (mutant).")
    if (mutated === original) negative("S1: answer-drift mutant actually changed the file", false, "replace was a no-op")
    else {
      writeFileSync(p, mutated)
      const re = parseFaqMd(readFileSync(p, "utf8"))
      const mutatedAnswer = re.qas.find((x) => x.q === "Does my code leave my machine?")!.a
      negative("S1: answer-drift detector is sensitive", !genAnswers.includes(mutatedAnswer))
    }
  } finally {
    writeFileSync(p, original)
  }
}

// M2 (real file): a dropped question must break the count/order agreement.
{
  const re = parseFaqMd(md)
  const dropped = re.qas.slice(1)
  negative("S1: dropped-question detector is sensitive", JSON.stringify(dropped.map((x) => x.q)) !== JSON.stringify(genQuestions))
}

// M3 (cheap, mechanism): the `m`-flag trap — a NON-multiline heading scan is
// anchored to byte 0 of a multi-line document and finds nothing, so any
// verifier that could "pass" with 0 questions is broken by construction.
negative("S1: heading parser requires multiline anchors (0-question pass is impossible)", (() => {
  const withoutM = [...md.matchAll(/^### (.+)$/g)].length === 0 && mdParsed.qas.length > 0
  return withoutM
})())

// M4 (real data): the unknown-inbox detector must catch a wrong address.
// Both real inboxes are replaced with a foreign one (globally — the address
// appears in mailto hrefs and in several channel cards), and the SAME scan the
// positive check uses must flag the planted inbox.
{
  const foreign = supportHtmlRaw
    .replace(/support@backbencher\.cc/g, "help@backbencher-clone.example")
    .replace(/info@backbencher\.cc/g, "press@backbencher-clone.example")
  const planted = /[\w.+-]+@[\w-]+\.[\w.]+/.test(foreign.replace(/goatcounter/g, ""))
  negative("S1: inbox detector rejects a wrong address", planted && !foreign.includes("backbencher.cc\" >support@"))
}

// M5 (real data): a sitemap listing a redirect source must be flagged.
{
  const poisoned = sitemapBody.replace("https://backbencher.cc/support", "https://backbencher.cc/faq")
  negative("S1: redirect-source sitemap detector is sensitive", poisoned.includes("/faq</loc>") || !poisoned.includes("/support"))
}

// M6 (real data): the FAQPage detector must NOT accept the homepage, whose
// structured data is SoftwareApplication.
{
  const home = build.ok ? read("website/.next/server/app/index.html") : ""
  negative("S1: FAQPage detector rejects a page without FAQ markup", !ldBlocks(home).some((b) => b.type === "FAQPage"))
}

// M7 (mechanism): the generator's --check mode must refuse stale output.
{
  const p = path.join(ROOT, "website/src/data/support.generated.ts")
  const bak = p + ".bak-m56s1"
  const original = readFileSync(p, "utf8")
  try {
    mkdirSync(path.dirname(bak), { recursive: true })
    writeFileSync(p, original.replace("// GENERATED FILE", "// STALE FILE"))
    let rejected = false
    try {
      execFileSync("npx", ["tsx", "script/m56/generate-support-data.ts", "--check"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 })
    } catch {
      rejected = true
    }
    negative("S1: generator --check rejects a stale generated file", rejected)
  } finally {
    rmSync(p)
    writeFileSync(p, original)
    rmSync(bak, { force: true })
  }
}

// --- verdict --------------------------------------------------------------------------

const VERDICT = { PASS: "PASS", FAIL: "FAIL" } as const
const status = failed === 0 ? VERDICT.PASS : VERDICT.FAIL
console.log(`\nM56.S1: ${status} — ${passed}/${checks} checks, ${negatives} negatives`)

mkdirSync(RESULTS, { recursive: true })
const { execSync } = await import("node:child_process")
let commit = "unknown"
try {
  commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}
writeFileSync(
  EVIDENCE_PATH,
  JSON.stringify(
    {
      issue: "M56.S1 — Support Consolidation (#784)",
      code: "S1",
      milestone: "m56",
      status: status === VERDICT.PASS ? "verified" : "failed",
      checks,
      passed,
      failed,
      negativeCases: negatives,
      currentCommit: commit,
      verifierCommand: "npx tsx script/m56/verify-support-page.ts",
      evidenceFile: "S1.json",
      generatedAt: new Date().toISOString(),
      source: "website/faq.md",
      generatedData: "website/src/data/support.generated.ts",
      surfaces: ["/support (FAQ + still-have-questions)", "/faq -> /support (redirect)", "/contact -> /support (redirect)", "retired paths carry no rendered link (M56.I1 widened the scan)"],
      questions: mdParsed.qas.length,
      sections: mdParsed.sections.length,
      details: failures.slice(0, 10),
    },
    null,
    2,
  ) + "\n",
)
if (failed > 0) process.exit(1)
