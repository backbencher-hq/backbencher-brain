/**
 * cpp-cmake-census — HOW MUCH OF THE C++ POPULATION DOES A CMAKE MANIFEST GOVERN, AND WHAT DEPENDENCIES
 * DO THOSE MANIFESTS DECLARE?
 *
 * WHY THIS INSTRUMENT EXISTS. The package-scope claim's evidence is the PROJECT'S OWN MANIFEST, and the
 * rollout map sizes the C/C++ gap as "c 6.1 % governed, cpp 11.9 %" — the share of each lane's files whose
 * nearest ancestor manifest the GATE can read. But for C++ the manifest is `CMakeLists.txt`, and the gate
 * does not read it. So the map's 11.9 % is NOT the share of the C++ population the claim could decide if
 * the instrument were complete: it is the share that happens to sit under a NON-C++ manifest (an npm
 * `package.json`, a `Cargo.toml`) — and those are the share the claim would judge against the WRONG
 * manifest.
 *
 * This instrument measures the number the C++ lane owes the Lead, and it measures it in three parts:
 *
 *   1. THE COVERAGE — the share of the lane's admitted files whose nearest ancestor `CMakeLists.txt`
 *      exists, per repository. That is the instrument's reach, and it is the ceiling on what a
 *      CMake-aware package-scope claim could decide.
 *   2. THE DECLARED DEPENDENCIES — the `find_package(<Name>)` names and the pkg-config module names the
 *      corpus's manifests actually declare. This is the universe of "package" names a C++ claim could
 *      name, read from the checkout and never from a lane's vocabulary.
 *   3. THE MISJUDGED SHARE — the files the GATE's reader WOULD govern, and what that manifest is. A C++
 *      file under an npm `package.json` is exactly the monorepo laundering the rollout map names: a claim
 *      checked against it is checked against a different ecosystem's dependency list.
 *
 * THE POPULATION. The lane's OWN admitted list, taken from the GATE's own discovery
 * (`BB_LIST_FILES=1 … incoming-gate.ts cpp …`) so the file set is the gate's, not a hand-rolled walk — the
 * corpus-root trap the Master Review §2.5 names (every `.corpus` repo dir is a symlink) is avoided by
 * never walking the tree here. The corpus root is printed and must be the one the arm used.
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-cmake-census.ts \
 *     [--ext=cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu,h,hh] [--json=<path>]
 *
 * EXIT: 0 census · 2 usage/environment · 3 CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { cmakeDependencyNames } from "./cpp-cmake-names.ts"
import { existsSync, readFileSync, statSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const JSON_OUT = argOf("--json")
const EXT_LIST = argOf("--ext") ?? "cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu,h,hh"
const LANG = "cpp"
const SIZE_CAP = 1024 * 1024

// ── the ADMITTED LIST, from the GATE's own discovery (never a hand-rolled walk) ─────────────────────
// The gate prints the list on STDERR (`console.error`), so the child's stderr is the channel to read.
const { spawnSync } = await import("node:child_process")
const gateRun = spawnSync("bun", ["run", path.join(ROOT, "script/m14/incoming-gate.ts"), LANG, EXT_LIST, "0"], {
  encoding: "utf8",
  env: { ...process.env, BB_CORPUS_ROOT: CR, BB_LIST_FILES: "1" },
  maxBuffer: 1024 * 1024 * 1024,
})
const gate = `${gateRun.stdout ?? ""}\n${gateRun.stderr ?? ""}`
const admitted: string[] = []
for (const line of gate.split("\n")) {
  const m = /^BB_LIST_FILES_FILE: (.*)$/.exec(line)
  if (m) admitted.push(m[1])
}
const header = /^BB_LIST_FILES: .*/m.exec(gate)?.[0] ?? ""
if (admitted.length === 0) {
  console.error(`cpp-cmake-census: the gate discovered no files (${header}) — refusing to census an empty population.`)
  process.exit(3)
}
const CORPUS_MARK = `${path.sep}.corpus${path.sep}`
const repoOf = (abs: string): string => {
  const i = abs.indexOf(CORPUS_MARK)
  return i >= 0 ? abs.slice(i + CORPUS_MARK.length).split(path.sep)[0] : abs.split(path.sep)[0]
}
const relOf = (abs: string): string => {
  const i = abs.indexOf(CORPUS_MARK)
  return i >= 0 ? abs.slice(i + CORPUS_MARK.length) : abs
}

