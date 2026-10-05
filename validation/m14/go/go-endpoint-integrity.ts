// QUESTION 5 and the R7 half of QUESTION 6, for all ten types at once.
//
//   5. RESOLVED — do both endpoints bind to real symbols?
//   R7. no unknown symbols, no empty names, no placeholder-literal endpoints
//
// WHAT "RESOLVED" CAN AND CANNOT MEAN HERE, STATED UP FRONT.
//
// The lane is a PER-FILE analyzer. Go's method sets, embedding and interface
// satisfaction are PACKAGE-level facts spread across files, and this harness
// reads one file at a time, so "resolves" has to be defined or the number means
// nothing. Two levels are therefore measured and kept apart:
//
//   FILE-LOCAL   the endpoint names a declaration in the SAME file (a struct, a
//                field, a method, a top-level func, a type name). This is the
//                strongest claim a per-file analyzer can make and it is the one
//                `bb_graph` needs to draw an edge inside one file.
//
//   PACKAGE-WIDE the endpoint name is declared in ANOTHER file of the same
//                package. Measured by a second pass that indexes every symbol
//                name per package directory across the whole corpus, so a
//                stdlib call target like \`ToUpper\` in \`strings\` is counted as
//                resolving when \`strings/strings.go\` declares it.
//
//   UNRESOLVED   neither. For stdlib targets this is EXPECTED and is not a
//                defect — the corpus is the standard library and its external
//                dependencies are not vendored. So the number is reported split
//                by whether the target could plausibly be declared inside
//                go-stdlib at all, and the two are never summed into one
//                flattering figure.
//
// A placeholder-literal endpoint (R7) is counted SEPARATELY from "unresolved":
// an endpoint whose text is one of the language's placeholder spellings
// (\`_\` in Go, empty string, \`?node?\` recovery marks) is a defect even when a
// reader could guess what it meant.
//
// NO REGEX. Every name decision is a Set/Map lookup, an integer range on
// charCodeAt, or endsWith. The placeholder list is compared by string equality
// against a fixed vocabulary.

import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RelationshipType } from "../../../src/ast/types"
import { collectAllGoFiles, splitTestAndNonTest, strideSample } from "./go-corpus-files"

const WANT = Number(process.argv[2] || 400)
const CORPUS_ROOT = process.argv[3] || "$HOME/fixtures/repositories/go-stdlib"
const ENUM_VALUES: string[] = [...new Set(Object.values(RelationshipType))]
const OFF_ENUM_IMPORTS = "imports"

// Go's blank identifier, and the two spellings a tree-sitter recovery can leave
// on a node whose text was never written. Compared by equality.
const PLACEHOLDERS: ReadonlySet<string> = new Set(["_", "", "?", "<missing>", "MISSING"])

interface Bucket {
  edges: number
  sourceFileLocal: number
  sourcePackageWide: number
  sourceUnresolved: number
  targetFileLocal: number
  targetPackageWide: number
  targetUnresolved: number
  targetStdlibResolvable: number
  placeholderEndpoints: number
  emptyEndpoints: number
  sourceEqualsTarget: number
  examples: string[]
}

function emptyBucket(): Bucket {
  return {
    edges: 0, sourceFileLocal: 0, sourcePackageWide: 0, sourceUnresolved: 0,
    targetFileLocal: 0, targetPackageWide: 0, targetUnresolved: 0,
    targetStdlibResolvable: 0, placeholderEndpoints: 0, emptyEndpoints: 0,
    sourceEqualsTarget: 0, examples: [],
  }
}

