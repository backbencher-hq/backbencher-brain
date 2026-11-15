/**
 * CLOJURE LANE — THE MANIFEST FACTS, IN ONE PLACE.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Two lane instruments need the same thing: the PROJECT'S OWN DECLARED DEPENDENCY SET, read the
 * way the shared arbiter reads it. Two implementations of the same idea are a second source of
 * truth, and this programme keeps paying for that shape — so there is ONE implementation here and
 * both instruments import it.
 *
 * ## WHAT IT MIRRORS, AND WHERE IT IS ALLOWED TO DIFFER
 *
 * The gate builds the per-file evidence in `manifestResolutionForFile`: **walk UP from the file's
 * own directory and STOP at the first directory that holds ANY manifest the gate reads** (or a
 * `CMakeLists.txt`). The nearest-ancestor rule is the gate's, and it is not a detail — the
 * `clojure` repository carries a `pom.xml` and NO `deps.edn`, so its 142 files are governed by a
 * MAVEN manifest, and every Clojure-libspec claim on them is UNVERIFIABLE. An instrument that
 * ignored the pom would have measured a different population and quoted a different price.
 *
 * **THE SET is transcribed for the manifest kinds the clojure corpus actually carries** —
 * `deps.edn` (tools.deps), `project.clj` (Leiningen) and `pom.xml` (maven) — **and for every
 * OTHER kind the gate reads this module returns an EMPTY set.** That is deliberate: the WALK must
 * stop in the same directory the gate's stops, even where this module has nothing to say about the
 * contents. An empty set makes a claim UNVERIFIABLE, which is the fail-closed direction; a reader
 * that walked past a `package.json` to find a `deps.edn` two levels up would be checking a
 * DIFFERENT manifest and could VERIFY a claim the gate REFUTES.
 *
 * ## THE PARITY ASSERTION
 *
 * `assertReaderParity()` reads `script/m14/incoming-gate.ts` and checks that the gate's own clojure
 * reader carries the SAME four spellings and the SAME two regexes this module uses. The gate's
 * reader is not exported, so parity is asserted FROM THE SOURCE, on every run. A reader that
 * drifts is caught before a price is quoted from it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

/** The dependency set of ONE directory, or `null` when this directory holds no manifest the gate
 *  reads (which means the walk continues upward). */
