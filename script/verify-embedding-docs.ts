// script/verify-embedding-docs.ts — EMBEDDINGS.md is a contract, so check it.
//
// The failure this gate exists to prevent is specific and was found in this
// repo: the document described knobs that no code read, and told users a retry
// existed where none did. A user who trusted the doc set `BB_EMBEDDING_*` values
// and watched nothing happen. A document that names a switch is a promise that
// the switch is read, so every knob named in EMBEDDINGS.md is resolved against
// the source that must consume it.
//
//   D1  every `BB_EMBEDDING_*` var documented in EMBEDDINGS.md is read by src/
//   D2  every `BB_EMBEDDING_*` var read anywhere in src/ is documented
//   D3  every documented var is LOADED in code, not merely mentioned (a var can
//       pass a naive grep by appearing only inside a comment — which is exactly
//       how "documented but never read" hides)
//   D4  the two claims this round was created to correct are correct now:
//       the stored local label, and the absence of an index-time retry promise
//       the code does not keep
//   D5  the diagnosis surfaces the doc tells users to run actually exist and are
//       consumed by `bb doctor`, `bb setup show` and `bb health`
//   D6  the doc contains no key-shaped literal
//
// Plants doc mutants for D1, D4a and D4b that MUST be caught. The mutants re-run
// the real checks against mutated text, because a gate whose mutants compare
// against pristine state proves nothing about itself.
//
// Run: npx tsx script/verify-embedding-docs.ts
// Evidence: validation/embedding/results/EMBDOCS.json (machine-emitted)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const RESULTS_DIR = path.join(ROOT, "validation/embedding/results")
const EVIDENCE_PATH = path.join(RESULTS_DIR, "EMBDOCS.json")

let checks = 0
let passed = 0
let failed = 0
const failures: string[] = []
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) { passed++; return }
  failed++
  failures.push(label + (detail ? ` — ${detail}` : ""))
  console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function ck(list: string[], label: string, condition: boolean, detail = ""): void {
  check(label, condition, detail)
  if (!condition) list.push(label)
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8")

/** Every source file that may legitimately read an embedding knob. */
const SRC_FILES = [
  "src/config/config.ts",
  "src/brain/semantic/embedding-config.ts",
  "src/brain/semantic/embedding-diagnosis.ts",
  "src/brain/semantic/openai-embed.ts",
  "src/brain/semantic/engine.ts",
  "src/ast/parallel-indexer.ts",
  "src/setup/doctor.ts",
  "src/setup/setup-show.ts",
  "src/setup/setup-wizard.ts",
  "src/intelligence/health/health-provider.ts",
  "src/intelligence/search/semantic-search.ts",
]
const SRC = new Map<string, string>(SRC_FILES.map((f) => [f, read(f)]))

/**
 * A var name, matched only when it ENDS on an alphanumeric.
 *
 * The lookahead is what makes `BB_EMBEDDING_FALLBACK_*` — the wildcard the docs
 * use to mean "and the other two" — contribute nothing, instead of
 * contributing a fictitious knob called `BB_EMBEDDING_FALLBACK` that no code
 * reads and which would then fail D1 forever.
 */
const VAR = /(BB_EMBEDDING_[A-Z0-9]+(?:_[A-Z0-9]+)*)(?![A-Z0-9_])/g

function extractVars(src: string): Set<string> {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(VAR.source, "g")
  while ((m = re.exec(src)) !== null) out.add(m[1]!)
  return out
}

/** Comments removed, so a knob that only APPEARS in a comment is not "read". */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1 ")
}
const CODE = new Map([...SRC].map(([f, s]) => [f, stripComments(s)]))

const EMBEDDINGS = read("EMBEDDINGS.md")
const LOCAL_LABEL = (SRC.get("src/brain/semantic/engine.ts")!.match(/LOCAL_MODEL_LABEL\s*=\s*"([^"]+)"/) ?? [])[1] ?? ""

