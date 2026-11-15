/**
 * CUSTOM OPTION REFERENCES — do they resolve?
 *
 * WHY THIS IS A QUESTION AND NOT A FEATURE. A custom option's name is
 * parenthesised, and that parenthesis makes it a reference to an extension type:
 * `option (gogoproto.marshaler_all) = true;` names `gogoproto.marshaler_all`, which
 * is a declaration like any other. So the obvious next edge is a `uses` from the
 * option's owner onto that type.
 *
 * The probe answers whether such an edge would bind. It rebuilds the file's symbol
 * id set, resolves each parenthesised option name with protobuf's own rule (a
 * leading dot is absolute, otherwise innermost scope outward), and counts hits.
 *
 * MEASURED on 627 corpus files: 1,129 custom option sites, and **0 of them
 * resolve to a symbol declared in the same file (0.00%)** — 0 of the 1,028
 * declaration-scoped ones either. Every one names an extension declared in an
 * IMPORTED option-definition file (`gogoproto.*` from gogo.proto, `dart_options.*`
 * from dart_options.proto).
 *
 * So the edges are not emitted, and the reason is written down rather than
 * assumed: 1,129 edges at a 0% resolution rate, every endpoint dangling, is the
 * fabrication the workstream calls its most expensive mistake. Doing this
 * properly needs a cross-file project index over imported protos, which this lane
 * does not build. The 10 group-type declarations are counted alongside only so the
 * id set this probe builds can be sanity-checked against a known quantity.
 *
 * Usage: tsx _customopt.mts
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const files: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  const walk = (d: string): void => {
    let kids: string[]; try { kids = readdirSync(d) } catch { return }
    for (const k of kids) { if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k); let st; try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) walk(abs); else if (k.endsWith(".proto")) files.push(abs) }
  }
  walk(dir)
}
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const { RealProtobufAnalyzer } = await import("../../../../../src/ast/real-protobuf-analyzer")
const analyzer = new RealProtobufAnalyzer()
let idx = 0
let n = 0, declScoped = 0, resolveHit = 0, resolveHitDecl = 0
const scopeHit = new Map<string, number>()
const ex: string[] = []
const extDeclIds = new Set<string>()
let extDeclCount = 0
async function worker(): Promise<void> {
  const parser = new P(); parser.setLanguage(g)
  while (true) {
    const i = idx++; if (i >= files.length) return
    const abs = files[i]; const label = abs.slice(CR.length + 1)
    const content = readFileSync(abs, "utf8")
    const tree = parser.parse(content)
    const a: any = analyzer.analyze(tree.rootNode, content, abs)
    const ids = new Map<string, string>()
    for (const s of a.symbols ?? []) ids.set(String(s.metadata?.id ?? s.name), String(s.kind))
    // pkg
    let pkg = ""
    for (const s of a.symbols ?? []) if (s.kind === "namespace") pkg = s.name
    // extensions: which ids belong to an extension block (viaExtension on a member)
    const viaExt = new Set<string>()
    for (const s of a.symbols ?? []) if ((s.metadata ?? {}).viaExtension === true) viaExt.add(String(s.metadata?.id ?? s.name))
    // owner chain for a symbol id
    const ownerOf = new Map<string, string | undefined>()
    for (const s of a.symbols ?? []) ownerOf.set(String(s.metadata?.id ?? s.name), s.ownerName)
    const resolve = (text: string, scope: string | null): string | null => {
      if (text.startsWith(".")) return ids.has(text.slice(1)) ? text.slice(1) : null
      const chain: (string | null)[] = []
      if (scope) { const segs = scope.split("."); for (let k = segs.length; k > 0; k--) { const c = segs.slice(0, k).join("."); if (!pkg || c === pkg || c.startsWith(pkg + ".")) chain.push(c) } }
      if (pkg) chain.push(pkg)
      chain.push(null)
      for (const base of chain) { const c = base ? `${base}.${text}` : text; if (ids.has(c)) return c }
      return null
    }
    const ownerOfNode = (node: any): string | null => {
      let p = node.parent
      while (p) {
        if (p.type === "message") { const nm = p.namedChildren.find((c: any) => c.type === "message_name"); if (nm) return pkg ? `${pkg}.${nm.text}` : nm.text }
        if (p.type === "service") { const nm = p.namedChildren.find((c: any) => c.type === "service_name"); if (nm) return pkg ? `${pkg}.${nm.text}` : nm.text }
        if (p.type === "enum") { const nm = p.namedChildren.find((c: any) => c.type === "enum_name"); if (nm) return pkg ? `${pkg}.${nm.text}` : nm.text }
        if (p.type === "rpc") { const nm = p.namedChildren.find((c: any) => c.type === "rpc_name"); const svc = ownerOfNode(p); if (nm) return svc ? `${svc}.${nm.text}` : nm.text }
        if (p.type === "source_file") return null
        p = p.parent
      }
      return null
    }
    const v = (node: any): void => {
      if (node.isNamed && node.type === "option") {
        const kids = node.children.filter((c: any) => c && !c.isNamed)
        const fp = kids.findIndex((c: any) => c.text === "(")
        const fd = kids.findIndex((c: any) => c.text === ".")
        const custom = fp >= 0 && (fd < 0 || fp < fd)
        if (custom) {
          const fi = node.namedChildren.find((c: any) => c.type === "full_ident")
          const name = fi?.text ?? ""
          const scope = ownerOfNode(node)
          const isFile = node.parent?.type === "source_file"
          if (!isFile) declScoped++
          n++
          const hit = resolve(name, scope)
          scopeHit.set(node.parent?.type ?? "?", (scopeHit.get(node.parent?.type ?? "?") ?? 0) + 1)
          if (hit) { resolveHit++; if (!isFile) resolveHitDecl++ }
          else if (ex.length < 10) ex.push(`${label}:${node.startPosition.row + 1} [in ${node.parent?.type}] (${name}) scope=${scope}`)
        }
      }
      for (let c = 0; c < node.childCount; c++) v(node.child(c))
    }
    v(tree.rootNode)
    for (const s of a.symbols ?? []) { const id = String(s.metadata?.id ?? s.name); if ((s.metadata ?? {}).isGroupType) extDeclCount++; void id }
    tree.delete?.()
  }
}
await Promise.all(Array.from({length: 8}, () => worker()))
console.log(`custom option sites: ${n}  (declaration-scoped ${declScoped}, file-scoped ${n - declScoped})`)
console.log(`resolve to a symbol declared in the SAME file: ${resolveHit}  = ${(100 * resolveHit / n).toFixed(2)}%`)
console.log(`  of the declaration-scoped ones: ${resolveHitDecl}/${declScoped} = ${(100 * resolveHitDecl / declScoped).toFixed(2)}%`)
console.log(`by parent node: ${JSON.stringify(Object.fromEntries(scopeHit))}`)
console.log(`group type declarations (for reference): ${extDeclCount}`)
console.log(`unresolved examples:`)
for (const s of ex) console.log("   ", s)