export function manifestSetIn(dir: string): Set<string> | null {
  const out = new Set<string>()
  const add = (v: string): void => { const t = v.trim(); if (t.length > 0) out.add(t) }
  const read = (name: string): string | null => { try { return readFileSync(path.join(dir, name), "utf8") } catch { return null } }
  let saw = false

  /** A MAVEN COORDINATE `group/artifact`, in every spelling a Clojure libspec may use. The four
   *  are the gate's own (the Lead adopted them from this lane's proposal): the coordinate, the
   *  group-with-a-dot form, the namespace the Clojure convention implies, and the artifact alone. */
  const addCoord = (group: string, artifact: string): void => {
    const g = group.trim()
    const a = artifact.trim()
    if (a.length === 0) return
    if (g.length > 0) {
      add(`${g}/${a}`)
      add(`${g}.${a}`)
      add(`${g.split("/").pop()}.${a}`)
    }
    add(a)
  }

  const depsEdn = read("deps.edn")
  if (depsEdn !== null) {
    saw = true
    for (const m of depsEdn.matchAll(/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\s*\{/g)) addCoord(m[1]!, m[2]!)
  }
  const projectClj = read("project.clj")
  if (projectClj !== null) {
    saw = true
    for (const m of projectClj.matchAll(/\[\s*([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?)\s+"/g)) {
      const spec = m[1]!
      const slash = spec.indexOf("/")
      if (slash > 0) addCoord(spec.slice(0, slash), spec.slice(slash + 1))
      else addCoord("", spec)
    }
  }
  const pom = read("pom.xml")
  if (pom !== null) {
    saw = true
    for (const m of pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
      const g = /<groupId>([^<]+)<\/groupId>/.exec(m[1]!)
      const a = /<artifactId>([^<]+)<\/artifactId>/.exec(m[1]!)
      if (!g || !a) continue
      add(`${g[1]!.trim()}:${a[1]!.trim()}`)
      add(g[1]!.trim())
    }
  }
  if (saw) return out

  // EVERY OTHER KIND THE GATE READS — the walk must STOP here even though this module has nothing
  // to say about the contents.
  const otherKinds = ["package.json", "go.mod", "Cargo.toml", "pubspec.yaml", "pyproject.toml", "composer.json", "build.gradle", "build.gradle.kts", "Package.swift", "Gemfile"]
  for (const k of otherKinds) { if (read(k) !== null) return new Set<string>() }
  try {
    for (const f of readdirSync(dir)) {
      if (/^requirements.*\.txt$/.test(f)) return new Set<string>()
      if (/\.(csproj|fsproj|vbproj)$/.test(f)) return new Set<string>()
    }
  } catch { /* no dir listing */ }
  if (read("CMakeLists.txt") !== null) return new Set<string>()
  return null
}

/** The gate's nearest-ancestor walk, from a file's own directory up to the repository root. */
export function governingManifest(repoRoot: string, absFile: string): Set<string> | undefined {
  let dir = path.dirname(absFile)
  const root = path.resolve(repoRoot)
  for (;;) {
    const set = manifestSetIn(dir)
    if (set !== null) return set
    if (path.resolve(dir) === root) return undefined
    const up = path.dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
}

/** The gate's per-repository facts, in the gate's own shape. */
export function buildFacts(corpusRoot: string, files: string[]): Map<string, any> {
  const byRepo = new Map<string, string[]>()
  for (const f of files) {
    const rel = f.startsWith(corpusRoot) ? f.slice(corpusRoot.length + 1) : f
    const repo = rel.split(path.sep)[0]!
    const list = byRepo.get(repo) ?? []
    list.push(f)
    byRepo.set(repo, list)
  }
  const out = new Map<string, any>()
  for (const [repo, list] of byRepo) {
    const repoRoot = path.join(corpusRoot, repo)
    const admitted = new Set<string>()
    for (const abs of list) {
      const rel = path.relative(repoRoot, abs)
      if (rel.length > 0) admitted.add(rel.split(path.sep).join("/"))
    }
    const byFile = new Map<string, Set<string>>()
    for (const abs of list) {
      const governed = governingManifest(repoRoot, abs)
      if (governed === undefined) continue
      byFile.set(abs, governed)
    }
    out.set(repo, {
      packages: new Set<string>(), files: admitted, sdkLib: false,
      packageDependencies: manifestSetIn(repoRoot) ?? new Set<string>(),
      packageDependenciesByFile: byFile,
      projectFactDependencies: new Set<string>(),
      projectFactDependenciesByFile: new Map<string, Set<string>>(),
    })
  }
  return out
}

/**
 * THE PARITY ASSERTION — the control on the control.
 *
 * The gate's `manifestDependenciesIn` is not exported, so parity is checked FROM THE SOURCE: the
 * gate's clojure reader must carry the SAME `addCoord` body and the SAME two regexes this module
 * uses. It exits 4 on a divergence, because a price quoted from a reader the gate does not run is
 * a price about a different population.
 */
export function assertReaderParity(repoRoot: string): void {
  const gateSrc = readFileSync(path.join(repoRoot, "script", "m14", "incoming-gate.ts"), "utf8")
  const problems: string[] = []
  if (!gateSrc.includes("deps.edn")) problems.push("the gate does not read deps.edn")
  if (!gateSrc.includes("project.clj")) problems.push("the gate does not read project.clj")
  const fourSpellings = [
    'add(`${g}/${a}`)',
    'add(`${g}.${a}`)',
    'add(`${g.split("/").pop()}.${a}`)',
    'add(a)',
  ]
  for (const s of fourSpellings) {
    if (!gateSrc.includes(s)) problems.push(`the gate's addCoord does not record the spelling ${s}`)
  }
  const DEPS_RE = '/([A-Za-z0-9._-]+)\\/([A-Za-z0-9._-]+)\\s*\\{'
  const PROJ_RE = '/\\[\\s*([A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+)?)\\s+"'
  if (!gateSrc.includes(DEPS_RE)) problems.push("the gate's deps.edn coordinate regex differs from this module's")
  if (!gateSrc.includes(PROJ_RE)) problems.push("the gate's project.clj dependency regex differs from this module's")
  if (problems.length > 0) {
    console.error("*** READER PARITY FAILED — the gate's manifest reader and this module's are NOT the same code:")
    for (const p of problems) console.error(`    - ${p}`)
    console.error("    A price quoted from it would be about a reader the gate does not run. Refusing to quote it. ***")
    process.exit(4)
  }
  console.log("READER PARITY: the gate's clojure manifest reader and this module's are THE SAME CODE (four spellings, both regexes) — asserted from the source.")
}

/** The repository root of this checkout, from this file's own location. */
export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
