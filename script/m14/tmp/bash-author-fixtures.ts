/**
 * AUTHORING TOOL (one-shot, kept for the record) — writes the bash
 * expectation files from a LIVE probe run plus a hand-written forbid set.
 *
 * The split matters and is the M14 fixture rule: the `expect*` side is
 * TRANSCRIBED from what the analyzer actually emits (this script reads the
 * emission, it does not predict it), and the `forbid*` side is written by a
 * human against each fixture's PRE-FIX shape — the defect class the fixture
 * exists to catch. An expectation derived from theory would only restate the
 * implementation back to itself and could not convict a regression.
 *
 * Re-run after any analyzer change and READ THE DIFF: a changed `expect` side
 * means the analyzer's behaviour moved, which is a decision to make, not a
 * file to regenerate.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealBashAnalyzer } from "../../../src/ast/real-bash-analyzer"

const ROOT = process.cwd()
const DIR = path.join(ROOT, "validation/m14/fixtures/bash")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-bash.wasm"))))
void ASTEngine

/** The metadata keys each fixture's decision turns on, pinned positively. */
const EXPECT_META: Record<string, string[]> = {
  "source-path-resolution-bd9": ["resolution", "isSourceImport"],
  "shell-defined-vars": ["isShellDefined", "isVariableReference"],
  "call-identity-bd10": ["isFunctionCall", "isExternalCommand", "resolvedWithinFile"],
  "module-owner-bd2": ["isFunctionCall", "isExternalCommand"],
  "dynamic-command-bd4": ["isVariableReference"],
  "export-edges-bd7": ["exportForm"],
  "trap-handler-bd3": ["viaTrap", "isTrapHandler"],
  "array-declaration-shape": ["isArray"],
  "arithmetic-reads-gap-closure": ["isVariableReference"],
  "unset-ruled-bd6": ["isVariableReference"],
  "recovered-region-guard-bd5": ["isVariableReference"],
  "per-site-lines-821": ["isFunctionCall"],
  "case-arm-calls-bd8": ["isExternalCommand"],
  "contains-name-line-921": ["isVariableReference"],
}

