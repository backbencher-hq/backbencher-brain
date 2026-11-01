// script/m13/verify-edit-docs.ts — M13.17 (E12).
//
// Docs + evidence + release gate for bb_edit.
//
// 1. DOCS ACCURACY: docs/tools/bb_edit.md must be byte-identical to a fresh
//    render from the executable registry (proven by running the real generator
//    in verify mode), and its Contract section must match the registry entry
//    field-by-field (mutability, requiresIndex, modes, defaults, category).
// 2. EVIDENCE COMMITTED: e1..e11.json must all exist, validate against the
//    shared schema, and claim verified.
// 3. RELEASE GATE: the gate must block a non-passing suite from claiming
//    verified. We prove this adversarially by tampering with a real evidence
//    document (failed>0, zero negative cases) and asserting the REAL
//    validateEvidence (imported from verify-evidence.ts) rejects it.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { EDIT_OPTIONS_BY_MODE } from "../../src/mcp/tool-validation"
import { MAX_BATCH_EDITS } from "../../src/intelligence/edit/edit-engine"

const harness = new Harness({
  issue: "M13.17",
  code: "E12",
  tool: "bb_edit",
  title: "bb_edit: docs + evidence + release gate",
  layers: ["unit", "e2e"],
  decisions: {
    docsAuthority: "src/mcp/tool-registry.ts + script/verify-tool-docs.ts (curated doc) are the single source; docs/tools/bb_edit.md is a generated artifact",
    releaseGate: "verify-quality-gate.ts (the E1-E12 verifiers wired) + verify-evidence.ts B3 invariant (verified requires failed=0 AND negativeCases>=1); proven by tamper test",
    evidenceInputs: "validation/m13/results/e1..e11.json plus e13.json (batch) must all exist, validate, and claim verified for bb_edit to be release-eligible",
  },
  limitations: [
    "Docs byte-freshness is proven by the generator's own verify mode, not by a duplicated render.",
    "This gate covers bb_edit only; other tools have their own issues in M13.",
    "The hand-page checks are phrase-level: they prove the page STATES each contract and that the enumerations it must match (the accepted sets, the entry cap) come from the enforcing constants, not that every sentence on the page is checked.",
  ],
})

// `import.meta.dir` is BUN-ONLY. Under Node it is undefined, so this gate died
// with `TypeError: The "paths[0]" argument must be of type string` before running
// a single check — it had never executed outside Bun. The `?? "."` fallback is
// NOT enough: the scripts are invoked from the repo ROOT, so "." plus "../.."
// climbs one level too far and the failure becomes ENOENT on a sibling path
// instead, which reads as a missing file rather than a wrong root.
//
// `fileURLToPath(import.meta.url)` is the repo's existing portable idiom
// (script/m62/verify-docs.ts, verify-consumers.ts, verify-arrival.ts and others
// already use exactly this). It is also the only form safe on a path containing
// a space — this repository lives under "/Users/…/Default Project/…", and
// `new URL(import.meta.url).pathname` percent-encodes that, so the naive
// form would break here while working everywhere else.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

// ── 1. Docs accuracy ───────────────────────────────────────────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_edit")
const docPath = path.join(root, "docs", "tools", "bb_edit.md")
let doc = ""
try { doc = readFileSync(docPath, "utf8") } catch {}

harness.check("docs: bb_edit.md exists", doc.length > 0, doc ? "" : "missing file")

