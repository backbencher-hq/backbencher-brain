// script/m16/verify-docs-truth.ts — M16.D1-D3 (docs ≠ claim drift).
//
// Every behavior claim the docs make about the M16-verified tool behaviors must
// be present in BOTH the doc AND the code it describes (traceable), and the
// analyzer-domain findings must be documented as limitations/route, not as
// fixed features. If someone deletes the mechanism from code or the claim from
// the doc, a check fails. Evidence -> D1/D2/D3.json. No auto-passes.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }
function nk(label: string, cond: boolean, detail?: string) { negatives++; if (cond) negativePassed++; else { failed++; console.log("  FAIL: " + label + " (negative)" + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m16/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
async function emit(code: string, issue: string, extra?: any) {
  const total = passed + negativePassed
  const e = { issue, code, tool: "docs", title: issue.split(":")[1]?.trim() ?? code, verified: failed === 0, checks, passed: total, failed, negatives, generatedAt: new Date().toISOString(), ...(extra || {}) }
  writeFileSync(path.join(RESULTS_DIR, code + ".json"), JSON.stringify(e, null, 2) + "\n")
  if (failed > 0) anyFailed = true
  console.log(code + ": " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + total + "/" + checks + " passed, " + negatives + " negatives)")
}
async function reset() { checks = passed = failed = negatives = negativePassed = 0 }

// THIS FILE PRINTED A VERDICT PER LEG AND NEVER EXITED NON-ZERO.
//
// `emit` writes `${code}.json` with `verified: failed === 0` and prints VERIFIED or
// KNOWN-GAP, but nothing turned that into an exit code, so the process always exited
// 0. This gate is in the `npm run verify` chain, so a green chain carried no
// information for this leg. Found by script/m62/verify-gates-can-fail.ts.
//
// The run-wide accumulator is necessary because `reset()` clears the per-leg counters
// after every emit: without it, a failure in D1 followed by a clean D3 would exit 0
// and lose the one failure that mattered.
//
// It mirrors the recorded verdict rather than replacing it. The evidence JSON this
// file writes is what other gates read, so changing the record to make the exit code
// simpler would change what the suite knows.
let anyFailed = false
function has(f: string): boolean { return existsSync(path.join(ROOT_DIR, f)) }
function read(f: string): string { return readFileSync(path.join(ROOT_DIR, f), "utf8") }

async function main() {
  const DOCS = ["BB_EDIT.md", "BB_ASK.md", "BB_SEARCH.md", "BB_HEALTH.md", "BB_PATTERNS.md", "BB_SECURITY.md", "BB_ANALYZE.md", "BB_DOC.md", "BB_VISUALIZE.md", "BB_MIGRATE.md"]
  // ─────────────────────────────────────────────────────────────────────
  // D1: all 10 docs exist, and the M16-verified behaviors are claimed in
  // docs AND implemented in code (dual-anchor traceability).
  // ─────────────────────────────────────────────────────────────────────
  {
    ck("D1: all 10 tool docs exist", DOCS.every((d) => has("docs/" + d)), DOCS.filter((d) => !has("docs/" + d)).join(","))

    // BB_EDIT: AST-occurrence rename + shadow guard + value-side reference
    const editDoc = read("docs/BB_EDIT.md")
    const editCode = read("src/intelligence/edit/edit-engine.ts")
    ck("D1: BB_EDIT claims AST-occurrence rename semantics", /AST-classified reference site|every AST-classified/i.test(editDoc))
    ck("D1: BB_EDIT claims edge-independent completeness", /independent\s+of\s+whether\s+the\s+index\s+recorded\s+an\s+edge/i.test(editDoc))
    ck("D1: BB_EDIT claims shadow guard", /shadow/i.test(editDoc))
    ck("D1: edit-engine implements shadow scopes (code anchor)", editCode.includes("collectShadowScopes"))
    ck("D1: edit-engine implements value-side classification (code anchor)", editCode.includes("VALUE_SIDE_BINDING_PARENTS"))
    ck("D1: edit-engine surfaces warnings/summary (code anchor)", editCode.includes("warnings") && editCode.includes("renamedSites"))

    // BB_ASK: function|method + no-fabricated counts
    const askDoc = read("docs/BB_ASK.md")
    const askCode = read("src/intelligence/search/quick-answer.ts")
    ck("D1: BB_ASK claims function|method counts across languages", /function.*method|method.*function/i.test(askDoc) && /language/i.test(askDoc))
    ck("D1: BB_ASK claims unsupported nouns never fabricate", /zero\s+fabrication|never fabricat|never invent|not fabricat/i.test(askDoc))
    ck("D1: quick-answer code uses function|method union", /symbol_type IN \('function','method'\)/.test(askCode))

    // BB_SECURITY: phantom-sink limitation rout to M14
    const secDoc = read("docs/BB_SECURITY.md")
    ck("D1: BB_SECURITY documents token-based sink limitation", /token[- ]based|token matching/i.test(secDoc))
    ck("D1: BB_SECURITY names the phantom-sink repro (execute)", /execute/i.test(secDoc))
    // The domain is named truthfully (sink classification is the analyzer/indexer's
    // job); the old assertion demanded milestone IDs, which the docs contract bans
    // as process narration.
    ck("D1: BB_SECURITY names the owning domain", /analyzer\/indexer-domain|analyzer domain|indexer-domain/i.test(secDoc))

    // BB_PATTERNS: constructor/lifecycle nuance
    const patDoc = read("docs/BB_PATTERNS.md")
    ck("D1: BB_PATTERNS documents lifecycle-method nuance", /initialize/i.test(patDoc) && /constructor/i.test(patDoc))

    await emit("D1", "M16.D1 (all docs ↔ code dual-anchor)")
    await reset()
  }

  // ─────────────────────────────────────────────────────────────────────
  // D2: BB_EDIT.md semantics exactly match E1-E5 (the verified behaviors)
  // ─────────────────────────────────────────────────────────────────────
  {
    const editDoc = read("docs/BB_EDIT.md")
    ck("D2: BB_EDIT documents delete dangling-reference scan", /dangling-reference scan|reference to the deleted symbol survives/i.test(editDoc))
    ck("D2: BB_EDIT documents forced-delete warnings (never silent)", /warnings/i.test(editDoc) && /never silent/i.test(editDoc))
    ck("D2: BB_EDIT documents summary.renamedSites audit", /renamedSites/i.test(editDoc))
    ck("D2: BB_EDIT documents position-aware classification example", /x = target/i.test(editDoc))
    nk("D2: BB_EDIT no longer claims index-span-only rename", !/only in the declaration\/caller AST spans/i.test(editDoc), "stale claim still present")
    await emit("D2", "M16.D2 (BB_EDIT.md semantics)")
    await reset()
  }

  // ─────────────────────────────────────────────────────────────────────
  // D3: BB_ASK.md — the ask doc matches A1-A3 verified behavior
  // ─────────────────────────────────────────────────────────────────────
  {
    const askDoc = read("docs/BB_ASK.md")
    ck("D3: BB_ASK documents no-index honesty", /no index|index it first/i.test(askDoc))
    ck("D3: BB_ASK documents labels for search-result fallback", /search results, not a verified answer|never presented as a verified fact/i.test(askDoc))
    // The process provenance of a fix belongs in the milestone record, not in a user
    // guide (the campaign's comment contract bans process narration in docs), so the
    // old `rake` assertion here was checking for text the docs must NOT carry.
    await emit("D3", "M16.D3 (BB_ASK.md semantics)")
    await reset()
  }
}

await main()

process.exit(anyFailed ? 1 : 0)