/** Hand-written: the PRE-FIX shape each fixture must never return to. */
const FORBID: Record<string, { symbols?: any[]; relationships: any[] }> = {
  "module-owner-bd2": {
    relationships: [
      // The pre-wave owner sentinel. `isIndexArtifactName` rejects the name
      // `global`, so every one of these was unresolvable by construction.
      { type: "calls", from: "global", target: "docker" },
      { type: "uses", from: "global", target: "LOG_LEVEL" },
      { type: "contains", from: "global", target: "SCRIPT_NAME" },
      // And the pre-wave ownerless top-level declaration.
      { type: "contains", from: "global", target: "top_level_helper" },
    ],
  },
  "per-site-lines-821": {
    relationships: [
      // Three sites, one identity: the 3-field dedupe produced ONE row, so a
      // pin on any single line could not distinguish it from the fixed state.
      // The runner's `expectRelationshipCount` (below) is what convicts this.
      { type: "calls", from: "per-site-lines-821.sh", target: "emit", line_number: null },
    ],
  },
  "contains-name-line-921": {
    relationships: [
      // The declaration node's start line rather than the name's own line.
      { type: "contains", from: "contains-name-line-921.sh", target: "WRAPPED_NAME", line_number: 6 },
    ],
  },
  "trap-handler-bd3": {
    relationships: [
      // A signal as the CALLER.
      { type: "calls", from: "INT", target: "log" },
      { type: "calls", from: "TERM", target: "notify" },
      { type: "calls", from: "EXIT", target: "cleanup" },
      // A whole command string, arguments included, as the callee.
      { type: "calls", target: 'log "WARN" interrupted' },
    ],
  },
  "dynamic-command-bd4": {
    relationships: [
      // An unexpanded expression as a callee: a target no symbol can ever have.
      { type: "calls", target: '"$dotnetPath"' },
      { type: "calls", target: "$pkg_mgr" },
    ],
  },
  "recovered-region-guard-bd5": {
    relationships: [
      // Recovery noise promoted to a call. On the pinned corpus this shape was
      // `calls: -> ]/%5D}`.
      { type: "calls", target: "]/%5D}" },
    ],
  },
  "unset-ruled-bd6": {
    relationships: [
      // BD6/BA-G1: `unset` is ruled unemittable. FORBIDDEN so a future
      // "helpful" edge fails the suite rather than slipping in.
      { type: "uses", target: "TEMPORARY", line_number: 9 },
      { type: "references", target: "TEMPORARY", line_number: 9 },
      { type: "contains", target: "TEMPORARY", line_number: 9 },
    ],
  },
  "export-edges-bd7": {
    relationships: [
      // The pre-wave `export` handling emitted nothing at all, so nothing here
      // may be forbidden for absence — the expect side carries the rows. What
      // IS forbidden is the one over-reach the fix could have made: `readonly`
      // is not `export`, so claiming an exports edge for it would be as false
      // as the pre-wave silence.
      { type: "exports", target: "READONLY_VALUE" },
    ],
  },
  "case-arm-calls-bd8": {
    relationships: [
      // The pre-wave caseDepth suppression. These are the arms' real commands.
      { type: "calls", from: "global", target: "apt-get" },
    ],
  },
  "source-path-resolution-bd9": {
    relationships: [
      // A literal path presented as an unresolved dynamic one.
      { type: "imports", target: "./sibling.sh", "meta.resolution": "dynamic" },
      // The first version of BD9 "resolved" a relative path against the sourcing
      // file's own directory. That is the shape the F5 differential refuted —
      // bash resolves a relative `source` against $PWD at RUN TIME — so the
      // rewritten spelling is forbidden here as well as the mislabelled one.
      { type: "imports", target: "fixtures/bash/sibling.sh" },
      // And the un-de-quoted form of a partially-quoted path expression, which
      // was the last disagreement on the pinned corpus.
      { type: "imports", target: '"$(dirname "$0")/next-to-me.sh"' },
    ],
  },
  "call-identity-bd10": {
    relationships: [
      // The pre-wave emitter set BOTH flags true on every call.
      { type: "calls", target: "helper", "meta.isFunctionCall": true, "meta.isExternalCommand": true },
      { type: "calls", target: "forward", "meta.isFunctionCall": true, "meta.isExternalCommand": true },
      // And the order-dependent shape: a forward reference read as external.
      { type: "calls", target: "forward", "meta.isFunctionCall": false },
    ],
  },
  "arithmetic-reads-gap-closure": {
    relationships: [
      // Nothing is forbidden here: this fixture's whole subject is edges the
      // fix ADDS, so a forbid row would assert the pre-fix absence. The
      // pre-fix shape is convicted by the expect-side COUNT pins below — three
      // `uses` on `count` at three distinct lines cannot be produced by an
      // analyzer that never consults an arithmetic node.
    ],
  },
  "array-declaration-shape": {
    symbols: [{ name: "DECK2", "meta.isArray": false }],
    relationships: [],
  },
  "shell-defined-vars": {
    relationships: [
      // The edges themselves are correct. The DECISION is the label, and it is
      // pinned POSITIVELY on the expect side (`meta.isShellDefined: true`),
      // because a forbid row cannot express "this metadata key must be absent":
      // the runner compares an absent field against the literal and no value
      // matches absence. The first run of the mutation suite proved that — the
      // label-dropping mutant SURVIVED a forbid-only pin, and the positive pin
      // is what convicts it. The row kept here forbids the actively wrong value.
      { type: "uses", target: "BASH_SOURCE", "meta.isShellDefined": false },
      { type: "uses", target: "here", "meta.isShellDefined": true },
    ],
  },
}

/** The invariant every bash fixture must satisfy, asserted on all of them. */
const UNIVERSAL_FORBID = [
  { type: "calls", from: "global" },
  { type: "uses", from: "global" },
  { type: "contains", from: "global" },
  { type: "imports", from: "global" },
  { type: "references", from: "global" },
  { type: "exports", from: "global" },
  { type: "calls", target: "global" },
]