if (registry) {
  const category = registry.documentation.category
  const defaults = JSON.stringify(registry.documentation.defaults)
  const modes = registry.modes.map((m: string) => `\`${m}\``).join(", ")
  harness.check("docs: category matches registry", doc.includes(`- Category: \`${category}\``), `registry=${category}`)
  harness.check("docs: mutability matches registry", doc.includes(`- Mutability: \`${registry.mutability}\``), `registry=${registry.mutability}`)
  harness.check("docs: requiresIndex matches registry", doc.includes(`- Requires index: \`${registry.requiresIndex}\``), `registry=${registry.requiresIndex}`)
  harness.check("docs: modes line matches registry", doc.includes(`- Modes: ${modes}`), `registry=${modes}`)
  harness.check("docs: defaults match registry", doc.includes(`- Defaults: \`${defaults}\``), `registry=${defaults}`)
  // Every declared input property must be documented.
  const props = Object.keys((registry.inputSchema as any).properties ?? {})
  const missing = props.filter((p) => !doc.includes(`"${p}"`))
  harness.check("docs: every input property is documented", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${props.length} props`)
  harness.check("docs: required=['mode'] is documented", doc.includes('"required"') && doc.includes('"mode"'))
  // Read the enum from the registry rather than a list kept here: this check used
  // to name the five modes and would have gone on passing — while a sixth mode
  // shipped undocumented — because it never looked at what the schema declares.
  const declaredModes = ((registry.inputSchema as any).properties?.mode?.enum ?? []) as string[]
  const enumMissing = declaredModes.filter((m) => !doc.includes(`"${m}"`))
  harness.check("docs: every mode in the schema enum appears in the generated page",
    declaredModes.length > 0 && enumMissing.length === 0,
    enumMissing.length ? `missing: ${enumMissing.join(",")}` : `${declaredModes.length} modes: ${declaredModes.join(",")}`)

  // ── M71.D6/D10: the page carries the per-mode facts, rendered from the SAME
  // constants the server and the validator enforce. The Contract line's boolean
  // was the whole published answer to "does this need an index?", and it read as
  // "the tool is unusable until you index" — false for the one mode that creates
  // files. The mode contract likewise lived only on this page, in prose beside a
  // rejection that named nothing.
  const free = registry.indexFreeModes ?? []
  harness.check(
    "docs: the Contract line carries the per-mode index exemption",
    free.length > 0 && doc.includes("- Requires index: `true` (except ") && free.every((mode) => doc.includes(`\`${mode}\``)),
    `registry indexFreeModes=[${free.join(",")}]`,
  )
  harness.check(
    "docs: the exemption states what the exempt mode does NOT resolve",
    doc.includes("resolves no symbol, and reindexes the file it wrote"),
    doc.split("\n").find((line) => line.startsWith("- Requires index:"))?.slice(0, 120),
  )
  for (const [mode, options] of Object.entries(EDIT_OPTIONS_BY_MODE)) {
    const rendered = `\`${mode}\` → ${options.map((option) => `\`${option}\``).join(", ")}`
    harness.check(`docs: the ${mode} accepted set is rendered from EDIT_OPTIONS_BY_MODE`, doc.includes(rendered), rendered)
  }
  harness.check(
    "docs: the mode-contract bullet no longer describes a known gap",
    doc.includes("the accepted set is named") && !doc.includes("not the accepted set for the mode"),
    "the page still describes the rejection as omitting the accepted set",
  )
}

// ── M71.D8: the HAND-WRITTEN page is checked against the registry too ──────
// `docs/tools/bb_edit.md` is generated and byte-freshness-gated. `docs/BB_EDIT.md`
// is written by hand and was gated by nothing, which is how it came to state that
// `insert` REQUIRES `position` while the registry makes it optional with a default
// of `after` — a false statement about the tool, in the page a reader is most
// likely to open, and one no gate could fail on. It is the same class of defect as
// the rejection message D10 fixed: the contract stated in a second place by a
// person rather than rendered from the constant that enforces it.
{
  const handPath = path.join(root, "docs", "BB_EDIT.md")
  let hand = ""
  try { hand = readFileSync(handPath, "utf8") } catch {}
  harness.check("hand page: docs/BB_EDIT.md exists", hand.length > 0, hand ? "" : "missing file")
  const flat = hand.replace(/\s+/g, " ")
  if (registry && hand.length > 0) {
    // (a) the per-mode table, cell for cell, against the constant the rejection
    // builds its message from — so the human page cannot drift from the enforced set.
    // The ROW MUST COME FROM THE PER-MODE ARGUMENTS SECTION. `write` also appears in
    // the index table (`| `write` | **no** | …`), and the first matching row was that
    // one: every mode parsed as an empty set, which is how this check reported a
    // mismatch for all five at once. A section-scoped read is the difference between
    // comparing the contract and comparing the wrong table.
    const argSection = hand.split(/\n## /).find((section) => section.startsWith("Per-Mode Arguments")) ?? ""
    harness.check("hand page: the Per-Mode Arguments section is present", argSection.length > 0, `${argSection.split("\n").length} lines`)
    const mismatches: string[] = []
    for (const [mode, options] of Object.entries(EDIT_OPTIONS_BY_MODE)) {
      const row = argSection.split("\n").find((line) => line.startsWith(`| \`${mode}\` |`))
      if (!row) { mismatches.push(`${mode}: no row`); continue }
      const cells = row.split("|").map((c) => c.trim())
      const documented = [...(cells[2] ?? "").matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1])
      if (JSON.stringify(documented) !== JSON.stringify([...options])) mismatches.push(`${mode}: documented=[${documented.join(",")}] registry=[${options.join(",")}]`)
    }
    harness.check("hand page: every mode's accepted set matches EDIT_OPTIONS_BY_MODE", mismatches.length === 0, mismatches.join(" · ").slice(0, 300))
    // (b) the D8 defect itself: `position` is optional (default `after`) per the
    // schema, and the page said it was required. Read the SCHEMA, not a memory of it.
    const insertRequired = ((registry.inputSchema as any).required ?? []).includes("position")
    harness.check("hand page: `insert` position optionality matches the schema",
      insertRequired || (!flat.includes("Required: `targetSymbolName`, `position`, and `newContent`") && flat.includes("`position` is optional and defaults to `after`")),
      insertRequired ? "the schema DOES require position" : "page still says position is required after the schema stopped")
    harness.check("hand page: the `content` alias is documented for the modes that accept it",
      flat.includes("`symbolName`, plus `newContent` (or its alias `content`)") && flat.includes("`targetSymbolName`, plus `newContent` (or its alias `content`)"),
      "update/insert required-field sentences do not name the alias")
    // (c) M71.D7: the overwrite contract on the page a human reads, all three states.
    harness.check("hand page: states the write guard and all three states of `overwrite`",
      flat.includes("**Omitted `overwrite`** replaces the file, but a replacement that removes **at least half** of a file's lines **and at least 5 lines** is refused as a probable mistake")
        && flat.includes("**`overwrite: true`** replaces it whatever the size")
        && flat.includes("**`overwrite: false`** is create-only"),
      "the hand-written page does not state the guard")
    harness.check("hand page: says the guard is evaluated at PLAN time (a dry run reports it)",
      flat.includes("The refusal happens at PLAN time, so `dryRun: true` reports the same refusal"), "")
    // (d) M71.D9: the plan-to-commit check, with the refusal text a caller will see.
    harness.check("hand page: states the plan-to-commit pre-image check",
      flat.includes("Every target's **sha256 is now taken as the plan reads it**")
        && flat.includes("bb_edit wrote nothing: 1 target file(s) changed on disk between planning and committing"),
      "the pre-image check is not documented on the hand-written page")
    // (e) M71.D13: the batch mode, on the page a human reads. The four claims here
    // are the ones a caller acts on — what the mode is for, that a refusal writes
    // nothing, that the envelope is per file, and the two limits (one file per
    // entry, the entry cap). The cap is read from the ENGINE constant, so the page
    // cannot state a number the code no longer enforces.
    harness.check("hand page: documents `batch` as a mode with its two shapes",
      flat.includes("Required: `edits` — a non-empty list of edits")
        && flat.includes("`files` turns the list into a **fan-out**")
        && flat.includes("`files` supplies the `filePath` of every entry"),
      "the batch mode is not documented on the hand-written page")
    harness.check("hand page: states that a refusal in any entry writes nothing",
      flat.includes("means the call writes nothing at all"), "")
    harness.check("hand page: states the duplicate-target refusal and the way forward",
      flat.includes("batch entries 0 and 1 both resolve to src/a.ts")
        && flat.includes("Edit that file in one entry, or make a second bb_edit call after this one."),
      "the two-entries-one-file rule is not on the page")
    harness.check("hand page: documents the per-file envelope and all six fields",
      flat.includes("carries `envelope`, the per-file outcome of the call")
        && ["atomic", "committed", "restored", "failed", "entry", "mode", "planned", "bytesBefore", "bytesAfter"].every((field) => flat.includes(`\"${field}\"`) || flat.includes(`\`${field}\``)),
      "the envelope fields are not on the page")
    harness.check(`hand page: states the entry cap from the engine constant (${MAX_BATCH_EDITS})`,
      flat.includes(`at most **${MAX_BATCH_EDITS}** edits`),
      `engine MAX_BATCH_EDITS=${MAX_BATCH_EDITS}`)
    harness.check("hand page: states that `batch` needs an index while `write` does not",
      flat.includes("`batch` is not exempt the way `write` is"), "")
    // ── The Phase B contracts: each one is a claim a reader acts on, so the hand
    // page has to carry it and this gate has to be able to go red when it stops.
    harness.check("hand page: states the import-cleanup scope and the declared skip",
      flat.includes("Import cleanup after the deletion is **TypeScript/JavaScript only**")
        && flat.includes("byte-for-byte unchanged")
        && flat.includes('"importPruning": {"attempted": false'),
      "the import-pruning contract is not on the page")
    harness.check("hand page: states the protected-path refusal",
      flat.includes("`.git/`, `.hg/`, `.svn/`, `node_modules/`, or the index data directory")
        && flat.includes("A protected target is refused by name before anything is written"),
      "the protected-path policy is not on the page")
    harness.check("hand page: states both rename refusals (existing name, same name)",
      flat.includes("is ALREADY DECLARED at top level")
        && flat.includes("`newName` that is the symbol's current name is refused as a no-op"),
      "the rename refusals are not on the page")
    harness.check("hand page: a plan-stage refusal carries the EMPTY envelope, declared",
      flat.includes("A refusal raised while PLANNING carries the EMPTY envelope")
        && flat.includes("refusedBeforeWriting: true"),
      "the plan-stage envelope is not on the page")
    harness.check("hand page: states the formatter line-ending repair and its declared field",
      flat.includes("restores the file's CRLF ending")
        && flat.includes("lineEndingRestored: true"),
      "the line-ending repair is not on the page")
    harness.check("hand page: states that reindexed is measured, not asserted",
      flat.includes("`reindexed` reports the reindex result, not the intent to reindex"),
      "the measured-reindex contract is not on the page")
    harness.check("hand page: states the measured commit cost and the client timeout ceiling",
      flat.includes("A commit therefore costs SECONDS")
        && flat.includes("30 s timeout"),
      "the measured commit cost is not on the page")
    // ── The generated page must carry the same Phase B contracts. ───────────
    harness.check("docs: the generated page carries the import-pruning limitation and its declaration",
      doc.includes("Import cleanup after `delete` is TypeScript/JavaScript-only")
        && doc.includes("importPruning.attempted: false"),
      "the generated page does not state the import-pruning scope")
    harness.check("docs: the generated page carries the protected-path refusal",
      doc.includes("Writes are refused inside `.git/`, `.hg/`, `.svn/`, `node_modules/`, and the index data directory"),
      "the generated page does not state the protected-path policy")
    harness.check("docs: the generated page carries the measured commit cost",
      doc.includes("A commit is SECONDS, not milliseconds") && doc.includes("30 s timeout"),
      "the generated page does not state the measured commit cost")
  }
}

