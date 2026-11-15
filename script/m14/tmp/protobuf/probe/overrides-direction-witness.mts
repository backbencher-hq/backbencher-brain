/**
 * OVERRIDES DIRECTION WITNESS — the last open half of this lane's DERIVATION finding.
 *
 * ## What was open
 *
 * `probe/overrides-oracle.mts` supplies two witnesses for `overrides`:
 *
 *   WITNESS 1  protoc, NO shared grammar — a field NAME is declared twice.
 *   WITNESS 2  an independent walk in that file, SHARES the tree-sitter grammar —
 *              a field NUMBER is declared twice.
 *
 * Neither witness fixes the edge's DIRECTION. The analyzer emits `later -> earlier`
 * (`t.M.y -> t.M.x`), and until this pass that direction was asserted by the fixture
 * suite and by nothing else. This file supplies WITNESS 3.
 *
 * ## Why protoc could not be used on the corpus instance, measured
 *
 * The one corpus file whose duplicate protoc rejects is
 * `gql-ruby/lib/graphql/tracing/perfetto_trace/trace.proto`, and it is rejected for
 * an unrelated reason. That file declares `syntax = "proto2";` at line 6, and its
 * second declaration of `string_value_iid = 17` (line 74) carries NO label, which
 * proto2 requires. Reproduced verbatim:
 *
 *   trace.proto:74:3: Expected "required", "optional", or "repeated".
 *
 * A label error at 74:3 is hit before any duplicate-number diagnostic, so on THAT file
 * protoc cannot witness anything. It is a malformed file, not a witness gap.
 *
 * ## What protoc actually says, on a file it accepts
 *
 * Feed it the same CONSTRUCT in a well-formed file and it answers both halves at once,
 * including which declaration it treats as the incumbent:
 *
 *   dup_plain.proto   two optional fields, same number
 *     t.M: Field number 17 has already been used in "t.M" by field "a".
 *                     ^ the EARLIER declaration is named as the holder
 *
 *   dup_oneof.proto   a oneof member and a later plain field, same number — the exact
 *                     shape of the corpus instance, with the label proto2 requires
 *     t.M: Field number 17 has already been used in "t.M" by field "x".
 *
 *   dup_name.proto    same NAME, different numbers — a different error class
 *     t.M: "x" is already defined in "t.M".
 *
 * So protoc adjudicates the number half, across a oneof boundary, from C++ code that
 * shares nothing with a tree-sitter grammar, and it names the earlier declaration.
 * An edge `later -> earlier` labelled `overrides` asserts exactly that. This is an
 * agreement between two independent implementations about a DIRECTION, which is what
 * was missing.
 *
 * `dup_name.proto` is also a labelled-correct NEGATIVE: the analyzer emits no
 * `overrides` edge there, because a name collision is not a slot collision. protoc
 * reports it as a different error class, and so does the analyzer — by declining.
 *
 * ## What this cannot show
 *
 * `protoc` REJECTS all three fixtures, so there is no descriptor to compare and this is
 * a comparison of diagnostics, not of emitted facts. It cannot detect an edge protoc
 * accepts and the analyzer invents — it only ever sees files protoc refuses. The
 * corpus-wide count of the construct is still witness 2's, and this file does not
 * change it. What it adds is independent agreement on direction, on the one construct
 * `overrides` names.
 *
 * ## Skipping
 *
 * Needs a protoc. Resolves it the way `probe/overrides-oracle.mts` resolves it, plus
 * two cases that oracle misses, and skips with a printed reason and exit 0 if none is
 * found — a missing oracle is not a failure, and silently exiting 0 as if it had passed
 * would be.
 *
 * The two probes used to disagree about whether a protoc existed at all: this one read
 * `$PB_PROTOC` and a `./protoc-venv` that is not on disk, while the oracle read
 * `$BB_PROTOC` and hardcoded `/tmp/opencode/protoc-36/bin/protoc`. On a machine where
 * only the hardcoded path existed, the oracle reported witness 1 as having RUN and this
 * witness reported SKIP — in the same output block. A witness that skips because it
 * looked in the wrong place is indistinguishable, to a reader of that block, from a
 * witness whose property is genuinely unwitnessed, and pass 19's own DERIVATION line
 * turned on exactly that distinction. One locator, five sources, in this order:
 * `$PB_PROTOC`, `$BB_PROTOC`, `protoc` on `PATH`, the `./protoc-venv` grpc_tools shim,
 * then the oracle's hardcoded path.
 *
 * ## Reproduce
 *
 *   npx tsx script/m14/tmp/protobuf/probe/overrides-direction-witness.mts
 *
 * Writes its verdict to `/tmp/opencode/pb/overrides-direction.json`, which
 * `probe/overrides-oracle.mts` reads and REPORTS. That oracle's finding block used to
 * assert in prose that the direction was witnessed by nothing, while its own header
 * described this witness — so the two halves of one file disagreed, and the assertion
 * was the half that would have survived a regression here. A missing protoc writes
 * `holds: false` rather than leaving an earlier pass in place.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"

const REPO = path.resolve(new URL("../../../../..", import.meta.url).pathname)
const OUT = "/tmp/opencode/pb/overrides-direction.json"

/**
 * One protoc locator, five sources, shared in intent with `overrides-oracle.mts`.
 *
 * Every candidate is EXECUTED before it is returned, so a path that exists but cannot
 * run is treated as absent rather than as an oracle that then fails to produce output.
 */
