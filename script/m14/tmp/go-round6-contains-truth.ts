// go lane — ROUND 6, step 2: a TRUTH derivation for the `contains` surface.
//
// THE HOLE. `contains` is the membership edge: it is how a consumer asks "what
// is inside this type?". Go has exactly two owner relations — a struct's fields
// and an interface's method set, plus a method's receiver — and every one of
// them is derivable from the tree with no inference at all. Yet `contains` is
// NOT in go's compared-label set, so 47,088 `contains` edges across the three
// new corpora could be neither MISSING nor fabrication. A membership graph that
// is never checked is a graph whose answer to "what is in this type" is
// unpinned.
//
// THE RULES, from Go's spec:
//
//   C1 a struct's members are its FIELDS — named fields by their name, and
//      embedded fields by the leaf of the embedded type (spec, Struct types:
//      "The unqualified type name acts as the field name").
//   C2 an interface's members are its METHOD SPECS, plus each embedded
//      interface named as a member leaf (the same rule the analyzer's
//      `extractInterfaceMethods` applies).
//   C3 a method's owner is its RECEIVER's type, with `*` and any type
//      arguments stripped — Go's method set is keyed by the receiver type.
//   C4 a member whose name EQUALS its owner gets no edge. This is the lane's
//      ruled decision GO33: a self-loop in a membership surface is a hazard for
//      every consumer that walks `contains` first, so the guard stays and the
//      member is reachable through its other edges instead.
//   C5 one edge per (owner, member) — membership is a set, not a multiset.
//   C6 a `type_alias` is a type declaration and declares its name, so an
//      alias's fields are members of the ALIAS.
//
// DELIBERATELY A DIFFERENT SHAPE. The analyzer builds membership from the SYMBOL
// table it just emitted (every symbol with an `ownerName`); this derives it from
// the DECLARATION SIDE of the tree, so a field the analyzer fails to publish, or
// publishes with the wrong owner, is visible here as a MISSING row rather than
// silently absent from both sides.
//
// Run: bun script/m14/tmp/go-round6-contains-truth.ts [--repo <name>] [--files N]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"


export interface ContainsTruth {
  label: string
  from: string
  target: string
}

const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** C1: the name an embedded field declares — the leaf of its type. */
const embeddedFieldLeaf = (typeNode: any): string | undefined => {
  let cur: any = typeNode
  for (let guard = 0; guard < 8 && cur; guard++) {
    if (cur.type === "pointer_type" || cur.type === "generic_type") {
      cur = cur.namedChildCount > 0 ? cur.namedChild(0) : undefined
      continue
    }
    break
  }
  if (!cur) return undefined
  if (cur.type !== "type_identifier" && cur.type !== "qualified_type") return undefined
  const raw = String(cur.text ?? "")
  const dot = raw.lastIndexOf(".")
  const leaf = dot !== -1 ? raw.slice(dot + 1) : raw
  return PLAIN_IDENT.test(leaf) ? leaf : undefined
}