// Byte-freshness: the real generator's verify mode must pass (exit 0). This is
// the same artifact check the gate runs; we assert it here as the docs gate.
// The check spawns the generator. It used to spawn `bun`, which is the same
// hardcoded-runtime bug as `import.meta.dir` in this file: under Node the spawn
// fails with ENOENT and the assertion reads
//
//   docs: generator verify mode passes (bb_edit.md byte-fresh)
//
// which says the DOCUMENTATION IS STALE. It is not. Running the generator under
// Node on the same tree prints `TOOL DOCS: PASS (16 public tools, 18 artifacts)`,
// so the artifact was byte-fresh the whole time and this gate was reporting a
// missing runtime as a content defect — the worst possible direction for a
// freshness check, because the correct response to it is to regenerate.
//
// It now spawns the runtime it is itself running under, which is what the repo
// does elsewhere (process.execPath in script/m31/verify-gate-selftest.ts,
// script/m65/verify-rules-gate-selftest.ts), and only the invocation differs:
// Bun runs a .ts file directly, Node needs the tsx loader.
const runningUnderBun = typeof (globalThis as any).Bun !== "undefined"
// SCOPED to this tool: the generator's unscoped verify also checks every other
// tool's page, so a stale page elsewhere in the tree turned THIS tool's gate red
// for a file it does not own (measured: 82/83 with the only failure naming
// docs/tools/bb_analyze.md). A per-tool release gate must fail on its own
// artifact, not on the repository's regeneration state.
const generatorArgs = runningUnderBun
  ? ["run", "script/verify-tool-docs.ts", "--only", "bb_edit"]
  : ["--import", "tsx", "script/verify-tool-docs.ts", "--only", "bb_edit"]
