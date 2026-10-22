/**
 * THE MANIFEST READERS — the dependency names a project declares, per directory.
 *
 * EXTRACTED 2026-10-21 (Lead) from `script/m14/incoming-gate.ts` into this module, for ONE REASON:
 * the gate is a SCRIPT that runs its whole body on import, so nothing could import its manifest
 * reader without running the gate's arm. The package-scope claim is the fleet's biggest lever — the
 * dart lane priced 84.9 % of its 16,395 unresolved `uses` rows as "members of types the project does
 * not declare", and the C++ lane's bucket D (122,227 of 614,081) is the same class — and the ONLY
 * true statement available for those rows is "this name belongs to a package this project depends
 * on". The arbiter's verifier (`verifyPackageScopeClaim` in `incoming-rule.ts`) was already built,
 * and the readers were already here, but every lane that wanted to price its residual had to
 * re-implement the manifest reading — and could answer a DIFFERENT question from the one the arbiter
 * answers.
 *
 * THE MOVE IS VERBATIM. The body is the gate's own, unchanged, so the arbiter and every lane read
 * the SAME manifests with the SAME rules. `script/m14/package-scope-claim.ts` is the shared,
 * lane-usable entry point over exactly these readers and the same nearest-ancestor walk.
 */

/**
 * THE MANIFEST IN ONE DIRECTORY, and the dependency names it declares.
 *
 * `null` means NO MANIFEST IS HERE — which is different from "a manifest that declares nothing", and the
 * difference decides a claim: the first leaves the claim UNVERIFIABLE, the second REFUTES it. The
 * nearest-ancestor walk below depends on telling them apart.
 *
 * EXPORTED 2026-10-21 (Lead). The package-scope claim is the fleet's biggest lever — the dart lane
 * priced 84.9 % of its 16,395 unresolved `uses` rows as "members of types the project does not
 * declare", and the C++ lane's bucket D (122,227 of 614,081) is the same class — and the ONLY true
 * statement available for those rows is "this name belongs to a package this project depends on".
 * The arbiter's verifier (`verifyPackageScopeClaim` in `incoming-rule.ts`) was already built, and the
 * readers were already here, but every LANE had to reach them through this gate's own private
 * plumbing. `script/m14/package-scope-claim.ts` is the shared, lane-usable entry point over exactly
 * this function and the same nearest-ancestor walk, so a lane does not have to re-implement the
 * manifest reading, and cannot answer a DIFFERENT question from the one the arbiter answers.
 */

import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"

