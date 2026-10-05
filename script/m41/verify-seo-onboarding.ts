// script/m41/verify-seo-onboarding.ts — M41.S2.
//
// Proves the search-engine onboarding (S2) from BOTH halves:
//   machine half  — the live deployed site exposes everything engines need:
//                   Google verification token live in global DNS, sitemap
//                   fetchable with the deployed route set, every URL 200 to
//                   crawlers, no noindex signals, truth renders live.
//                   NOTE: this half describes the DEPLOYED build, not the
//                   working tree. The repository's authoritative route list is
//                   S1's (discovered from website/src/app); the live set trails
//                   it until X1 deploys. The lag is recorded as a limitation, so
//                   the gate never claims more than the deployed site shows.
//   owner half    — dashboard confirmations (GSC verified, Bing import,
//                   Brave submit) recorded in S2-OWNER-CONFIRMATIONS.json;
//                   the verifier fails if any confirmation is missing,
//                   unconfirmed, or undated.
//
// This verifier touches the LIVE internet. It only ever reads.
//
// Run: npx tsx script/m41/verify-seo-onboarding.ts

import path from "node:path"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m41/results")
const EVIDENCE_PATH = path.join(RESULTS, "S2.json")
const LIVE = "https://backbencher.cc"

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

// A live check that cannot reach the internet has FAILED, not skipped. The
// failure is recorded with its reason and every remaining check still runs —
// an unreachable network must never crash this verifier halfway through and
// throw away the checks that already ran (observed 2026-09-12: a transient
// EHOSTUNREACH on the sitemap fetch aborted the run with no verdict at all).
async function get(url: string, opts?: RequestInit): Promise<{ status: number; body: string; error?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), ...opts })
    return { status: res.status, body: await res.text() }
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause
    return { status: 0, body: "", error: String(cause?.code ?? (e as Error).message).slice(0, 60) }
  }
}

// Token-match logic in one place so the live check and its sensitivity
// negative provably run the SAME comparison.
function tokenPresent(records: string[], token: string): boolean {
  return records.some((r) => r.replace(/^"|"$/g, "") === token)
}

console.log("M41.S2 search-engine onboarding verifier (live internet, read-only)")

// --- 1. owner confirmations ------------------------------------------------------

type Confirmation = { engine: string; confirmedByOwner: boolean; confirmedOn: string }
let confirmations: Confirmation[] = []
let confirmationsParsed = false
try {
  const raw = JSON.parse(readFileSync(path.join(RESULTS, "S2-OWNER-CONFIRMATIONS.json"), "utf8")) as { confirmations?: Confirmation[] }
  confirmations = raw.confirmations ?? []
  confirmationsParsed = true
} catch {
  confirmationsParsed = false
}
check("S2: owner confirmations file parses", confirmationsParsed)
check(
  "S2: all three engines confirmed by owner, each with a date",
  ["google", "bing", "brave"].every((e) =>
    confirmations.some((c) => c.engine === e && c.confirmedByOwner === true && /^\d{4}-\d{2}-\d{2}$/.test(c.confirmedOn)),
  ),
  confirmations.map((c) => `${c.engine}:${c.confirmedByOwner}`).join(","),
)

// --- 2. Google verification token live in global DNS -----------------------------