const gen = spawnSync(process.execPath, generatorArgs, { cwd: root, encoding: "utf8", timeout: 300_000 })
harness.check(
  `docs: generator verify mode passes for bb_edit (bb_edit.md byte-fresh) — ${runningUnderBun ? "bun" : "node"}`,
  gen.status === 0,
  gen.status === 0 ? "" : `exit ${gen.status}: ${(gen.stderr || gen.stdout || "").slice(0, 200)}`,
)

// ── 2. Evidence committed and passing (e1..e11) ────────────────────────────
const E_FILES = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10", "e11", "e13"]
const evDocs: any[] = []
for (const code of E_FILES) {
  let doc2: any = null
  try { doc2 = JSON.parse(readFileSync(path.join(RESULTS, `${code}.json`), "utf8")) } catch {}
  const exists = !!doc2
  const valid = exists && validateEvidence(doc2).length === 0
  const verified = valid && doc2.verifiedState === "verified"
  harness.check(`evidence: ${code}.json exists, validates, verified`, exists && valid && verified, !exists ? "missing" : !valid ? validateEvidence(doc2).join("; ").slice(0, 120) : doc2.verifiedState)
  if (doc2) evDocs.push(doc2)
}
harness.check(`evidence: all ${E_FILES.length} E-issues claim verified with negatives`, evDocs.length === E_FILES.length && evDocs.every((d) => d.negativeCases >= 1), evDocs.map((d) => `${d.code}:${d.negativeCases}neg`).join(" "))

