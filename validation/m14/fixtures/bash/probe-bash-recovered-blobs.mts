/**
 * WHAT THE CORPUS NEVER SHOWED ANY INSTRUMENT — and whether it changes a verdict.
 *
 * ## The finding
 *
 * `probe-bash-corpus-pin.mts` reports 23,090 files that `git ls-files` lists and
 * the working tree does not contain. Four repositories' checkout never completed:
 *
 *   pb-grpc          9,792 missing of 10,504 tracked
 *   pb-googleapis    9,153 missing of  9,390
 *   pb-reference     2,797 missing of  3,678
 *   julia            1,107 missing of  2,059
 *
 * Both the census and the shared coverage gate `continue` past a file they cannot
 * stat, so those files are outside every number this lane has published. 962 of
 * them carry a `.sh` / `.bash` / `.zsh` extension and 568 more are extensionless,
 * so the admitted-file count is short by at least 962 bash files and by an unknown
 * number of shebang-admitted extensionless ones.
 *
 * That is a floor on coverage, not a surplus — and it is the kind of gap that reads
 * as thoroughness, because every published number is a count of files that DO
 * exist. The honest question is not "how many are missing" but "does the missing
 * population contain anything that would change a verdict".
 *
 * ## What this measures
 *
 * For every tracked-but-absent file, read the blob from the OBJECT DATABASE with
 * `git cat-file` — the blob is present locally (`git cat-file -e` succeeds on
 * `pb-grpc:bazel/update_mirror.sh`), the clone is `--filter=blob:none` but was
 * fetched, so only the working tree is incomplete. Then:
 *
 *   1. admit it with the production router `detectLanguageFromPath` and the same
 *      512 KB cap, so the population is defined the same way the census defines
 *      its own;
 *   2. materialise it under /tmp — NEVER into the shared corpus, because six other
 *      agents are measuring against that corpus right now and restoring 23,090
 *      files under them would move their denominators mid-run with no signal;
 *   3. run production `parseFile` over the admitted ones and tally per type;
 *   4. walk their parse trees with this file's OWN `web-tree-sitter` handle and
 *      enumerate every node type, then test the three RULED entries' falsifiers
 *      from `script/m14/bash-ruled.ts` against that inventory.
 *
 * Step 4 is the one that decides a verdict. All three rulings are instrument A
 * ("no node type in the grammar expresses the construct"), and the gate's
 * falsifier is mechanical: if any name in `nodeTypesThatWouldMeanIt` appears in
 * the corpus-wide inventory, the row reads FALSIFIED. So the question "would
 * 4,185 + 962 files change the ruling" is exactly "do these files produce a node
 * type the other 4,185 did not".
 *
 * ## What it does not do
 *
 * It does not restore the corpus (see above) and it does not write into it. It
 * does not re-derive the census's per-type columns — it reports the DELTA the
 * absent population would add, which is the number that decides whether the
 * published columns need restating.
 *
 * No regex. Admission is the production router; the node walk is `node.type` over
 * `child(i)`. One caveat stated rather than hidden: a blob that is absent from the
 * working tree but present in the object database is read at `HEAD`, so a file
 * with unstaged local edits would be read at its committed state. That is a
 * property of the corpus (nobody is editing these repos), not of this probe.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-recovered-blobs.mts
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { BASH_RULED } from "../../../../script/m14/bash-ruled"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = "/tmp/opencode/bash-recovered"
const SIZE_CAP = 512 * 1024

interface Recovered {
  repo: string
  rel: string
  abs: string
  text: string
}

const recovered: Recovered[] = []
let absentTotal = 0
let blobUnavailable = 0
let oversized = 0
let notBash = 0
const perRepoMissing = new Map<string, number>()
const absentCandidates: string[] = []

/**
 * Read many blobs in ONE `git cat-file --batch` per repository.
 *
 * Two properties are load-bearing and both were learned the hard way:
 *
 *   GIT_NO_LAZY_FETCH=1 — the corpus is `--filter=blob:none` with a promisor
 *   remote, so a plain `git cat-file` on an unheld blob tries to FETCH IT. With
 *   no network that is a 135-second connect timeout PER FILE, and the first
 *   version of this probe hung for 30 minutes on julia's 1,107 absent files
 *   without printing a line. The variable makes the miss fast and honest: the
 *   batch prints `missing` and the count is reported.
 *
 *   `cat-file --batch` rather than one call per file — 23,090 process spawns is
 *   minutes of wall clock for a measurement that is one subprocess per repo.
 *
 * `gc.auto=0` because the auto-gc the fetches triggered wrote to the shared
 * corpus repos and printed to stderr, which is noise in a measurement.
 */
const BATCH_ENV = { ...process.env, GIT_NO_LAZY_FETCH: "1" }

