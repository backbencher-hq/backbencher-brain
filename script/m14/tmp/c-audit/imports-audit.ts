/**
 * #980 — `imports` resolvability audit for C.
 *
 * `imports` is the one relationship in this lane with **no independent evidence at
 * all**: 13,201 corpus edges, and nothing in the tree checks any of them. The
 * differential's C oracle derives `imports` from the same `preproc_include` walk the
 * analyzer uses, so agreement between them proves only that the analyzer read the
 * line it says it read — not that the module it names is a module that exists.
 *
 * That is the claim worth making, and it is a filesystem claim rather than an AST
 * one, which is what makes it independent: the analyzer's whole input is the source
 * text, so the only way to contradict it is to consult something the source text
 * cannot dictate. For an `imports` target that something is the include search path.
 *
 * The question is deliberately NOT "is this include direct?" — the analyzer reads
 * directness straight off the `#include` line, so testing it would be near-tautological.
 * The question is "does this name resolve to a header that exists?", which catches the
 * failure mode that matters: a fabricated or mangled module name. That is the same
 * defect class #962 removed from `instantiates` (-> malloc) and #971 removed from
 * `exports` (-> KERNEL_EXPORT) — an edge target that a consumer cannot resolve.
 *
 * Resolution order, mirroring what a compiler actually tries:
 *   1. quoted form  — relative to the including file's directory, then the repo root
 *   2. angled form   — relative to the repo root, then any indexed header whose path
 *                      ends with the target (this is the system-header case, where the
 *                      header lives outside the repo entirely)
 *
 * A target that resolves by NO route is reported, not assumed fine. Two classes are
 * separated because they mean different things:
 *   - SYSTEM headers absent from the checkout (`stdio.h`, `windows.h`) are expected.
 *     They are checked against the machine's own include directories, and if they are
 *     not there either they are counted as `unverified`, NOT as failures.
 *   - PROJECT headers that resolve nowhere are real findings.
 *
 * Run: bun run script/m14/tmp/c-audit/imports-audit.ts [--repos a,b] [--limit N]
 * Out: validation/m12/results/c-imports-audit.json
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../../..")
const argv = process.argv.slice(2)
const argOf = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const REPOS = argOf("repos", "curl,libgit2,redis").split(",").map((s) => s.trim()).filter(Boolean)
const LIMIT = Number(argOf("limit", "900"))
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const OUT = path.join(ROOT, "validation/m12/results/c-imports-audit.json")

// Where a system header would live if this machine has it. Checked so that "absent
// from the checkout" can be told apart from "absent everywhere".
const SYSTEM_INCLUDE_DIRS = [
  "/usr/include",
  "/usr/local/include",
  "/usr/include/x86_64-linux-gnu",
]

function walkFiles(dir: string, out: string[], cap: number, exts: RegExp): void {
  if (out.length >= cap) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= cap) return
    if (e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(full, out, cap, exts)
    else if (exts.test(e.name)) out.push(full)
  }
}

// Index every header in the repo by its path suffix, so an angled include can be
// matched against a header that lives in a subdirectory (`include/git2/annotated_commit.h`
// satisfies `#include <git2/annotated_commit.h>`).
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const Parser = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new Parser()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer }: any = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

type Row = { quoted: number; angled: number }
const perRepo: any[] = []
const unresolvedProject: any[] = []
const unresolvedSystem: any[] = []
const extensionless: any[] = []

let totalEdges = 0
let resolved = 0
let sysUnverified = 0
let projectUnresolved = 0
let extensionlessCount = 0
let externalDeps = 0
const externalDepSample: any[] = []

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!fs.existsSync(dir)) {
    console.log(`  ${repo.padEnd(9)} SKIP (no such corpus)`)
    continue
  }
  const sources: string[] = []
  walkFiles(dir, sources, LIMIT, /\.[ch]$/)
  sources.sort()
  const headers: string[] = []
  walkFiles(dir, headers, 100000, /\.h$/)
  const headerSet = new Set(headers)
  // suffix index: for `a/b/c.h`, register `a/b/c.h`, `b/c.h` and `c.h`
  const bySuffix = new Map<string, string[]>()
  for (const h of headers) {
    const parts = h.split("/")
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join("/")
      const arr = bySuffix.get(suffix)
      if (arr) arr.push(h)
      else bySuffix.set(suffix, [h])
    }
  }

  // The repo's build files, read once: the evidence that an absent header is an
  // expected external dependency rather than a bad target.
  let buildText = ""
  for (const bf of ["configure.ac", "CMakeLists.txt", "meson.build", "Makefile.am", "configure.in"]) {
    try {
      buildText += fs.readFileSync(path.join(dir, bf), "utf8")
    } catch {
      /* absent is fine */
    }
  }

  const row = { repo, files: sources.length, edges: 0, resolved: 0, quoted: 0, angled: 0, systemUnverified: 0, externalDeps: 0, projectUnresolved: 0 }
  for (const file of sources) {
    const src = fs.readFileSync(file, "utf8")
    let result: any
    try {
      result = await new RealCAnalyzer().analyze(parser.parse(src).rootNode, src, file)
    } catch {
      continue
    }
    const fileDir = path.dirname(file)
    for (const rel of result.relationships ?? []) {
      if (String(rel.type) !== "imports") continue
      const target = String(rel.target ?? "")
      if (!target) continue
      row.edges++
      totalEdges++
      if (!/[/.]/.test(target)) extensionlessCount++
      // Quoted or angled? The analyzer publishes the bare path; recover the form from
      // the source line so a system include is not mistaken for a project one.
      const line = src.split("\n")[rel.line_number - 1] ?? ""
      const angled = /#\s*include\s*<[^>]*>/.test(line)
      if (angled) row.angled++
      else row.quoted++

      if (!/[/.]/.test(target)) {
        // An EXTENSIONLESS include. The target is still faithful to the source line --
        // `#include <QSocketNotifier>` in curl's docs/examples really does spell a
        // C++ Qt class header with no extension, and the analyzer publishing it
        // unchanged is correct behaviour, not a fabrication. Recorded as a distinct
        // class rather than folded into `malformed`, because "the target has no path
        // separator" and "the target is not a header" are different claims and only the
        // first was ever true here.
        if (extensionless.length < 100) extensionless.push({ repo, file: path.relative(dir, file), line_number: rel.line_number, target, lineText: line.trim().slice(0, 100) })
      }
      const abs = path.isAbsolute(target) ? target : null
      const hit =
        abs !== null && fs.existsSync(abs) ? abs
        : !angled && fs.existsSync(path.resolve(fileDir, target)) ? path.resolve(fileDir, target)
        : fs.existsSync(path.resolve(dir, target)) ? path.resolve(dir, target)
        : headerSet.has(target) ? target
        : bySuffix.has(target) ? bySuffix.get(target)![0]
        : null
      if (hit) {
        resolved++
        row.resolved++
        continue
      }
      // Not in this repo. A system header may still exist on the machine.
      // A SYSTEM header can carry a subdirectory -- `sys/types.h` is the canonical one,
      // so testing only the basename misses every BSD/POSIX header and misfiles them as
      // project misses. Check the FULL relative path under each system include
      // directory first, then the basename.
      const onSystem =
        SYSTEM_INCLUDE_DIRS.some((d) => fs.existsSync(path.join(d, target))) ||
        SYSTEM_INCLUDE_DIRS.some((d) => fs.existsSync(path.join(d, target.split("/").pop() ?? target)))
      if (onSystem) {
        sysUnverified++
        row.systemUnverified++
        continue
      }
      // Nothing anywhere: separate a plausible system header from a real miss.
      // System-ness is a PROPERTY OF THE PREFIX, not of the presence of a slash. The
      // first version of this audit required no `/`, which filed every `sys/*.h`,
      // `arpa/*.h`, `netinet/*.h` and `bits/*.h` as a project miss -- 620 phantom
      // findings out of 6,874 edges, which is exactly the "measurement bug reads as an
      // analyzer defect" failure this file's header warns about.
      const SYSTEM_PREFIXES = ["sys/", "arpa/", "net/", "netinet/", "bits/", "asm/", "linux/", "machine/", "syscall/", "uapi/", "gapi/"]
      const looksSystem = SYSTEM_PREFIXES.some((p2) => target.startsWith(p2)) || (!target.includes("/") && /^[a-z0-9_]+\.h$/.test(target))
      if (looksSystem) {
        sysUnverified++
        row.systemUnverified++
        if (unresolvedSystem.length < 100) unresolvedSystem.push({ repo, file: path.relative(dir, file), target })
      } else {
        // Not in the repo, not on this machine, not a system prefix. The remaining
        // class is an EXTERNAL DEPENDENCY header: curl's `#include <wolfssl/options.h>`
        // names a header that exists in a configured build with wolfSSL enabled, but
        // curl does not vendor wolfSSL, so it is in no checkout here. Calling those
        // project misses would be wrong -- the analyzer's edge is FAITHFUL to the
        // source line -- and calling them resolved would be a lie.
        //
        // The discriminator is the repo's own build system: if configure.ac /
        // CMakeLists.txt / meson.build names the header or its top-level directory, the
        // project KNOWS about the dependency, so the include is expected and its
        // absence from the checkout is a property of the checkout, not a bad target.
        // A target no build file mentions is a genuine finding.
        const seg = target.split("/")[0]
        const known = buildText.includes(target) || (seg.length > 2 && buildText.includes(seg))
        if (known) {
          externalDeps++
          row.externalDeps = (row.externalDeps ?? 0) + 1
          if (externalDepSample.length < 60) externalDepSample.push({ repo, target })
        } else {
          projectUnresolved++
          row.projectUnresolved++
          if (unresolvedProject.length < 100) unresolvedProject.push({ repo, file: path.relative(dir, file), line_number: rel.line_number, target, lineText: line.trim().slice(0, 100) })
        }
      }
    }
  }
  perRepo.push(row)
  console.log(
    `  ${repo.padEnd(9)} files=${row.files} edges=${row.edges} resolved=${row.resolved}` +
      ` system=${row.systemUnverified} externalDep=${row.externalDeps ?? 0} projectUnresolved=${row.projectUnresolved}`,
  )
}