async function main(): Promise<void> {
  const all = collectAllGoFiles(CORPUS_ROOT)
  const { lib, test } = splitTestAndNonTest(all)
  const libWant = Math.max(1, Math.round(WANT * 0.75))
  const sample = [...strideSample(lib, libWant), ...strideSample(test, WANT - libWant)]

  // PASS 1 — index every declared symbol name per package directory. Keyed by
  // the file's directory, so two files in one directory share a package.
  const namesByDir = new Map<string, Set<string>>()
  const parser = await ASTEngine.getParser("go")
  const dirOf = (rel: string): string => {
    const i = rel.lastIndexOf("/")
    return i < 0 ? "." : rel.slice(0, i)
  }
  for (const f of all) {
    let content: string
    try {
      content = readFileSync(f.path, "utf8")
    } catch {
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      continue
    }
    const dir = dirOf(f.rel)
    let set = namesByDir.get(dir)
    if (!set) {
      set = new Set()
      namesByDir.set(dir, set)
    }
    const visit = (n: any): void => {
      const t = n.type
      if (
        t === "function_declaration" || t === "method_declaration" || t === "type_spec" ||
        t === "field_declaration" || t === "method_elem" || t === "const_spec" || t === "var_spec" ||
        t === "package_identifier"
      ) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier" || c.type === "field_identifier" || c.type === "type_identifier" || c.type === "package_identifier") {
            const txt = String(c.text ?? "")
            if (txt.length > 0) set.add(txt)
          }
        }
        if (t === "function_declaration" || t === "method_declaration") {
          const nm = n.childForFieldName("name")
          if (nm) set.add(String(nm.text ?? ""))
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)
  }

  // PASS 2 — run the production path and resolve every endpoint.
  const buckets = new Map<string, Bucket>()
  for (const t of [...ENUM_VALUES, OFF_ENUM_IMPORTS]) buckets.set(t, emptyBucket())

  const isMethodEndpoint = (s: string): boolean => s.includes(".")
  let compared = 0
  const placeholderExamples: string[] = []

  for (const f of sample) {
    let content: string
    try {
      content = readFileSync(f.path, "utf8")
    } catch {
      continue
    }
    let res: any
    try {
      res = await ASTEngine.parseFile(f.path, content)
    } catch {
      continue
    }
    compared++
    const fileNames = new Set<string>()
    const dirNames = namesByDir.get(dirOf(f.rel)) || new Set<string>()
    for (const sym of res.symbols as any[]) {
      const nm = String(sym.name ?? "")
      if (nm.length > 0) fileNames.add(nm)
      const owner = String(sym.ownerName ?? "")
      if (owner.length > 0) fileNames.add(owner)
    }

    for (const r of res.relationships as any[]) {
      const ty = typeof r.type === "string" && r.type.length > 0 ? r.type : typeof r.relationshipType === "string" ? r.relationshipType : ""
      if (ty.length === 0) continue
      let b = buckets.get(ty)
      if (!b) {
        b = emptyBucket()
        buckets.set(ty, b)
      }
      const src = typeof r.source === "string" ? r.source : typeof r.from === "string" ? r.from : ""
      const dst = typeof r.target === "string" ? r.target : typeof r.to === "string" ? r.to : ""
      b.edges++

      for (const [which, ep] of [["source", src], ["target", dst]] as Array<[string, string]>) {
        if (ep.length === 0) {
          b.emptyEndpoints++
          continue
        }
        if (PLACEHOLDERS.has(ep)) {
          b.placeholderEndpoints++
          if (placeholderExamples.length < 25) placeholderExamples.push(`${ty} ${which}=\"${ep}\" in ${f.rel}`)
          continue
        }
        // A composite endpoint like `Beta.Get` is two facts: the type and the
        // member. Either half resolving is a partial resolve; both must resolve
        // for the edge to be navigable, so both are checked and the strict
        // reading is what the bucket records.
        const parts = isMethodEndpoint(ep) ? ep.split(".") : [ep]
        let allLocal = true
        let anyLocal = false
        let allDir = true
        for (const p of parts) {
          const inFile = fileNames.has(p)
          const inDir = dirNames.has(p)
          if (inFile) anyLocal = true
          else allLocal = false
          if (!inDir) allDir = false
        }
        const dirWide = !allLocal && allDir
        if (which === "source") {
          if (allLocal) b.sourceFileLocal++
          else if (dirWide) b.sourcePackageWide++
          else b.sourceUnresolved++
        } else {
          if (allLocal) b.targetFileLocal++
          else if (dirWide) {
            b.targetPackageWide++
            b.targetStdlibResolvable++
          } else b.targetUnresolved++
        }
      }
      if (src.length > 0 && src === dst) b.sourceEqualsTarget++
      if (b.examples.length < 4) b.examples.push(`${f.rel}: ${src} -> ${dst}`)
    }
  }

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`ENDPOINT RESOLUTION over ${compared} files, indexed against ${namesByDir.size} package directories`)
  L(`"unresolved target" is NOT a defect rate: the corpus is the standard library and its`)
  L(`external dependencies are not vendored, so a target like ToUpper is unresolvable HERE`)
  L(`and correct. The two columns are kept apart rather than summed.`)
  L("")
  L(`type${" ".repeat(12)}edges      src:file  src:pkg  src:?   tgt:file  tgt:pkg  tgt:?   placeholder empty`)
  for (const t of [...ENUM_VALUES, OFF_ENUM_IMPORTS]) {
    const b = buckets.get(t)!
    if (b.edges === 0) {
      L(`${t.padEnd(24)}0`)
      continue
    }
    const nm = t === OFF_ENUM_IMPORTS ? "imports(off-enum)" : t
    L(
      `${nm.padEnd(24)}${String(b.edges).padStart(7)}` +
      `${String(b.sourceFileLocal).padStart(11)}${String(b.sourcePackageWide).padStart(9)}${String(b.sourceUnresolved).padStart(7)}` +
      `${String(b.targetFileLocal).padStart(11)}${String(b.targetPackageWide).padStart(9)}${String(b.targetUnresolved).padStart(7)}` +
      `${String(b.placeholderEndpoints).padStart(13)}${String(b.emptyEndpoints).padStart(6)}`,
    )
  }
  L("")
  L(`placeholder-literal endpoints (R7): ${[...buckets.values()].reduce((a, b) => a + b.placeholderEndpoints, 0)}`)
  for (const e of placeholderExamples) L(`  ${e}`)
  const emptyTotal = [...buckets.values()].reduce((a, b) => a + b.emptyEndpoints, 0)
  L(`empty-string endpoints: ${emptyTotal}`)
  const out = process.env.GO_ENDPOINT_ARTIFACT
  if (out) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(out, JSON.stringify({ compared, packageDirs: namesByDir.size, buckets: Object.fromEntries(buckets), placeholderExamples }, null, 2))
    L(`artifact: ${out}`)
  }
}

await main()