/** Vars read by code, per file. */
function varsReadInCode(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [file, code] of CODE) out.set(file, extractVars(code))
  return out
}
const READ_BY_FILE = varsReadInCode()
const READ_ANYWHERE = new Set<string>()
for (const set of READ_BY_FILE.values()) for (const v of set) READ_ANYWHERE.add(v)

// ── the contract, as a pure function so mutants can re-run it ──────────────

interface ContractResult {
  documented: string[]
  read: string[]
  documentedNotRead: string[]
  readNotDocumented: string[]
  documentedNotLoaded: string[]
  problems: string[]
}

function evaluateContract(doc: string): ContractResult {
  const documented = new Set<string>()
  const re = new RegExp(VAR.source, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) documented.add(m[0]!)

  const problems: string[] = []
  const p = (s: string) => problems.push(s)

  const documentedNotRead = [...documented].filter((v) => !READ_ANYWHERE.has(v)).sort()
  if (documentedNotRead.length) p(`documented but never read by src/: ${documentedNotRead.join(", ")}`)

  const readNotDocumented = [...READ_ANYWHERE].filter((v) => !documented.has(v)).sort()
  if (readNotDocumented.length) p(`read by src/ but undocumented: ${readNotDocumented.join(", ")}`)

  // "Loaded" means present in comment-stripped source, i.e. it survived D1 as a
  // genuine read rather than a mention inside a comment or a doc block.
  const documentedNotLoaded = [...documented].filter((v) => {
    for (const code of CODE.values()) if (code.includes(v)) return false
    return true
  }).sort()
  if (documentedNotLoaded.length) p(`documented but not loaded in code: ${documentedNotLoaded.join(", ")}`)

  // D4a — the stored local label.
  if (LOCAL_LABEL && !doc.includes(LOCAL_LABEL)) p(`doc does not name the stored local label ${LOCAL_LABEL}`)
  if (doc.includes("`local-word-vectors`")) p("doc still presents `local-word-vectors` as the stored label")

  // D4b — no unconditional index-time retry promise. A line that QUOTES a
  // `bb setup` message in backticks is a quotation, not a claim about indexing;
  // script/m30/verify-honesty-docs.ts separately requires that quotation to be
  // verbatim, so it is excluded here rather than deleted.
  const retryOverclaim = doc
    .split("\n")
    .filter((l) => /indexing retr(y|ies) automatically/i.test(l))
    .filter((l) => !/^\s*-\s*`/.test(l))
  if (retryOverclaim.length) p(`unconditional retry claim: ${retryOverclaim.map((l) => l.trim()).join(" | ")}`)
  if (!/per-batch|_apiRetryAt/i.test(doc)) p("doc does not say where the primary provider's retry actually lives")

  // D6 — no key-shaped literal.
  if (/(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9]{16,}/.test(doc)) p("doc contains a key-shaped literal")

  return {
    documented: [...documented].sort(),
    read: [...READ_ANYWHERE].sort(),
    documentedNotRead,
    readNotDocumented,
    documentedNotLoaded,
    problems,
  }
}

console.log("EMB-DOCS embedding documentation contract")

const result = evaluateContract(EMBEDDINGS)

// D1
ck(problems(), "D1: every BB_EMBEDDING_* var documented in EMBEDDINGS.md is read by src/ code",
  result.documentedNotRead.length === 0, result.documentedNotRead.join(", "))
// D2
ck(problems(), "D2: every BB_EMBEDDING_* var read by src/ is documented in EMBEDDINGS.md",
  result.readNotDocumented.length === 0, result.readNotDocumented.join(", "))
// D3
ck(problems(), "D3: every documented var is LOADED in code (a comment is not a read)",
  result.documentedNotLoaded.length === 0, result.documentedNotLoaded.join(", "))

// The precedence vars are resolved in src/config/config.ts, outside the behavioural
// remit of the client. Prove they are genuinely read there.
{
  const configCode = CODE.get("src/config/config.ts")!
  const readThere = ["BB_EMBEDDING_BASE_URL", "BB_EMBEDDING_MODEL", "BB_EMBEDDING_API_KEY"]
    .filter((v) => new RegExp(`["'\`]${v}["'\`]`).test(configCode))
  check("D1: the three precedence vars are read in src/config/config.ts", readThere.length === 3, `read: ${readThere.join(", ")}`)
}

// The knobs this round added, each named with the var it must load. Spelled out
// so deleting one read fails a labelled check rather than a set difference.
const NEW_KNOBS: Array<[string, string, string]> = [
  ["kill switch", "BB_EMBEDDING_DISABLED", "src/brain/semantic/embedding-config.ts"],
  ["fallback endpoint", "BB_EMBEDDING_FALLBACK_BASE_URL", "src/brain/semantic/embedding-config.ts"],
  ["fallback model", "BB_EMBEDDING_FALLBACK_MODEL", "src/brain/semantic/embedding-config.ts"],
  ["fallback key", "BB_EMBEDDING_FALLBACK_API_KEY", "src/brain/semantic/embedding-config.ts"],
  ["fallback retry count", "BB_EMBEDDING_FALLBACK_RETRIES", "src/brain/semantic/embedding-config.ts"],
  ["request timeout", "BB_EMBEDDING_TIMEOUT_MS", "src/brain/semantic/embedding-config.ts"],
  ["inputs per request ceiling", "BB_EMBEDDING_MAX_INPUTS", "src/brain/semantic/embedding-config.ts"],
  ["retry base delay", "BB_EMBEDDING_RETRY_BASE_MS", "src/brain/semantic/embedding-config.ts"],
  ["retry delay ceiling", "BB_EMBEDDING_RETRY_CAP_MS", "src/brain/semantic/embedding-config.ts"],
  ["declared dimension", "BB_EMBEDDING_DIMENSION", "src/brain/semantic/embedding-config.ts"],
  ["query vector cache bound", "BB_EMBEDDING_CACHE_MAX", "src/brain/semantic/engine.ts"],
  ["drainer call bound", "BB_EMBEDDING_CALL_TIMEOUT_MS", "src/ast/parallel-indexer.ts"],
  ["store batch ceiling", "BB_EMBEDDING_BATCH_LIMIT", "src/ast/parallel-indexer.ts"],
  ["queue item cap", "BB_EMBEDDING_QUEUE_LIMIT", "src/ast/parallel-indexer.ts"],
]
for (const [label, v, file] of NEW_KNOBS) {
  check(`D3: ${label} (${v}) is loaded in ${file}`, CODE.get(file)!.includes(v))
}
check("D3: the declared dimension is enforced by the client, not just parsed",
  /cfg\.dimension/.test(CODE.get("src/brain/semantic/openai-embed.ts")!) &&
  /assertedDimension/.test(CODE.get("src/brain/semantic/embedding-config.ts")!))

// D4 — the corrected claims, asserted on their own so a regression names itself.
check("D4: the local model label is discoverable from the engine source", LOCAL_LABEL !== "", "LOCAL_MODEL_LABEL not found")
check("D4: the local label is versioned (a -vN suffix is load-bearing)", /^local-word-vectors-v\d+$/.test(LOCAL_LABEL), `label=${LOCAL_LABEL}`)
check("D4: EMBEDDINGS.md names the real stored local label", EMBEDDINGS.includes(LOCAL_LABEL), `doc lacks ${LOCAL_LABEL}`)
check("D4: EMBEDDINGS.md no longer presents `local-word-vectors` as the stored label", !EMBEDDINGS.includes("`local-word-vectors`"))
check("D4: EMBEDDINGS.md shows how to query the local vectors by that label", /local-word-vectors-v3'\s*\n?\s*WHERE|embedding_model = 'local-word-vectors/.test(EMBEDDINGS))
check("D4: EMBEDDINGS.md makes no unconditional 'indexing retries automatically' claim",
  !EMBEDDINGS.split("\n").some((l) => /indexing retr(y|ies) automatically/i.test(l) && !/^\s*-\s*`/.test(l)))
check("D4: EMBEDDINGS.md states where the primary's retry lives", /per-batch|_apiRetryAt/i.test(EMBEDDINGS))
check("D4: the quoted bb-setup 503 message is still present verbatim (m30 pins it)", EMBEDDINGS.includes("indexing retries automatically"))
check("D4: the doc corrects that quote in prose rather than deleting it", /What a saved key actually gets at index time/.test(EMBEDDINGS))
check("D4: the vector-mixing rule survived", /never compared or mixed/.test(EMBEDDINGS))
check("D4: the forced-reindex rule survived", /bb index --force/.test(EMBEDDINGS))

// D5 — the diagnosis the doc tells users to run.
const DOCTOR = SRC.get("src/setup/doctor.ts")!
const SHOW = SRC.get("src/setup/setup-show.ts")!
const HEALTH = SRC.get("src/intelligence/health/health-provider.ts")!
const DIAG = SRC.get("src/brain/semantic/embedding-diagnosis.ts")!
const CLIENT = SRC.get("src/brain/semantic/openai-embed.ts")!
check("D5: bb doctor consumes the shared diagnosis", /buildEmbeddingDiagnosis/.test(DOCTOR))
check("D5: bb setup show consumes the shared diagnosis", /buildEmbeddingDiagnosis/.test(SHOW))
check("D5: bb health consumes the shared diagnosis", /buildEmbeddingDiagnosis/.test(HEALTH))
check("D5: all three read the same builder, so they cannot drift",
  /embedding-diagnosis/.test(DOCTOR) && /embedding-diagnosis/.test(SHOW) && /embedding-diagnosis/.test(HEALTH))
check("D5: bb doctor prints the chain", /diagnosis\.chain/.test(DOCTOR))
check("D5: bb setup show prints the chain", /renderChainSummary/.test(SHOW))
check("D5: bb health prints the chain", /renderChainSummary/.test(HEALTH))
check("D5: bb health exposes the chain structurally for machine consumers", /embeddingChain/.test(HEALTH))
check("D5: the kill-switch predicate has a caller outside its own module",
  /isEmbeddingDisabled/.test(DOCTOR) || /isEmbeddingDisabled/.test(SHOW) || /isEmbeddingDisabled/.test(HEALTH))
check("D5: the failure classifier has a caller", /classifyStatus/.test(DIAG) || /classifyStatus/.test(DOCTOR) || /classifyStatus/.test(HEALTH))
check("D5: the endpoint assessor has a caller", /assessEndpoint/.test(DIAG))
check("D5: the observed-failure view has a caller", /observedEmbeddingFailures/.test(DIAG))
check("D5: the setup report is still exported for API consumers", /export async function getEmbeddingSetupReport/.test(CLIENT))
check("D5: EMBEDDINGS.md tells the reader to ask bb doctor", /bb doctor/.test(EMBEDDINGS))
check("D5: EMBEDDINGS.md documents the fallback chain order", /The fallback chain, in order/.test(EMBEDDINGS))
// The probe is exported but not CLI-reachable; that gap must stay VISIBLE here,
// not silently disappear from the report.
check("D5: the unreachable live probe is labelled as such in the source", /NOT YET REACHABLE/.test(DOCTOR))
{
  const cli = read("src/cli/index.ts")
  check("D5: bb health never probes (no network in a health check)", !/probeEmbedding/.test(cli) || !/health[\s\S]{0,4000}probeEmbeddingDiagnosis/.test(cli))
}

// D6
check("D6: EMBEDDINGS.md contains no key-shaped literal", !/(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9]{16,}/.test(EMBEDDINGS))
{
  const key = process.env.OPENROUTER_API_KEY
  if (key && key.length > 8) {
    check("D6: the env-provided key appears nowhere in EMBEDDINGS.md", !EMBEDDINGS.includes(key))
  } else {
    check("D6: (no key in this environment — nothing to leak from)", true)
  }
}

// ── mutants: re-run the REAL contract against mutated text ─────────────────
type Mutant = { name: string; doc: string; expect: (r: ContractResult) => boolean }
const mutants: Mutant[] = [
  {
    name: "a documented knob is removed from the doc but kept in code (undocumented knob)",
    doc: EMBEDDINGS.replaceAll("BB_EMBEDDING_MAX_INPUTS", "BB_EMBEDDING_MAX_TOKENS"),
    expect: (r) => r.readNotDocumented.includes("BB_EMBEDDING_MAX_INPUTS") || r.documentedNotRead.includes("BB_EMBEDDING_MAX_TOKENS"),
  },
  {
    name: "the stored local label regresses to the unversioned string",
    doc: EMBEDDINGS.replaceAll(LOCAL_LABEL, "local-word-vectors"),
    expect: (r) => r.problems.some((p) => /does not name the stored local label|unversioned|local-word-vectors`/.test(p)),
  },
  {
    name: "the false unconditional retry claim returns outside the quoted message",
    doc: EMBEDDINGS.replace(/further batches are held off by a bounded[^.]*\./i, "Indexing retries automatically."),
    expect: (r) => r.problems.some((p) => /unconditional retry claim/.test(p)),
  },
  {
    name: "the doc stops saying where the primary's retry lives",
    doc: EMBEDDINGS.replace(/per-batch/gi, "sometimes"),
    expect: (r) => r.problems.some((p) => /where the primary provider/.test(p)),
  },
]
// Mutants are only meaningful against a PRISTINE document: a mutant applied to a
// doc that is already failing produces no further change, and reporting that as
// a survived mutant would be a second, misleading failure on top of the real one.
// So when the contract is already failing, mutants are reported as skipped rather
// than as failures.
const baseAlreadyFailing = result.problems.length > 0
if (baseAlreadyFailing) {
  console.log(`  mutants: SKIPPED — the contract already failed (${result.problems.length} problem(s)); mutants require a pristine document`)
}
const mutantResults = mutants.map((m) => {
  const mutated = evaluateContract(m.doc)
  const applied = m.doc !== EMBEDDINGS
  const caught = applied && m.expect(mutated)
  if (!baseAlreadyFailing) {
    check(`mutant [${m.name}] applied`, applied, applied ? "" : "mutation produced no change — fix the mutant")
    check(`mutant [${m.name}] caught by the contract`, caught, caught ? "" : "survived")
  }
  return { name: m.name, applied, caught, skipped: baseAlreadyFailing }
})

// ── verdict + evidence ─────────────────────────────────────────────────────
const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${mutantResults.length} mutants`)
console.log(`  documented knobs: ${result.documented.length} · knobs read by src/: ${result.read.length}`)
if (!ok) console.log("VERDICT: FAIL")
else console.log("VERDICT: PASS")

let currentCommit = "unknown"
try {
  currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}
mkdirSync(RESULTS_DIR, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify({
  issue: "EMB-DOCS",
  code: "EMBDOCS",
  status: ok ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  negativeCases: mutantResults.filter((m) => m.caught && !m.skipped).length,
  mutants: mutantResults,
  currentCommit,
  verifierCommand: "npx tsx script/verify-embedding-docs.ts",
  evidenceFile: "EMBDOCS.json",
  generatedAt: new Date().toISOString(),
  documentedKnobs: result.documented,
  knobsReadBySrc: result.read,
  localModelLabel: LOCAL_LABEL,
  problems: problems(),
  limitations: [
    "The knob contract is a NAME contract: it proves each documented BB_EMBEDDING_* var is loaded in src/, and that each one's BEHAVIOUR is what the doc says. Behaviour is asserted separately, not re-derived from the doc here.",
    "Precedence over env vs config file is covered by script/m40/verify-a8-config.ts; this gate only proves the three var names are read in src/config/config.ts.",
    "Doc mutants mutate the doc text in memory and re-run the real contract against it. EMBEDDINGS.md is never modified by this verifier.",
    "Mutants are SKIPPED (not counted as failures) when the contract already fails, because a mutant applied to an already-broken document proves nothing about the mutant.",
  ],
}, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
process.exit(ok ? 0 : 1)

function problems(): string[] {
  return failures
}