function findProtoc(): string[] | null {
  const direct: Array<[string, string]> = [
    ["$PB_PROTOC", process.env.PB_PROTOC ?? ""],
    ["$BB_PROTOC", process.env.BB_PROTOC ?? ""],
    ["/tmp/opencode/protoc-36/bin/protoc", "/tmp/opencode/protoc-36/bin/protoc"],
  ]
  for (const [label, p] of direct) {
    if (!p) continue
    try {
      execFileSync(p, ["--version"], { stdio: "pipe" })
      return [p]
    } catch {
      console.log(`  ${label} -> ${p} did not run; trying the next source.`)
    }
  }
  // A protoc already on PATH is the case neither probe looked for, and it is the only
  // one of the five that survives a machine rebuild.
  for (const p of ["protoc"]) {
    try {
      execFileSync(p, ["--version"], { stdio: "pipe" })
      return [p]
    } catch {
      /* not on PATH */
    }
  }
  const venv = path.join(REPO, "protoc-venv", "bin", "python")
  try {
    execFileSync(venv, ["-c", "import grpc_tools.protoc"], { stdio: "pipe" })
    return [venv, "-m", "grpc_tools.protoc"]
  } catch {
    return null
  }
}

/**
 * The three fixtures. Written as strings and parsed through the production entry point
 * and through protoc in the same run, so a change in either side shows up as a
 * disagreement rather than as a stale expected value.
 */
const FIXTURES: Array<{ name: string; body: string; kind: "number" | "name"; shape: string }> = [
  {
    name: "dup_plain",
    kind: "number",
    shape: "two optional fields sharing a number",
    body: `syntax = "proto2";
package t;
message M {
  optional uint64 a = 17;
  optional uint64 b = 17;
}
`,
  },
  {
    name: "dup_oneof",
    kind: "number",
    shape: "a oneof member and a later plain field sharing a number — the corpus shape",
    body: `syntax = "proto2";
package t;
message M {
  oneof v {
    uint64 x = 17;
  }
  optional uint64 y = 17;
}
`,
  },
  {
    name: "dup_name",
    kind: "name",
    shape: "same name, different numbers — a different error class",
    body: `syntax = "proto2";
package t;
message M {
  optional uint64 x = 17;
  optional string x = 18;
}
`,
  },
]

