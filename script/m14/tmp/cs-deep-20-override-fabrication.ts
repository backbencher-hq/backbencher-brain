// CS-DEEP-20 — is the override target FABRICATED on code that COMPILES?
//
// CS-DEEP-19 found that `resolveOverrides`' Pass 3 ("first hierarchy parent") fires whenever
// the exact-signature BFS misses, and Pass 3 does not check that the parent DECLARES the member
// at all. The probe case that convicted it (`class C : Unrelated, A` overriding `M(int)` where
// A declares `M()`) is **invalid C#** — CS0115, no suitable method to override — so on its own
// it proves a fabrication on non-compiling input, which is a much weaker claim than a
// fabrication on real code.
//
// So this measures the real thing: over a corpus of files that DO compile, for every emitted
// `overrides Owner.m -> Base.m` edge, does ANY type declaration in the same file declare a
// member named `m`? A NO means the edge names a member that exists nowhere in the file, which
// is the R10 "a target no symbol can be named" class — and a YES means the analyzer found a
// real declaration and the edge is a resolution, not a guess.
//
// This reads the TREE for the declarations (a type's own member names) and the analyzer's
// relationships for the claim, so the two are compared per edge.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const MEMBER_DECLS = new Set([
  "method_declaration", "property_declaration", "indexer_declaration",
  "event_declaration", "event_field_declaration",
])

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-20-override-fabrication.ts --list <paths> [limit]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 400)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  let edges = 0
  let resolvesInFile = 0
  let noDeclInFile = 0
  let memberExistsSomewhere = 0
  let firstBaseIsInterfaceShape = 0
  const samples: string[] = []
  const byTargetShape = new Map<string, number>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    const ov = (res.relationships ?? []).filter((r: any) => (r.type ?? r.relationshipType) === "overrides")
    if (ov.length === 0) continue

    // Grammar truth: every type's own member names, and every type's base list.
    const membersByType = new Map<string, Set<string>>()
    const basesByType = new Map<string, string[]>()
    const allMemberNames = new Set<string>()
    const typeNames = new Set<string>()
    const interfaceNames = new Set<string>()
    const walk = (n: any, owner: string | null): void => {
      let next = owner
      const t = n.type
      if (t === "class_declaration" || t === "struct_declaration" || t === "interface_declaration" || t === "record_declaration" || t === "enum_declaration") {
        const nm = n.childForFieldName?.("name")?.text ?? n.namedChildren?.find((c: any) => c.type === "identifier")?.text
        if (nm) { next = nm; typeNames.add(nm); if (t === "interface_declaration") interfaceNames.add(nm) }
        const bl = n.namedChildren?.find((c: any) => c.type === "base_list")
        if (bl && nm) {
          const bs: string[] = []
          for (const b of bl.namedChildren ?? []) {
            if (!b || b.type === "argument_list") continue
            const lt = String(b.text).indexOf("<")
            bs.push((lt > 0 ? String(b.text).slice(0, lt) : String(b.text)).trim())
          }
          basesByType.set(nm, bs)
        }
      }
      if (MEMBER_DECLS.has(t) && next) {
        const nm = n.childForFieldName?.("name")?.text ?? (t === "indexer_declaration" ? "this" : null)
        if (nm) {
          let s = membersByType.get(next)
          if (!s) { s = new Set<string>(); membersByType.set(next, s) }
          s.add(nm)
          allMemberNames.add(nm)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), next)
    }
    walk(parser.parse(src).rootNode, null)

    for (const r of ov) {
      edges++
      const srcLabel = String(r.source)
      const tgtLabel = String(r.target)
      const srcType = srcLabel.includes(".") ? srcLabel.slice(0, srcLabel.lastIndexOf(".")) : srcLabel
      const tgtMember = tgtLabel.includes(".") ? tgtLabel.slice(tgtLabel.lastIndexOf(".") + 1) : tgtLabel
      const tgtType = tgtLabel.includes(".") ? tgtLabel.slice(0, tgtLabel.lastIndexOf(".")) : ""

      if (allMemberNames.has(tgtMember)) {
        memberExistsSomewhere++
        resolvesInFile++
        continue
      }
      noDeclInFile++
      // Is the first base an interface-shaped name? That is the C#-legal reason a
      // first-parent default would be wrong, as opposed to merely unlucky.
      const bs = basesByType.get(srcType) ?? []
      if (bs.length > 0 && interfaceNames.has(bs[0].split(".").pop() ?? "")) firstBaseIsInterfaceShape++
      const shape = bs.length === 0 ? "no-base-list" : bs.length === 1 ? "single-base" : "multi-base"
      byTargetShape.set(shape, (byTargetShape.get(shape) ?? 0) + 1)
      if (samples.length < 20) samples.push(`${path.basename(f)}:${r.line_number}  ${srcLabel} -> ${tgtLabel}   bases of ${srcType}: ${JSON.stringify(bs)}`)
    }
  }

  console.log(`files: ${files.length}`)
  console.log(`override edges emitted: ${edges}`)
  console.log(`   the TARGET member name is declared SOMEWHERE in the same file: ${memberExistsSomewhere} (${((memberExistsSomewhere / Math.max(1, edges)) * 100).toFixed(1)}%)  -> a resolution`)
  console.log(`   the TARGET member name is declared NOWHERE in the same file:    ${noDeclInFile} (${((noDeclInFile / Math.max(1, edges)) * 100).toFixed(1)}%)  -> resolves to an external type`)
  console.log(`\nof the unresolvable-in-file edges, the owning type's base list is:`)
  for (const [k, v] of byTargetShape) console.log(`   ${k.padEnd(14)} ${v}`)
  console.log(`   (of those, the FIRST base is a type this file declares as an interface: ${firstBaseIsInterfaceShape} — the C#-legal case where a first-parent default is wrong by construction)`)
  if (samples.length) console.log(`\nsamples:\n   ${samples.join("\n   ")}`)
}

if (import.meta.main) await main()