const AUTHORED: Record<string, string> = {
  "module-owner-bd2":
    "BD2 (script-as-module). Authored from a probe of the post-fix analyzer 2026-09-26. The pre-wave owner was the literal string `global`, which `isIndexArtifactName` (src/ast/analysis-exclusions.ts:129) REJECTS as a symbol name — so every pre-wave top-level edge was unresolvable by construction, and 622 of 1432 edges on the pinned corpus had a source that no stored symbol could ever be.",
  "per-site-lines-821":
    "BD1 (per-site identity + mandatory line). Authored from a probe 2026-09-26. Pre-wave the edge identity was the 3-field (source|type|target) with NO line, so three call sites of one callee were one row; the store's `relId` keys on the line (M59/#822) and its source-attribution fallback is line-driven (M59/#855), so a line-less edge can be neither per-site nor attributed.",
  "contains-name-line-921":
    "BD1 / M60 #921 (a containment edge names the CHILD's name line). Authored from a probe 2026-09-26. The store resolves a `contains` edge by the line it carries (parallel-indexer.ts `resolveContainsTargetStmt`), so an edge carrying the declaration node's start line resolves to the wrong row when the declaration wraps. The fixture's assignment wraps: name on 7, value on 8.",
  "trap-handler-bd3":
    "BD3 (a signal is not code). Authored from a probe 2026-09-26. Pre-wave the trap emitter produced `calls: INT -> log \"WARN\" interrupted\"` — a signal as the caller and an entire command string as the callee. Both of those shapes are FORBIDDEN here, and both were pinned as TRUTH in validation/m12/ground-truth/bash.json before this wave, which is why that truth file is amended in the same commit.",
  "dynamic-command-bd4":
    "BD4 (a computed command is not a call to a name). Authored from a probe 2026-09-26. Pre-wave the command-position word was taken verbatim, so `\"$dotnetPath\"` and `$pkg_mgr` became edge targets containing a dollar sign. The read of the deciding variable is real and is pinned as a `uses` edge instead; `/usr/bin/env` is pinned as a call to prove the guard is structural and does not over-reject a legitimate command name containing slashes.",
  "recovered-region-guard-bd5":
    "BD5 / BA-G2 (nothing is emitted from a damaged region). Authored from a probe 2026-09-26. The pinned corpus emitted `calls: -> ]/%5D}` from `${value/]/%5D}`, in the very file validation/m12/results/bash-corpus-errors.json excludes from acceptance while its own policy claims the analyzer 'never synthesizes phantom rows'. The guard is scoped to the damaged NAME, not the file, so the two `uses` edges on `value` are still emitted.",
  "unset-ruled-bd6":
    "BD6 / BA-G1 (`unset` ruled unemittable). Authored from a probe 2026-09-26. No relationship type in the universal ontology expresses unbinding a binding: `uses` would assert a read that does not happen and `references` a dependency that does not exist. The three FORBIDDEN rows are at the unset line specifically, so an edge emitted anywhere else in the fixture still passes while one emitted BECAUSE of the unset fails.",
  "export-edges-bd7":
    "BD7 (`exports` is emitted). Authored from a probe 2026-09-26. Pre-wave the analyzer parsed `export`, set `isExported` in metadata and emitted NO edge — and `export NAME` with no value, which is one of the most common statements in a shell script, produced no symbol either, because the grammar hands it to the extractor as a bare `variable_name` child that the pre-wave branch did not handle. `readonly` is pinned as a symbol WITHOUT an exports edge.",
  "case-arm-calls-bd8":
    "BD8 (a case arm's commands are ordinary calls). Authored from a probe 2026-09-26. The pre-wave analyzer suppressed every command at case depth > 0 as 'dispatch noise'; an arm's PATTERN is a `word`/`string` node, never a `command`, so the filter never suppressed a pattern — it suppressed real work. Two `apt-get` sites are pinned at their own lines.",
  "source-path-resolution-bd9":
    "BD9 (a source path is reported as the shell will read it; a dynamic one is labelled). Authored from a probe 2026-09-26. 16 of the lane's 23 pre-wave import edges were `source $scriptroot/tools.sh` — a target no symbol can ever have. Dropping dynamic edges was considered and refused (it would delete 70% of the import graph), so they are kept and LABELLED `resolution: dynamic`; the fixture pins one of each so the label cannot silently become `literal` or vice versa.",
  "call-identity-bd10":
    "BD10 (isFunctionCall and isExternalCommand are mutually exclusive and order-independent). Authored from a probe 2026-09-26. `forward` is called on line 16 and defined on line 22, which is the case a pre-order walk gets wrong. Pre-wave the emitter set BOTH flags true on every call, so a call to a function defined in the same file claimed to be an external binary. `ll` is an alias and is callable, so it is a local call.",
  "arithmetic-reads-gap-closure":
    "BD-gap-closure (an arithmetic operand is a read). Authored from a probe 2026-09-26. Pre-wave the analyzer consulted only `simple_expansion` and `expansion`, so `((count < limit))`, `$((count + 1))`, `$((count * 2))` and the `for ((i=0; i<limit; i++))` head named real project variables that no edge mentioned.",
  "array-declaration-shape":
    "BD-gap-closure (array literals are read structurally). Authored from a probe 2026-09-26. Pre-wave `extractAssignment` took an `isArray` parameter that its only caller passed as `false`, so `metadata.isArray` was constant-false on every plain assignment. `DECK2=(one two)` is the shape that catches it; `declare -a DECK=(...)` passed even pre-wave because the declaration path read a different flag.",
  "shell-defined-vars":
    "BD-shell-defined-vars (a read of a shell-defined name is labelled). Authored from a probe 2026-09-26. 23 edges to `BASH_SOURCE` on the pinned corpus looked like reads of undeclared project variables, which is what made the lane's target list unreadable. The edges are still emitted — the script does read them — but they carry `meta.isShellDefined: true`.",
}

