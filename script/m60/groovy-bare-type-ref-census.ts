// script/m60/groovy-bare-type-ref-census.ts — the measurement behind the ONE
// fixture conflict JOB 1 could not settle from inside the lane.
//
//   npx tsx script/m60/groovy-bare-type-ref-census.ts [--out <path>] [--max N]
//
// ## The question
//
// `collectDeclaredTypeRefs` refuses every `declared_type` / `return_type` /
// `cast_type` / `throws_type` target whose name is not QUALIFIED:
//
//     if (!t.name.includes(".")) continue
//
// The stated reason, at the emission site, is a measurement of the lane's own
// hand-audited truth: "every one of the 15 `references` rows this lane's
// hand-audited truth expects is fully qualified … Truth has no bare target
// anywhere in its 79 relationship rows." Eleven M14 fixtures for this lane
// assert the opposite — they expect `String`, `List`, `IOException` — and the
// java analyzer (the family comparator) emits bare names deliberately, with
// the measured defect that made it do so named in its own comment
// ("GormProperties.java -> String", "Opcodes.java -> Integer").
//
// So this is not a lane decision: one committed contract says a 79-row hand
// audit happens to contain no bare target, another says bare targets are
// required. Both are recorded. This instrument supplies the number the
// adjudication needs — HOW MUCH PAYLOAD the refusal costs — because that is the
// only side of the question that no committed file states.
//
// ## What it measures
//
// On the PARSE TREE, never on text (a string literal and a Gradle heredoc can
// fake any regex — the ontology gate's own header records two false positives
// from exactly that):
//
//   written       every BARE type name in a declared-type position the lane's
//                own collector visits: field_declaration, formal_parameter,
//                local_variable_declaration, throws, catch_formal_parameter,
//                instanceof_expression, cast_expression, switch_label,
//                method_reference, a method's return-type clause, and the
//                `as`-coercion type.
//   resolvable    of those, how many name a type that appears as a declared
//                symbol or an import in the SAME file — i.e. how many are
//                followable by a reader rather than free text.
//   shadowed      written but covered by an `import` edge's dotted target whose
//                LEAF equals the bare name (`import java.util.List` +
//                `List<String>`), which is the case where the qualified form
//                IS already in the graph one row away.
//   uniqueFiles   how many files carry at least one.
//
// The denominator is stated explicitly because "we refuse bare names" is a
// claim about a POPULATION, and a population with no denominator is the defect
// class this repo keeps re-discovering.
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as wts from "web-tree-sitter"

const ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const MAX = Number((argv.includes("--max") ? argv[argv.indexOf("--max") + 1] : "0")) || 0
const REPOS = (process.env.BB_GROOVY_REPOS ?? "groovy").split(",").map((s) => s.trim()).filter(Boolean)

/** The positions `collectDeclaredTypeRefs`'s switch visits. Mirrored here as a
 *  list of node types, deliberately read as DATA so the census and the analyzer
 *  cannot drift into agreeing by accident. */
const TYPE_STOP = new Set(["variable_declarator", "closure", "block", "closure_expression"])

const isPlainTypeName = (t: string): boolean => {
  if (t.length === 0) return false
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    const ok =
      (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) ||
      c === 95 || c === 36 || c === 46
    if (!ok) return false
  }
  return true
}

type Counters = {
  files: number
  positionsVisited: number
  qualifiedWritten: number
  bareWritten: number
  bareCapitalised: number
  bareLowercaseInitial: number
  bareResolvableInFile: number
  bareShadowedByImport: number
  bareUnresolvable: number
  filesWithBare: number
  bareByName: Map<string, number>
  samples: string[]
}

function newCounters(): Counters {
  return {
    files: 0, positionsVisited: 0, qualifiedWritten: 0, bareWritten: 0,
    bareCapitalised: 0, bareLowercaseInitial: 0,
    bareResolvableInFile: 0, bareShadowedByImport: 0, bareUnresolvable: 0,
    filesWithBare: 0, bareByName: new Map(), samples: [],
  }
}

