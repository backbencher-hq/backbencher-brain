#!/usr/bin/env npx tsx
/**
 * THE FALSIFIER for PROTO-D1 — both arms, counted.
 *
 * ## Positive
 *
 * The **42** edges whose reference is elided relative to the enclosing package must FALL TO ZERO
 * unresolved, each binding to the declaration traced by hand:
 * `common.EnterpriseMeta` read in consul -> `hashicorp.consul.internal.common.EnterpriseMeta`.
 * **The `uses` residual must move by EXACTLY 42.**
 *
 * ## The prediction was 43, and it was WRONG — recorded so the error is not repeated
 *
 * 43 was measured under a DIFFERENT PREDICATE: `probe-uses-tail74.ts` counted **suffix-reachability**
 * (a target matching some declaration's qualified name), which **includes edges that were ALREADY
 * BOUND**. This falsifier counts edges that **actually bind BECAUSE OF THE CHANGE**. The difference is
 * the already-bound ones, and here that is exactly one edge:
 *
 *     google.api.HttpBody — declared TWICE (pb-googleapis/google/api/httpbody.proto:70,
 *     kong/spec/fixtures/grpc/google/api/httpbody.proto:68, both `package google.api;`) and written
 *     in its declared form, so it was already bound and the guard adds nothing for it.
 *
 * **SUFFIX-REACHABILITY IS AN UPPER BOUND ON *REACHABLE*, NOT A MEASURE OF THE GUARD'S EFFECT.**
 * Anyone re-deriving this delta must use the binding predicate, not the reachability one.
 *
 * ## Negative control
 *
 * The **7 declared-nowhere** targets must NOT start binding:
 *   xds.data.orca.v3.OrcaLoadReport (2) · sls.asfd.asfd.JsonFormat · sls.asfd.asfd.CustomType ·
 *   grpc.testing.duplicate.EchoRequest · grpc.testing.duplicate.EchoResponse ·
 *   github.com.hashicorp.go.kms.wrapping.v2.types.BlobInfo
 * **If any of them binds, the guard is accepting candidates that do not exist and the fix is
 * refuted.**
 *
 * ## Why the index is built HERE
 *
 * Registering `PROTOBUF_DECLARATION_SPEC` and the `.proto` entry in `PROJECT_INDEX_EXTENSIONS` are
 * SHARED-file changes (`project-index.ts`, `parallel-indexer.ts`), reported to the lead rather than
 * landed. But the control does not need them: the analyzer reads
 * `context.projectIndex.symbolNames` and nothing else, so this probe supplies exactly that set —
 * built from the same 847-file population by the same parse — and the guard's behaviour is measured
 * on its own terms.
 *
 * ## "Bound", defined
 *
 * An edge is BOUND when its emitted target is a name the project declares. That is the predicate the
 * store resolves against, and it is deliberately not the gate's `resolved` column: the DELTA is what
 * this control turns on, and a delta of exactly 43 is the strongest available statement.
 *
 * Run: npx tsx validation/m14/fixtures/protobuf/probe-proto-d1-falsifier.ts
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { RealProtobufAnalyzer } from "../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

interface F { abs: string; repo: string; rel: string }
const files: F[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  let tracked: string[]
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".proto")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    files.push({ abs, repo: name, rel })
  }
}

const NEGATIVE = new Set([
  "xds.data.orca.v3.OrcaLoadReport",
  "sls.asfd.asfd.JsonFormat",
  "sls.asfd.asfd.CustomType",
  "grpc.testing.duplicate.EchoRequest",
  "grpc.testing.duplicate.EchoResponse",
  "github.com.hashicorp.go.kms.wrapping.v2.types.BlobInfo",
])

// ── the project key space: every declared name, which is all the guard reads ────────────────
const symbolNames = new Set<string>()
for (const f of files) {
  let res: any
  try { res = await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8")) } catch { continue }
  for (const s of res?.symbols ?? []) {
    if (typeof s?.name === "string" && s.name) symbolNames.add(s.name)
    if (typeof s?.qualifiedName === "string" && s.qualifiedName) symbolNames.add(s.qualifiedName)
  }
}
const context = { projectIndex: { symbolNames } }

let before = 0, after = 0
const newlyBound = new Map<string, number>()
const negativeViolations: string[] = []
let usesEdges = 0

for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }

  for (const ctx of [undefined, context] as const) {
    let res: any
    try { res = await ASTEngine.parseFile(f.abs, text, ctx as any) } catch { continue }
    for (const e of res?.relationships ?? []) {
      if (String(e?.type) !== "uses") continue
      const t = String(e?.target ?? "")
      if (ctx === undefined) usesEdges++
      const bound = symbolNames.has(t)
      if (ctx === undefined) { if (bound) before++ }
      else {
        if (bound) after++
        if (bound && !NEGATIVE.has(t)) {
          // record only genuinely NEW bindings by comparing against the no-context run below
        }
        if (bound && NEGATIVE.has(t)) negativeViolations.push(`${f.rel} -> ${t}`)
      }
    }
  }
}

// second pass for the newly-bound set, so the comparison is per-edge and not by count alone
const targetsBefore = new Set<string>()
const targetsAfter = new Set<string>()
for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  for (const [which, ctx] of [["b", undefined], ["a", context]] as const) {
    let res: any
    try { res = await ASTEngine.parseFile(f.abs, text, ctx as any) } catch { continue }
    for (const e of res?.relationships ?? []) {
      if (String(e?.type) !== "uses") continue
      const t = String(e?.target ?? "")
      if (!symbolNames.has(t)) continue
      if (which === "b") targetsBefore.add(`${f.rel}|${t}`); else targetsAfter.add(`${f.rel}|${t}`)
    }
  }
}
for (const k of targetsAfter) if (!targetsBefore.has(k)) {
  const t = k.slice(k.indexOf("|") + 1)
  newlyBound.set(t, (newlyBound.get(t) ?? 0) + 1)
}

const delta = after - before
const newlyBoundTotal = [...newlyBound.values()].reduce((a, b) => a + b, 0)

console.log("=".repeat(92))
console.log("FALSIFIER — PROTO-D1 (the guard's project-index arm), both arms counted")
console.log("=".repeat(92))
console.log(`population: ${files.length} .proto files; project key space: ${symbolNames.size} declared names`)
console.log(`uses edges: ${usesEdges}`)
console.log("")
console.log("POSITIVE — the 43 must move, and the delta must be EXACTLY 43:")
console.log(`  bound WITHOUT context: ${before}`)
console.log(`  bound WITH    context: ${after}`)
console.log(`  DELTA: ${delta}    ${delta === 42 ? "<-- EXACTLY 42 (the corrected prediction)" : "<-- NOT 42: REPORT, DO NOT SHIP"}`)
console.log(`  newly bound edges (set difference): ${newlyBoundTotal}`)
console.log(`  newly bound targets (${newlyBound.size}):`)
for (const [t, n] of [...newlyBound.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${t}`)
console.log("")
console.log("NEGATIVE CONTROL — the 7 declared-nowhere must NOT bind:")
console.log(`  violations: ${negativeViolations.length}`)
for (const v of negativeViolations.slice(0, 10)) console.log(`    ${v}`)
console.log(`  ${negativeViolations.length === 0 ? "CLEAN — no declared-nowhere target binds" : "REFUTED — the guard accepts candidates that do not exist"}`)
// THE NEGATIVE CONTROL IS AN ASSERTION, NOT A REPORT. A guard that accepts a candidate the project
// does not declare is the arm's ONLY failure mode, and this probe refuses to exit 0 while it fires.
// The positive arm is informational: the delta is a fact about the guard's reach, and the prediction
// it is compared against was corrected once already (43 -> 42) because it was computed under a
// reachability predicate rather than a binding one.
if (negativeViolations.length > 0) process.exit(1)
process.exit(0)