const EXPECTED_TOKEN = "google-site-verification=WqhvOz_J93aA5SgNKkHS6RCqa_fVxrxUJYw2O4zNs_M"
const CORRUPT_TOKEN = "google-site-verification=0000000000000000000000000000000000000000"
let txtRecords: string[] = []
let dnsFetched = false
let dnsError = ""
try {
  const res = await fetch("https://dns.google/resolve?name=backbencher.cc&type=TXT", { signal: AbortSignal.timeout(20_000) })
  const dns = (await res.json()) as { Answer?: { type: number; data: string }[] }
  txtRecords = (dns.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data)
  dnsFetched = true
} catch (e) {
  dnsFetched = false
  dnsError = String((e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message).slice(0, 60)
}
check("S2: DNS TXT answer retrieved from dns.google", dnsFetched, dnsError)
check("S2: Google site-verification token is live in global DNS", tokenPresent(txtRecords, EXPECTED_TOKEN), `records=${txtRecords.length}`)

// --- 3. sitemap live and matching the canonical route set --------------------------
//
// The expectation is not a hardcoded list. Two sets are meaningful:
//   - PREVIOUS_DEPLOYED — the pre-M56 IA that backbencher.cc actually serves
//     today (recorded 2026-09-05);
//   - CANONICAL — the repository's set, discovered from website/src/app minus
//     the routes declared retired in website/src/lib/redirects.ts.
// The gate therefore has two HONEST states and rejects every other one:
//   lag CLOSED — the live sitemap equals the repository's canonical set (the
//     state after the X1 deploy, which is what closes this gate's loop);
//   lag OPEN   — the live sitemap equals the previously deployed set, and every
//     route the deploy has not yet published is recorded in the evidence.
// A hardcoded expectation could not tell "not deployed yet" from "the deploy is
// wrong", which is exactly the failure mode M56.I1 created by changing the IA:
// the old literal list would have failed forever after the deploy.

const PREVIOUS_DEPLOYED = ["", "/install", "/docs", "/tools", "/faq", "/troubleshooting", "/contact"]
  .map((r) => `${LIVE}${r}`)
  .sort()

// Independent instrument. S1 discovers the route set too, and M56's rule is that
// the two instruments must not share code, so a single bug cannot satisfy both.
//
// A dynamic segment is not a URL. `[slug]` is skipped by the walk and then
// expanded separately, from the one declaration the pages themselves are
// generated from (website/src/data/language-depth/slugs.ts) — so the live
// sitemap is compared against the real set of language URLs rather than against
// a literal `[slug]` that could never be crawled.
function declaredLanguageSlugs(): string[] {
  let src = ""
  try {
    src = readFileSync(path.join(ROOT, "website/src/data/language-depth/slugs.ts"), "utf8")
  } catch {
    return []
  }
  const start = src.indexOf("export const FAMILY_SLUGS")
  if (start < 0) return []
  const block = src.slice(start, src.indexOf("\n}", start))
  return [...block.matchAll(/:\s*"([a-z0-9-]+)",\s*$/gm)].map((m) => m[1]!)
}

function discoverCanonicalRoutes(): string[] {
  const appDir = path.join(ROOT, "website/src/app")
  const found: string[] = []
  const walk = (dir: string, route: string): void => {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name === "page.tsx")) found.push(route)
    for (const e of entries) {
      if (!e.isDirectory()) continue
      // Route groups, dynamic segments and the API tree are not sitemap surfaces.
      if (e.name.startsWith("(") || e.name.startsWith("[") || e.name === "api") continue
      walk(path.join(dir, e.name), `${route}/${e.name}`)
    }
  }
  walk(appDir, "")
  // Expand the one dynamic segment that publishes documents. Guarded on the
  // route actually existing, so a slug list without pages cannot inflate the
  // canonical set.
  if (existsSync(path.join(appDir, "languages/[slug]/page.tsx"))) {
    for (const slug of declaredLanguageSlugs()) found.push(`/languages/${slug}`)
  }
  const retired = new Set(
    [...readFileSync(path.join(ROOT, "website/src/lib/redirects.ts"), "utf8").matchAll(/^\s*"(\/[^"]+)":/gm)].map((m) => m[1]!),
  )
  return found.filter((r) => !retired.has(r))
}

const CANONICAL = discoverCanonicalRoutes().map((r) => `${LIVE}${r}`).sort()
const sm = await get(`${LIVE}/sitemap.xml`)
check("S2: live sitemap.xml responds 200", sm.status === 200, sm.error ?? `status=${sm.status}`)
check("S2: canonical route set is discoverable and non-trivial", CANONICAL.length >= 5, `canonical=${CANONICAL.length}`)
const liveUrls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!)
const liveSet = [...liveUrls].sort()
const sameSet = (a: string[], b: string[]): boolean => JSON.stringify(a) === JSON.stringify(b)
const lagClosed = sameSet(liveSet, CANONICAL)
const lagOpen = sameSet(liveSet, PREVIOUS_DEPLOYED)
check(
  "S2: live sitemap equals the canonical set (lag closed) or the previously deployed set (lag recorded)",
  lagClosed || lagOpen,
  `lag=${lagClosed ? "closed" : lagOpen ? "open" : "UNKNOWN"} live=${liveUrls.length} canonical=${CANONICAL.length} previous=${PREVIOUS_DEPLOYED.length}`,
)
const laggingRoutes = CANONICAL.filter((u) => !liveSet.includes(u))
const deployLag: "closed" | "open" | "unknown" = lagClosed ? "closed" : lagOpen ? "open" : "unknown"

// --- 4. every sitemap URL serves 200 to a crawler --------------------------------