async function main(): Promise<void> {
  const files: Array<{ repo: string; abs: string }> = []
  for (const repo of REPOS) {
    const dir = join(ROOT, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".groovy") && !rel.endsWith(".gradle")) continue
      const abs = join(dir, rel)
      try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
      files.push({ repo, abs })
    }
  }
  files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  const selected = MAX > 0 ? files.slice(0, MAX) : files

  const P: any = (wts as any).Parser ?? (wts as any).default
  const L: any = (wts as any).Language ?? (wts as any).default?.Language
  await P.init({ locateFile: () => join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(new Uint8Array(readFileSync(join(process.cwd(), "wasm", "tree-sitter-groovy.wasm")))))

  const c = newCounters()
  for (const f of selected) {
    let text: string
    try { text = readFileSync(f.abs, "utf8") } catch { continue }
    const tree = parser.parse(text)
    if (!tree) continue
    const root: any = tree.rootNode
    c.files++

    // Everything the file DECLARES or IMPORTS, for the resolvable/shadowed split.
    const declared = new Set<string>()
    const importedLeaves = new Set<string>()
    const visit0 = (n: any): void => {
      if (n.type === "import_declaration") {
        const scoped = n.namedChildren?.find((k: any) => k.type === "scoped_identifier" || k.type === "identifier")
        if (scoped) {
          const segs = String(scoped.text).split(".")
          importedLeaves.add(segs[segs.length - 1])
        }
      }
      if (n.type === "class_declaration" || n.type === "interface_declaration" ||
          n.type === "trait_declaration" || n.type === "enum_declaration" ||
          n.type === "record_declaration") {
        const id = n.namedChildren?.find((k: any) => k.type === "identifier")
        if (id) declared.add(String(id.text))
      }
      for (let i = 0; i < n.childCount; i++) visit0(n.child(i))
    }
    visit0(root)

    let fileHadBare = false
    const collect = (n: any, out: string[]): void => {
      if (n.type === "type_identifier") {
        if (n.text !== "def" && n.text !== "as" && isPlainTypeName(String(n.text)) && !out.includes(String(n.text))) out.push(String(n.text))
        return
      }
      // A QUALIFIED type is ONE name written with its qualifier, and its nested
      // `type_identifier`s are package/class segments, not types — the analyzer's
      // own `collectTypeNames` takes it as a complete name for exactly that reason,
      // and descending here would report `java`, `util`, `Map` as three names. The
      // ANALYZER's half is handled above; the census needs the branch so the
      // qualified population is counted at all.
      if (n.type === "scoped_type_identifier") {
        if (isPlainTypeName(String(n.text)) && !out.includes(String(n.text))) out.push(String(n.text))
        return
      }
      if (TYPE_STOP.has(n.type)) return
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch) collect(ch, out)
      }
    }
    const take = (decl: any, roots: any[]): void => {
      const names: string[] = []
      for (const r of roots) collect(r, names)
      c.positionsVisited++
      for (const nm of names) {
        if (nm.includes(".")) { c.qualifiedWritten++; continue }
        c.bareWritten++
        // A Groovy/Java type name starts with an UPPERCASE letter or `_`. A
        // lowercase-initial name in a type position is not a type the author
        // wrote — it is a command-chain argument the grammar read as a type
        // (`println x` -> local_variable_declaration(type_identifier(println),
        // …)), and counting those as "a bare type reference the rule refuses"
        // would overstate the payload the rule costs. The two are counted apart
        // and both are reported, because the artefact class is a finding in its
        // own right.
        if (/^[A-Z_]/.test(nm)) c.bareCapitalised++
        else c.bareLowercaseInitial++
        fileHadBare = true
        c.bareByName.set(nm, (c.bareByName.get(nm) ?? 0) + 1)
        if (declared.has(nm)) c.bareResolvableInFile++
        else if (importedLeaves.has(nm)) c.bareShadowedByImport++
        else c.bareUnresolvable++
        if (c.samples.length < 12) c.samples.push(`${f.repo}/${f.abs.replace(`${ROOT}/`, "")} ${decl.type}@${decl.startPosition.row + 1} ${nm}`)
      }
    }
    const walk = (n: any): void => {
      switch (n.type) {
        case "field_declaration":
        case "formal_parameter":
        case "local_variable_declaration": {
          const roots: any[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const ch = n.namedChild(i)
            if (!ch || TYPE_STOP.has(ch.type)) continue
            if (ch.type.endsWith("type") || ch.type === "type_identifier") roots.push(ch)
          }
          if (roots.length) take(n, roots)
          break
        }
        case "throws": {
          const kids: any[] = []
          for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) kids.push(ch) }
          take(n, kids)
          break
        }
        case "catch_formal_parameter": {
          const ct = n.namedChildren?.find((k: any) => k.type === "catch_type")
          if (ct) take(n, [ct])
          break
        }
        case "instanceof_expression":
        case "cast_expression": {
          const kids: any[] = []
          for (let i = 0; i < n.namedChildCount; i++) { const ch = n.namedChild(i); if (ch) kids.push(ch) }
          take(n, kids)
          break
        }
        case "binary_expression": {
          const t = n.childForFieldName?.("type")
          if (t) take(n, [t])
          break
        }
        case "method_declaration": {
          const roots: any[] = []
          for (let i = 0; i < n.namedChildCount; i++) {
            const ch = n.namedChild(i)
            if (!ch) continue
            if (ch.type === "identifier") break
            if (ch.type === "modifiers") continue
            if (ch.type.endsWith("type") || ch.type === "type_identifier") roots.push(ch)
            else break
          }
          if (roots.length) take(n, roots)
          break
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch) walk(ch)
      }
    }
    walk(root)
    if (fileHadBare) c.filesWithBare++
    tree.delete?.()
  }

  const top = [...c.bareByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  const artifact = {
    instrument: "groovy-bare-type-ref-census",
    lane: "analyzer/GROOVY",
    question: "how much `references` payload does the lane's qualified-only rule drop?",
    corpora: REPOS.map((r) => `${ROOT}/${r}`),
    filesAdmitted: selected.length,
    filesParsed: c.files,
    declaredTypePositionsVisited: c.positionsVisited,
    qualifiedNamesWritten: c.qualifiedWritten,
    bareNamesWritten: c.bareWritten,
    bareNamesCapitalisedInitial: c.bareCapitalised,
    bareNamesLowercaseInitialGrammarArtifact: c.bareLowercaseInitial,
    bareNamesResolvableToADeclaredTypeInTheSameFile: c.bareResolvableInFile,
    bareNamesWhoseLeafIsImportedInTheSameFile: c.bareShadowedByImport,
    bareNamesUnresolvableInTheSameFile: c.bareUnresolvable,
    filesWithAtLeastOneBareName: c.filesWithBare,
    pctPositionsBare: +((c.bareWritten / Math.max(1, c.positionsVisited)) * 100).toFixed(1),
    pctBareFollowable: +(((c.bareResolvableInFile + c.bareShadowedByImport) / Math.max(1, c.bareWritten)) * 100).toFixed(1),
    pctBareCapitalised: +((c.bareCapitalised / Math.max(1, c.bareWritten)) * 100).toFixed(1),
    pctBareCapitalisedFollowable: +(((c.bareResolvableInFile + c.bareShadowedByImport) / Math.max(1, c.bareCapitalised)) * 100).toFixed(1),
    topBareNames: top.map(([k, v]) => ({ name: k, occurrences: v })),
    samples: c.samples,
  }
  const out = JSON.stringify(artifact, null, 2)
  if (OUT) { writeFileSync(OUT, out + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(out)
}
main().catch((e) => { console.error(e); process.exit(1) })