export const deriveGoContains = (root: any): ContainsTruth[] => {
  const out: ContainsTruth[] = []
  const emitted = new Set<string>()
  const add = (owner: string, member: string) => {
    if (!owner || !member) return
    if (owner === member) return // C4, ruled as GO33
    const key = `${owner}|${member}`
    if (emitted.has(key)) return // C5
    emitted.add(key)
    out.push({ label: "contains", from: owner, target: member })
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!

    // ---- C1/C6: a struct's fields belong to the enclosing type NAME, and a
    // `type_alias` is a type declaration too.
    if (n.type === "type_spec" || n.type === "type_alias") {
      const owner = n.childForFieldName?.("name")?.text
      const structN = n.namedChildren?.find((c: any) => c.type === "struct_type")
      if (owner && structN) {
        const list = structN.namedChildren?.find((c: any) => c.type === "field_declaration_list")
        for (let i = 0; list && i < list.namedChildCount; i++) {
          const fd = list.namedChild(i)
          if (!fd || fd.type !== "field_declaration") continue
          const names = (fd.namedChildren ?? []).filter(
            (c: any) => c.type === "field_identifier" || c.type === "identifier",
          )
          if (names.length > 0) {
            for (const nm of names) {
              const t = String(nm.text ?? "")
              if (t && t !== "_") add(String(owner), t) // C1: `_` declares nothing
            }
            continue
          }
          // No name: an embedded field, named by its type's leaf.
          const tn = fd.childForFieldName?.("type")
          const leaf = tn ? embeddedFieldLeaf(tn) : undefined
          if (leaf) add(String(owner), leaf)
        }
      }

      // ---- C2: an interface's method set, plus each embedded interface as a
      // member leaf.
      const ifaceN = n.namedChildren?.find((c: any) => c.type === "interface_type")
      if (owner && ifaceN) {
        for (let i = 0; i < ifaceN.namedChildCount; i++) {
          const m = ifaceN.namedChild(i)
          if (!m) continue
          if (m.type === "method_spec") {
            const nm = m.childForFieldName?.("name")?.text
            if (nm) add(String(owner), String(nm))
            continue
          }
          if (m.type === "constraint_elem") {
            // Only a PLAIN type reference embeds (the analyzer's GO2 gate):
            // `~int | ~string` is a union of constraints, not a member.
            const inner = m.namedChildCount > 0 ? m.namedChild(0) : undefined
            if (!inner) continue
            if (inner.type !== "type_identifier" && inner.type !== "qualified_type") continue
            const raw = String(inner.text ?? "")
            const dot = raw.lastIndexOf(".")
            const leaf = dot !== -1 ? raw.slice(dot + 1) : raw
            if (leaf && PLAIN_IDENT.test(leaf)) add(String(owner), leaf)
          }
        }
      }
    }

    // ---- C3: a method's owner is its receiver's type.
    if (n.type === "method_declaration") {
      const nm = n.childForFieldName?.("name")?.text
      // Derive WHEN THE NAME IS PRESENT. The first draft guarded the block with
      // `if (!nm)`, which derived the owner only for the nameless case — an
      // inverted condition that silently dropped EVERY method, and showed up as
      // 461 spurious UNEXPLAINED `contains` rows. Worth recording: the first
      // number the instrument produced was wrong, and the shape of the error
      // (all of them methods) was the only thing that gave it away.
      if (nm) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "parameter_list") {
            const recv = c.namedChildCount > 0 ? c.namedChild(0) : undefined
            const tn = recv?.childForFieldName?.("type")
            let t = tn ? String(tn.text ?? "") : ""
            if (t.startsWith("*")) t = t.slice(1)
            const lt = t.indexOf("[")
            if (lt > 0) t = t.slice(0, lt)
            if (t) add(t, String(nm))
            break
          }
        }
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

// ────────────────────────────────────────────── the measurement
const arg = (n: string): string | undefined => {
  const eq = process.argv.find((a) => a.startsWith(`${n}=`))
  if (eq) return eq.slice(n.length + 1)
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : undefined
}
if (import.meta.main) {
  const REPO = arg("--repo") ?? "<corpus-root>/bb_tests/repositories/go-tools"
  const LIMIT = Number(arg("--files") ?? 0)
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "vendor" || e.name === "node_modules") continue
        walk(path.join(d, e.name))
      } else if (e.isFile() && e.name.endsWith(".go")) files.push(path.join(d, e.name))
    }
  }
  walk(REPO)
  files.sort()
  const read = LIMIT > 0 ? files.slice(0, LIMIT) : files

  const { RealGoAnalyzer } = await import("../../../src/ast/real-go-analyzer")
  const analyzer = new RealGoAnalyzer()
  let truthTotal = 0
  let analyzerTotal = 0
  let matched = 0
  let skips = 0
  const missingByClass = new Map<string, number>()
  const extraByClass = new Map<string, number>()
  const missingSamples: string[] = []
  const extraSamples: string[] = []

  for (const f of read) {
    const src = fs.readFileSync(f, "utf8")
    const rel = path.relative(REPO, f)
    let tree: any
    try {
      const parser = await ASTEngine.getParser("go" as any)
      tree = parser.parse(src)
    } catch {
      skips++
      continue
    }
    if (!tree?.rootNode) continue
    const res: any = await analyzer.analyze(tree.rootNode, src, f)
    const truth = deriveGoContains(tree.rootNode)
    const got = new Set<string>()
    const lineOf = new Map<string, number>()
    for (const r of res.relationships ?? []) {
      if (String(r.type ?? r.relationshipType ?? "") !== "contains") continue
      const k = `${r.source}|${r.target}`
      if (got.has(k)) continue
      got.add(k)
      if (typeof (r as any).line_number === "number") lineOf.set(k, (r as any).line_number)
    }
    analyzerTotal += got.size
    const truthKeys = new Set(truth.map((t) => `${t.from}|${t.target}`))
    for (const t of truth) {
      truthTotal++
      const k = `${t.from}|${t.target}`
      if (got.has(k)) { matched++; continue }
      // classify the member KIND, so a red row is a shape
      const cls = /^[a-z]/.test(t.target) ? "unexported" : "exported"
      missingByClass.set(cls, (missingByClass.get(cls) ?? 0) + 1)
      if (missingSamples.length < 30) missingSamples.push(`${rel} ${t.from}->${t.target} [${cls}]`)
    }
    for (const k of got) {
      if (truthKeys.has(k)) continue
      const [from, target] = k.split("|")
      const cls = `extra|${/^[a-z]/.test(target) ? "unexported" : "exported"}`
      extraByClass.set(cls, (extraByClass.get(cls) ?? 0) + 1)
      if (extraSamples.length < 30) extraSamples.push(`${rel}:${lineOf.get(k) ?? "?"} ${from}->${target}`)
    }
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0)
  const rows = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${String(v).padStart(7)}  ${k}`).join("\n")
  console.log(JSON.stringify({
    repo: REPO,
    filesListed: files.length,
    filesRead: read.length,
    parseSkips: skips,
    truth: truthTotal,
    analyzerContains: analyzerTotal,
    matched,
    MISSING: truthTotal - matched,
    missingPct: pct(truthTotal - matched, truthTotal),
    UNEXPLAINED: analyzerTotal - matched,
    unexplainedPct: pct(analyzerTotal - matched, analyzerTotal),
    coveragePct: pct(matched, truthTotal),
    missingByClass: rows(missingByClass) || "    (none)",
    extraByClass: rows(extraByClass) || "    (none)",
    missingSamples,
    extraSamples,
  }, null, 2))
}