console.log(`\nTOTAL imports edges ${totalEdges}`)
console.log(`  resolved inside the corpus      ${resolved}`)
console.log(`  system header, not in checkout  ${sysUnverified}`)
console.log(`  external dep (build file names it) ${externalDeps}`)
console.log(`  PROJECT header unresolved       ${projectUnresolved}`)
console.log(`  extensionless include (faithful) ${extensionlessCount}`)

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      schemaVersion: 1,
      instrument: "c-imports-audit",
      claim:
        "every `imports` target names a header that exists — verified against the filesystem, " +
        "which is the only input the analyzer cannot dictate. This is a RESOLVABILITY claim, " +
        "not a directness claim: the analyzer reads directness off the #include line, so " +
        "testing it would be near-tautological.",
      knownLimitation:
        "system headers absent from both the checkout and this machine's include directories " +
        "are counted as systemUnverified, NOT as resolved and NOT as failures — the audit " +
        "cannot distinguish 'present but not indexed here' from 'genuinely absent'.",
      generatedAt: new Date().toISOString(),
      repos: REPOS,
      limit: LIMIT,
      totals: { edges: totalEdges, resolved, systemUnverified: sysUnverified, externalDeps, projectUnresolved, extensionless: extensionlessCount },
      perRepo,
      externalDepSample,
      unresolvedProject,
      unresolvedSystemSample: unresolvedSystem.slice(0, 40),
      extensionlessSample: extensionless,
    },
    null,
    2,
  ) + "\n",
)
console.log(`wrote ${path.relative(ROOT, OUT)}`)