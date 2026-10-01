/**
 * M60 — the IPC WIRING gate: does the project index survive PRODUCTION's transport?
 *
 * WHY THIS IS A SEPARATE GATE AND NOT PART OF THE SOL-21 GATE. `solidity-crossfile-gate`
 * calls the analyzer in-process, which proves the analyzer reads a `ProjectIndex` it is
 * HANDED. Production does not hand it one: the parent builds it, serialises it, and sends
 * it to a FORKED worker over `child_process` IPC — and that boundary is where the whole
 * feature can die silently.
 *
 * `fork()` serialises with JSON unless advanced serialisation is enabled, and JSON
 * cannot carry a `Map`. A `Map` arrives as `{}`. The index would then contain no types,
 * resolve nothing, and behave EXACTLY like an analyzer that had never heard of project
 * knowledge — no error, no warning, just a feature that does not work. A unit test of
 * the serialiser cannot catch that, because the serialiser is not where the loss happens;
 * only a real fork can.
 *
 * So this gate forks a real `pool-worker.ts`, sends the index exactly the way
 * `parallel-indexer.ts` does, and asserts what the CHILD's analysis says.
 *
 * The corpus chosen is `abstract contract ERC2981 is IERC2981, ERC165` — both bases
 * declared in OTHER files, and they are DIFFERENT KINDS. That is the assertion that
 * matters: a resolver that assumed every cross-file base was an interface would satisfy
 * the IERC2981 row and fail the ERC165 one, and a resolver that assumed every base was a
 * contract would do the reverse. One file, two bases, two different settled answers.
 */

import * as path from "node:path"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const CORPUS = process.env.SOL_REPO ?? "$HOME/fixtures/repositories/solidity"

/** The file under analysis, and the two files its bases live in. */
const TARGET = path.join(CORPUS, "contracts/token/common/ERC2981.sol")
const INTERFACE_FILE = path.join(CORPUS, "contracts/interfaces/IERC2981.sol")
const CONTRACT_FILE = path.join(CORPUS, "contracts/utils/introspection/ERC165.sol")

const { buildProjectIndexFromDisk, buildResolutionTables, serializeProjectIndex, roundTripProjectIndex } =
  await import(path.join(ROOT, "src/ast/project-index.ts"))

const checks: { id: string; description: string; status: "pass" | "fail"; detail: string }[] = []
const check = (id: string, description: string, ok: boolean, detail: string): void => {
  checks.push({ id, description, status: ok ? "pass" : "fail", detail })
}

for (const f of [TARGET, INTERFACE_FILE, CONTRACT_FILE]) {
  if (!fsExists(f)) {
    console.error(`corpus file missing: ${f}. Set SOL_REPO.`)
    process.exit(1)
  }
}
function fsExists(p: string): boolean {
  return require("node:fs").existsSync(p)
}

const index = await buildProjectIndexFromDisk(
  path.join(ROOT, "wasm", "tree-sitter-solidity.wasm"),
  [TARGET, INTERFACE_FILE, CONTRACT_FILE],
)
buildResolutionTables(index)

check("index-holds-both-bases", "the index holds both cross-file bases, and knows they differ in kind",
  index.typeKinds.get("IERC2981") === "interface" && index.typeKinds.get("ERC165") === "contract",
  `IERC2981=${index.typeKinds.get("IERC2981")} ERC165=${index.typeKinds.get("ERC165")}`)

const roundTrip = roundTripProjectIndex(index)
check("serialiser-is-lossless", "the index survives JSON serialisation before it is ever sent",
  roundTrip.length === 0, roundTrip.slice(0, 3).join("; ") || "lossless")

const payload = serializeProjectIndex(index)

// ── THE REAL FORK.
const child = fork(path.join(ROOT, "src/ast/pool-worker.ts"), [], {
  env: { ...process.env, BB_POOL_WORKER: "1" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
})

let settled = false
const finish = (code: number): void => {
  if (settled) return
  settled = true
  clearTimeout(timer)
  try { child.kill() } catch { /* already gone */ }
  const failed = checks.filter((c) => c.status !== "pass")
  console.log("M60 — Solidity project-index IPC wiring gate (real fork)\n")
  for (const c of checks) {
    console.log(`  ${c.status === "pass" ? "pass" : "FAIL"}  ${c.id.padEnd(34)} ${c.detail}`)
  }
  console.log(`\n  ${checks.length - failed.length}/${checks.length} pass`)
  if (failed.length > 0) {
    console.error(`\nFAIL — ${failed.length} check(s) did not hold.`)
    process.exit(1)
  }
  console.log("\nPASS — the index crossed a real fork boundary and settled BOTH kinds correctly there.")
  process.exit(code)
}

const timer = setTimeout(() => {
  check("child-answered", "the forked worker answered the batch", false, "timed out")
  finish(1)
}, 120_000)

child.on("message", (m: any) => {
  if (m.type === "file_error") {
    check("child-answered", "the forked worker answered the batch", false, `child error: ${m.error}`)
    finish(1)
    return
  }
  if (m.type !== "file_done") return

  const rels: any[] = m.result?.relationships ?? []
  const flagged = rels.filter((x) => x.metadata?.projectIndexSupplied === true)
  check("child-answered", "the forked worker answered the batch", true, `${rels.length} relationships`)

  // THE ASSERTION THAT MATTERS. If the Map had been lost, the index would be empty, the
  // two bases would be undecidable, and `flagged` would be zero — so this single check
  // distinguishes "wired" from "silently dead" without depending on any other signal.
  check("index-crossed-the-fork", "the index arrived in the CHILD (every row says it was supplied)",
    rels.length > 0 && flagged.length === rels.length,
    `${flagged.length} of ${rels.length} rows flagged`)

  const imp = rels.find((x) => x.type === "implements" && x.target === "IERC2981")
  check("interface-base-settled", "a cross-file INTERFACE base settled as `implements` at full confidence",
    imp !== undefined && imp.confidence === 1 &&
    imp.metadata?.kindResolvedProjectWide === true && imp.metadata?.baseDeclarationKind === "interface",
    imp === undefined ? "no implements row at all" :
      `${imp.source} is ${imp.target} @${imp.confidence} baseKind=${imp.metadata?.baseDeclarationKind}`)

  const ext = rels.find((x) => x.type === "extends" && x.target === "ERC165")
  check("contract-base-settled-differently", "a cross-file CONTRACT base settled as `extends` — the two bases differ",
    ext !== undefined && ext.confidence === 1 && ext.metadata?.baseDeclarationKind === "contract",
    ext === undefined ? "no extends row at all" :
      `${ext.source} is ${ext.target} @${ext.confidence} baseKind=${ext.metadata?.baseDeclarationKind}`)

  const unresolved = rels.filter((x) => x.metadata?.kindUnresolved === true)
  check("no-kind-left-undecided", "no inheritance kind in the child is left undecided",
    unresolved.length === 0, `${unresolved.length} undecided`)

  finish(0)
})

child.on("error", (e: Error) => {
  check("child-answered", "the forked worker answered the batch", false, `fork failed: ${e.message}`)
  finish(1)
})

// Sent EXACTLY as parallel-indexer.ts sends it, including the extension key the worker
// matches on — a mismatch here would silently yield no index, which is the failure this
// gate exists to make visible.
child.send({
  type: "parse_batch",
  batchId: 1,
  files: [TARGET],
  projectPath: ROOT,
  projectIndexes: { ".sol": payload },
})
