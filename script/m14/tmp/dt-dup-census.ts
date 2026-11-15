// script/m14/tmp/dt-dup-census.ts — how often does the #753 shape occur at all?
//
// #753's ruling question is "who wins when ONE scope declares the same member
// twice". Before choosing last-wins (py #748) over dart's current first-wins,
// measure whether the pinned corpora contain the shape AT ALL: a ruling that
// moves no corpus payload is pinned by fixture + mutant, and a ruling that
// moves one needs the oracle mirrored. Parse-only (no analyzer), so it is
// independent of the fix it informs.
//
// Arg: per-repo file cap (0 = full extent). Reads only; writes nothing.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPOS = ["proxicall", "dart-http"].map((r) => path.join("/home/ishaq2321/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|dist|\.dart_tool)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out
}

const SIGS = new Set([
  "function_signature", "method_signature", "getter_signature", "setter_signature",
  "constructor_signature", "factory_constructor_signature", "constant_constructor_signature",
  "redirecting_factory_constructor_signature", "operator_signature",
])

async function main() {
  const cap = Number(process.argv[2] ?? 0)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))

  let files = 0
  let memberDups = 0
  let programDups = 0
  let accessorPairs = 0
  let ctorDups = 0
  const samples: string[] = []
  const findings: string[] = []

  for (const repo of REPOS) {
    const list = filesUnder(repo).sort()
    const use = cap > 0 ? list.slice(0, cap) : list
    for (const f of use) {
      files++
      const content = fs.readFileSync(f, "utf8")
      const p = new P()
      p.setLanguage(LANG)
      const root = p.parse(content).rootNode
      const perScope = new Map<string, Map<string, string[]>>() // scope -> name -> kinds[]
      const stack: Array<{ n: any; container: string }> = [{ n: root, container: "__program__" }]
      while (stack.length > 0) {
        const { n, container } = stack.pop()!
        let nextContainer = container
        if (n.type === "class_definition" || n.type === "mixin_declaration" || n.type === "extension_declaration" ||
            n.type === "enum_declaration") {
          nextContainer = n.childForFieldName?.("name")?.text ?? "(anon)"
        }
        if (SIGS.has(n.type)) {
          // the name-bearing signature: a method_signature WRAPS the inner one
          let sig = n
          if (n.type === "method_signature") {
            let inner = n
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c && SIGS.has(c.type) && c.type !== "method_signature") { inner = c; break }
            }
            if (inner !== n) {
              // visit only the inner signature's name; skip the wrapper
              for (let i = n.namedChildCount - 1; i >= 0; i--) {
                const c = n.namedChild(i)
                if (c) stack.push({ n: c, container: nextContainer })
              }
              continue
            }
          }
          const nameNode = sig.childForFieldName?.("name")
          let name: string | null = nameNode ? nameNode.text : null
          const kind = sig.type.startsWith("getter") || sig.type.startsWith("setter") ? "accessor"
            : sig.type.includes("constructor") ? "ctor"
              : sig.type === "operator_signature" ? "operator" : "fn"
          if (kind === "ctor") {
            // A constructor's NAME FIELD is the CLASS name for the unnamed ctor
            // and for every named one (`Counter.named()`); the named segment is
            // a bare identifier child. Using the name field alone made every
            // `X()` + `X.named()` pair read as a duplicate (the first run's
            // false positives).
            const ids: string[] = []
            for (let i = 0; i < sig.namedChildCount; i++) {
              const c = sig.namedChild(i)
              if (c && c.type === "identifier") ids.push(c.text)
            }
            name = ids.find((t) => t !== container) ?? name
          } else if (kind === "operator" && sig.childCount >= 3) {
            name = `operator ${sig.child(2).text}`
          }
          if (name) {
            let m = perScope.get(nextContainer)
            if (!m) { m = new Map(); perScope.set(nextContainer, m) }
            const list = m.get(name) ?? []
            list.push(kind)
            m.set(name, list)
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push({ n: c, container: nextContainer })
        }
      }
      for (const [scope, m] of perScope) {
        for (const [name, kinds] of m) {
          if (kinds.length <= 1) continue
          // `get x` + `set x` is LEGAL Dart and expected (the DARTD12 pair)
          if (kinds.every((k) => k === "accessor")) { accessorPairs++; continue }
          if (kinds.every((k) => k === "ctor")) ctorDups++
          if (scope === "__program__") programDups++
          else memberDups++
          findings.push(`${path.relative(ROOT, f)}\tscope=${scope}\t${name}: ${kinds.join("+")}`)
          if (samples.length < 25) samples.push(`${path.relative(ROOT, f)} scope=${scope} ${name}: ${kinds.join("+")}`)
        }
      }
    }
  }
  console.log(`files=${files} (cap ${cap || "full extent"})`)
  console.log(`member-scope duplicate NAMES: ${memberDups}`)
  console.log(`  of which ctor-name duplicates: ${ctorDups}`)
  console.log(`program-scope duplicate NAMES: ${programDups}`)
  console.log(`accessor pairs (legal get+set, excluded): ${accessorPairs}`)
  fs.writeFileSync("/tmp/dt-dup-census.jsonl", findings.map((x) => x + "\n").join(""))
  console.log(`findings -> /tmp/dt-dup-census.jsonl (${findings.length})`)
  for (const s of samples) console.log(`  ${s}`)
}
main()