const GB = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
const crawlTarget = liveUrls.length ? liveUrls : PREVIOUS_DEPLOYED
let crawlOk = 0
const badRoutes: string[] = []
for (const u of crawlTarget) {
  try {
    const r = await get(u, { headers: { "User-Agent": GB } })
    if (r.status === 200 && !/name="robots" content="noindex/.test(r.body)) crawlOk++
    else badRoutes.push(`${u}=${r.error ?? r.status}`)
  } catch {
    badRoutes.push(`${u}=ERR`)
  }
}
check("S2: all sitemap URLs return 200 to Googlebot with no noindex", crawlOk === crawlTarget.length && badRoutes.length === 0, badRoutes.join(","))

// --- 5. truth renders live (the index story is the correct one) ------------------

const home = await get(`${LIVE}/`, { headers: { "User-Agent": GB } })
const truthVersion = readFileSync(path.join(ROOT, "website/src/data/truth.generated.ts"), "utf8").match(/version: "([^"]+)"/)?.[1]
check("S2: live homepage renders the true version", home.body.includes(`v<!-- -->${truthVersion}`) || home.body.includes(`v${truthVersion}`), `${home.error ?? `expected v${truthVersion}`} (bytes=${home.body.length})`)
check("S2: live homepage carries JSON-LD SoftwareApplication", home.body.includes('"@type":"SoftwareApplication"') || home.body.includes('"@type": "SoftwareApplication"'), home.error ?? `bytes=${home.body.length}`)

// --- 6. negatives ------------------------------------------------------------------

// N1 (live): the SAME comparison that just passed must REJECT a corrupted
// token against the real DNS answer — proving the check can fail.
negative("S2: DNS token comparison rejects a corrupted token (live records)", dnsFetched && txtRecords.length > 0 && !tokenPresent(txtRecords, CORRUPT_TOKEN))

// N2 (live): the route-equality comparator must reject a phantom route in
// EITHER accepted set — the comparator actually used above, not a copy of it.
{
  const mutated = [...liveSet, `${LIVE}/phantom`].sort()
  negative("S2: route-list comparator rejects phantom URLs", !sameSet(mutated, CANONICAL) && !sameSet(mutated, PREVIOUS_DEPLOYED))
}

// N2b: an unrecognised sitemap set is rejected by both states, so "neither
// closed nor the recorded previous deploy" can never read as a pass.
{
  const unknown = [`${LIVE}/only-one`]
  negative("S2: lag detector rejects an unrecognised sitemap set", !sameSet(unknown, CANONICAL) && !sameSet(unknown, PREVIOUS_DEPLOYED))
}

// N2c: when the lag is open the delta must be non-empty, so the recorded
// limitation can never be vacuous (an empty delta would mean the sets matched).
negative(
  "S2: open-lag state reports a non-empty route delta",
  deployLag !== "open" || laggingRoutes.length > 0,
  `lag=${deployLag} delta=${laggingRoutes.length}`,
)

// N3 (cheap): the noindex detector must fire on a synthetic noindex page.
negative("S2: noindex detector is sensitive", /name="robots" content="noindex/.test('<meta name="robots" content="noindex, nofollow">'))

// --- verdict + evidence ------------------------------------------------------------

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

const ok = passed === checks
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
if (!ok) {
  console.log("S2 VERDICT: FAIL")
  process.exit(1)
}
console.log("S2 VERDICT: PASS")

mkdirSync(RESULTS, { recursive: true })
const evidence = {
  issue: "M41.S2",
  code: "S2",
  milestone: "M41",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m41/verify-seo-onboarding.ts",
  evidenceFile: "S2.json",
  ownerConfirmationsFile: "S2-OWNER-CONFIRMATIONS.json",
  generatedAt: new Date().toISOString(),
  deployLag,
  canonicalRoutes: CANONICAL,
  liveRoutes: liveSet,
  laggingRoutes,
  limitations: [
    "Dashboard states (GSC/Bing/Brave) are external and can change after verification; the live checks prove the site half, the owner-confirmation file records the dashboard half as of its dates.",
    deployLag === "closed"
      ? "The live sitemap equals the repository's canonical route set: the deploy has caught up with the M56 IA, so the lag M41.S2 recorded against the pre-M56 deploy is closed."
      : `The live sitemap equals the PREVIOUSLY deployed (pre-M56) route set, not the repository's canonical set: \`deployLag=open\`, ${laggingRoutes.length} route(s) the deploy has not published yet are named in laggingRoutes. X1's post-deploy re-run closes this; the state is recorded, never silently accepted.`,
    "Live checks fail rather than skip when the network is unreachable: the failure is recorded with its reason (status=0 plus the socket error) and the remaining checks still run, so a transient outage cannot crash the run or be mistaken for a pass.",
    "DNS is checked via dns.google (Google's own resolver) — the authoritative path for GSC verification.",
    "Brave has no verification protocol; acceptance of the submit-url form is the only available signal.",
  ],
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