for (const e of readdirSync(CR)) {
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

  const absent: string[] = []
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      statSync(abs)
      continue // present: already in the census population
    } catch {
      absentTotal++
      absent.push(rel)
      absentCandidates.push(`${e}/${rel}`)
    }
  }
  if (absent.length === 0) continue
  perRepoMissing.set(e, absent.length)

  let raw: Buffer
  try {
    raw = execFileSync("git", ["-C", dir, "-c", "gc.auto=0", "cat-file", "--batch"], {
      input: absent.map((r) => `HEAD:${r}\n`).join(""),
      maxBuffer: 1024 * 1024 * 1024,
      env: BATCH_ENV,
    })
  } catch {
    blobUnavailable += absent.length
    continue
  }

  // `--batch` answers each query in order with `<oid> SP <type> SP <size> LF`,
  // then exactly <size> bytes of content and one LF — or `<oid> SP missing LF`.
  let off = 0
  for (const rel of absent) {
    const nl = raw.indexOf(0x0a, off)
    if (nl < 0) {
      blobUnavailable++
      continue
    }
    const header = raw.toString("utf8", off, nl)
    off = nl + 1
    const parts = header.split(" ")
    if (parts[1] === "missing" || parts.length < 3) {
      blobUnavailable++
      continue
    }
    const size = Number(parts[2])
    if (!Number.isFinite(size)) {
      blobUnavailable++
      continue
    }
    const buf = raw.subarray(off, off + size)
    off += size + 1
    if (size > SIZE_CAP) {
      oversized++
      continue
    }
    const text = buf.toString("utf8")
    const abs = path.join(dir, rel)
    if (detectLanguageFromPath(abs, text) !== "bash") {
      notBash++
      continue
    }
    const dest = path.join(OUT, e, rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    recovered.push({ repo: e, rel, abs: dest, text })
  }
}

console.log(`recovered-blob probe — the corpus population no instrument has read`)
console.log(`  corpus root            : ${CR}`)
console.log(`  materialised under     : ${OUT} (the shared corpus is NOT touched)`)
console.log(`  tracked-but-absent     : ${absentTotal.toLocaleString()}`)
console.log(`    blob not in object db: ${blobUnavailable.toLocaleString()}`)
console.log(`    over the 512KB cap   : ${oversized.toLocaleString()}`)
console.log(`    admitted as NOT bash : ${notBash.toLocaleString()}`)
console.log(`    ADMITTED AS BASH     : ${recovered.length.toLocaleString()}  <- the population that was missing`)
console.log(`  repositories involved  : ${new Set(recovered.map((r) => r.repo)).size}`)
console.log("")
console.log("repositories with absent tracked files:")
for (const [repo, n] of [...perRepoMissing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  const admitted = recovered.filter((r) => r.repo === repo).length
  console.log(`  ${repo.padEnd(24)} ${String(n).padStart(6)} absent · ${String(admitted).padStart(5)} admitted as bash`)
}

/**
 * The candidate count, which is the number that makes an empty result readable.
 *
 * A path is a CANDIDATE if its extension is one the production router maps to
 * bash (`.sh`, `.bash`, `.zsh`) or it is one of the three extensionless names the
 * router admits (`bashrc`, `.bashrc`, `.zshrc`). Extensionless files carrying a
 * bash shebang are also admitted by the router but CANNOT be counted here,
 * because the shebang is in the blob and the blob is what is missing — so this is
 * a floor, and it is labelled a floor.
 *
 * No regex: the extension list is compared with `endsWith` against the same
 * strings `src/ast/language-detection.ts` maps.
 */
const BASH_EXTENSIONS = [".sh", ".bash", ".zsh"]
const BASH_NAMES = ["bashrc", ".bashrc", ".zshrc"]
const isCandidate = (rel: string): boolean => {
  const base = rel.split("/").pop() ?? rel
  if (BASH_NAMES.includes(base)) return true
  return BASH_EXTENSIONS.some((ext) => base.endsWith(ext))
}
const candidates = absentCandidates.filter(isCandidate)

console.log("")
console.log(`  bash-extension CANDIDATES among the absent: ${candidates.length.toLocaleString()} (a floor;`)
console.log(`  extensionless files with a bash shebang are also admitted and cannot be counted here)`)
if (candidates.length > 0) {
  console.log(`  e.g. ${candidates.slice(0, 3).join(", ")}`)
}

// ---------------------------------------------------------------- production pass
const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const

const perType = new Map<string, number>(TYPES.map((t) => [t, 0]))
const relFiles = new Map<string, Set<string>>()
let symbols = 0
let parseFailures = 0
let degraded = 0
let emptyNames = 0
let unknownEnds = 0
let sub07 = 0
const kinds = new Map<string, number>()

for (const f of recovered) {
  let r: any
  try {
    r = await parseFile(f.abs, path.join(OUT, f.repo))
  } catch {
    parseFailures++
    continue
  }
  if (!r) {
    parseFailures++
    continue
  }
  if (r.fallback === true) degraded++
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    if (name.length === 0) emptyNames++
    const k = String(s?.kind ?? "")
    kinds.set(k, (kinds.get(k) ?? 0) + 1)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const t = String(rel?.type ?? "")
    perType.set(t, (perType.get(t) ?? 0) + 1)
    const set = relFiles.get(t) ?? new Set<string>()
    set.add(f.abs)
    relFiles.set(t, set)
    const conf = Number(rel?.confidence ?? 1)
    if (Number.isFinite(conf) && conf < 0.7) sub07++
    if (String(rel?.source ?? "") === "unknown" || String(rel?.target ?? "") === "unknown") unknownEnds++
  }
}