export function manifestDependenciesIn(dir: string): Set<string> | null {
  const deps = new Set<string>()
  const add = (v: string): void => {
    const t = v.trim()
    if (t.length > 0) deps.add(t)
  }
  /**
   * A MAVEN COORDINATE `group/artifact`, recorded in every spelling a Clojure libspec may use.
   *
   * ADDED 2026-10-20 (the clojure lane's proposal, wired by the Lead). A Clojure dependency is a MAVEN
   * COORDINATE and the libspec a file writes is a NAMESPACE, so the coordinate is recorded as the
   * coordinate itself (`babashka/fs`), the group-with-a-dot form (`babashka.fs`), the namespace form the
   * convention implies (`<last group segment>.artifact` — `io.replikativ/datalog-parser` ->
   * `replikativ.datalog-parser`) and the artifact alone (`fs`, which is what makes
   * `borkdude/missing.test.assertions` -> `missing.test.assertions` match). The arbiter's matcher is
   * EXACT or `/`-boundary and knows nothing about Clojure's group/artifact convention, so the reader
   * must supply every spelling — the same thing the pom.xml reader already does for a maven coordinate.
   */
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
  let sawManifest = false
  const read = (name: string): string | null => {
    try { return readFileSync(path.join(dir, name), "utf8") } catch { return null }
  }
  // ── deps.edn (Clojure / tools.deps) — ADDED 2026-10-20 (clojure lane). A Clojure dependency is
  // a MAVEN COORDINATE `group/artifact`, and the libspec a file writes is a NAMESPACE — so a
  // coordinate is recorded in the spellings a Clojure libspec may use (see `addCoord`).
  {
    const text = read("deps.edn")
    if (text !== null) {
      sawManifest = true
      for (const m of text.matchAll(/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\s*\{/g)) addCoord(m[1]!, m[2]!)
    }
  }
  // ── project.clj (Clojure / Leiningen) — ADDED 2026-10-20 (clojure lane). `:dependencies
  // [[artifact "v"] [group/artifact "v"]]`, AND the PROFILE dependencies: clj-kondo's own
  // `project.clj` puts ring-mock, next-jdbc, schema, compojure, potemkin, expectations, rum and
  // clojure-lsp in the `:test` PROFILE, and the corpus's test fixtures require exactly those. **A READER
  // THAT READ ONLY THE ROOT LIST WOULD REFUTE 977 ROWS THE PROJECT PLAINLY HAS.**
  {
    const text = read("project.clj")
    if (text !== null) {
      sawManifest = true
      for (const m of text.matchAll(/\[\s*([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?)\s+"/g)) {
        const spec = m[1]!
        const slash = spec.indexOf("/")
        if (slash > 0) addCoord(spec.slice(0, slash), spec.slice(slash + 1))
        else addCoord("", spec)
      }
    }
  }
  // ── go.mod: `require`/`replace` blocks and single-line forms ──────────────────────────────────
  {
    const text = read("go.mod")
    if (text !== null) {
      sawManifest = true
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (line.length === 0) continue
        if (line.startsWith("require (")) continue
        const m = /^(?:require|replace)\s+([^\s]+)/.exec(line)
        if (m) { add(m[1]); continue }
        const inBlock = /^(?:require|replace)\s+\(([^)]*)\)/.exec(line)
        if (inBlock) { for (const part of inBlock[1].split(/\s+/)) if (part.length > 0) add(part) }
      }
    }
  }
  // ── package.json / composer.json: JSON key reads ───────────────────────────────────────────────
  const jsonManifests: [string, string[]][] = [
    ["package.json", ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]],
    ["composer.json", ["require", "require-dev"]],
  ]
  for (const [name, sections] of jsonManifests) {
    const text = read(name)
    if (text === null) continue
    sawManifest = true
    try {
      const parsed = JSON.parse(text) as Record<string, any>
      for (const sec of sections) {
        const block = parsed?.[sec]
        if (block && typeof block === "object") {
          for (const key of Object.keys(block)) add(key)
        }
      }
    } catch { /* unparseable: the manifest is still a manifest */ }
  }
  // pubspec.yaml: `dependencies:` and `dev_dependencies:` blocks, each `  name:` or `  name: version`
  {
    const text = read("pubspec.yaml")
    if (text !== null) {
      sawManifest = true
      let inBlock = false
      for (const raw of text.split(/\r?\n/)) {
        if (/^(dependencies|dev_dependencies):\s*$/.test(raw)) { inBlock = true; continue }
        if (inBlock && /^\S/.test(raw)) { inBlock = false }   // a new top-level key ends the block
        if (!inBlock) continue
        const m = /^\s{2}([A-Za-z0-9_-]+):/.exec(raw)
        if (m) add(m[1])
      }
    }
  }
  // Cargo.toml: `[dependencies]` and `[dev-dependencies]` sections, `name = "version"` or `name = { … }`
  {
    const text = read("Cargo.toml")
    if (text !== null) {
      sawManifest = true
      let inBlock = false
      for (const raw of text.split(/\r?\n/)) {
        const sec = /^\s*\[([^\]]+)\]\s*$/.exec(raw)
        if (sec) { inBlock = sec[1] === "dependencies" || sec[1] === "dev-dependencies" || sec[1] === "build-dependencies"; continue }
        if (!inBlock) continue
        const m = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(raw)
        if (m) add(m[1])
      }
    }
  }
  // pyproject.toml: `[project] dependencies = [ "x", … ]` and `[tool.poetry.dependencies]`
  {
    const text = read("pyproject.toml")
    if (text !== null) {
      sawManifest = true
      const arr = /dependencies\s*=\s*\[([^\]]*)\]/s.exec(text)
      if (arr) {
        for (const q of arr[1].split(",")) {
          const m = /["']([A-Za-z0-9_.-]+)/.exec(q)
          if (m) add(m[1])
        }
      }
      const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(text)
      if (poetry) {
        for (const raw of poetry[1].split(/\r?\n/)) {
          const m = /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(raw)
          if (m) add(m[1])
        }
      }
    }
  }
  // requirements*.txt: one distribution per line, `name==1.0` / `name>=1.0` / `name`
  try {
    for (const f of readdirSync(dir)) {
      if (!/^requirements.*\.txt$/.test(f)) continue
      sawManifest = true
      for (const raw of readFileSync(path.join(dir, f), "utf8").split(/\r?\n/)) {
        const line = raw.trim()
        if (line.length === 0 || line.startsWith("#") || line.startsWith("-")) continue
        const m = /^([A-Za-z0-9_.-]+)/.exec(line)
        if (m) add(m[1])
      }
    }
  } catch { /* no requirements: unverifiable */ }
  // ── Gemfile (ruby) — ADDED 2026-10-20. The gate could not read it, so the package-scope claim was
  // STRUCTURALLY UNAVAILABLE for every ruby repo: `facts.packageDependencies` was empty, every claim
  // read UNVERIFIABLE, and a lane could not use the fleet's biggest lever on a language the corpus
  // carries 15 repos of. `gem 'name'` / `gem "name"`.
  {
    const text = read("Gemfile")
    if (text !== null) {
      sawManifest = true
      for (const raw of text.split(/\r?\n/)) {
        const m = /^\s*gem\s+['"]([^'"]+)['"]/.exec(raw)
        if (m) add(m[1])
      }
    }
  }
  // ── pom.xml (maven) — ADDED 2026-10-20, same reason. A maven dependency is `group:artifact`, and a
  // claim names the PACKAGE, which is the GROUP (`org.slf4j`), so BOTH spellings are recorded: the
  // coordinate for a coordinate-shaped claim, and the group alone for a package-shaped one.
  {
    const text = read("pom.xml")
    if (text !== null) {
      sawManifest = true
      for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
        const g = /<groupId>([^<]+)<\/groupId>/.exec(m[1])
        const a = /<artifactId>([^<]+)<\/artifactId>/.exec(m[1])
        if (!g || !a) continue
        const group = g[1].trim()
        const artifact = a[1].trim()
        add(`${group}:${artifact}`)
        add(group)
      }
    }
  }
  // ── build.gradle / build.gradle.kts — ADDED 2026-10-20, same reason. A gradle coordinate is
  // `group:artifact:version`, and the claim names the group, so both are recorded.
  for (const name of ["build.gradle", "build.gradle.kts"]) {
    const text = read(name)
    if (text === null) continue
    sawManifest = true
    for (const m of text.matchAll(/(?:api|implementation|compile|compileOnly|runtimeOnly|testImplementation|testCompile|testRuntimeOnly|annotationProcessor|kapt)\s*[( ]\s*['"]([^'"]+)['"]/g)) {
      const parts = m[1].split(":")
      if (parts.length >= 2) { add(`${parts[0]}:${parts[1]}`); add(parts[0]) }
      else if (parts.length === 1 && parts[0].length > 0) add(parts[0])
    }
  }
  // ── Package.swift (swift package manager) — ADDED 2026-10-20, same reason. The package is named by
  // its URL's last path component (`swift-nio`) and, when the manifest spells it, by `name:` — and the
  // MODULE a file imports is the `name:` when there is one, so both are recorded.
  {
    const text = read("Package.swift")
    if (text !== null) {
      sawManifest = true
      for (const m of text.matchAll(/\.package\s*\(\s*(?:name:\s*["']([^"']+)["']\s*,\s*)?url:\s*["']([^"']+)["']/g)) {
        if (m[1]) add(m[1])
        const base = m[2].split("/").pop() ?? ""
        if (base.length > 0) add(base.replace(/\.git$/, ""))
      }
    }
  }
  // ── *.csproj (.NET) — ADDED 2026-10-20, same reason. `<PackageReference Include="Newtonsoft.Json" />`
  // — and the claim names the NAMESPACE, which is the Include value.
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".csproj") && !f.endsWith(".fsproj") && !f.endsWith(".vbproj")) continue
      sawManifest = true
      const text = readFileSync(path.join(dir, f), "utf8")
      for (const m of text.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) add(m[1])
    }
  } catch { /* no project file: unverifiable */ }
  return sawManifest ? deps : null
}