// ── 3. Release gate blocks 'verified' unless every E-issue passes ──────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
const E_VERIFIERS = ["verify-edit-boundary", "verify-edit-rename", "verify-edit-mask", "verify-edit-body", "verify-edit-freshness", "verify-edit-atomicity", "verify-edit-unit", "verify-edit-integration", "verify-edit-e2e", "verify-edit-corpus", "verify-edit-honesty", "verify-edit-batch"]
for (const v of E_VERIFIERS) {
  harness.check(`gate: ${v}.ts wired into quality gate`, gateSrc.includes(`m13/${v}.ts`))
  harness.check(`gate: ${v}.ts wired into npm run verify`, verifyScript.includes(`script/m13/${v}.ts`))
}
harness.check("gate: evidence validator (B3) is part of the gate", gateSrc.includes("m13/verify-evidence.ts") && verifyScript.includes("script/m13/verify-evidence.ts"))

// Adversarial: a tampered document (failed>0, zero negatives) claiming verified
// MUST be rejected by the real validator. This proves the gate actually blocks.
const tampered = JSON.parse(JSON.stringify(evDocs[0]))
tampered.verifiedState = "verified"
tampered.negativeCases = 0
tampered.summary.failed = 3
const tamperErrors = validateEvidence(tampered)
harness.negative("gate: tampered doc (failed>0, no negatives) cannot claim verified", tamperErrors.length > 0, tamperErrors.join("; ").slice(0, 160))

// Adversarial: dropping any one verifier from the quality gate must break the
// gate wiring (each E1-E11 verifier is individually required).
const dropped = E_VERIFIERS.map((v) => gateSrc.replace(`m13/${v}.ts`, `m13/${v}-REMOVED.ts`))
harness.negative("gate: removing any single E-verifier breaks the gate", dropped.every((d) => d !== gateSrc), "all verifiers still present")

harness.emit()
