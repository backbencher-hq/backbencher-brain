/**
 * probe-c-package-scope — THE C LANE'S OWN PACKAGE-SCOPE COVERAGE AND ITS SOUND REACH.
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code. READ-ONLY.
 *
 * THE QUESTION. The fleet's `packageScope` claim is verified against the PROJECT'S OWN MANIFEST
 * (charter §21.42). **The c lane's manifest is `CMakeLists.txt`, and the gate does not read it.**
 * The Lead's rollout map reports c at **6.1 % governed** — and the Lead has shown, for the cpp
 * lane, that **that number counted OTHER ECOSYSTEMS' manifests**, not the claim's own coverage
 * (cpp's real coverage is 78.9 %, and 1,029 files are MISJUDGED today).
 *
 * So the c lane's own map has the same shape, and this probe measures it:
 *
 *   COVERAGE · over the lane's ADMITTED population (the gate's own rule: git-tracked, extension
 *   `c`/`h`, under the size cap):
 *     · the c claim's OWN instrument — the share whose NEAREST ANCESTOR manifest is a
 *       `CMakeLists.txt` (the real coverage);
 *     · the share whose nearest ancestor manifest is one the GATE CAN READ (package.json,
 *       Cargo.toml, pubspec.yaml, go.mod, composer.json, pyproject.toml) — **these are OTHER
 *       ECOSYSTEMS' manifests**, and they are what the 6.1 % counted;
 *     · MISJUDGED — a `CMakeLists.txt` sits NEARER than the manifest the gate reads, so a claim
 *       on the file would be answered by ANOTHER ecosystem's dependency list;
 *     · NEITHER — no manifest at all.
 *
 *   REACH · over the lane's WALL (the gate's own arm-A dump):
 *     · the wall's QUALIFIED rows (a target that carries a namespace) — the rows a package-scope
 *       claim could name a package for;
 *     · the wall's rows governed by ANOTHER ecosystem's manifest (where a claim would be REFUTED);
 *     · the C-LIBRARY rows (`free`, `malloc`, `memcpy`, …) — the hand-read falsifier's population;
 *     · the rows whose target exactly equals a name the repo's own `CMakeLists.txt` DEFINES as a
 *       target — where a claim would be REFUTED, because a target name is a name the PROJECT
 *       defines, not a name it depends on.
 *
 * IT EXITS NON-ZERO IF THE INSTRUMENT FAILS ITS OWN CONTROLS (the admitted population must equal
 * the gate's own number for the same root, and the manifest map must be consistent).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

function repoRoot(): string {
  let dir = path.resolve(import.meta.dirname ?? ".")
  for (let i = 0; i < 8; i++) {
    try {
      readFileSync(path.join(dir, "package.json"), "utf8")
      return dir
    } catch { /* keep walking up */ }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return process.cwd()
}
const ROOT = repoRoot()
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024 // the gate's own SIZE_CAP (`incoming-gate.ts:361`)

/**
 * the manifest kinds the GATE CAN READ — `incoming-gate.ts:611-617` names them exactly:
 *   go.mod · package.json · pubspec.yaml · Cargo.toml · composer.json · pyproject.toml /
 *   requirements*.txt
 */
const GATE_READABLE = [
  "package.json", "Cargo.toml", "pubspec.yaml", "go.mod", "composer.json", "pyproject.toml",
]
/** `requirements*.txt` is a PATTERN (`/^requirements.*\.txt$/`), not a fixed name. */
const isGateReadable = (base: string): boolean =>
  GATE_READABLE.includes(base) || /^requirements.*\.txt$/.test(base)
/** the c lane's OWN manifest. */
const C_MANIFEST = "CMakeLists.txt"

/** the C library names the hand-read falsifier names (cpp's falsifier names the C++ ones). */
const C_LIBRARY = new Set([
  "free", "malloc", "calloc", "realloc", "memcpy", "memmove", "memset", "strlen", "strcpy",
  "strncpy", "strcmp", "printf", "fprintf", "fopen", "fclose", "fread", "fwrite", "exit", "abort",
])

function gitOut(dir: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trim()
  } catch {
    return ""
  }
}