async function main(): Promise<void> {
  const protoc = findProtoc()
  if (!protoc) {
    console.log("SKIP — no protoc found.")
    console.log("  Set PB_PROTOC=/path/to/protoc, or create ./protoc-venv with grpc_tools installed.")
    console.log("  A missing oracle is not a pass: this probe ran NO comparison.")
    // Overwrite rather than leave whatever an earlier run left behind: a stale
    // `holds: true` is exactly how a skipped witness keeps looking like a passing one.
    mkdirSync(path.dirname(OUT), { recursive: true })
    writeFileSync(
      OUT,
      JSON.stringify(
        { witness: 3, skipped: true, holds: false, failures: ["no protoc: this run compared nothing"] },
        null,
        2,
      ),
    )
    console.log(`wrote ${OUT} (holds: false, skipped — this run measured nothing)`)
    return
  }

  let version = "unknown"
  try {
    version = execFileSync(protoc[0], [...protoc.slice(1), "--version"], { encoding: "utf8" }).trim()
  } catch {
    /* grpc_tools prints its version on stdout and exits 0; a failure here is not fatal */
  }
  console.log(`witness 3 — protoc's own diagnostic vs the analyzer's edge direction`)
  console.log(`protoc: ${version}`)
  console.log("")

  const dir = mkdtempSync(path.join(tmpdir(), "pb-ovdir-"))
  let agree = 0
  let disagree = 0
  let negativesRight = 0
  let negativesWrong = 0
  const failures: string[] = []

  try {
    for (const fx of FIXTURES) {
      const abs = path.join(dir, `${fx.name}.proto`)
      writeFileSync(abs, fx.body, "utf8")

      let diag = "(no diagnostic)"
      try {
        execFileSync(protoc[0], [...protoc.slice(1), "-I" + dir, "--descriptor_set_out=/dev/null", abs], {
          stdio: "pipe",
        })
      } catch (e) {
        const err = e as { stderr?: Buffer | string; stdout?: Buffer | string }
        diag = String(err.stderr ?? err.stdout ?? "").trim().split("\n")[0] ?? "(no diagnostic)"
      }

      const r = await parseFile(abs)
      const ovs = (Array.isArray(r.relationships) ? r.relationships : []).filter((x: any) =>
        String(x?.type ?? "").toLowerCase().includes("overrides"),
      )

      console.log(`${fx.name} — ${fx.shape}`)
      console.log(`  protoc   ${diag}`)

      if (fx.kind === "name") {
        if (ovs.length === 0) {
          negativesRight++
          console.log(`  analyzer 0 overrides edges  AGREE  (a name collision is not a slot collision)`)
        } else {
          negativesWrong++
          failures.push(`${fx.name}: analyzer emitted ${ovs.length} overrides edge(s) for a NAME collision`)
          console.log(`  analyzer ${ovs.length} overrides edges  DISAGREE`)
          for (const o of ovs) console.log(`             ${o.source} -> ${o.target}`)
        }
        console.log("")
        continue
      }

      // protoc names the incumbent: `... by field "<name>"`. The analyzer's edge must
      // TARGET that name, which means later -> earlier.
      const m = /by field "([^"]+)"/.exec(diag)
      const incumbent = m?.[1]
      if (ovs.length !== 1) {
        disagree++
        failures.push(`${fx.name}: expected exactly 1 overrides edge, analyzer emitted ${ovs.length}`)
        console.log(`  analyzer ${ovs.length} overrides edges  DISAGREE (expected 1)`)
        for (const o of ovs) console.log(`             ${o.source} -> ${o.target}`)
        console.log("")
        continue
      }
      const edge = ovs[0] as any
      const targetLeaf = String(edge.target).split(".").pop()
      const sourceLeaf = String(edge.source).split(".").pop()
      const dirOk = incumbent !== undefined && targetLeaf === incumbent
      if (dirOk) {
        agree++
        console.log(`  analyzer overrides ${edge.source} -> ${edge.target}`)
        console.log(`  AGREE — protoc's incumbent is "${incumbent}", the edge targets it, so later (${sourceLeaf}) overrides earlier (${targetLeaf})`)
      } else {
        disagree++
        failures.push(
          `${fx.name}: protoc names incumbent "${incumbent ?? "(none)"}", edge targets "${targetLeaf}"`,
        )
        console.log(`  analyzer overrides ${edge.source} -> ${edge.target}`)
        console.log(`  DISAGREE — protoc's incumbent is "${incumbent ?? "(none)"}", edge targets "${targetLeaf}"`)
      }
      console.log("")
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const numberFixtures = FIXTURES.filter((f) => f.kind === "number").length
  console.log("SUMMARY")
  console.log("--------------------------------------------------------------------------------------------------")
  console.log(`  direction agrees with protoc      ${agree} of ${numberFixtures}`)
  console.log(`  direction disagrees               ${disagree}`)
  console.log(`  name-collision negatives correct  ${negativesRight} of 1`)
  console.log(`  name-collision negatives wrong     ${negativesWrong}`)
  console.log("")

  // Machine-readable, so `probe/overrides-oracle.mts` can REPORT this verdict instead of
  // asserting it in prose. It read this file's header describe witness 3 and then printed
  // a finding line saying the direction was witnessed by nothing — the two disagreed, and
  // the assertion is the kind that survives a regression. An oracle that prints a claim it
  // did not measure is the defect this programme exists to find.
  const verdict = {
    witness: 3,
    instrument: `${protoc.join(" ")} (independent implementation, no shared grammar)`,
    protocVersion: version,
    fixtures: FIXTURES.length,
    numberFixtures,
    directionAgrees: agree,
    directionDisagrees: disagree,
    nameCollisionNegativesCorrect: negativesRight,
    nameCollisionNegativesWrong: negativesWrong,
    holds: failures.length === 0,
    failures,
    limits: [
      "protoc REJECTS all three fixtures, so this compares DIAGNOSTICS, not emitted facts",
      "it only ever sees files protoc refuses, so it cannot detect an edge protoc accepts and the analyzer invents",
      "the corpus-wide count of the construct remains witness 2's, which shares the grammar",
    ],
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(verdict, null, 2))
  console.log(`wrote ${OUT}`)

  if (failures.length > 0) {
    console.log("FAILURES")
    for (const f of failures) console.log(`  ${f}`)
    process.exitCode = 1
    return
  }
  console.log("witness 3 holds: protoc names the EARLIER declaration as the holder of a doubled number,")
  console.log("across a oneof boundary, in C++ that shares no grammar with the analyzer — and the")
  console.log("analyzer's edge points at exactly that declaration.")
}

main().catch((e) => {
  console.error(`[overrides-direction-witness] ${(e as Error)?.message ?? e}`)
  process.exit(1)
})
