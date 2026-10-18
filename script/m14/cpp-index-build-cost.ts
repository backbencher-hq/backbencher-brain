/**
 * cpp-index-build-cost — how long the C++ project index takes to BUILD on the largest repo, measured
 * before any whole-population arm is run (task-22 milestone 3; the Lead's explicit precursor).
 *
 * WHY THIS IS ITS OWN INSTRUMENT: the gate's `projectIndexesFor` builds one index PER REPOSITORY via
 * `buildProjectIndexStreaming` (one tree at a time — the collecting builder was measured to abort on a
 * 4,378-file project). The cpp corpus's largest single repo is `duckdb` (4,243 admitted files), an
 * order of magnitude above anything the five existing indexed lanes index, so the arm's cost is not
 * inferable from theirs. This measures it and reports the memory-watermark components it can see.
 *
 * THE POPULATION: the same admitted extensions the analyzer/gate use (`.cpp .cc .cxx .c++ .hpp .hxx
 * .ipp .inl .cu`), readable (< 1 MB) files only — `.h` is NOT included, matching the ruled
 * extension-only index population (CPP-INDEX-PROPOSAL §1b; the C/C++ header boundary is deferred).
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-index-build-cost.ts --repo=duckdb [--json=<path>] [--limit=N]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const REPO = argOf("--repo")
const LIMIT = Number(argOf("--limit") ?? "0")
const JSON_OUT = argOf("--json")
if (!REPO) { console.error("usage: bun run script/m14/cpp-index-build-cost.ts --repo=<corpus repo> [--limit=N] [--json=path]"); process.exit(2) }
const SIZE_CAP = 1024 * 1024
const ADMITTED = new Set(["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"])
const extOf = (p: string): string => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d >= 0 ? b.slice(d + 1).toLowerCase() : "" }

const repoDir = path.join(CR, REPO)
let tracked: string[]
try {
  tracked = execFileSync("git", ["-C", repoDir, "ls-files"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\n").filter(Boolean)
} catch {
  console.error(`cpp-index-build-cost: ${repoDir} is not a git checkout`)
  process.exit(2)
}
const candidates = tracked.filter((r) => ADMITTED.has(extOf(r)))
const files: string[] = []
let overCap = 0
let absent = 0
for (const rel of candidates) {
  const abs = path.join(repoDir, rel)
  try {
    if (fs.statSync(abs).size > SIZE_CAP) { overCap++; continue }
    files.push(abs)
  } catch { absent++ }
}
const selected = LIMIT > 0 ? files.slice(0, LIMIT) : files
const memBefore = process.memoryUsage()
const load1 = os.loadavg()[0]
const freeG = os.freemem() / (1024 ** 3)

const indexMod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const spec: any = indexMod.CPP_DECLARATION_SPEC
if (!spec) { console.error("cpp-index-build-cost: project-index.ts does not export CPP_DECLARATION_SPEC (Lead wiring pending)"); process.exit(3) }
const wasm = path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")
const t0 = performance.now()
const index: any = await indexMod.buildProjectIndexStreaming(wasm, selected, spec)
const wallMs = performance.now() - t0
const memAfter = process.memoryUsage()
let memberTotal = 0
for (const members of index.typeMembers.values()) memberTotal += members.size
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-index-build-cost.ts",
  measuredAt: new Date().toISOString(),
  repo: REPO,
  repoDir,
  population: { admittedTracked: candidates.length, readableUnderCap: files.length, measured: selected.length, overCap, absent, extensions: [...ADMITTED].sort(), headersIncluded: false, rule: "extension-only index population (CPP-INDEX-PROPOSAL §1b); .h deferred by ruling" },
  build: {
    builder: "buildProjectIndexStreaming (one tree at a time — the gate's builder)",
    wallMs: Number(wallMs.toFixed(0)),
    msPerFile: Number((wallMs / Math.max(1, selected.length)).toFixed(2)),
    filesIndexed: index.stats?.files ?? null,
    damaged: index.stats?.damaged ?? null,
    damagedFiles: [...(index.damagedFiles ?? [])].slice(0, 10),
  },
  index: {
    typeKinds: index.typeKinds.size,
    typeMembers: index.typeMembers.size,
    typeMembersTotal: memberTotal,
    typeBases: index.typeBases.size,
    symbolNames: index.symbolNames.size,
    modules: index.modules.size,
  },
  memory: { rssBeforeMB: Number((memBefore.rss / (1024 ** 2)).toFixed(1)), rssAfterMB: Number((memAfter.rss / (1024 ** 2)).toFixed(1)), deltaMB: Number(((memAfter.rss - memBefore.rss) / (1024 ** 2)).toFixed(1)), heapUsedAfterMB: Number((memAfter.heapUsed / (1024 ** 2)).toFixed(1)) },
  machine: { loadAvg1: Number(load1.toFixed(2)), freeGBAtStart: Number(freeG.toFixed(1)), cores: os.cpus().length },
  note: "A wall clock on a shared box is observed, not portable; the load is recorded so a reader can judge contention. This is the BUILD cost only — the arm cost also includes the second analysis pass the gate already pays.",
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) { const t = path.resolve(ROOT, JSON_OUT); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.writeFileSync(t, json) }
process.stdout.write(json)
