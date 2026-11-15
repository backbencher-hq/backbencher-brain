/**
 * INCOMING AUDIT (nim) — provenance wrapper around the SHARED incoming-check.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-check.ts` is the only instrument that measures the reverse
 * direction, and it is shared machinery this lane does not own (§8). It writes a
 * bare per-type table to stdout and nothing else: no analyzer digest, no record of
 * WHICH files it was pointed at, no verdict on either side of the walk.
 *
 * That is enough to be misread. A reader holding
 * `validation/m14/measurements/nim/ambiguity-compiler.json` (which carries a
 * digest) next to an un-digested incoming-check printout has no way to tell
 * whether the two were produced by the same analyzer state. In this lane that was
 * not hypothetical: three cells of the document's incoming table did not match
 * this instrument when it was finally re-run and pinned, and nothing in either
 * artifact could have said which of the two numbers was the older one.
 *
 * So this wrapper does the one thing the shared script cannot do for itself:
 *
 *   1. hash `src/ast/real-nim-analyzer.ts` BEFORE and AFTER the child walk and
 *      publish both, so a run that straddles an edit says so;
 *   2. hash the FILE LIST it passed, so "182 files" is checkable rather than
 *      asserted — the count alone cannot distinguish `compiler/*.nim` (180) from
 *      the same set plus the two `.nimble` files (182), and `.nimble` routes to
 *      nim in `src/ast/language-detection.ts`;
 *   3. record the child's exit code and stderr, so a child that threw is not
 *      read as a child that measured zero;
 *   4. re-state, per type, the columns the reverse walk in `src/lsp/impact.ts`
 *      actually consumes, because `ambiguousTargets` is a per-TARGET count while
 *      `edges` is per-edge and the two are routinely read as one number.
 *
 * It shells out rather than importing, because the shared script is a CLI with no
 * exports and editing it is §8. Nothing here changes a measurement: every number
 * under `perType` is the child's, byte for byte, and this file adds provenance
 * around them and nothing else.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/nim/incoming-audit.ts compiler
 *   npx tsx validation/m14/fixtures/nim/incoming-audit.ts lib/pure
 *   BB_NIM_AMBIGUITY_SUB=all npx tsx validation/m14/fixtures/nim/incoming-audit.ts all
 *
 * READ-ONLY with respect to the corpus. Writes one artifact per run under
 * `validation/m14/measurements/nim/incoming-<sub>.{json,txt}`.
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const HERE = path.resolve((import.meta as any).dirname ?? ".")
const ROOT = path.resolve(HERE, "../../../..")
const ANALYZER = path.join(ROOT, "src/ast/real-nim-analyzer.ts")
const SHARED = path.join(ROOT, "script/m14/incoming-check.ts")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SUB = process.argv[2] ?? "compiler"
const OUT_DIR = path.join(ROOT, "validation/m14/measurements/nim")
// A path slug with no regex: `lib/pure` and `compiler` must become `lib-pure`
// and `compiler`, and the only thing being rewritten is a FILE NAME of ours.
const SLUG = SUB.split("/").join("-")

const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()
const SHARED_HASH = createHash("sha256").update(readFileSync(SHARED)).digest("hex")

if (!existsSync(CR)) {
  console.error(`corpus root not found: ${CR} (set BB_CORPUS_ROOT)`)
  process.exit(2)
}

// The file set is discovered exactly as `validation/m14/fixtures/nim/census.ts`
// and `ambiguity-split.ts` discover it, so the three instruments agree on what
// "the corpus" is: every git-tracked path the production router calls nim, at or
// under the 512 KB cap, taken from every repo on disk.
const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (detectLanguageFromPath(rel) !== "nim") continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    if (SUB !== "all" && !rel.startsWith(SUB)) continue
    files.push(abs)
  }
}
files.sort()

if (files.length === 0) {
  console.error(`no nim files under "${SUB}" in ${CR}`)
  process.exit(2)
}

const FILE_LIST_SHA = createHash("sha256").update(files.join("\n")).digest("hex")
const byExt: Record<string, number> = {}
for (const f of files) {
  const ext = path.extname(f) || "(none)"
  byExt[ext] = (byExt[ext] ?? 0) + 1
}

// Run the shared instrument. Its exit code and stderr are captured rather than
// inherited, because a child that threw must not be readable as a child that
// measured zero.
let stdout = ""
let stderr = ""
let exitCode = -1
try {
  const out = execFileSync("npx", ["tsx", path.relative(ROOT, SHARED), "--json", "nim", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
  stdout = String(out)
  exitCode = 0
} catch (e: any) {
  stdout = String(e?.stdout ?? "")
  stderr = String(e?.stderr ?? "")
  exitCode = typeof e?.status === "number" ? e.status : -1
}

let child: any = null
try {
  child = JSON.parse(stdout)
} catch {
  console.error("child did not emit JSON on stdout; first 400 bytes:")
  console.error(stdout.slice(0, 400))
  console.error(stderr.slice(-2000))
  process.exit(2)
}

const STABLE = analyzerHash() === HASH_BEFORE

// `src/lsp/impact.ts` picks a winner among the symbols a target name resolves to,
// and it does that per TARGET, not per edge. `ambiguousTargets` is therefore the
// column that predicts a wrong attribution, and `ambiguousTargets / targetsDistinct`
// is the share of distinct declarations at risk — not `ambiguousTargets / edges`,
// which understates it by the average number of edges per target.
const perType: Record<string, any> = {}
const childPerType: Record<string, any> = (child as any).perType ?? {}
for (const [t, v] of Object.entries(childPerType) as [string, any][]) {
  const row: any = { ...v }
  if (v.targetsDistinct > 0) {
    row.ambiguousShareOfDistinctTargets = Number((v.ambiguousTargets / v.targetsDistinct).toFixed(4))
  }
  if (v.edges > 0) {
    row.edgesPerDistinctTarget = Number((v.edges / v.targetsDistinct).toFixed(2))
  }
  perType[t] = row
}

const artifact = {
  instrument: "validation/m14/fixtures/nim/incoming-audit.ts",
  wraps: "script/m14/incoming-check.ts",
  sharedInstrumentSha256: SHARED_HASH,
  analyzerSha256: HASH_BEFORE,
  analyzerStableDuringRun: STABLE,
  sub: SUB,
  corpusRoot: CR,
  files: files.length,
  fileListSha256: FILE_LIST_SHA,
  filesByExtension: byExt,
  childExitCode: exitCode,
  childStderrTail: stderr.split("\n").slice(-6).join("\n"),
  perTypeDeclaredLimit:
    "ambiguousTargets counts TARGET STRINGS resolving to more than one published symbol; " +
    "src/lsp/impact.ts picks one winner per target, so that is the count of places the " +
    "reverse walk can attribute an incoming edge to a declaration that never mentioned it. " +
    "unresolvedTargets is a target string resolving to no published symbol in THIS index, " +
    "which a sub-corpus index cannot distinguish from a declaration that was never published.",
  ...child,
  perType,
}

const lines: string[] = []
lines.push(`nim incoming audit — ${SUB}`)
lines.push(`analyzer    : src/ast/real-nim-analyzer.ts sha256:${HASH_BEFORE.slice(0, 16)}`)
lines.push(`shared instr: script/m14/incoming-check.ts sha256:${SHARED_HASH.slice(0, 16)}`)
lines.push(`corpus root : ${CR}`)
lines.push(`files       : ${files.length}  file-list sha256:${FILE_LIST_SHA.slice(0, 16)}`)
lines.push(`by extension: ${Object.entries(byExt).map(([k, v]) => `${k}=${v}`).join("  ")}`)
lines.push(`child exit  : ${exitCode}   degraded parses: ${child.degraded}   parse failures: ${Array.isArray(child.parseFailures) ? child.parseFailures.length : child.parseFailures}`)
lines.push(`symbols     : ${child.symbols}   distinct incoming targets: ${child.distinctIncomingTargets}`)
lines.push(`orphans     : ${child.orphanDeclarations} (${(child.orphanRate * 100).toFixed(2)}% of published symbols)`)
lines.push("")
lines.push("type             fired  edges  distinct  ambiguous  ambig%of-distinct  unresolved  selfLoops  edges/target")
lines.push("-".repeat(108))
for (const [t, v] of Object.entries(perType)) {
  lines.push(
    `${t.padEnd(15)} ${String(v.fired).padEnd(6)} ${String(v.edges).padStart(6)} ${String(v.targetsDistinct).padStart(9)} ` +
      `${String(v.ambiguousTargets).padStart(10)} ${String(v.ambiguousShareOfDistinctTargets ?? "-").padStart(17)} ` +
      `${String(v.unresolvedTargets).padStart(11)} ${String(v.selfLoops).padStart(10)} ${String(v.edgesPerDistinctTarget ?? "-").padStart(13)}`,
  )
}
lines.push("")
lines.push(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${STABLE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)

writeFileSync(path.join(OUT_DIR, `incoming-${SLUG}.json`), JSON.stringify(artifact, null, 2))
writeFileSync(path.join(OUT_DIR, `incoming-${SLUG}.txt`), lines.join("\n") + "\n")
console.log(lines.join("\n"))
process.exit(exitCode === 0 && STABLE ? 0 : 1)