const totalRels = [...perType.values()].reduce((a, b) => a + b, 0)
console.log("")
console.log(`production parseFile over the recovered population`)
console.log(`  files parsed          : ${recovered.length - parseFailures} of ${recovered.length}, parse failures ${parseFailures}, degraded ${degraded}`)
console.log(`  symbols               : ${symbols}`)
console.log(`  relationships         : ${totalRels}`)
console.log(`  SymbolKind values     : ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`)
console.log(`  symbols with empty name: ${emptyNames}`)
console.log(`  edges with 'unknown' end: ${unknownEnds}`)
console.log(`  edges below 0.7 confidence: ${sub07}`)
console.log("")
console.log("  type          edges   files")
for (const t of TYPES) {
  console.log(`  ${t.padEnd(13)} ${String(perType.get(t) ?? 0).padStart(5)}  ${String(relFiles.get(t)?.size ?? 0).padStart(6)}`)
}

// ---------------------------------------------------------------- instrument A
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

const counts = new Map<string, number>()
let nodes = 0
let parsed = 0
for (const f of recovered) {
  let t: any
  try {
    t = parser.parse(f.text)
  } catch {
    continue
  }
  if (!t) continue
  parsed++
  const stack: any[] = [t.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    nodes++
    counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
    for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
  }
  t.delete?.()
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
console.log("")
console.log(`instrument A over the recovered population`)
console.log(`  files parsed           : ${parsed}`)
console.log(`  nodes walked           : ${nodes.toLocaleString()}`)
console.log(`  DISTINCT NODE TYPES    : ${sorted.length}`)
console.log(`  full inventory:`)
for (let r = 0; r < sorted.length; r += 6) {
  console.log(`    ${sorted.slice(r, r + 6).map(([k, v]) => `${k}=${v}`).join("  ")}`)
}

console.log("")
console.log("the three RULED entries' falsifiers, tested against that inventory:")
const inventory = new Set(counts.keys())
const measured = recovered.length > 0
let anyHit = false
for (const entry of BASH_RULED) {
  const names = entry.nodeTypesThatWouldMeanIt ?? []
  const hit = names.filter((n) => inventory.has(n))
  if (hit.length > 0) anyHit = true
  const verdict =
    hit.length > 0
      ? `FALSIFIED BY ${hit.join(", ")}`
      : measured
        ? "NO NODE TYPE PRESENT — ruling survives"
        : "NOT MEASURED — 0 files, which is not evidence"
  console.log(`  ${entry.type.padEnd(13)} ${verdict}`)
}
console.log("")

/**
 * A zero over a zero is not a pass, and printing it as one is the specific defect
 * this file exists to avoid. The first version of this probe recovered 0 of 22,861
 * absent files and printed "All three rulings survive a population they had never
 * been measured over" — a vacuous green over a population of 22,861, 962 of which
 * carry a bash extension. So the exit code distinguishes the two cases and the
 * message says which one happened.
 */
if (!measured) {
  console.log(
    `NOT MEASURED. ${absentTotal.toLocaleString()} tracked files are absent from the working tree and ` +
      `${blobUnavailable.toLocaleString()} of them have NO blob in the local object database, so no ` +
      `instrument on this machine can read them: the corpus was cloned with --filter=blob:none and the ` +
      `blobs were never fetched, and this host has no route to github.com (measured: a plain ` +
      `'git cat-file' on an unheld blob blocks 135s on connect before failing). ${candidates.length.toLocaleString()} ` +
      `of the absent files carry a bash extension, so every published bash count in this lane is a count ` +
      `over a corpus with a known hole in it. Re-cloning those four repositories WITH blobs would close ` +
      `the hole; that is a corpus decision affecting every lane, so it is reported and not taken here.`,
  )
  process.exit(3)
}
if (anyHit) {
  console.log("A ruling is FALSIFIED. Report it; do not re-pick an instrument that reads zero.")
  process.exit(4)
}
console.log(`All three rulings survive a population they had never been measured over (${recovered.length} files).`)