// CS-DEEP-28 — CONTROL for cs-deep-27. The bare-uses reconcile reported 742 TRUTH-only rows
// against 16 ANALYZER-only, and a 2.4x gap that size is a statement about one of the two sides,
// not about the code. Before believing 742 defects, find out WHICH side is wrong.
//
// The method: take specific rows from the reconcile, and for each one print the evidence that
// decides it --
//   * the identifier's own source text and line, so the read can be read by a human;
//   * the symbol-table entry the truth's inventory was built from (name, kind, owner), which is
//     the question "is this actually a Property-kind member of an enclosing class?"
//   * the lexical class chain at that site, so "why did resolution walk this far" is visible.
//
// Why this exists: the first TRUTH-only shape is `EnforceOnBuildValues -> AddBraces`, where
// `AddBraces` is a `public const DiagnosticDescriptor`. A const is a FIELD in C#, and the
// analyzer's rule resolves bare identifiers against PROPERTY-kind members only -- fields reach
// the graph through the field-access path, which needs a receiver. So either the truth's
// inventory is over-broad, or the analyzer is publishing a `const` as `property`. One of those
// is a defect and the other is a bug in an instrument written twenty minutes ago, and they look
// identical in a count.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

/** Walk to a named identifier occurrence and report the enclosing class chain + the inventory. */
function inspect(root: any, name: string, inventory: Map<string, Set<string>>, sources: Map<string, number>, limit: number) {
  const found: string[] = []
  const leafOf = (s: string): string => {
    const segs: string[] = []
    for (const a of s.split("::")) for (const b of a.split(".")) if (b) segs.push(b)
    return segs[segs.length - 1] ?? s
  }
  const stack: any[] = [root]
  const chain: string[] = []
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "class_declaration" || n.type === "struct_declaration" || n.type === "record_declaration" || n.type === "interface_declaration") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) chain.push(nm)
    }
    if (n.type === "identifier" && n.text === name && found.length < limit) {
      const line = (sources.get(n.text) ?? 0)
      // the inventory keys that would let this read resolve
      const owners: string[] = []
      for (let i = chain.length - 1; i >= 0; i--) {
        const c = chain[i]
        if (inventory.get(c)?.has(name) || inventory.get(leafOf(c))?.has(name)) owners.push(c)
      }
      const p = n.parent
      found.push([
        `      line ${line}  \`${name}\``,
        `        parent node:      ${p?.type}${p?.childForFieldName?.("name") ? " (is its name field)" : ""}`,
        `        enclosing chain:  ${chain.length > 0 ? chain.join(" > ") : "(none)"}`,
        `        inventory match:  ${owners.length > 0 ? `YES via ${owners.join(", ")}` : "no enclosing class holds it as a property"}`,
        `        source text:      ${(sources.get("__src__") ?? "").split("\n")[line - 1]?.trim().slice(0, 120) ?? "?"}`,
      ].join("\n"))
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return found
}

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: cs-deep-28-bare-uses-control.ts --list <paths> [--limit N] [--name X]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 60)
  const wantName = arg("--name") ?? "AddBraces"
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  // Rebuild the SAME inventory the truth builds, but keep the raw symbol rows that fed it, so a
  // kind disagreement is visible instead of inferred.
  const kindCounts = new Map<string, number>()
  const sampleSymbols: string[] = []
  const declShapes = new Map<string, number>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const base = path.basename(f)
    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    for (const s of res.symbols ?? []) {
      const k = String(s.kind ?? "?")
      kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1)
    }
    for (const s of res.symbols ?? []) {
      if (String(s.kind) === "property" && s.name === wantName && sampleSymbols.length < 8) {
        sampleSymbols.push(`      ${base}: name=${s.name} kind=${s.kind} owner=${s.ownerName}  (from \`${(s.line ? `${s.line}` : "?")}\`)`)
      }
    }
    // What declaration KIND does a const / readonly / static field actually get published as?
    if (/EnforceOnBuildValues/.test(base) || /BuiltInCodeStyle/.test(base)) {
      const root = parser.parse(src).rootNode
      const stack: any[] = [root]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "field_declaration") {
          const mods: string[] = []
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed) mods.push(c.type) }
          const decls = (n.namedChildren ?? []).filter((c: any) => c.type === "variable_declarator").map((c: any) => c.childForFieldName?.("name")?.text ?? "?")
          for (const d of decls) {
            const key = `${mods.includes("const") ? "const" : mods.includes("readonly") ? "readonly" : "plain"} -> ${d}`
            declShapes.set(key, (declShapes.get(key) ?? 0) + 1)
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
      }
    }
  }

  console.log(`symbol kinds in the sample (${files.length} files):`)
  for (const [k, v] of [...kindCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(14)} ${v}`)
  console.log(`\nsymbols published as kind=property named \`${wantName}\` (${sampleSymbols.length}):`)
  for (const s of sampleSymbols) console.log(s)
  console.log(`\nfield declarations by modifier -> declarator (in the two diagnostic files):`)
  for (const [k, v] of [...declShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${k.padEnd(46)} ${v}`)

  // The decisive question, asked of the tree for one name: is the const published as a property?
  const probe = files.find((f) => /EnforceOnBuildValues/.test(path.basename(f)))
  if (probe) {
    const src = fs.readFileSync(probe, "utf8")
    const res: any = await ASTEngine.parseFile(probe, src)
    const rows = (res.symbols ?? []).filter((s: any) => /^(AddBraces|UseImplicitType|Ordering)$/.test(String(s.name)))
    console.log(`\nTHE DECISIVE ROWS from ${path.basename(probe)}:`)
    for (const s of rows) console.log(`   name=${s.name}  kind=${s.kind}  owner=${s.ownerName}  line=${s.line ?? "?"}`)
    console.log(`\n   C# says \`public const DiagnosticDescriptor AddBraces\` is a FIELD. If these rows`)
    console.log(`   say kind=property, the ANALYZER is what widened -- and then it should have emitted`)
    console.log(`   the bare reads too, so the reconcile would not flag them. If they say kind=field,`)
    console.log(`   then the TRUTH's inventory over-matched, and 742 TRUTH-only rows are one bug,`)
    console.log(`   not 742 findings.`)
  }
}

if (import.meta.main) await main()