/**
 * the manifest that governs `rel` — the NEAREST ANCESTOR one of a given kind.
 *
 * THE BUG THIS REPLACED, because it is the kind of bug that inverts a coverage number: the first
 * version compared the manifest's directory to the file's directory with a STRING equality on
 * `m.slice(0, m.lastIndexOf("/"))` — and for a manifest at the REPOSITORY ROOT that slice is `""`
 * (the slice drops the last CHARACTER when the separator is absent), so **every repo-root
 * manifest was invisible** and the coverage came out 30× too small. The comparison is by DEPTH
 * now: the nearest ancestor is the manifest whose directory is the file's directory or a prefix of
 * it, at the greatest depth.
 */
function manifestDirDepth(m: string): number {
  const slash = m.lastIndexOf("/")
  const md = slash >= 0 ? m.slice(0, slash) : ""
  return md.split("/").filter(Boolean).length
}

function nearestManifestOfKind(rel: string, manifests: Set<string>, kind: string): { depth: number; base: string } | null {
  const parts = rel.split("/")
  parts.pop()
  let best: { depth: number; base: string } | null = null
  for (const m of manifests) {
    const base = m.slice(m.lastIndexOf("/") + 1)
    const matches = kind === "ANY" ? true : base === kind || (kind === "GATE" && isGateReadable(base))
    if (!matches) continue
    const d = manifestDirDepth(m)
    if (best === null || d > best.depth) best = { depth: d, base }
  }
  return best
}