// ── the CMake scanner (paren-aware: a CMake command may span lines) ────────────────────────────────
/**
 * CMAKE COMMENTS ARE NOT DECLARATIONS — and a scanner that does not strip them invents dependencies.
 *
 * MEASURED, NOT ASSUMED: ghostty's root `CMakeLists.txt` carries
 *   `#   find_package(ghostty-vt REQUIRED)`
 * inside a comment that documents "Option 2 — find_package (after installing to a prefix)". A scanner that
 * reads the raw text sees a package named `ghostty-vt` that the project does not depend on — and a claim
 * checked against it would be REFUTED by a checkout that never declared it. So the scanner strips CMake
 * line comments FIRST: a `#` outside a quoted string runs to the end of the line.
 *
 * THE LIMIT, STATED: CMake's bracket comments (`#[[ ... ]]`) are not handled, and a `#` inside a quoted
 * string is correctly kept. The corpus's manifests use neither in a way that changes a package name (the
 * census reports every package name it found, so a reader can check the list).
 */
function stripCmakeComments(text: string): string {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    let inString = false
    let cut = line.length
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"' && line[i - 1] !== "\\") inString = !inString
      else if (c === "#" && !inString) { cut = i; break }
    }
    out.push(line.slice(0, cut))
  }
  return out.join("\n")
}

