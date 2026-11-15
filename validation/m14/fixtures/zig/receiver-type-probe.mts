/**
 * RECEIVER-TYPE PROBE — is the receiver's declared type recoverable, and would
 * qualifying a `zig_field_access` target with it resolve?
 *
 * ## What it asks
 *
 * `uses` carries 7,108 B2 (`scope-not-modelled`) ambiguous edges of the lane's
 * 14,843 — the largest bucket this lane controls. Every `zig_field_access` edge
 * publishes the BARE LEAF (`p.x` -> `x`), so a field named `len` competes with
 * every other declaration named `len` in the window. The disambiguating
 * coordinate for a field read is the TYPE OF THE RECEIVER, and Zig spells that
 * in the parse tree at the parameter/container-field/variable-declaration site.
 *
 * So the question is measurable and falsifiable: **for how many corpus field
 * accesses is the receiver's declared type both (a) syntactically present as a
 * single unambiguous path, and (b) a name that is published in the same file?**
 *
 * If the answer is large, B2 -> B1 is a real fix. If it is small, the honest
 * report is "not repairable here" and this file is what says so.
 *
 * ## Independence
 *
 * This walks the PARSE TREE with its own recursion. It does not call the
 * analyzer's edge builder, so it cannot inherit the analyzer's idea of what a
 * target is. It reads the receiver type the way the grammar spells it and asks
 * the STORE whether that spelling resolves — a question the analyzer does not
 * answer.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/receiver-type-probe.mts [maxFiles]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/zig"
const MAX = Number(process.argv[2] ?? 200)

await Parser.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const language: any = await Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-zig.wasm`))
const parser = new Parser()
parser.setLanguage(language)

/** Corpus-relative `.zig` paths, stride-sampled to MAX. Mirrors the gate's rule. */
function draw(n: number): string[] {
  const all: string[] = []
  for (const repo of ["zig", "ghostty", "mold", "eastwood", "duckdb", "oven"]) {
    const dir = `${CR}/${repo}`
    let stack = [dir]
    while (stack.length) {
      const d = stack.pop()!
      let ents: string[]
      try { ents = readdirSync(d) } catch { continue }
      for (const e of ents) {
        const p = `${d}/${e}`
        let st
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) { if (e !== ".git") stack.push(p) }
        else if (e.endsWith(".zig")) all.push(p.slice(CR.length + 1))
      }
    }
  }
  all.sort()
  const stride = Math.max(1, Math.floor(all.length / n))
  const out: string[] = []
  for (let i = 0; out.length < n && i < all.length; i += stride) out.push(all[i])
  return out
}

const files = draw(MAX)
const filesAbs = files.map((f) => `${CR}/${f}`)

// Published type names per file, taken from the PRODUCTION parse, not the tree walk.
const published = new Map<string, Set<string>>() // file -> set of bare published names
const qnByFile = new Map<string, Set<string>>() // file -> set of published qualifiedNames
const fieldsByFile = new Map<string, Map<string, Set<string>>>() // file -> member -> owners

const rows: any[] = []
let totalUses = 0, receiverPresent = 0, singlePath = 0, typePublishedHere = 0, bothResolved = 0
const ownerCollisions = new Map<string, number>()