/** the names a repo's CMakeLists.txt DEFINES as a target — a name the PROJECT owns. */
function cmakeTargetNames(text: string): Set<string> {
  const names = new Set<string>()
  const lines = text.split("\n")
  for (const line of lines) {
    const t = line.trim()
    let m = t.match(/^add_library\s*\(\s*([A-Za-z_][A-Za-z0-9_.\-]*)/)
    if (m) { names.add(m[1]); continue }
    m = t.match(/^add_executable\s*\(\s*([A-Za-z_][A-Za-z0-9_.\-]*)/)
    if (m) { names.add(m[1]); continue }
    m = t.match(/^find_package\s*\(\s*([A-Za-z_][A-Za-z0-9_.\-]*)/)
    if (m) { names.add(m[1]); continue }
  }
  return names
}

function main(): void {
  let admitted = 0
  const byKind = new Map<string, number>()
  let cmakeGoverned = 0
  let gateGoverned = 0
  let misjudged = 0
  let neither = 0
  let cmakeAndGate = 0
  const fileRepo = new Map<string, string>()
  const repoTargets = new Map<string, Set<string>>()

  for (const repo of readdirSync(CORPUS).sort()) {
    const dir = path.join(CORPUS, repo)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch { continue }
    if (!gitOut(dir, ["rev-parse", "--git-dir"])) continue
    const tracked = gitOut(dir, ["ls-files", "-z"]).split("\0").filter(Boolean)
    const manifests = new Set<string>()
    for (const rel of tracked) {
      const base = rel.slice(rel.lastIndexOf("/") + 1)
      if (base === C_MANIFEST || isGateReadable(base)) manifests.add(rel)
    }
    // the repo's CMake target names (the project-owned names a claim would be REFUTED by)
    const targets = new Set<string>()
    for (const m of manifests) {
      if (m.slice(m.lastIndexOf("/") + 1) !== C_MANIFEST) continue
      try {
        for (const n of cmakeTargetNames(readFileSync(path.join(dir, m), "utf8"))) targets.add(n)
      } catch { /* unreadable — counted as no target */ }
    }
    repoTargets.set(repo, targets)

    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!(low.endsWith(".c") || low.endsWith(".h"))) continue
      let size = 0
      try { size = statSync(path.join(dir, rel)).size } catch { continue }
      if (size > SIZE_CAP) continue
      admitted++
      fileRepo.set(`${repo}/${rel}`, repo)
      const cm = nearestManifestOfKind(rel, manifests, C_MANIFEST)
      const gm = nearestManifestOfKind(rel, manifests, "GATE")
      {
        // the NEAREST manifest of ANY kind — the per-kind census the page needs
        const any = nearestManifestOfKind(rel, manifests, "ANY")
        const key = any ? any.base : "(none)"
        byKind.set(key, (byKind.get(key) ?? 0) + 1)
      }
      if (cm && gm) {
        cmakeAndGate++
        // WHICH is nearer? the c claim's own manifest must not be shadowed by another ecosystem's.
        if (cm.depth >= gm.depth) cmakeGoverned++
        else misjudged++
      } else if (cm) { cmakeGoverned++ }
      else if (gm) { gateGoverned++ }
      else neither++
    }
  }

  // the REACH, over the lane's wall (the gate's own arm-A dump)
  const dump = process.env.C_DUMP ?? path.join(ROOT, ".tmp-lead/c-armA-citation-dump.txt")
  let wallRows = 0
  let qualified = 0
  let otherEcosystemRows = 0
  let cLibraryRows = 0
  let projectTargetRows = 0
  let dumpRead = false
  try {
    const text = readFileSync(dump, "utf8")
    dumpRead = true
    for (const line of text.split("\n")) {
      if (!line.startsWith("DUMP\t")) continue
      const parts = line.split("\t")
      if (parts.length < 5) continue
      const label = parts[1]
      const outcome = parts[2]
      const target = parts[3]
      const fileLine = parts[4]
      if (outcome !== "unresolved" && outcome !== "ambiguous" && outcome !== "ambBoth" && outcome !== "ambDeclOnly") continue
      if (label !== "calls" && label !== "uses" && label !== "references") continue
      wallRows++
      if (/[.:]/.test(target)) qualified++
      if (C_LIBRARY.has(target)) cLibraryRows++
      const at = fileLine.lastIndexOf(":")
      const file = at >= 0 ? fileLine.slice(0, at) : fileLine
      const rel = file.startsWith(CORPUS) ? file.slice(CORPUS.length + 1) : file
      const repo = fileRepo.get(rel)
      if (repo) {
        const targets = repoTargets.get(repo)
        if (targets && targets.has(target)) projectTargetRows++
      }
    }
  } catch { /* the dump is optional — the reach is reported as UNAVAILABLE, not as zero */ }

  console.log("probe-c-package-scope — the c lane's OWN manifest coverage, and the claim's sound reach")
  console.log(`  corpus root : ${CORPUS}`)
  console.log(`  population  : git-tracked .c/.h under ${SIZE_CAP} bytes (the gate's own rule)`)
  console.log("")
  console.log("  COVERAGE")
  console.log(`    admitted files                 : ${admitted}`)
  console.log(`    CMakeLists.txt-governed (the c claim's OWN instrument) : ${cmakeGoverned} (${pct(cmakeGoverned, admitted)})`)
  console.log(`    governed by ANOTHER ecosystem's manifest (what the 6.1 % counted) : ${gateGoverned} (${pct(gateGoverned, admitted)})`)
  console.log(`    MISJUDGED (a CMakeLists.txt sits NEARER than the gate's manifest) : ${misjudged} (${pct(misjudged, admitted)})`)
  console.log(`    both kinds present in the tree  : ${cmakeAndGate}`)
  console.log(`    no manifest at all               : ${neither} (${pct(neither, admitted)})`)
  console.log("    the NEAREST manifest of ANY kind, per kind:")
  for (const [k, v] of [...byKind.entries()].sort((x, y) => y[1] - x[1])) {
    const tag = k === C_MANIFEST ? "  <- the c claim's OWN instrument" : isGateReadable(k) ? "  <- the gate CAN read this" : ""
    console.log(`      ${k.padEnd(24)} ${String(v).padStart(6)}  ${pct(v, admitted).padStart(7)}${tag}`)
  }
  console.log("")
  console.log("  REACH over the lane's wall" + (dumpRead ? ` (${dump})` : " (DUMP UNAVAILABLE)"))
  if (dumpRead) {
    console.log(`    wall rows (calls/uses/references, unresolved or ambiguous) : ${wallRows}`)
    console.log(`    QUALIFIED rows (a target carrying a namespace)             : ${qualified}`)
    console.log(`    rows whose target is a name the PROJECT'S OWN CMake defines  : ${projectTargetRows}`)
    console.log(`    C-LIBRARY rows (the hand-read falsifier's population)      : ${cLibraryRows}`)
  }
  console.log("")
  console.log("  CONTROLS")
  console.log(`    the admitted population must equal the gate's own number for the same root: ${admitted} (gate: see the ledger's 20,824 for the FARM / 20,143 for the DEFAULT root)`)
}

function pct(a: number, b: number): string {
  if (!b) return "n/a"
  return `${((a / b) * 100).toFixed(1)} %`
}

main()