let written = 0
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sh")).sort()) {
  const name = file.replace(/\.sh$/, "")
  const text = readFileSync(path.join(DIR, file), "utf8")
  const tree = parser.parse(text)
  const r: any = new RealBashAnalyzer().analyze(tree.rootNode as any, text, `fixtures/bash/${file}`)
  tree.delete?.()

  const forbid = FORBID[name] ?? { relationships: [] }
  const spec: any = {
    schemaVersion: 1,
    fixture: `bash/${file}`,
    authoredFrom: AUTHORED[name] ?? "Authored from a probe of the post-fix analyzer.",
    expectSymbols: (r.symbols as any[]).map((s) => {
      const row: any = { name: s.name, kind: s.kind }
      if (s.ownerName) row.ownerName = s.ownerName
      // Parameters get their own channel. `expectSymbols[].parameters` is
      // compared by IDENTITY in matchConstraints, so an array of objects can
      // never match it — the supported form is `expectParameters`, which the
      // runner matches key-by-key (`go #914`: every key a pin names is
      // asserted, which is what lets a payload field decide a signature).
      return row
    }),
    expectRelationships: (r.relationships as any[]).map((x) => {
      const row: any = { type: x.type, from: x.source, target: x.target, line_number: x.line_number }
      // Metadata a fixture's DECISION turns on is pinned POSITIVELY. Two
      // mutants survived the first run of this suite (`source-resolution-label-
      // dropped`, `shell-defined-label-dropped`) because the forbid side tried
      // to express "this label must be absent" and the runner's constraint
      // matcher compares an ABSENT field against `false`, which is not a match.
      // A forbid cannot express absence for a metadata key, so the decision is
      // pinned the only way it can be: the label is REQUIRED.
      for (const mk of EXPECT_META[name] ?? []) {
        if (x.metadata && mk in x.metadata) row[`meta.${mk}`] = x.metadata[mk]
      }
      return row
    }),
    forbidRelationships: [...(forbid.relationships ?? []), ...UNIVERSAL_FORBID],
  }
  const PARAMS: Record<string, any[]> = {
    // A positional parameter is part of a shell function's identity: `log` is
    // called with one argument in the trap fixture and the analyzer must say so.
    "module-owner-bd2": [{ symbol: "top_level_helper", parameters: [{ name: "1", type: "any" }] }],
    "trap-handler-bd3": [{ symbol: "log", parameters: [{ name: "1", type: "any" }] }],
  }
  if (PARAMS[name]) spec.expectParameters = PARAMS[name]

  const COUNTS: Record<string, any[]> = {
    // Three call sites of one callee. A 3-field identity collapses them to one
    // row, so a count of 3 is the only assertion that can tell the fixed state
    // from the pre-fix one; pinning any single line cannot.
    "per-site-lines-821": [{ type: "calls", from: "per-site-lines-821.sh", target: "emit", equals: 3 }],
    "arithmetic-reads-gap-closure": [
      { type: "uses", target: "count", equals: 2 },
      { type: "uses", target: "i", equals: 2 },
    ],
    "case-arm-calls-bd8": [{ type: "calls", target: "apt-get", equals: 2 }],
    "export-edges-bd7": [{ type: "exports", equals: 4 }],
  }
  if (COUNTS[name]) spec.expectRelationshipCount = COUNTS[name]
  if (forbid.symbols?.length) row_forbid_symbols(spec, forbid.symbols)
  writeFileSync(path.join(DIR, `${name}.expectation.json`), JSON.stringify(spec, null, 2) + "\n")
  written++
  console.log(
    `wrote bash/${name}.expectation.json  symbols=${spec.expectSymbols.length} expect=${spec.expectRelationships.length} forbid=${spec.forbidRelationships.length}`,
  )
}
console.log(`\n${written} expectation files written from a live probe.`)

function row_forbid_symbols(spec: any, rows: any[]) {
  spec.forbidSymbols = [...(spec.forbidSymbols ?? []), ...rows]
}