function scanCmake(text: string, command: string): string[][] {
  const out: string[][] = []
  const re = new RegExp(`(^|[^A-Za-z0-9_])${command}\\s*\\(`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const open = text.indexOf("(", m.index + m[0].length - 1)
    let depth = 0, i = open
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") { depth--; if (depth === 0) break }
    }
    const body = text.slice(open + 1, i)
    out.push(body.split(/\s+/).map((s) => s.replace(/^["']|["']$/g, "")).filter((s) => s.length > 0))
    re.lastIndex = i
  }
  return out
}
type ManifestFacts = {
  path: string
  commentOnlyFindPackage: string[]
  findPackage: string[]
  pkgConfig: string[]
  importedNamespaces: string[]
  refusedLibraryNames: string[]
  projectTargets: string[]
  fetched: string[]
}
const manifestCache = new Map<string, ManifestFacts | null>()
function manifestFor(absDir: string, repoDir: string): ManifestFacts | null {
  if (manifestCache.has(absDir)) return manifestCache.get(absDir) ?? null
  let dir = absDir
  let found: ManifestFacts | null = null
  for (;;) {
    const candidate = path.join(dir, "CMakeLists.txt")
    if (existsSync(candidate)) {
      let text = ""
      try { text = readFileSync(candidate, "utf8") } catch { text = "" }
      // THE READER, not a second scanner: the census uses the SAME implementation the Lead would wire
      // (`script/m14/cpp-cmake-names.ts`), so the corpus's package universe IS what the wiring would read.
      const reader = cmakeDependencyNames(text)
      const findPackage = reader.names
      const pkgConfig: string[] = []
      const importedNamespaces: string[] = []
      for (const args of scanCmake(stripCmakeComments(text), "target_link_libraries")) {
        for (const a of args.slice(1)) {
          if (["PUBLIC", "PRIVATE", "INTERFACE"].includes(a.toUpperCase())) continue
          if (a.startsWith("-")) continue
          const ns = a.split("::")[0]
          if (ns && ns !== a) importedNamespaces.push(ns)
        }
      }
      const refusedLibraryNames: string[] = []
      for (const cmd of ["find_library", "find_path"]) {
        for (const args of scanCmake(text, cmd)) {
          const ni = args.findIndex((a) => a.toUpperCase() === "NAMES")
          if (ni < 0) continue
          for (const a of args.slice(ni + 1)) if (!a.toUpperCase().startsWith("PATH_SUFFIXES")) { refusedLibraryNames.push(a); refuse("file-stem", a) }
        }
      }
      const projectTargets: string[] = []
      for (const cmd of ["add_library", "add_executable"]) for (const a of scanCmake(text, cmd)) if (typeof a[0] === "string") { projectTargets.push(a[0]); refuse("project-target", a[0]) }
      // THE REFUSED SURFACE — every name-shaped string the reader reads NOTHING from, and why. This is the
      // false-claim surface the Lead's condition is about, measured on the corpus's own manifests.
      const commentOnlyFindPackage: string[] = []
      for (const a of scanCmake(stripCmakeComments(text), "find_package")) {
        const name = a[0]
        if (typeof name === "string" && name.length > 0) { commentOnlyFindPackage.push(name); refuse("find_package-arg", name) }
      }
      const fetched = scanCmake(stripCmakeComments(text), "FetchContent_Declare").map((a) => a[0]).filter((s): s is string => typeof s === "string")
      for (const f of fetched) refuse("fetched-dependency", f)
      found = {
        path: candidate,
        commentOnlyFindPackage: [...new Set(commentOnlyFindPackage)],
        findPackage: [...new Set(findPackage)], pkgConfig: [...new Set(pkgConfig)],
        importedNamespaces: [...new Set(importedNamespaces)], refusedLibraryNames: [...new Set(refusedLibraryNames)],
        projectTargets: [...new Set(projectTargets)], fetched: [...new Set(fetched)],
      }
      break
    }
    if (path.resolve(dir) === path.resolve(repoDir)) break
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  manifestCache.set(absDir, found)
  return found
}

// ── the GATE's manifest kinds, so the MISJUDGED share can be named ─────────────────────────────────
// The gate reads these (script/m14/incoming-gate.ts `manifestDependenciesIn`); a C++ file governed by one
// of them is governed by a manifest from ANOTHER ecosystem, and a claim on it is judged against that
// ecosystem's dependency list.
//
// THE NEAREST-ANCESTOR RULE IS OVER MANIFEST KINDS, NOT OVER ONE ECOSYSTEM: the gate walks UP and takes
// the FIRST manifest it finds, whatever kind it is. So the question the C++ lane owes is not "does a
// CMakeLists.txt exist above this file" but "WHAT IS THE FIRST MANIFEST ABOVE IT" — because that is the
// one a claim would be judged against, today and after any wiring.
const GATE_MANIFEST_KINDS = ["package.json", "composer.json", "pubspec.yaml", "Cargo.toml", "pyproject.toml", "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts", "Package.swift"]
const ALL_MANIFEST_KINDS = ["CMakeLists.txt", ...GATE_MANIFEST_KINDS]
/** The FIRST manifest above `absDir`, by the nearest-ancestor rule, over ALL kinds. */
function nearestManifest(absDir: string, repoDir: string): { kind: string; path: string } | null {
  let dir = absDir
  for (;;) {
    for (const k of ALL_MANIFEST_KINDS) {
      const p = path.join(dir, k)
      if (existsSync(p)) return { kind: k, path: p }
    }
    if (path.resolve(dir) === path.resolve(repoDir)) return null
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/** The FIRST manifest the GATE'S reader would find — i.e. over the gate's OWN kinds only, which is how
 *  the rollout map's "governed" column was computed (it did not consider `CMakeLists.txt` at all). */
function nearestGateReadableManifest(absDir: string, repoDir: string): string | null {
  let dir = absDir
  for (;;) {
    for (const k of GATE_MANIFEST_KINDS) {
      const p = path.join(dir, k)
      if (existsSync(p)) return p
    }
    if (path.resolve(dir) === path.resolve(repoDir)) return null
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

// ── the census ────────────────────────────────────────────────────────────────────────────────────
/** THE FALSE-CLAIM SURFACE: the name-shaped strings the READER reads nothing from, counted by shape.
 *  This is the Lead's condition measured on the corpus's own manifests — what the extended reader would
 *  NOT turn into a dependency name. */
const refusedSurface: Record<string, number> = {}
const refuse = (shape: string, name: string): void => {
  if (name.length === 0) return
  const k = `${shape}:${name}`
  refusedSurface[k] = (refusedSurface[k] ?? 0) + 1
}
const ecoRows = new Map<string, number>()
type RepoRow = {
  repo: string; files: number; cmakeGoverned: number; gateGoverned: number; neither: number; nearestIsCMake: number; gateManifestAbove: number
  gateManifestKinds: Record<string, number>; findPackage: string[]; pkgConfig: string[]; importedNamespaces: string[]
}
const perRepo = new Map<string, RepoRow>()
const packageUniverse = new Map<string, Set<string>>()
let total = 0, cmakeGoverned = 0, gateGoverned = 0, neither = 0, nearestIsCMake = 0, gateManifestAbove = 0
let overCap = 0, absent = 0
for (const abs of admitted) {
  const repo = repoOf(abs)
  const repoDir = path.join(CR, repo)
  const row = perRepo.get(repo) ?? {
    repo, files: 0, cmakeGoverned: 0, gateGoverned: 0, neither: 0, nearestIsCMake: 0, gateManifestAbove: 0, gateManifestKinds: {},
    findPackage: [], pkgConfig: [], importedNamespaces: [],
  }
  row.files++
  total++
  try { if (statSync(abs).size > SIZE_CAP) { overCap++; continue } } catch { absent++; continue }
  const cm = manifestFor(path.dirname(abs), repoDir)
  const nearest = nearestManifest(path.dirname(abs), repoDir)
  if (cm) {
    cmakeGoverned++
    row.cmakeGoverned++
    for (const p of cm.findPackage) { row.findPackage.push(p); const s = packageUniverse.get(p) ?? new Set(); s.add(repo); packageUniverse.set(p, s) }
    for (const p of cm.pkgConfig) { row.pkgConfig.push(p); const s = packageUniverse.get(p) ?? new Set(); s.add(repo); packageUniverse.set(p, s) }
    for (const p of cm.importedNamespaces) row.importedNamespaces.push(p)
  }
  const gateNearest = nearestGateReadableManifest(path.dirname(abs), repoDir)
  if (gateNearest) { gateManifestAbove++; row.gateManifestAbove++ }
  if (nearest) {
    ecoRows.set(nearest.kind, (ecoRows.get(nearest.kind) ?? 0) + 1)
    if (nearest.kind === "CMakeLists.txt") {
      nearestIsCMake++
      row.nearestIsCMake++
    } else {
      gateGoverned++
      row.gateGoverned++
      row.gateManifestKinds[nearest.kind] = (row.gateManifestKinds[nearest.kind] ?? 0) + 1
    }
  } else { neither++; row.neither++ }
  perRepo.set(repo, row)
}

const pct = (n: number): string => `${((n / Math.max(1, total)) * 100).toFixed(1)}%`
const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-cmake-census.ts",
  measuredAt: new Date().toISOString(),
  corpusRoot: CR,
  gateHeader: header,
  extensionList: EXT_LIST,
  population: {
    admittedFiles: total, overSizeCap: overCap, absent: absent,
    repos: perRepo.size,
    machine: { loadAvg1: Number(os.loadavg()[0].toFixed(2)), availableGB: Number((os.freemem() / 1024 ** 3).toFixed(2)), cores: os.cpus().length },
  },
  coverage: {
    nearestIsCMakeLists: { files: nearestIsCMake, share: pct(nearestIsCMake), note: "the FIRST manifest above the file is a CMakeLists.txt — the claim would be DECIDABLE if the gate read CMake, and is UNVERIFIABLE today" },
    nearestIsAGateReadableManifest: { files: gateGoverned, share: pct(gateGoverned), note: "the FIRST manifest above the file is one the gate reads — and for a C++ file it is ANOTHER ECOSYSTEM's manifest, so a C++ package claim on it would be REFUTED (a false red)" },
    noManifestAtAll: { files: neither, share: pct(neither) },
    gateManifestAboveIgnoringCMake: { files: gateManifestAbove, share: pct(gateManifestAbove), note: "a manifest the gate's reader WOULD find if it walked up over the gate's kinds only — THIS is the rollout map's 'governed' column, computed without CMakeLists.txt" },
    cmakeNearerThanTheGateManifest: { files: gateManifestAbove - gateGoverned, note: "a gate-readable manifest exists above, but a CMakeLists.txt sits NEARER — so today's answer for these files comes from the FARTHER, foreign manifest: the monorepo laundering the rollout map names" },
    anyCMakeAbove: { files: cmakeGoverned, share: pct(cmakeGoverned), note: "a CMakeLists.txt exists above the file (not necessarily the nearest manifest)" },
  },
  perEcosystem: Object.fromEntries([...ecoRows.entries()].sort((a, b) => b[1] - a[1])),
  refusedSurface,
  packageUniverse: Object.fromEntries([...packageUniverse.entries()].sort((a, b) => b[1].size - a[1].size)),
  perRepo: [...perRepo.values()].sort((a, b) => b.files - a.files),
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const t = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, json)
}
console.log(`cpp-cmake-census — admitted ${total} files / ${perRepo.size} repos · over-cap ${overCap} · absent ${absent}`)
console.log(`  NEAREST manifest is CMakeLists.txt : ${String(nearestIsCMake).padStart(6)}  ${pct(nearestIsCMake)}`)
console.log(`  NEAREST manifest is gate-readable  : ${String(gateGoverned).padStart(6)}  ${pct(gateGoverned)}  (another ecosystem's manifest)`)
console.log(`  NO manifest at all                 : ${String(neither).padStart(6)}  ${pct(neither)}`)
console.log(`  any CMakeLists.txt above           : ${String(cmakeGoverned).padStart(6)}  ${pct(cmakeGoverned)}`)
console.log(`  a GATE-READABLE manifest above     : ${String(gateManifestAbove).padStart(6)}  ${pct(gateManifestAbove)}  (the rollout map's "governed", computed WITHOUT CMakeLists.txt)`)
console.log("PER REPO")
for (const r of report.perRepo) {
  console.log(`  ${r.repo.padEnd(22)} files=${String(r.files).padStart(6)}  nearest-cmake=${String(r.nearestIsCMake).padStart(6)}  nearest-gate=${String(r.gateGoverned).padStart(6)}  none=${String(r.neither).padStart(6)}  ${Object.entries(r.gateManifestKinds).map(([k, v]) => `${k}:${v}`).join(" ")}`)
}
console.log("PER ECOSYSTEM (the ecosystem IS the kind of the first manifest above the file)")
for (const [k, v] of [...ecoRows.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${String(v).padStart(6)}  ${pct(v)}`)
console.log("THE PACKAGE NAMES THE CORPUS'S CMAKE MANIFESTS DECLARE")
for (const [p, repos] of Object.entries(report.packageUniverse)) console.log(`  ${p.padEnd(28)} ${[...repos].join(", ")}`)
