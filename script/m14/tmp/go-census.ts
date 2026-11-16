import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
function filesUnder(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target|_test|\.git)/.test(e.name)) filesUnder(p, exts, out) }
    else if (exts.some((x) => e.name.endsWith("." + x))) out.push(p)
  }
  return out
}
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  // analyzer-referenced node types (extracted from source)
  const src = fs.readFileSync(path.join(ROOT, "src/ast/real-go-analyzer.ts"), "utf8")
  const refd = new Set<string>()
  const re = /[."']([a-z][a-z0-9_]*(_[a-z0-9]+)*)["']/g
  let m: RegExpExecArray | null
  const SKIP = new Set("anemic_structs,anonymous_closure,any,append,auto_migration,balanced,body,bufio,bytes,call_expression,cap,channel,channel_communication,channels,close,comment,complexity_analysis,concurrency_pattern,condition,contains,context,copy,crud_operations,crypto,dec_statement,default_case,defer,defer_cleanup,defer_statement,delete,dependency_injection,design_pattern,duck_typing,echo,echo_context_usage,echo_setup,empty_interface,encoding,ent,err,error,error_handling,errors,excellent,exceptional,exports,extends,fair,fasthttp,fiber,fiber_app_setup,field,flag,fmt,for_statement,function,function_complexity,fx,gin,gin_router_setup,global,go,go_channel_operation,go_composite_literal_construction,go_defer,go_errors,go_function_call,go_goroutine,go_instantiation,go_interface_embedding,go_interface_implementation,golang_extended,good,go_package_scope_call,go_package_scope_instantiation,gorilla_mux,gorilla_router_setup,gorm,gorm_connection,grpc interfacial".split(","))
  while ((m = re.exec(src))) { if (!SKIP.has(m[1]) && m[1].includes("_")) refd.add(m[1]) }
  const seen = new Map<string, number>()
  const walk = (n: any): void => {
    seen.set(n.type, (seen.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  const p = new P(); p.setLanguage(LANG)
  const files = [...filesUnder("<corpus-root>/bb_tests/repositories/go-tools", ["go"]), ...filesUnder("<corpus-root>/bb_tests/repositories/terraform", ["go"])].slice(0, 400)
  console.log("files:", files.length)
  for (const f of files) {
    try {
      const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
      walk(root)
    } catch {}
  }
  const observed = new Set(seen.keys())
  console.log("=== analyzer-referenced but NEVER observed (dead?) ===")
  for (const t of [...refd].sort()) if (!observed.has(t)) console.log("  DEAD?", t)
  console.log("=== frequently observed but never referenced (gaps?) ===")
  for (const [t, c] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    if (!refd.has(t) && c > 50) console.log(`  UNHANDLED ${t} x${c}`)
  }
}
main()