for (let i = 0; i < filesAbs.length; i++) {
  const f = filesAbs[i]
  const r: any = await parseFile(f, "zig")
  const syms: any[] = r?.symbols ?? []
  const names = new Set<string>()
  const qns = new Set<string>()
  for (const s of syms) { if (s.name) names.add(s.name); if (s.qualifiedName) qns.add(s.qualifiedName) }
  published.set(f, names)
  qnByFile.set(f, qns)

  // ---- independent tree walk for the RECEIVER type and the OWNER of the member ----
  const tree = parser.parse(readFileSync(f, "utf8"))
  if (!tree) continue
  const root = tree.rootNode
  // bind: a bare identifier as written -> the single path spelling its declared type
  const bind = new Map<string, string>()
  const memberOwner = new Map<string, Set<string>>()
  const walk = (n: any) => {
    // A declaration with a type annotation binds the name to that type's path.
    if (n.type === "variable_declaration" || n.type === "container_field" || n.type === "parameter") {
      const nameNode = n.namedChild(0)
      const typeNode = n.namedChild(1)
      if (nameNode && typeNode && nameNode.type === "identifier") {
        const nm = String(nameNode.text)
        if (typeNode.type === "identifier") bind.set(nm, String(typeNode.text))
        else if (typeNode.type === "field_expression") {
          const segs: string[] = []
          let cur = typeNode, ok = true, h = 0
          while (cur && h++ < 32) {
            const last = cur.namedChild(cur.namedChildCount - 1)
            if (!last || last.type !== "identifier") { ok = false; break }
            segs.push(String(last.text))
            const b = cur.namedChild(0)
            if (!b) { ok = false; break }
            if (b.type === "identifier") { segs.push(String(b.text)); break }
            if (b.type !== "field_expression") { ok = false; break }
            cur = b
          }
          if (ok) bind.set(nm, segs.reverse().join("."))
        }
      }
      // a container_field also tells us who owns the member
      if (n.type === "container_field" && nameNode && nameNode.type === "identifier") {
        const owner = ownerOfContainer(n.parent)
        if (owner) {
          const k = String(nameNode.text)
          if (!memberOwner.has(k)) memberOwner.set(k, new Set())
          memberOwner.get(k)!.add(owner)
        }
      }
    }
    for (let c = 0; c < n.childCount; c++) walk(n.child(c))
  }
  const ownerOfContainer = (c: any): string | null => {
    if (!c) return null
    if (c.type === "variable_declaration") {
      const d = c.namedChild(0)
      return d && d.type === "identifier" ? String(d.text) : null
    }
    if (c.type === "container_declaration" || c.type === "container_field") {
      let p = c.parent
      let h = 0
      while (p && h++ < 4) {
        if (p.type === "variable_declaration") {
          const d = p.namedChild(0)
          if (d && d.type === "identifier") return String(d.text)
        }
        p = p.parent
      }
    }
    return null
  }
  walk(root)
  fieldsByFile.set(f, memberOwner)

  // ---- now walk field accesses and ask the question ----
  const scan = (n: any) => {
    if (n.type === "field_expression" && n.namedChildCount >= 2) {
      const leaf = n.namedChild(n.namedChildCount - 1)
      const base = n.namedChild(0)
      if (leaf && leaf.type === "identifier" && base && base.type === "identifier") {
        const leafName = String(leaf.text)
        const recv = String(base.text)
        totalUses++
        const decl = bind.get(recv)
        if (decl !== undefined) {
          receiverPresent++
          const single = decl.includes(".") ? decl : decl // both are "single path" by construction
          singlePath++
          const bare = single.split(".").pop()!
          const typeHere = published.get(f)!.has(bare)
          if (typeHere) typePublishedHere++
          // would `Type.member` bind to a published qualifiedName in THIS file?
          const cand = `${single}.${leafName}`
          const binds = qnByFile.get(f)!.has(cand)
          if (binds) bothResolved++
          rows.push({ file: files[i], recv, type: single, member: leafName, cand, typeHere, binds })
        }
      }
    }
    for (let c = 0; c < n.childCount; c++) scan(n.child(c))
  }
  scan(root)
  if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${filesAbs.length}\n`)
}

// member-owner collision census: how many member names are owned by >1 container IN ONE FILE
let coll = 0, collNames = 0
for (const [, m] of fieldsByFile) {
  for (const [, owners] of m) { if (owners.size > 1) { coll++; collNames++ } }
}

const out = {
  tool: "zig-receiver-type-probe",
  corpusAdmitted: 3834,
  files: filesAbs.length,
  strideSample: true,
  fieldAccessesWithBareReceiver: totalUses,
  receiverHasDeclaredType: receiverPresent,
  receiverHasSinglePathType: singlePath,
  receiverTypePublishedInSameFile: typePublishedHere,
  qualifiedTargetWouldBindInSameFile: bothResolved,
  rate_of_bare_receiver_with_binding_type: totalUses ? receiverPresent / totalUses : 0,
  rate_binding_to_a_published_qualified_name: totalUses ? bothResolved / totalUses : 0,
  memberNamesOwnedByMoreThanOneContainerInOneFile: collNames,
  memberNameSlotsColliding: coll,
  sample: rows.slice(0, 60),
}
writeFileSync("validation/m14/fixtures/zig/measurements/receiver-type-probe.json", JSON.stringify(out, null, 2))
console.log(JSON.stringify({ ...out, sample: out.sample.slice(0, 12) }, null, 2))
