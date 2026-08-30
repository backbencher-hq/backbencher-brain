/**
 * M14.0.F5 — Differential Corpus Harness
 *
 * Second-opinion verification on real repositories. For a seeded sample of
 * files from a pinned corpus repo:
 *   1. Derive TREE TRUTH directly from the wasm parse tree.
 *   2. Run the real analyzer on the same file.
 *   3. Diff BOTH directions:
 *        tree -> analyzer : silent drops become visible and counted
 *        analyzer -> tree : fabricated/mislabelled edges become visible
 *
 * Target matching tolerates FQN vs last-segment; label matching is exact.
 *
 * CLI: bun run script/m14/differential.ts [--repo <name>] [--sample N]
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const REPO = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : "grails-core"
const SAMPLE_PER_LANG = process.argv.includes("--sample") ? parseInt(process.argv[process.argv.indexOf("--sample") + 1]) : 60

const LANGS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string }> = {
  javascript: { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: "js" },
      typescript: { wasm: "tree-sitter-typescript.wasm", analyzerFile: "real-typescript-analyzer", className: "RealTypeScriptAnalyzer", ext: "ts" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", analyzerFile: "real-kotlin-analyzer", className: "RealKotlinAnalyzer", ext: "kt" },
  scala: { wasm: "tree-sitter-scala.wasm", analyzerFile: "real-scala-analyzer", className: "RealScalaAnalyzer", ext: "scala" },
  java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java" },
  groovy: { wasm: "tree-sitter-groovy.wasm", analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer", ext: "groovy" },
  vue: { wasm: "tree-sitter-vue.wasm", analyzerFile: "real-vue-analyzer", className: "RealVueAnalyzer", ext: "vue" },
  svelte: { wasm: "tree-sitter-svelte.wasm", analyzerFile: "real-svelte-analyzer", className: "RealSvelteAnalyzer", ext: "svelte" },
  cpp: { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cc" },
  c: { wasm: "tree-sitter-c.wasm", analyzerFile: "real-c-analyzer", className: "RealCAnalyzer", ext: "c" },
  rust: { wasm: "tree-sitter-rust.wasm", analyzerFile: "real-rust-analyzer", className: "RealRustAnalyzer", ext: "rs" },
  go: { wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: "go" },
  zig: { wasm: "tree-sitter-zig.wasm", analyzerFile: "real-zig-analyzer", className: "RealZigAnalyzer", ext: "zig" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", analyzerFile: "real-csharp-analyzer", className: "RealCSharpAnalyzer", ext: "cs" },
  dart: { wasm: "tree-sitter-dart.wasm", analyzerFile: "real-dart-analyzer", className: "RealDartAnalyzer", ext: "dart" },
  swift: { wasm: "tree-sitter-swift.wasm", analyzerFile: "real-swift-analyzer", className: "RealSwiftAnalyzer", ext: "swift" },
  objc: { wasm: "tree-sitter-objc.wasm", analyzerFile: "real-objective-c-analyzer", className: "RealObjectiveCAnalyzer", ext: "m" },
}

function seededPick<T>(items: T[], n: number, seedStr: string): T[] {
  let h = 2166136261
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  const idx = items.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h + i), 2246822519)
    const j = Math.abs(h) % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, n).map(i => items[i])
}
function lastSegment(name: string): string {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
function normTarget(t: string): string {
  // scala type args use square brackets; multi-line constructs can leave a
  // trailing unbalanced "[" in raw-text targets (List[ -> List)
  return lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
}

interface TreeEdge { label: string; from: string; target: string }

// Vue template component-usage oracle: every element start_tag NOT in an
// independently-written core-HTML/SVG set is a component usage. The set
// below is written from the HTML spec, deliberately NOT copied from the
// analyzer's list, so disagreements surface as missing/unexplained.
const ORACLE_HTML_TAGS = new Set(["a","abbr","address","area","article","aside","audio","b","base","bdi","bdo","blockquote","body","br","button","canvas","caption","cite","code","col","colgroup","data","datalist","dd","del","details","dfn","dialog","div","dl","dt","em","embed","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","iframe","img","input","ins","kbd","label","legend","li","link","main","map","mark","menu","meta","meter","nav","noscript","object","ol","optgroup","option","output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","script","section","select","slot","small","source","span","strong","style","sub","summary","sup","table","tbody","td","template","textarea","tfoot","th","thead","time","title","tr","track","u","ul","var","video","wbr","svg","path","g","rect","circle","ellipse","line","polyline","polygon","text","tspan","use","defs","stop","view"])
function deriveVueComponentUsages(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "script_element" || n.type === "style_element") continue
    if (n.type === "element" || n.type === "self_closing_tag") {
      // tag_name lives INSIDE start_tag/self_closing_tag, not on the
      // element node itself.
      const container = n.namedChildren.find((c: any) => c.type === "start_tag" || c.type === "self_closing_tag")
      const tag = container?.namedChildren.find((c: any) => c.type === "tag_name")
      const name = tag?.text
      // vue framework builtins are rendering primitives, not components
      const VUE_BUILTINS = new Set(["component", "transition", "transition-group", "keep-alive", "teleport", "suspense", "fragment"])
      if (name && !ORACLE_HTML_TAGS.has(name) && !VUE_BUILTINS.has(name) && !seen.has(name)) {
        seen.add(name)
        edges.push({ label: "instantiates", from: "(expr)", target: name })
      }
      if (n.type === "self_closing_tag") continue
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// Svelte template component-usage oracle (independent HTML-core set;
// svelte:* and slot are framework primitives).
function deriveSvelteComponentUsages(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const VUE_STYLE_BUILTINS = new Set(["slot","svelte:component","svelte:self","svelte:element","svelte:window","svelte:document","svelte:body","svelte:head","svelte:options","svelte:fragment","svelte:boundary"])
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "script_element" || n.type === "style_element") continue
    if (n.type === "element" || n.type === "self_closing_tag") {
      const container = n.namedChildren.find((c: any) => c.type === "start_tag" || c.type === "self_closing_tag")
      const tag = container?.namedChildren.find((c: any) => c.type === "tag_name")
      const name = tag?.text
      if (name && !ORACLE_HTML_TAGS.has(name) && !VUE_STYLE_BUILTINS.has(name) && !seen.has(name)) {
        seen.add(name)
        edges.push({ label: "instantiates", from: "(expr)", target: name })
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// Embedded-script truth for SFC languages: extract <script> raw_text
// blocks and parse them with the JS grammar (lang="ts" blocks included -
// the JS-family structural rules apply identically).
async function deriveEmbeddedScriptTrees(root: any, content: string, lang: string): Promise<any[]> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const Lang = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const parser = new P()
  parser.setLanguage(language)
  const tsLanguage = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const tsParser = new P()
  tsParser.setLanguage(tsLanguage)
  const out: any[] = []
  const walk = (n: any): void => {
    if (n.type === "script_element") {
      const raw = n.namedChildren.find((c: any) => c.type === "raw_text")
      const startTag = n.namedChildren.find((c: any) => c.type === "start_tag")
      const isTs = !!startTag && /lang=["']ts["']/.test(startTag.text)
      if (raw && raw.text.trim().length > 0) {
        try {
          // ts blocks need the TS grammar or heritage clauses error-recover away
          out.push((isTs ? tsParser : parser).parse(raw.text).rootNode)
        } catch { /* skip */ }
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) walk(n.namedChild(k))
  }
  walk(root)
  return out
}

// C call-truth: a call_expression with an IDENTIFIER callee is an
// independently derivable call edge (function pointers excluded - opaque).
function deriveCCalls(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
      // identifier callee OR member/pointer callee -> its callable LEAF
      const fn = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "field_expression")
      let name: string | undefined
      if (fn?.type === "field_expression") {
        const leaf = fn.namedChildren.find((c: any) => c.type === "field_identifier")
        name = leaf?.text
      } else name = fn?.text
      if (name && !seen.has(name)) {
        seen.add(name)
        edges.push({ label: "calls", from: "(expr)", target: name })
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// Go truth: mirror the analyzer's leaf-target call contract, struct
// embedding (extends), and PascalCase constructor instantiation.
// Calls: every call_expression whose callee is an identifier or a
// selector_expression => LEAF target (pkg.Fn -> Fn, s.repo.Save -> Save).
// stdlib/external leaves are kept as truth (like rust/c). Builtins
// (make/len/append/new/...) are deliberately not truth (analyzer excludes).
// Extends: anonymous embedded fields in a struct (Go composition).
// Instantiates: calls to in-file PascalCase top-level constructor
// functions (NewFoo) => instantiates the ctor target (family convention).
export function deriveGoEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const GOBUILTINS = new Set(["make", "new", "len", "cap", "append", "copy", "delete", "panic", "recover", "print", "println", "close"])

  // In-file top-level (non-method) function/method names. Mirror the
  // analyzer's resolveGoFunctionCall contract EXACTLY:
  //   - package-qualified / selector callee (s.start, pkg.Fn) => leaf kept
  //     unconditionally (stdlib/external leaves are truth, like rust/c)
  //   - bare identifier callee => emitted ONLY if it names an in-file
  //     declared top-level function OR method (type conversions string(x),
  //     float64(x), closure vars fn(), bare externals are NOT truth -
  //     the analyzer resolves them to no local symbol and drops them).
  // declaredFns: every in-file top-level function AND method name (used for
  // BARE-callee call truth, mirroring resolveGoFunctionCall which needs a
  // matching Function/Method symbol). ctorFns: top-level functions ONLY
  // (no receiver) — the analyzer's instantiates fires only for PascalCase
  // TOP-LEVEL FUNCTION symbols (`!s.ownerName && kind === Function`), never
  // for methods, so type conversions and method leaves never instantiate.
  const declaredFns = new Set<string>()
  const ctorFns = new Set<string>()
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.type === "function_declaration") {
        const nm = n.childForFieldName?.("name")
        if (nm) { declaredFns.add(nm.text); ctorFns.add(nm.text) }
      } else if (n.type === "method_declaration") {
        const nm = n.childForFieldName?.("name")
        if (nm) declaredFns.add(nm.text)
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }

  const stack: any[] = [root]
  const leafOf = (fn: any): { leaf?: string; qualified: boolean } => {
    if (!fn) return { qualified: false }
    if (fn.type === "identifier") return { leaf: fn.text, qualified: false }
    if (fn.type === "selector_expression") {
      const f = fn.childForFieldName?.("field")
      return { leaf: f?.text, qualified: true }
    }
    return { qualified: false }
  }
  // Deep-review alignment 2026-08-29 (go family final pass, go-tools @200
  // measured 12 MISSING): mirror the analyzer's package-scope closure
  // contract. Inside a function body findGoFunctionCalls descends closure
  // bodies (goroutines/callbacks are reachable), but at PACKAGE scope only an
  // IMMEDIATELY-invoked func literal (`var x = func(){...}()` -> parent is
  // call_expression) runs at init, so only those bodies are descended; a
  // STORED package closure (`var table = map...{func(){...}}`) is a template
  // not executed at init and its body must be skipped. The flat DFS below
  // previously descended every func_literal body, over-deriving calls from
  // stored package closures the analyzer correctly omits.
  const isInsideFunctionBody = (node: any): boolean => {
    let p: any = node.parent
    while (p) {
      if (p.type === "function_declaration" || p.type === "method_declaration") return true
      p = p.parent
    }
    return false
  }
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "func_literal") {
      // Stored package-scope closure (non-IIFE, not inside any function body):
      // template, not executed at init -> skip body entirely. IIFE closures
      // and in-function closures are descended normally below.
      const isIIFE = n.parent && n.parent.type === "call_expression"
      if (!isIIFE && !isInsideFunctionBody(n)) {
        continue
      }
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName?.("function")
      const { leaf: name, qualified } = leafOf(fn)
      const isCtor = !!name && /^[A-Z]/.test(name) && name[0] !== name[0].toLowerCase()
      // Call truth: qualified leaves unconditionally; bare callees need an
      // in-file declared function/method (string(x), float64(x) conversions
      // and closure vars fn() are type/bare names not in declaredFns -> not
      // truth, mirroring the analyzer's resolveGoFunctionCall drop).
      const emit = !!name && !GOBUILTINS.has(name) && (qualified || declaredFns.has(name))
      if (emit && !seen.has("call:" + name)) {
        seen.add("call:" + name)
        edges.push({ label: "calls", from: "(expr)", target: name })
      }
      // Instantiates: only in-file TOP-LEVEL constructor FUNCTIONS (NewFoo).
      // ctorFns excludes methods (analyzer: `!s.ownerName && Function`), so
      // method leaves and stdlib ctors never instantiate.
      if (isCtor && ctorFns.has(name) && !seen.has("inst:" + name)) {
        seen.add("inst:" + name)
        edges.push({ label: "instantiates", from: "(expr)", target: name })
      }
    } else if (n.type === "type_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const ts = n.namedChild(i)
        if (!ts || ts.type !== "type_spec") continue
        const nm = ts.childForFieldName?.("name")
        const structN = ts.namedChildren.find((c: any) => c.type === "struct_type")
        if (nm && structN) {
          const fdl = structN.namedChildren.find((c: any) => c.type === "field_declaration_list")
          if (fdl) {
            for (let j = 0; j < fdl.namedChildCount; j++) {
              const fd = fdl.namedChild(j)
              if (!fd || fd.type !== "field_declaration") continue
              // Embedded field: no field_identifier/name child, only a type.
              const hasName = (fd.namedChildren ?? []).some((c: any) => c.type === "field_identifier" || c.type === "identifier")
              if (hasName) continue
              const typeN = fd.childForFieldName?.("type") ?? (fd.namedChildren ?? []).find((c: any) => c.type === "type_identifier" || c.type === "qualified_type")
              if (typeN) {
                const t = lastSegment(typeN.text)
                if (t && !seen.has("ext:" + nm.text + "->" + t)) {
                  seen.add("ext:" + nm.text + "->" + t)
                  edges.push({ label: "extends", from: nm.text, target: t })
                }
              }
            }
          }
        }
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// C# second-opinion oracle (csharp #264 wave). Re-derives the SAME relationship
// set the analyzer emits, independently, so disagreements surface as
// missing/unexplained rather than being copied. Mirrors the analyzer's
// deterministic C# base-list rule (CSD1): a type's base_list children are
// ordered — the FIRST entry is the base class (extends), every remaining
// entry is an interface (implements). Instantiates comes from
// object_creation_expression; calls come from invocation_expression leaf
// targets (the analyzer's leaf-target M12 contract, like go/rust).

// Mirror of RealCSharpAnalyzer.cleanTypeName: strip generics (`<...>`) and
// nullable (`?`) suffixes, but KEEP the full qualified prefix (no lastSegment)
// so the oracle's implicit-new target matches the analyzer's instantiates
// target byte-for-byte before normTarget reduction.
function csharpCleanTypeName(text: string): string {
  const lt = text.indexOf("<")
  const base = lt > 0 ? text.slice(0, lt) : text
  const q = base.indexOf("?")
  return (q > 0 ? base.slice(0, q) : base).trim()
}

// Mirror of RealCSharpAnalyzer.resolveImplicitNewType: a target-typed `new()`
// carries no syntactic type, so the type comes from the enclosing
// variable_declarator (or property_declaration) declaration. Walks `.parent`
// exactly like the analyzer so both sides resolve the SAME target.
function csharpImplicitNewType(node: any): string | null {
  let cur: any = node.parent
  while (cur) {
    if (cur.type === "variable_declarator") {
      const parentDecl = cur.parent
      if (parentDecl && parentDecl.type === "variable_declaration") {
        for (let k = 0; k < parentDecl.namedChildCount; k++) {
          const c = parentDecl.namedChild(k)
          if (c && /^(generic_name|identifier|qualified_name|predefined_type|nullable_type|array_type)$/.test(c.type)) return csharpCleanTypeName(c.text)
        }
      }
      return null
    }
    if (cur.type === "field_declaration") return null
    if (cur.type === "property_declaration") {
      const stack: any[] = [cur]
      while (stack.length) {
        const t = stack.pop()!
        if (t && /^(generic_name|identifier|qualified_name|predefined_type|nullable_type)$/.test(t.type) && t.type !== "variable_declarator") return csharpCleanTypeName(t.text)
        for (let k = 0; k < t.namedChildCount; k++) stack.push(t.namedChild(k))
      }
      return null
    }
    cur = cur.parent
  }
  return null
}

export function deriveCSharpEdges(root: any, corpusInterfaces?: Set<string>): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const leafOf = (t: string): string => {
    // generic_name: IComparer<Circle> -> IComparer; qualified: A.B.C -> C
    const lt = t.indexOf("<")
    return lastSegment(lt >= 0 ? t.slice(0, lt) : t)
  }
  // Receiver wrappers the analyzer suppresses (isCSharpBuiltin: Console
  // output, Environment/GC/Debug/Trace noise). Deliberately NOT `string`/
  // `object` — string.Create / object.Equals are real framework calls.
  // Mirror RealCSharpAnalyzer.isCSharpBuiltin: the ANALYZER filters only the
  // exact full-call CSHARP_BUILTINS strings (Console.WriteLine, GC.Collect,
  // Debug.Write, ...) plus Object-method leaves — it does NOT blanket-suppress
  // whole receivers. So `Debug.Assert`, `File.Close`, `Math.Abs` are real
  // framework calls the analyzer keeps and the oracle must CONFIRM, not hide.
  const CSHARP_BUILTINS_ORACLE = new Set([
    "Console.WriteLine", "Console.Write", "Console.WriteAsync",
    "Console.Error.WriteLine", "Console.Error.Write", "Console.Error.WriteAsync",
    "Console.Out.WriteLine", "Console.Out.Write", "Console.Out.WriteAsync",
    "Environment.Exit", "Environment.GetEnvironmentVariable", "Environment.GetEnvironmentVariables", "Environment.SetEnvironmentVariable",
    "GC.Collect", "GC.SuppressFinalize", "GC.WaitForPendingFinalizers",
    "Debug.WriteLine", "Debug.Write", "Debug.Print",
    "Trace.WriteLine", "Trace.Write",
  ])
  // In-file declared type kinds, mirroring the analyzer's typeKinds pre-pass
  // (CSD1). Lets `class X : ISomeInterface` resolve to implements even when
  // the interface is the FIRST base-list entry — the two sides only diverge
  // on cross-file interface kinds, which is the declared per-file limitation.
  const declKinds = new Map<string, string>()
  {
    const pre: any[] = [root]
    while (pre.length) {
      const t = pre.pop()!
      if (/^(class|interface|struct|record)_declaration$/.test(t.type)) {
        const nm = t.childForFieldName?.("name")?.text
        if (nm) declKinds.set(nm, t.type.startsWith("interface") ? "interface" : t.type.includes("struct") ? "struct" : "class")
      }
      for (let k = 0; k < t.namedChildCount; k++) pre.push(t.namedChild(k))
    }
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "class_declaration" || n.type === "interface_declaration" || n.type === "struct_declaration" || n.type === "record_declaration") {
      const nameNode = n.childForFieldName?.("name")
      const nm = nameNode?.text
      const baseList = n.namedChildren.find((c: any) => c.type === "base_list")
      if (nm && baseList) {
        const baseTypes: string[] = []; for (const b of baseList.namedChildren) if (b) baseTypes.push(leafOf(b.text))
        const isInterfaceDecl = n.type === "interface_declaration"
        for (let i = 0; i < baseTypes.length; i++) {
          const target = baseTypes[i]
          if (!target) continue
          // C#: an interface only EVER $extends other interfaces (no
          // interface-implements keyword). Mirror the analyzer's isInterface
          // branch exactly.
          if (isInterfaceDecl) {
            const key = `extends:${nm}->${target}`
            if (!seen.has(key)) { seen.add(key); edges.push({ label: "extends", from: nm, target }) }
            continue
          }
          // class/struct/record: mirror the analyzer — in-file kind, then the
          // corpus interface set (the oracle's cross-file companion), then the
          // qualified-name leaf (a nested type like Outer.Base is keyed by its
          // leaf Base in the kind maps), then the deterministic rule
          // (first=extends, later-unknown=implements).
          const dot = target.lastIndexOf(".")
          const leaf = dot > 0 ? target.slice(dot + 1) : target
          const knownIface =
            declKinds.get(target) === "interface" || corpusInterfaces?.has(target) ||
            declKinds.get(leaf) === "interface" || corpusInterfaces?.has(leaf)
          const knownClass =
            declKinds.get(target) === "class" || declKinds.get(target) === "struct" ||
            declKinds.get(leaf) === "class" || declKinds.get(leaf) === "struct"
          const declaredKind = knownIface ? "interface" : knownClass ? "class" : undefined
          const label = knownIface || (i > 0 && !declaredKind) ? "implements" : "extends"
          const key = `${label}:${nm}->${target}`
          if (!seen.has(key)) {
            seen.add(key)
            edges.push({ label, from: nm, target })
          }
        }
      }
    } else if (n.type === "object_creation_expression") {
      const typeNode =
        n.namedChildren.find((c: any) => c.type === "generic_name" || c.type === "identifier" || c.type === "qualified_name" || c.type === "predefined_type") ??
        n.namedChildren.find((c: any) => c.type === "type_argument_list")
      if (typeNode) {
        const t = leafOf(typeNode.text)
        const key = "inst:" + t
        // A construction target is always a constructible type — `new object()`
        // and `new string(...)` are real instantiations, so CSBUILTINS must NOT
        // filter them (only `var`/`nameof` can never be `new` targets, and those
        // never parse as object_creation_expression anyway).
        if (t && !seen.has(key)) {
          seen.add(key)
          edges.push({ label: "instantiates", from: "(expr)", target: t })
        }
      }
    } else if (n.type === "implicit_object_creation_expression") {
      // Target-typed `new()` — the type is NOT inside the node. Resolve it
      // from the enclosing variable_declarator / property_declaration exactly
      // like RealCSharpAnalyzer.resolveImplicitNewType, so the oracle
      // CONFIRMS the analyzer's instantiates (csharp #264 Station-6: `object
      // x = new()` / `Dictionary<..> d = new()` were UNEXPLAINED because the
      // oracle only understood explicit object_creation_expression). Same
      // inst: key dedups explicit+implicit constructions of one type per file.
      const t = csharpImplicitNewType(n)
      if (t) {
        const key = "inst:" + t
        if (!seen.has(key)) {
          seen.add(key)
          edges.push({ label: "instantiates", from: "(expr)", target: t })
        }
      }
    } else if (n.type === "invocation_expression") {
      const fn = n.childForFieldName?.("function")
      if (fn) {
        let leaf = ""
        if (fn.type === "member_access_expression") {
          const nameNode = fn.childForFieldName?.("name")
          leaf = nameNode ? (nameNode.type === "generic_name" ? (nameNode.childForFieldName?.("name")?.text ?? nameNode.text.split("<")[0]) : nameNode.text) : ""
        } else if (fn.type === "identifier" || fn.type === "generic_name") {
          leaf = fn.type === "generic_name" ? (fn.childForFieldName?.("name")?.text ?? fn.text.split("<")[0]) : fn.text
        } else if (fn.type === "conditional_access_expression") {
          // Null-conditional call `x?.M(args)` — the callee is a
          // member_binding_expression (`.M`) whose `name` field is the member
          // identifier. csharp #264 Station-6: `postActionHandler?.PostVisit(ast)`,
          // `subscriber.Action?.NotifyJobStopped()`, `destinationStream?.Close()`
          // were UNEXPLAINED because the oracle only read member_access_expression
          // / identifier callees. Mirror the analyzer's leaf (Close, Translate,
          // PostVisit, ...) so it confirms these real calls.
          const stack: any[] = [fn]
          while (stack.length && !leaf) {
            const t = stack.pop()!
            if (t.type === "member_binding_expression") {
              const nm = t.childForFieldName?.("name")
              if (nm) leaf = nm.type === "generic_name" ? (nm.childForFieldName?.("name")?.text ?? nm.text.split("<")[0]) : nm.text
            }
            for (let k = 0; k < t.namedChildCount; k++) stack.push(t.namedChild(k))
          }
        }
        // Mirror the analyzer's isCSharpBuiltin: suppress a call ONLY when its
        // exact full name matches CSHARP_BUILTINS (or the leaf is an Object
        // method). Debug.Assert / File.Close / Math.Abs / NotifyJobStopped are
        // NOT in that set, so the oracle confirms them instead of assuming the
        // whole receiver is noise.
        const OBJMETHODS = new Set(["ToString", "GetHashCode", "Equals", "GetType", "ReferenceEquals"])
        const rcvr = fn.type === "member_access_expression" ? (fn.childForFieldName?.("expression")?.text ?? "") : ""
        const full = fn.type === "member_access_expression" ? (rcvr ? rcvr + "." + leaf : leaf) : leaf
        const isSuppressed = CSHARP_BUILTINS_ORACLE.has(full) || OBJMETHODS.has(leaf)
        // Call-target hygiene mirror of the analyzer: tree-sitter mislabels
        // `if (...)` as an invocation_expression, and unsafe vtable dispatch can
        // slot pointer indexes / element-addresses as the callee. A real target
        // is a clean, non-keyword identifier.
        const isKeyword = /^(if|for|foreach|while|do|switch|case|else|return|throw|using|new|delegate|in|is|as|sizeof|fixed|lock|checked|unchecked|params|ref|out|base|this|get|set)$/.test(leaf)
        const key = "call:" + leaf
        if (leaf && !isKeyword && /^[A-Za-z_][A-Za-z0-9_]*$/.test(leaf) && !isSuppressed && !seen.has(key)) {
          seen.add(key)
          edges.push({ label: "calls", from: "(expr)", target: leaf })
        }
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// Dart tree-truth oracle (dart managed-OO wave #264). Mirrors
// RealDartAnalyzer's M12.11 leaf-target contract exactly:
//   - extends:  superclass first type_identifier
//   - implements: every type_identifier under `interfaces` (not type_arguments)
//   - uses:     every type_identifier under the mixins (with-clause)
//   - instantiates: constructor_invocation / new_expression /
//     const_object_expression type_identifier, PLUS a capitalized bare
//     identifier directly before an argument_part selector (Dart types are
//     capitalized; `Foo()` is a constructor invocation)
//   - calls:    selector(argument_part) callee leaf — member_access chains
//     resolve to the LAST identifier (obj.method -> method), null-conditional
//     `x?.M()` via conditional_assignable_selector, cascade_section via
//     cascade_selector; dart global builtins (print/assert/identical) and
//     Object methods (toString/hashCode/runtimeType/noSuchMethod) filtered.
// The oracle emits UNIQUE (label,target) edges (seen-set per label+target),
// matching the site-agnostic coverage match in main().
export function deriveDartEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const isCapitalized = (t: string): boolean => t.length > 0 && t.charCodeAt(0) >= 65 && t.charCodeAt(0) <= 90
  const DART_BUILTINS = new Set(["print", "assert", "identical", "toString", "hashCode", "runtimeType", "noSuchMethod"])
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }

  // Collect type_identifier leaves of a container, excluding generic args.
  const typeLeaves = (n: any): string[] => {
    const out: string[] = []
    const st: any[] = [n]
    while (st.length) {
      const t = st.pop()!
      if (t.type === "type_identifier") { out.push(t.text); continue }
      if (t.type === "type_arguments") continue // generic args are NOT bases
      for (let k = 0; k < t.namedChildCount; k++) { const c = t.namedChild(k); if (c) st.push(c) }
    }
    return out
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "class_definition" || t === "mixin_declaration") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        const sup = n.namedChildren.find((c: any) => c.type === "superclass")
        if (sup) {
          // first type_identifier directly under superclass (base class),
          // EXCLUDING the mixins (with-clause) child.
          for (let k = 0; k < sup.namedChildCount; k++) {
            const c = sup.namedChild(k)
            if (c && c.type === "mixins") continue
            if (c && (c.type === "type_identifier" || c.type === "generic_type")) {
              const ti = c.type === "generic_type" ? (c.namedChildren.find((x: any) => x.type === "type_identifier") ?? c) : c
              if (ti?.text) push("extends", ti.text)
              break
            }
          }
          // mixins under superclass (extends A with M)
          const mx = sup.namedChildren.find((c: any) => c.type === "mixins")
          if (mx) for (const m of typeLeaves(mx)) push("uses", m)
        }
        // mixins directly on the class (class A with M implements C)
        const mxDirect = n.namedChildren.find((c: any) => c.type === "mixins")
        if (mxDirect) for (const m of typeLeaves(mxDirect)) push("uses", m)
        // interfaces
        const ifc = n.namedChildren.find((c: any) => c.type === "interfaces")
        if (ifc) for (const m of typeLeaves(ifc)) push("implements", m)
      }
    }
    if (t === "constructor_invocation" || t === "new_expression" || t === "const_object_expression") {
      const tn = n.namedChildren.find((c: any) => c.type === "type_identifier")
      if (tn && isCapitalized(tn.text)) push("instantiates", tn.text)
    }
    if (t === "selector") {
      const hasArgs = n.namedChildren.some((c: any) => c.type === "argument_part")
      if (hasArgs) {
        const prev = n.previousNamedSibling
        if (prev) {
          let leaf: string | null = null
          if (prev.type === "unconditional_assignable_selector" || prev.type === "conditional_assignable_selector" || prev.type === "selector") {
            const id = prev.namedChildren.find((c: any) => c.type === "identifier")
            leaf = id ? id.text : (() => { const stk: any[] = [prev]; let last: string | null = null; while (stk.length) { const x = stk.pop()!; if (x.type === "identifier" || x.type === "type_identifier") last = x.text; for (let k = 0; k < x.namedChildCount; k++) { const c = x.namedChild(k); if (c) stk.push(c) } } return last })()
          } else if (prev.type === "identifier" || prev.type === "type_identifier") {
            leaf = prev.text
          }
          if (leaf && !DART_BUILTINS.has(leaf)) {
            if (isCapitalized(leaf) && (prev.type === "identifier" || prev.type === "type_identifier")) {
              push("instantiates", leaf)
            } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(leaf)) {
              // Dart identifiers may contain $ (json_serializable generates
              // _$FooFromJson / _$FooToJson helpers); the analyzer emits
              // calls for them, so the oracle must too.
              push("calls", leaf)
            }
          }
        }
      }
    }
    if (t === "cascade_section") {
      const sel = n.namedChildren.find((c: any) => c.type === "cascade_selector")
      const hasArgs = n.namedChildren.some((c: any) => c.type === "argument_part")
      if (sel && hasArgs) {
        const id = sel.namedChildren.find((c: any) => c.type === "identifier")
        if (id && !DART_BUILTINS.has(id.text) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id.text)) push("calls", id.text)
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) { const c = n.namedChild(k); if (c) stack.push(c) }
  }
  return edges
}

// Swift tree-truth oracle (swift managed-OO wave #266). Mirrors
// RealSwiftAnalyzer's M12.21 leaf-target contract exactly:
//   - extends:  FIRST inheritance base of class/struct/actor (superclass),
//     from the inheritance_specifier children
//   - implements: REMAINING bases (adopted protocols)
//   - instantiates: bare CAPITALIZED call `User(...)` -> instantiates ONLY
//     (no calls edge — Swift construction syntax, Java `new Foo()` analog)
//   - calls:    member calls resolve to the LEAF target (`users.first` ->
//     `first`); bare non-capitalized identifiers, with the analyzer's
//     BUILTIN_BARE_CALLS set filtered (print/String/Int/... AND the `defer`
//     keyword-construct which parses as a call in the pinned grammar)
//   - uses:     ONLY `self.` member READS — navigation_expression with a
//     self receiver that is NOT the callee of a call_expression
//   - references: imports -> root -> module (mirrors handleImport)
// The oracle emits UNIQUE (label,target) edges (seen-set per label+target),
// matching the site-agnostic coverage match in main().
export function deriveSwiftEdges(root: any, corpusProtocols?: Set<string>): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const SWIFT_BUILTINS = new Set([
    "print", "debugPrint", "assert", "precondition", "fatalError",
    "String", "Int", "Double", "Float", "Bool", "Array", "Dictionary",
    "Set", "Optional", "Any", "Void", "Character", "Data", "Date", "defer",
  ])
  const isCapitalized = (t: string): boolean => t.length > 1 && t.charCodeAt(0) >= 65 && t.charCodeAt(0) <= 90
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }

  // self on the navigation RECEIVER chain only (mirrors the analyzer's
  // hasSelfReceiver): navigation > (navigation | self_expression) — stops at
  // the first non-receiver child (call_expression/try_expression).
  const hasSelfReceiver = (n: any): boolean => {
    let cur: any = n
    let guard = 0
    while (cur && guard++ < 64) {
      if (cur.type === "self_expression") return true
      const next = cur.namedChildren.find((c: any) => c.type === "navigation_expression" || c.type === "self_expression")
      if (!next) return false
      cur = next
    }
    return false
  }

  // Leaf name of a navigation_expression: last navigation_suffix's
  // simple_identifier/identifier (mirrors navigationLeaf).
  const navLeaf = (n: any): string | null => {
    let leaf: any = null
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type === "navigation_suffix") {
        const id = c.namedChildren.find((x: any) => x.type === "simple_identifier" || x.type === "identifier")
        leaf = id ?? c
      }
    }
    return leaf ? leaf.text : null
  }

  // Base names from the inheritance_specifier (mirrors extractBaseName).
  const baseName = (spec: any): string | null => {
    for (let i = 0; i < spec.namedChildCount; i++) {
      const c = spec.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier") return c.text
      if (c.type === "user_type") {
        const leaf = c.namedChildren.find((x: any) => x.type === "type_identifier")
        if (leaf) return leaf.text
      }
    }
    const txt = spec.text.trim()
    return txt && !txt.includes(" ") ? txt : null
  }

  const stack: any[] = [{ n: root, parentType: "" }]
  while (stack.length > 0) {
    const { n, parentType } = stack.pop()!
    const t = n.type
    if (t === "class_declaration") {
      // Actor/struct/enum/extension are all class_declaration in the pinned
      // grammar, decided by the anonymous keyword token. Only class/struct/
      // actor carry extends/implements (enum/extension excluded — the
      // analyzer's handleDeclaration guard). Swift semantics: ONLY a class
      // can have a superclass (first base extends); struct/actor bases are
      // all protocol adoptions (implements) — mirrors the analyzer fix.
      let isEnum = false
      let isExtension = false
      let isClass = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && !c.isNamed) {
          if (c.type === "enum") isEnum = true
          if (c.type === "extension") isExtension = true
          if (c.type === "class") isClass = true
        }
      }
      if (!isEnum && !isExtension) {
        const bases: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "inheritance_specifier") {
            const nm = baseName(c)
            if (nm) bases.push(nm)
          }
        }
        // Mirror the analyzer: a class's first base is extends only when it
        // is NOT a known corpus protocol; a known protocol first-base (or any
        // struct/actor base) is implements.
        const firstIsSuperclass =
          isClass &&
          (bases.length > 0 ? !(corpusProtocols?.has(bases[0]) ?? false) : true)
        for (let i = 0; i < bases.length; i++) {
          const isExtends = firstIsSuperclass && i === 0
          push(isExtends ? "extends" : "implements", bases[i])
        }
      }
    }
    if (t === "call_expression") {
      // Subscript READ (`entries[key]`) parses as call_expression with a
      // `[key]` call_suffix — a property access, NOT a call (mirrors the
      // analyzer's isSubscriptRead gate).
      const suffix = n.namedChildren.find((c: any) => c.type === "call_suffix")
      const isSubscript = !!suffix && !!suffix.namedChildren.find((c: any) => c.type === "value_arguments" && c.text.startsWith("["))
      if (isSubscript) { for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, parentType: t }) }; continue }
      // callee: simple_identifier / identifier / navigation_expression
      const callee = n.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "identifier" || c.type === "navigation_expression")
      if (callee && callee.type === "navigation_expression") {
        const leaf = navLeaf(callee)
        if (leaf && leaf !== "$0" && !SWIFT_BUILTINS.has(leaf)) push("calls", leaf)
      } else if (callee) {
        const target = callee.text
        if (target && !SWIFT_BUILTINS.has(target)) {
          if (isCapitalized(target)) push("instantiates", target)
          else push("calls", target)
        }
      }
    }
    if (t === "navigation_expression") {
      // uses: self. member READ — not the callee of a call_expression, and
      // self must be on the RECEIVER chain (navigation > navigation > self),
      // never inside a call: `self.decode(...)?.buffer` reads .buffer off the
      // CALL RESULT, not off self (mirrors the analyzer's hasSelfReceiver).
      const hasSelf = hasSelfReceiver(n)
      if (hasSelf && parentType !== "call_expression") {
        const leaf = navLeaf(n)
        if (leaf) push("uses", leaf)
      }
    }
    if (t === "import_declaration") {
      // mirror handleImport: first simple_identifier/type_identifier/identifier
      const id = n.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "type_identifier" || c.type === "identifier")
      if (id && id.text) push("references", id.text)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, parentType: t })
    }
  }
  return edges
}

// Objective-C tree-truth oracle (objective-c managed-OO wave #267). Mirrors
// RealObjectiveCAnalyzer's emission contract exactly:
//   - extends: superclass (the first identifier/type_identifier AFTER the
//     class name, past the `:` in class_interface/class_implementation),
//     from non-category declarations only
//   - implements: protocols under parameterized_arguments (type_identifier /
//     identifier / type_name children)
//   - instantiates: message_expression whose selector is alloc/new — the
//     receiver leaf is the instantiated class (nested [[Foo alloc] ...] too)
//   - calls: message_expression selectors (non alloc/new) AND C call_expression
//     identifiers, ONLY inside method/function bodies (the analyzer guards
//     `activeScope !== "global"`)
//   - references: preproc_include -> root -> module name (system_lib_string
//     stripped of <>, or string_literal content)
// The oracle emits UNIQUE (label,target) edges (seen-set per label+target),
// matching the site-agnostic coverage match in main().
export function deriveObjcEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }

  // Walk with an inBody flag: calls/instantiates only inside method/function
  // bodies (mirrors the analyzer's activeScope !== "global" guard).
  const stack: any[] = [{ n: root, inBody: false, parentType: "" }]
  while (stack.length > 0) {
    const { n, inBody, parentType } = stack.pop()!
    const t = n.type
    if (t === "class_interface" || t === "class_implementation") {
      // Category detection: an anonymous `(` child (like swift's actor via
      // keyword token). Categories emit Extension symbols, no inheritance.
      let isCategory = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && !c.isNamed && c.type === "(") { isCategory = true; break }
      }
      if (!isCategory) {
        let foundName = false
        let superName: string | null = null
        const protocols: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier" && !foundName) { foundName = true; continue }
          if ((c.type === "type_identifier" || c.type === "identifier") && !superName) { superName = c.text }
          if (c.type === "parameterized_arguments") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const pn = c.namedChild(j)
              if (pn && (pn.type === "type_identifier" || pn.type === "identifier" || pn.type === "type_name")) protocols.push(pn.text)
            }
          }
        }
        if (superName) push("extends", superName)
        for (const p of protocols) push("implements", p)
      } else {
        // Category protocol conformance: `@interface NSString (Cat) <NSCoding>`
        // — the class genuinely adopts the protocol (mirrors the analyzer).
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "parameterized_arguments") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const pn = c.namedChild(j)
              if (pn && (pn.type === "type_identifier" || pn.type === "identifier" || pn.type === "type_name")) push("implements", pn.text)
            }
          }
        }
      }
    }
    if (t === "protocol_declaration") {
      // Protocol inheritance: `@protocol Child <Parent, Grandparent>` —
      // inherited parents under protocol_reference_list (mirrors the
      // analyzer). Protocols inherit other protocols in ObjC.
      const nameNode = n.namedChildren.find((c: any) => c.type === "identifier")
      if (nameNode) {
        const refList = n.namedChildren.find((c: any) => c.type === "protocol_reference_list")
        if (refList) {
          for (let i = 0; i < refList.namedChildCount; i++) {
            const cn = refList.namedChild(i)
            if (cn && cn.type === "identifier") push("extends", cn.text)
          }
        }
      }
    }
    if (t === "field_expression" && inBody) {
      // Member READS (managed-OO family contract): dot-syntax property
      // reads (`self.next`, `w.next`, `self.origin.x`) emit uses -> the
      // field name. The LHS of an assignment_expression is a WRITE, not a
      // read (mirrors the analyzer's parentType gate).
      const field = n.childForFieldName?.("field") ?? n.namedChildren.find((c: any) => c.type === "field_identifier")
      if (field && field.text.trim() && parentType !== "assignment_expression") {
        push("uses", field.text)
      }
    }
    if (t === "message_expression" && inBody) {
      // Selector = first identifier AFTER the receiver (mirrors the analyzer:
      // never the receiver itself). alloc/new -> instantiates the receiver
      // leaf; nested [[Foo alloc] ...] resolves through the inner message.
      let selectorNode: any = null
      for (let i = 1; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") { selectorNode = c; break }
      }
      if (selectorNode) {
        if (selectorNode.text === "alloc" || selectorNode.text === "new") {
          let receiverLeaf: string | null = null
          const receiver = n.namedChild(0)
          if (receiver) {
            if (receiver.type === "identifier" || receiver.type === "type_identifier") receiverLeaf = receiver.text
            else if (receiver.type === "message_expression") {
              const innerSel = receiver.namedChildren.find((c: any) => c.type === "identifier")
              if (innerSel && (innerSel.text === "alloc" || innerSel.text === "new")) {
                const innerRecv = receiver.namedChild(0)
                if (innerRecv && (innerRecv.type === "identifier" || innerRecv.type === "type_identifier")) receiverLeaf = innerRecv.text
              }
            }
          }
          if (receiverLeaf) push("instantiates", receiverLeaf)
        } else {
          push("calls", selectorNode.text)
        }
      }
    }
    if (t === "call_expression" && inBody) {
      const fn = n.namedChildren.find((c: any) => c.type === "identifier")
      if (fn) push("calls", fn.text)
    }
    if (t === "preproc_include") {
      // module name: system_lib_string stripped of <>, or string_literal
      // content (mirrors handleImport's modName extraction)
      let modName: string | null = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "system_lib_string") {
          const txt = c.text
          if (txt.length >= 2) modName = txt.slice(1, txt.length - 1)
        } else if (c.type === "string_literal") {
          const content = c.namedChildren.find((x: any) => x.type === "string_content")
          modName = content ? content.text : c.text
        }
        if (modName) break
      }
      if (modName) push("references", modName)
    }
    const nextBody = inBody || t === "method_definition" || t === "method_declaration" || t === "function_definition"
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, inBody: nextBody, parentType: t })
    }
  }
  return edges
}

// Go implicit interface-implementation truth (duck typing): a struct S
// implements interface I when S's receiver-method set (value OR pointer
// receivers) contains every method I declares. Mirrors the analyzer's
// checkGoInterfaceImplementation. Method-name set is compared (the analyzer
// also compares signatures, but name-set equality is the sufficient, stable
// truth — signature equality adds another oracle that must itself be
// mirrored, so it is intentionally simplified to the name set, which is
// still a correct superset check the analyzer also satisfies).
export function deriveGoImplements(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  // interfaceName -> Set<methodName>
  const interfaces: Record<string, Set<string>> = {}
  // interfaceName -> Set<embeddedInterfaceName>
  const embedded: Record<string, Set<string>> = {}
  // structName -> Set<embeddedStructName> (Go struct embedding promotion)
  const structEmbedded: Record<string, Set<string>> = {}
  // receiverType -> Set<methodName> (value AND pointer receivers merged)
  const structMethods: Record<string, Set<string>> = {}
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "type_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const ts = n.namedChild(i)
        if (!ts || ts.type !== "type_spec") continue
        const nm = ts.childForFieldName?.("name")?.text
        const structN = ts.namedChildren.find((c: any) => c.type === "struct_type")
        if (nm && structN) {
          // Anonymous (embedded) fields: field_declaration with NO name child —
          // its type node is the embedded type (type_identifier for `*Shape`
          // under a pointer_type). Record leaf name (mirrors analyzer's
          // embedding resolution).
          const fdl = structN.namedChildren.find((c: any) => c.type === "field_declaration_list")
          if (fdl) {
            if (!structMethods[nm]) structMethods[nm] = new Set()
          for (let k = 0; k < fdl.namedChildCount; k++) {
              const fd = fdl.namedChild(k)
              if (!fd || fd.type !== "field_declaration") continue
              const nameF = fd.childForFieldName?.("name")
              if (nameF) continue // named field, not embedding
              const typeNode = fd.childForFieldName?.("type") ?? (fd.namedChildCount > 0 ? fd.namedChild(0) : undefined)
              if (!typeNode) continue
              // Descend pointer/qualified wrappers to the leaf identifier.
              let inner: any = typeNode
              let guard = 0
              while (inner && guard++ < 4 && (inner.type === "pointer_type" || inner.type === "qualified_type")) {
                inner = inner.namedChildCount > 0 ? inner.namedChild(0) : undefined
              }
              const raw = inner?.text ?? typeNode.text
              const leaf = raw.lastIndexOf(".") !== -1 ? raw.slice(raw.lastIndexOf(".") + 1) : raw
              if (leaf) { if (!structEmbedded[nm]) structEmbedded[nm] = new Set(); structEmbedded[nm].add(leaf) }
            }
          }
        }
        const interfaceN = ts.namedChildren.find((c: any) => c.type === "interface_type")
        if (nm && interfaceN) {
          const set = new Set<string>()
          for (let j = 0; j < interfaceN.namedChildCount; j++) {
            const m = interfaceN.namedChild(j)
            if (!m) continue
            if (m.type === "method_spec") {
              const mn = m.childForFieldName?.("name")
              if (mn) set.add(mn.text)
            } else if (m.type === "constraint_elem") {
              // Embedded interface (`Reader`/`io.Closer` in
              // `interface { Reader; Close() error }`) — the embedded
              // interface's methods are promoted into the embedding
              // interface's method set. Record the embedded interface's LEAF
              // name so its methods can be folded in transitively after the
              // walk (a named embedded LOCAL interface like `Reader`
              // contribs its method set; an external `io.Closer` (leaf
              // `Closer`) is only contributed when a local interface of that
              // name exists). Matches the analyzer's promotion (fixed go
              // wave deep-review 2026-08-29).
              const child0 = m.namedChildCount > 0 ? m.namedChild(0) : undefined
              if (child0) {
                const raw = child0.text
                const leaf = raw.lastIndexOf(".") !== -1 ? raw.slice(raw.lastIndexOf(".") + 1) : raw
                if (!embedded[nm]) embedded[nm] = new Set()
                embedded[nm].add(leaf)
              }
            }
          }
          interfaces[nm] = set
        }
      }
    } else if (n.type === "method_declaration") {
      const nm = n.childForFieldName?.("name")?.text
      // receiver: function_declaration's second parameter_list holds params;
      // method_declaration's second child is the receiver param.
      let receiverType: string | undefined
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        // Receiver is the FIRST named child (parameter_list). Probe-verified
        // (2026-08-28): namedChildren = [receiver parameter_list, name,
        // params parameter_list, result..., block]. i===0 holds the receiver.
        if (c && c.type === "parameter_list" && i === 0) {
          const p = c.namedChild(0)
          if (p && (p.type === "parameter_declaration" || p.type === "receiver")) {
            const tn = p.childForFieldName?.("type")
            if (tn) receiverType = lastSegment(tn.text.replace(/^\*/, "").replace(/<.*$/, ""))
          }
        }
      }
      if (nm && receiverType) {
        if (!structMethods[receiverType]) structMethods[receiverType] = new Set()
        structMethods[receiverType].add(nm)
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  // Fold embedded-interface method sets into embedding interfaces,
  // transitively (interface { Reader } promotes Reader's methods).
  const fold = (name: string, visiting: Set<string>) => {
    const target = interfaces[name]
    if (!target || visiting.has(name)) return
    visiting.add(name)
    const embs = embedded[name]
    if (embs) {
      for (const e of embs) {
        const eSet = interfaces[e]
        if (!eSet) continue
        for (const m of eSet) target.add(m)
        fold(e, visiting)
      }
    }
    visiting.delete(name)
  }
  for (const name of Object.keys(interfaces)) fold(name, new Set())
  // Promoted struct method sets: an embedding struct includes its embedded
  // struct's methods (Go method promotion) — `Worker struct { *Shape }`
  // includes Shape's methods, so Worker implements any interface Shape
  // implements. Transitive + cycle-safe, mirrors the analyzer exactly.
  const foldStruct = (name: string, visiting: Set<string>) => {
    const target = structMethods[name]
    if (!target || visiting.has(name)) return
    visiting.add(name)
    const embs = structEmbedded[name]
    if (embs) {
      for (const e of embs) {
        const eSet = structMethods[e]
        if (eSet) for (const m of eSet) target.add(m)
        foldStruct(e, visiting)
      }
    }
    visiting.delete(name)
  }
  for (const name of Object.keys(structMethods)) foldStruct(name, new Set())
  for (const [iface, ifaceMethods] of Object.entries(interfaces)) {
    if (ifaceMethods.size === 0) continue
    for (const [structName, methods] of Object.entries(structMethods)) {
      if (structName === iface) continue
      let ok = true
      for (const m of ifaceMethods) {
        if (!methods.has(m)) { ok = false; break }
      }
      if (ok && !seen.has(structName + "->" + iface)) {
        seen.add(structName + "->" + iface)
        edges.push({ label: "implements", from: structName, target: iface })
      }
    }
  }
  return edges
}

// Zig truth: calls (identifier + field_expression-leaf callees) and uses
// (field access NOT in call-callee position), mirroring the family leaf
// contract the analyzer implements (zig wave 2026-08-29): a call_expression
// emits calls -> callee LEAF (helper -> helper, std.debug.print -> print,
// lst.append -> append); a field_expression that is not a call's direct
// callee emits uses -> field leaf (list.items.len -> len). Both skip bare
// numeric/builtin tokens. This mirrors the analyzer's analyzeZigCodeRelationships
// so the differential can verify it (it previously had NO oracle and the
// analyzer emitted no calls/uses at all).
export function deriveZigEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seenCalls = new Set<string>()
  const seenUses = new Set<string>()
  const leafOf = (fe: any): string | undefined => {
    if (!fe) return undefined
    const last = fe.namedChildCount > 0 ? fe.namedChild(fe.namedChildCount - 1) : null
    if (last && last.type === "identifier") return last.text
    return undefined
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
      const callee = n.namedChildCount > 0 ? n.namedChild(0) : null
      let leaf: string | undefined
      if (callee && callee.type === "identifier") leaf = callee.text
      else if (callee && callee.type === "field_expression") leaf = leafOf(callee)
      if (leaf && !seenCalls.has("call:" + leaf)) {
        seenCalls.add("call:" + leaf)
        edges.push({ label: "calls", from: "(expr)", target: leaf })
      }
    }
    if (n.type === "field_expression") {
      const parent = (n as any).parent
      const isCallee = !!parent && parent.type === "call_expression"
      if (!isCallee) {
        const leaf = leafOf(n)
        if (leaf && !seenUses.has("use:" + leaf)) {
          seenUses.add("use:" + leaf)
          edges.push({ label: "uses", from: "(expr)", target: leaf })
        }
      }
    }
    for (let k = n.namedChildCount - 1; k >= 0; k--) {
      const c = n.namedChild(k)
      if (c) stack.push(c)
    }
  }
  return edges
}

// Rust truth: call edges (identifier + member-leaf callees), implements
// (impl <Trait> for Type), extends (supertrait bounds on trait items).
function deriveRustEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seenCalls = new Set<string>()
  const impls: { ty: string; trait: string }[] = []
  const supertraits: Record<string, string[]> = {}

  // In-file declared type names (struct/enum/type-alias/impl targets),
  // mirroring the analyzer's deferred-instantiation contract: ctor
  // instantiates resolve ONLY to types declared in this file (std/foreign
  // receivers like String::new() are deliberately not truth). Impl types
  // are stored as FULL text (io::Error) to mirror the analyzer's inFile
  // symbol names - a foreign type implemented here is not a local
  // declaration and must not resolve io::Error::new() to the leaf Error.
  const declaredTypes = new Set<string>()
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.type === "struct_item" || n.type === "enum_item" || n.type === "type_item") {
        const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
        if (nm) declaredTypes.add(nm.text)
      } else if (n.type === "impl_item") {
        const typeN = n.childForFieldName?.("type")
        if (typeN) declaredTypes.add(typeN.text.split("<")[0].trim())
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }

  const stack: any[] = [root]
  const leafOf = (fn: any): string | undefined => {
    if (!fn) return undefined
    if (fn.type === "identifier") return fn.text
    // turbofish: foo::<T>() wraps the real callee - unwrap it.
    if (fn.type === "generic_function") {
      const inner = fn.childForFieldName?.("function")
      return leafOf(inner)
    }
    if (fn.type === "field_expression" || fn.type === "scoped_identifier") {
      const leaf = fn.namedChildren[fn.namedChildCount - 1]
      return leaf?.type === "field_identifier" || leaf?.type === "identifier" ? leaf.text : undefined
    }
    return undefined
  }
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "macro_invocation") {
      // macro invocations are real call sites (format!/write!/vec!...)
      const mn = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "scoped_identifier")
      let mname = mn ? mn.namedChildren[mn.namedChildCount - 1]?.text ?? mn.text : undefined
      if (mname && !seenCalls.has("macro:" + mname)) {
        seenCalls.add("macro:" + mname)
        edges.push({ label: "calls", from: "(expr)", target: mname })
      }
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName?.("function")
      const name = leafOf(fn)
      if (name && !seenCalls.has(name)) {
        seenCalls.add(name)
        edges.push({ label: "calls", from: "(expr)", target: name })
      }
      // ::new / Type() constructor instantiation truth mirrors the family:
      // receiver-type leaf for ::new, PascalCase leaf for tuple ctors.
      // FILTERED to in-file declared types - the analyzer resolves ctor
      // instantiates only for locally-declared types (deferred resolution),
      // so std/foreign receivers (String::new(), Arc::new()) are not truth.
      if (fn) {
        // Mirror the analyzer's ctor contract EXACTLY:
        //   Foo::new() on a field/scoped receiver -> instantiates(Foo leaf)
        //   Bare PascalCase Foo(...) identifier callee -> instantiates(Foo)
        // Enum-variant constructions (Token::Literal('.')) are CALLS, not
        // instantiates - the analyzer emits calls Literal there and never
        // instantiates Token (fixture-pinned contract). Bare identifiers
        // have no named children, so calleeLeaf is undefined - use fn.text.
        const calleeLeaf = fn.namedChildren[fn.namedChildCount - 1]
        const isNewCtor = calleeLeaf?.text === "new"
        const barePascal = fn.type === "identifier" && /^[A-Z]/.test(fn.text)
        if (
          (isNewCtor && (fn.type === "field_expression" || fn.type === "scoped_identifier")) ||
          (barePascal && fn.type === "identifier")
        ) {
          let recv: string | undefined
          if (fn.type === "identifier") recv = fn.text
          else {
            const r2 = fn.childForFieldName?.("value") ?? fn.childForFieldName?.("path")
            recv = lastSegment((r2?.text ?? "").split("<")[0].trim())
          }
          if (recv && /^[A-Z]/.test(recv) && declaredTypes.has(recv) && !seenCalls.has("inst:" + recv)) {
            seenCalls.add("inst:" + recv)
            edges.push({ label: "instantiates", from: "(expr)", target: recv })
          }
        }
      }
    } else if (n.type === "struct_expression") {
      const typeNode = n.childForFieldName?.("name") ?? n.namedChild(0)
      if (typeNode && /^[A-Z]/.test(typeNode.text)) {
        const t2 = lastSegment(typeNode.text)
        if (!seenCalls.has("struct:" + t2)) {
          seenCalls.add("struct:" + t2)
          edges.push({ label: "instantiates", from: "(expr)", target: t2 })
        }
      }
    } else if (n.type === "impl_item") {
      const traitN = n.childForFieldName?.("trait")
      const typeN = n.childForFieldName?.("type")
      if (traitN && typeN) {
        const tName = lastSegment(typeN.text.split("<")[0].trim())
        const trName = lastSegment(traitN.text.split("<")[0].trim())
        if (tName && trName) {
          edges.push({ label: "implements", from: tName, target: trName })
          impls.push({ ty: tName, trait: trName })
        }
      }
    } else if (n.type === "trait_item") {
      const nameNode = n.childForFieldName?.("name")
      const boundsNode = n.childForFieldName?.("bounds")
      if (nameNode && boundsNode) {
        const supers: string[] = []
        for (const c of boundsNode.namedChildren) {
          if (!c || c.type === "type_parameters" || c.type === "where_clause") continue
          let bn = c.text.split("<")[0].split(":").pop() || ""
          bn = lastSegment(bn.trim())
          if (/^[A-Za-z_]/.test(bn)) supers.push(bn)
        }
        if (supers.length) supertraits[nameNode.text] = supers
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  // supertrait extends truth
  for (const [tr, supers] of Object.entries(supertraits)) {
    for (const sp of supers) edges.push({ label: "extends", from: tr, target: sp })
  }
  return edges
}

// Independent oracle: derive extends/implements/instantiates edges straight
// from clause node structure — no analyzer code involved.
export function deriveTreeEdges(root: any, lang: string): TreeEdge[] {
  const edges: TreeEdge[] = []
  const TYPE = /type_identifier|scoped_type_identifier|generic_type|^identifier$/
  const collect = (x: any, label: string, clsName: string) => {
    if (!x) return
    if (TYPE.test(x.type)) edges.push({ label, from: clsName, target: x.text })
    else for (let k = 0; k < x.namedChildCount; k++) collect(x.namedChild(k), label, clsName)
  }
  const walk = (n: any) => {
    const t = n.type
    if (/^(class|interface|record|trait|object)_declaration$|^enum_declaration$|^class_definition$|^trait_definition$|^object_definition$|^(class|struct|union)_specifier$/.test(t)) {
      const nameNode =
        n.childForFieldName?.("name") ??
        n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")
      const clsName = nameNode?.text ?? "?"
      // extends side: superclass (classes), extends_interfaces+type_list
      // (java-style interfaces), extends_type_clause (typescript interfaces),
      // base_class_clause (cpp - flat children, access specifiers skipped)
      const sup = n.childForFieldName?.("superclass") ?? n.namedChildren.find((c: any) => c.type === "superclass" || c.type === "extends_interfaces" || c.type === "extends_type_clause")
      const cppClause = t === "class_specifier" || t === "struct_specifier"
        ? n.namedChildren.find((c: any) => c.type === "base_class_clause")
        : undefined
      if (cppClause) {
        for (const c of cppClause.namedChildren) {
          if (!c || c.type === "access_specifier") continue
          // base NAME only: the first type node inside the child. Blanket
          // collection descended into template argument lists and pushed
          // TYPE PARAMETERS (Char, T...) as fake bases.
          const typeNode =
            c.childForFieldName?.("name") ??
            c.namedChildren.find((x: any) => /type_identifier|qualified_identifier|template_type/.test(x.type)) ?? c
          let baseName = typeNode.text
          const lt2 = baseName.indexOf("<")
          if (lt2 !== -1) baseName = baseName.slice(0, lt2)
          baseName = lastSegment(baseName)
          if (baseName && /^[A-Za-z_]/.test(baseName)) {
            edges.push({ label: "extends", from: clsName, target: baseName })
          }
        }
      }
      if (sup) {
        if (sup.type === "superclass" || sup.type === "extends_interfaces") {
          if (lang === "dart") {
            // dart superclass = seq(base_type, type_arguments?, mixins?) —
            // type ARGUMENTS are arguments, not inherited bases (same rule
            // as the typescript extends_type_clause fix below), and mixins
            // are `uses`, not `extends` (deriveDartEdges emits them as uses).
            // Without this, `class _X extends State<X>` pushed extends->X
            // (the generic arg) as a fake base.
            for (const c of sup.namedChildren) {
              if (!c || c.type === "type_arguments" || c.type === "mixins") continue
              collect(c, "extends", clsName)
            }
          } else {
            collect(sup, "extends", clsName)
          }
        } else if (sup.type === "extends_type_clause") {
          // typescript interface heritage: type_arguments are ARGUMENTS,
          // not inherited bases - descend only into real type nodes
          // (mirrors the analyzer's fix for phantom "<string>" targets)
          for (const c of sup.namedChildren) {
            if (!c || c.type === "type_arguments") continue
            collect(c, "extends", clsName)
          }
        }
      }
      // implements side
      const impls = n.childForFieldName?.("interfaces") ?? n.namedChildren.find((c: any) => c.type === "super_interfaces")
      if (impls) collect(impls, "implements", clsName)
      // typescript: class_heritage > extends_clause / implements_clause
      if (t === "class_declaration" || t === "interface_declaration") {
        const heritage = n.namedChildren.find((c: any) => c.type === "class_heritage")
        if (heritage) {
          const ext2 = heritage.namedChildren.find((c: any) => c.type === "extends_clause")
          // type_arguments are ARGUMENTS, not inherited bases - descending
          // into them pushed type PARAMETERS (K, Props, Events...) as fake
          // extends targets (svelte repo .d.ts corpus).
          if (ext2) {
            for (const c of ext2.namedChildren) {
              if (!c || c.type === "type_arguments" || c.type === "type_parameters") continue
              collect(c, "extends", clsName)
            }
          }
          const imp2 = heritage.namedChildren.find((c: any) => c.type === "implements_clause")
          if (imp2) {
            for (const c of imp2.namedChildren) {
              if (!c || c.type === "type_arguments") continue
              collect(c, "implements", clsName)
            }
          }
        }
      }
      // scala extends_clause: first supertype extends, rest implements;
      // on trait_definition all are extends
      if (t === "class_definition" || t === "trait_definition" || t === "object_definition") {
        const extClause = n.namedChildren.find((c: any) => c.type === "extends_clause")
        if (extClause) {
          const isTraitDecl = t === "trait_definition"
          let first = true
          for (let i = 0; i < extClause.namedChildCount; i++) {
            const st = extClause.namedChild(i)
            if (!st) continue
            // head segment only for generic supertypes (Something[Test.A] -> Something)
            let target = ""
            if (/type_identifier|user_type|stable_type_identifier|generic_type$/.test(st.type)) {
              target = st.text
              const lt = target.indexOf("[")
              if (lt !== -1) target = target.slice(0, lt)
            } else if (st.type === "generic_type" && st.namedChildCount > 0) {
              const head = st.namedChild(0)
              target = head?.text ?? ""
              const lt = target.indexOf("[")
              if (lt !== -1) target = target.slice(0, lt)
            }
            if (!target) continue
            if (isTraitDecl || first) edges.push({ label: "extends", from: clsName, target })
            else edges.push({ label: "implements", from: clsName, target })
            first = false
          }
        }
      }
      // kotlin delegation_specifiers: first constructor_invocation = extends,
      // every other user_type = implements; on interface_declaration all extends
      // M14 #419 kotlin wave: tree-sitter-kotlin parses `interface X : Y` as
      // class_declaration with an `interface` keyword child (there is NO
      // interface_declaration node type), so interface detection must check
      // the keyword too — otherwise every kotlin interface was mislabelled
      // implements (the analyzer emits extends; the oracle emitted implements,
      // fabricating a permanent MISSING+UNEXPLAINED pair per interface).
      // NOTE: the `interface` keyword is an UNNAMED child of class_declaration
      // in tree-sitter-kotlin, so namedChildren cannot see it — scan child()
      // like the analyzer's walk does (someSymbol(n.children)).
      let hasInterfaceKeyword = false
      for (let ci = 0; ci < n.childCount; ci++) {
        if (n.child(ci)?.type === "interface") { hasInterfaceKeyword = true; break }
      }
      const isInterfaceDecl = t === "interface_declaration" || (t === "class_declaration" && hasInterfaceKeyword)
      let extendsUsed = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const d = n.namedChild(i)
        if (!d || d.type !== "delegation_specifier") continue
        const ctor = d.namedChildren?.find((c: any) => c.type === "constructor_invocation")
        const userType = ctor
          ? ctor.namedChild(0)?.type === "user_type" ? ctor.namedChild(0) : d.namedChildren?.find((c: any) => c.type === "user_type")
          : d.namedChildren?.find((c: any) => c.type === "user_type")
        // M14 #419 kotlin wave: dotted supertypes (class Builder :
        // DatabaseConfig.Builder()) keep the FULL path — the analyzer emits
        // DatabaseConfig.Builder, so truncating to the first identifier
        // (DatabaseConfig) fabricated an unmatched oracle edge. Only DIRECT
        // type_identifier children are joined; type ARGUMENTS
        // (SuspendExecutable<Int, ...>) stay nested under type_arguments and
        // never leak in as phantom supertypes.
        const tids = userType ? (userType.namedChildren ?? []).filter((c: any) => c.type === "type_identifier") : []
        const head = tids.length > 0 ? { text: tids.map((c: any) => c.text).join(".") } : userType
        if (ctor && head && !isInterfaceDecl && !extendsUsed) {
          edges.push({ label: "extends", from: clsName, target: head.text })
          extendsUsed = true
        } else if (head) {
          edges.push({ label: isInterfaceDecl ? "extends" : "implements", from: clsName, target: head.text })
        }
      }
    }
    if (t === "object_creation_expression") {
      const typeNode = n.namedChildren.find((c: any) => /type_identifier|scoped_type_identifier|generic_type$/.test(c.type))
      if (typeNode) edges.push({ label: "instantiates", from: "(expr)", target: typeNode.text })
    }
    // typescript/javascript: `new X()` parses as new_expression
    const GLOBAL_CTORS = new Set(["Promise","Date","Map","Set","WeakMap","WeakSet","Symbol","Proxy","Error","TypeError","RangeError","SyntaxError","URIError","EvalError","AggregateError","RegExp","Array","Object","Function","Boolean","Number","String","BigInt","ArrayBuffer","SharedArrayBuffer","DataView","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Uint16Array","Int32Array","Uint32Array","Float32Array","Float64Array","BigInt64Array","BigUint64Array","WeakRef","FinalizationRegistry","AbortController","FormData","Blob","File","URL","URLSearchParams","Headers","Request","Response","Intl","Image","Worker","SharedWorker","CustomEvent","Event","MouseEvent","KeyboardEvent","FocusEvent","InputEvent","PointerEvent","TouchEvent","DragEvent","ErrorEvent","UIEvent","StorageEvent","PromiseRejectionEvent","HashChangeEvent","PageTransitionEvent","PopStateEvent","ProgressEvent","AnimationEvent","TransitionEvent","ClipboardEvent","WheelEvent","CompositionEvent","ResizeObserver","MutationObserver","IntersectionObserver","PerformanceObserver","FileReader","XMLHttpRequest","WebSocket","TextEncoder","TextDecoder","DOMParser","Notification","BroadcastChannel","MessageChannel"])
    if (t === "new_expression") {
      const tn = n.namedChild(0)
      if (tn) {
        // Construction candidates are NAMEABLE leaves only: identifier or
        // dotted member path. Anonymous constructor expressions —
        // `new (Backbone.Collection.extend({...}))()`, `new (fn())()` —
        // have no honest target name; deriving their raw expression text
        // fabricated unmatchable oracle edges (lodash corpus).
        const isNameable =
          tn.type === "identifier" || tn.type === "member_expression" ||
          tn.type === "qualified_identifier" || tn.type === "template_type" ||
          tn.type === "generic_type" || tn.type === "type_identifier" ||
          tn.type === "type_descriptor" || tn.type === "primitive_type"
        let name = isNameable ? tn.text : ""
        const lt = name.indexOf("<") !== -1 ? name.indexOf("<") : name.indexOf("(")
        if (lt !== -1) name = name.slice(0, lt)
        // `new` keyword alone is the construction signal - casing is
        // irrelevant (lowercase classes are legal TypeScript)
        if (isNameable && !GLOBAL_CTORS.has(name.split(".").pop() ?? name) && (/^[A-Za-z_$]/.test(name) || name.includes(".") || name.includes("::"))) {
          // normalize to LEAF segment - analyzers emit leaf names
          edges.push({ label: "instantiates", from: "(expr)", target: lastSegment(name.split("<")[0].split("(")[0]) })
        }
      }
    }
    // scala: every `new X` / `new X(...)` / `new X[T](...)` parses as
    // instance_expression
    if (t === "instance_expression") {
      const tn = n.namedChild(0)
      if (tn) {
        let name = tn.text
        if (tn.type === "generic_type" && tn.namedChildCount > 0) name = tn.namedChild(0).text
        edges.push({ label: "instantiates", from: "(expr)", target: name })
      }
    }
    // kotlin/scala: constructions appear as call_expressions whose callee
    // leaf follows the PascalCase type convention - RECEIVER-LESS only
    // (MEASURED twice: kotlin Exposed wave and scala3 300-file sample found
    // qualified obj.Method() calls are enum-case/module member accesses;
    // treating them as constructions fabricated hundreds of edges).
    // Scala additionally has explicit `new X` (object_creation_expression)
    // and instance_expression, both handled above regardless of casing.
    if ((lang === "kotlin" || lang === "scala") && t === "call_expression") {
      const callee = n.namedChild(0)
      // Curried application wrapper: `List.fill(2)("a")` parses as an outer
      // call whose function is the inner call. Analyzers emit the inner
      // call only (documented curried-application rule) - deriving an edge
      // from the wrapper would count a phantom instantiates. SKIP DERIVATION
      // ONLY - recursion into children must continue (nested
      // instance_expressions inside e.g. let(new Foo) still count).
      const curried = callee?.type === "call_expression"
      if (!curried) {
      let leaf = ""
      let qualified = false
      if (callee?.type === "navigation_expression") {
        qualified = true
        const sel = callee.namedChild(callee.namedChildCount - 1)
        leaf = sel?.text ?? ""
      } else if (callee?.type === "field_expression") {
        // scala3 qualified call `Util.escapeChar(...)`: only the FINAL
        // selector is the called name - the receiver path must not leak
        // into the target (Util.escapeChar was being emitted whole).
        qualified = true
        const kids = callee.namedChildren
        const last = kids[kids.length - 1]
        leaf = last && /identifier|_type$/.test(last.type) ? last.text : ""
      } else if (callee) {
        leaf = callee.text.split("<")[0]
      }
      leaf = leaf.replace(/\(.*$/, "").replace(/^['`]/, "").trim()
      // scala type args use SQUARE brackets (List[(A, B)](...)): strip them
      // so oracle targets are clean base names, matching analyzer output.
      // Iterative strip: nested type args List[(A[B], C)] need repeated passes.
      let prevLeaf
      do { prevLeaf = leaf; leaf = leaf.replace(/\[[^\[\]]*\]/g, "") } while (leaf !== prevLeaf)
      leaf = leaf.trim()
      if (leaf && /^[A-Z]/.test(leaf) && !qualified) edges.push({ label: "instantiates", from: "(expr)", target: leaf })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  // dedupe identical edges (oracle double-push guard)
  // overrides truth: same-name methods across in-file inheritance chains.
  // Only declarations related by extends/implements within THIS file count -
  // cross-file override resolution is the analyzer's job, not the oracle's.
  const decls: Record<string, { parents: string[]; methods: Set<string> }> = {}
  const declParents: { child: string; parent: string }[] = []
  const collectDecl = (n: any) => {
    const t2 = n.type
    if (/^(class|interface|record|trait|object)_declaration$|^class_definition$|^trait_definition$|^object_definition$|^(class|struct|union)_specifier$/.test(t2)) {
      const nameNode = n.childForFieldName?.("name") ?? n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")
      const nm = nameNode?.text
      if (nm && !decls[nm]) {
        decls[nm] = { parents: [], methods: new Set() }
        // cpp classes use field_declaration_list (no 'body' substring)
        const body = n.namedChildren.find((c: any) => /body|field_declaration_list/.test(c.type))
        if (body) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const m = body.namedChild(i)
            if (/function_definition|function_declaration|method_declaration|method_definition|method_signature|field_declaration|declaration/.test(m?.type ?? "")) {
              // cpp class members are field_declaration > function_declarator;
              // other families keep the name as a direct identifier child.
              const fd = m.namedChildren.find((c: any) => c.type === "function_declarator")
              let mn: any = null
              if (!fd && /field_declaration|declaration/.test(m.type)) continue // member VARIABLE, not a method
              if (fd) {
                // cpp nests the name: function_declarator has a `declarator`
                // FIELD holding the method name (field_identifier, possibly
                // wrapped in pointer/reference_declarator) and a separate
                // `parameters` field. Walking the WHOLE subtree in LIFO order
                // grabs a parameter identifier instead (e.g. `Send(const
                // std::string& message)` -> `message`), fabricating
                // override pairs that the analyzer rightly rejects. Only the
                // declarator field carries the name.
                const declField = fd.childForFieldName?.("declarator")
                const st2: any[] = [declField ?? fd]
                while (st2.length && !mn) {
                  const x = st2.pop()!
                  // Class-member methods carry field_identifier as the name;
                  // a bare `identifier` in a class body is a MACRO invocation
                  // (`GTEST_DISALLOW_COPY_AND_ASSIGN_(A);` parses as
                  // declaration > function_declarator > identifier). Treating
                  // the macro as a method fabricates override pairs shared by
                  // every class that disables copies.
                  if (x.type === "field_identifier") { mn = x; break }
                  for (let k = 0; k < x.namedChildCount; k++) st2.push(x.namedChild(k))
                }
              } else {
                mn = m.namedChildren.find((c: any) => /identifier/.test(c.type))
              }
              // constructors are NOT virtually dispatched - no family
              // analyzer emits ctor-overrides, so truth must not either.
              // (cpp ctor name == class name; also skip same-name-as-class
              // members to avoid self/hierarchy name collisions)
              if (mn && mn.text !== "constructor" && mn.text !== nm) decls[nm].methods.add(mn.text)
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) collectDecl(n.namedChild(i))
  }
  collectDecl(root)
  // hierarchy from already-derived extends edges (head-segment normalized)
  for (const e of edges) {
    if (e.label !== "extends" && e.label !== "implements") continue
    const parent = lastSegment(e.target)
    if (decls[e.from] && decls[parent] && e.from !== parent) {
      declParents.push({ child: e.from, parent })
    }
  }
  for (const rel of declParents) {
    const childDecl = decls[rel.child]
    const parentDecl = decls[rel.parent]
    if (!childDecl || !parentDecl) continue
    for (const m of childDecl.methods) {
      if (parentDecl.methods.has(m)) {
        edges.push({ label: "overrides", from: `${rel.child}.${m}`, target: `${rel.parent}.${m}` })
      }
    }
  }

  return edges.filter((e, i) => edges.findIndex(x => x.label === e.label && x.from === e.from && x.target === e.target) === i)
}

export interface DifferentialEvaluation {
  comparable: boolean
  regressions: string[]
  perfRegressions: string[]
  checks: { id: string; description: string; status: "pass" | "fail"; detail: string }[]
}

/**
 * Evaluate a differential report before evidence is emitted. Keeping this
 * pure makes the evidence decision testable without parsing a corpus.
 */
export function evaluateDifferential(
  report: Record<string, any>,
  current: Record<string, any>,
  baseline: Record<string, any>,
  baselineSample: number | undefined,
  samplePerLang: number,
  repo: string,
): DifferentialEvaluation {
  const comparable = !baselineSample || baselineSample === samplePerLang
  const perfRegressions: string[] = []
  const regressions: string[] = []
  if (comparable) {
    for (const l of Object.keys(current)) {
      const bAvg = baseline[l]?.perf?.avgMsPerFile
      const cAvg = current[l]?.perf?.avgMsPerFile
      if (bAvg && cAvg && cAvg > Math.max(3 * bAvg, bAvg + 50)) {
        perfRegressions.push(`${l}: avg ${bAvg}ms -> ${cAvg}ms per file`)
      }
    }
    const avgs = Object.values(current)
      .map((c: any) => c.perf?.avgMsPerFile)
      .filter((x: any) => typeof x === "number" && x > 0)
      .sort((a: number, b: number) => a - b)
    if (avgs.length >= 3) {
      const median = avgs[Math.floor(avgs.length / 2)]
      for (const l of Object.keys(current)) {
        const cAvg = current[l]?.perf?.avgMsPerFile
        if (cAvg && median && cAvg > Math.max(3 * median, median + 200)) {
          perfRegressions.push(`${l}: outlier vs median (${cAvg}ms vs ${median}ms median)`)
        }
      }
    }
    for (const l of Object.keys(current)) {
      if (baseline[l] && (current[l].missing > baseline[l].missing || current[l].unexplained > baseline[l].unexplained || current[l].heuristic > baseline[l].heuristic)) {
        regressions.push(l)
      }
    }
  }
  const failed = new Set([
    ...regressions.map(key => key.split(":").pop() ?? key),
    ...perfRegressions.map(x => x.split(":")[0]),
  ])
  const checks = Object.entries(report).map(([lang, r]: any) => ({
    id: `differential-${lang}`,
    description: `${repo}: tree-truth vs analyzer diff`,
    status: comparable && !failed.has(lang) ? "pass" as const : "fail" as const,
    detail: comparable
      ? `${r.filesSampled} files, coverage ${r.coveragePct}%, unexplained ${r.fabricationPct}%${failed.has(lang) ? "; regression detected" : ""}`
      : `${r.filesSampled} files; NOT COMPARABLE: baseline sampled ${baselineSample ?? "unknown"}/lang, run ${samplePerLang}/lang`,
  }))
  return { comparable, regressions, perfRegressions, checks }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  const repoDir = path.join(CORPUS_ROOT, REPO)
  if (!fs.existsSync(repoDir)) throw new Error(`corpus repo missing: ${repoDir}`)
  const repoPin = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim()

  const report: Record<string, any> = {}
  for (const [lang, cfg] of Object.entries(LANGS)) {
    const files: string[] = []
    const scan = (d: string) => {
      if (files.length > 4000) return
      let entries
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) scan(p) }
        else if (e.name.endsWith("." + cfg.ext)) files.push(p)
      }
    }
    scan(repoDir)

    const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
    const analyzer = new mod[cfg.className]()

    // Cross-file type-kind aid for csharp (CSD1): the analyzer resolves a
    // base-list entry's interface-vs-class kind via a cross-file symbol
    // companion. The per-file oracle can't see other files, so give it the
    // corpus-level set of all C# INTERFACE names (regex pass over the corpus
    // text — cheap, no second parse) so `class X : ICommandRuntime2` and
    // `interface Y : IWSManConnectionOptions` resolve deterministically to
    // implements / extends the same way the analyzer does.
    const CSHARP_INTERFACES = new Set<string>()
    if (lang === "csharp") {
      const re = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/g
      for (const f of files) {
        let s: string
        try { s = fs.readFileSync(f, "utf8") } catch { continue }
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(s))) if (m[1]) CSHARP_INTERFACES.add(m[1])
      }
      // Same corpus knowledge handed to the ANALYZER as its cross-file
      // `context.typeKinds` companion (values = SymbolKind.Interface string).
      // Now `class X : IArgumentCompleter` resolves to implements on BOTH
      // sides — the analyzer with a real companion and the oracle with the
      // same set — instead of the analyzer falling back to deterministic
      // extends (which the oracle would then contradict).
    }
    const CSHARP_INTERFACE_KINDS = new Map<string, string>()
    if (lang === "csharp") for (const nm of CSHARP_INTERFACES) CSHARP_INTERFACE_KINDS.set(nm, "interface")

    // Swift: same cross-file companion for protocol adoption. A class's first
    // base is extends ONLY if it is a class — a first-base protocol is still
    // implements (SWIFTD1 resolution). The corpus protocol-name set (regex
    // pass, cheap) is handed to BOTH the analyzer (context.typeKinds) and the
    // oracle so `class X: SomeProtocol` resolves to implements identically.
    const SWIFT_PROTOCOLS = new Set<string>()
    const SWIFT_TYPE_KINDS = new Map<string, string>()
    if (lang === "swift") {
      const re = /\bprotocol\s+([A-Za-z_][A-Za-z0-9_]*)/g
      for (const f of files) {
        let s: string
        try { s = fs.readFileSync(f, "utf8") } catch { continue }
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(s))) if (m[1]) SWIFT_PROTOCOLS.add(m[1])
      }
      for (const nm of SWIFT_PROTOCOLS) SWIFT_TYPE_KINDS.set(nm, "interface")
    }

    const sample = seededPick(files, SAMPLE_PER_LANG, `${REPO}:${lang}:m14-f5`)
    let treeEdgesTotal = 0, coveredByAnalyzer = 0, missingInAnalyzer = 0
    let analyzerEdgesTotal = 0, explainableByTree = 0, unexplainedInAnalyzer = 0
    let heuristicUnexplained = 0
    const samples: any[] = []
    const samplesHeuristic: any[] = []

    const durations: number[] = []
    // Warm-up: the first parse of a language in this process pays one-time
    // wasm compilation (measured: ~15s for tree-sitter core + grammar init,
    // which poisoned a 52-file average as +280ms/file and tripped the F9
    // budget spuriously). The perf budget measures steady-state per-file
    // analysis cost, so one untimed warm-up parse precedes the timed loop.
    try {
      parser.parse("class WarmUp { void m() {} }")
    } catch {
      /* warm-up is best-effort; timing proceeds regardless */
    }
    for (const f of sample) {
      const content = fs.readFileSync(f, "utf8")
      const relPath = path.relative(repoDir, f)
      let root
      let result
      const tf0 = performance.now()
      try { root = parser.parse(content).rootNode } catch { continue }
      if (!root) continue
      try {
        if (lang === "vue" || lang === "svelte") {
          // SFC parity: script blocks must be pre-parsed by the engine or
          // the script-side edges never appear.
          const eng = await import("../../src/ast/engine")
          result = await (eng as any).ASTEngine.parseFile(f, content)
        } else {
          result = await analyzer.analyze(root, content, relPath, lang === "csharp" ? { typeKinds: CSHARP_INTERFACE_KINDS as Map<string, string> } : lang === "swift" ? { typeKinds: SWIFT_TYPE_KINDS as Map<string, string> } : undefined)
        }
      } catch { continue }
      durations.push(performance.now() - tf0)

      const truth = deriveTreeEdges(root, lang)
      if (lang === "vue") {
        // template component-usage oracle: independent HTML-core filter
        for (const e of deriveVueComponentUsages(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "c") {
        for (const e of deriveCCalls(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "rust") {
        for (const e of deriveRustEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "go") {
        for (const e of deriveGoEdges(root)) {
          ;(truth as any[]).push(e)
        }
        for (const e of deriveGoImplements(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "zig") {
        for (const e of deriveZigEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "csharp") {
        for (const e of deriveCSharpEdges(root, CSHARP_INTERFACES)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "dart") {
        for (const e of deriveDartEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "swift") {
        for (const e of deriveSwiftEdges(root, SWIFT_PROTOCOLS)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "objc") {
        for (const e of deriveObjcEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "svelte") {
        for (const e of deriveSvelteComponentUsages(root)) {
          ;(truth as any[]).push(e)
        }
        // Script-side truth: the svelte grammar stores script bodies as
        // opaque raw_text - re-parse them and derive the SAME structural
        // edges (extends/implements/instantiates) the non-SFC languages get.
        const subTrees = await deriveEmbeddedScriptTrees(root, content, "svelte")
        for (const st of subTrees) {
          for (const e of deriveTreeEdges(st, "javascript")) (truth as any[]).push(e)
        }
      }
      if (lang === "vue") {
        const subTrees = await deriveEmbeddedScriptTrees(root, content, "vue")
        for (const st of subTrees) {
          for (const e of deriveTreeEdges(st, "typescript")) (truth as any[]).push(e)
        }
      }
      if (lang === "typescript" && process.argv.includes("--debug-truth")) {
        console.log(`[debug] ${relPath}: truth=${truth.length} declRoot=${root.type}`)
      }
      const rels = (result.relationships ?? []).map((r: any) => ({
        label: String(r.type ?? r.relationshipType ?? ""),
        target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
        line: r.line_number ?? 0,
        confidence: typeof r.confidence === "number" ? r.confidence : 1,
      // c, rust and go compare CALL edges too (their independently derivable
      // truth); zig derives calls AND uses; other languages do not derive
      // call truth, so including calls there would flag every real call edge
      // as unexplained.
      })).filter((r: any) => ["extends", "implements", "instantiates", ...(lang !== "csharp" && lang !== "dart" && lang !== "swift" ? ["overrides"] : []), ...(lang === "c" || lang === "rust" || lang === "go" || lang === "dart" || lang === "objc" ? ["calls"] : []), ...(lang === "zig" || lang === "swift" || lang === "objc" ? ["calls", "uses"] : []), ...(lang === "dart" ? ["uses"] : []), ...(lang === "csharp" ? ["calls"] : []), ...(lang === "swift" || lang === "objc" ? ["references"] : [])].includes(r.label))
        // The tree-truth oracles already emit UNIQUE (label,target) edges per
        // file (each oracle keeps a `seen` set keyed by label+target). The
        // analyzer, by contrast, emits one edge per source SEARCH HIT, so a
        // target constructed/called N times yields N duplicate (label,target)
        // edges. Because the coverage match below is deliberately site-agnostic
        // (it compares label+target only, never the source line), those
        // duplicates were being double-counted as fabrication. Collapsing them
        // to one edge per (label,target) aligns the analyzer side with the
        // truth-side semantics. This never removes a match a truth edge relied
        // on (the kept occurrence still matches), so it is safe for every
        // already-gated language -- it can only remove duplicate fabrication.
        .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => (x.label + "|" + x.target) === k) })

      treeEdgesTotal += truth.length
      analyzerEdgesTotal += rels.length

      for (const te of truth) {
        const hit = rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))
        if (hit) coveredByAnalyzer++
        else { missingInAnalyzer++; if (samples.length < 300) samples.push({ dir: "MISSING", file: relPath, ...te }) }
      }
      for (const r of rels) {
        const hit = truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))
        if (hit) { explainableByTree++; continue }
        // Evidence-tier split for unmatched analyzer edges: a low-confidence
        // edge is DECLARED HEURISTIC (honest suspicion), not fabrication.
        // Only confident unmatched edges count as fabrications.
        const conf = typeof r.confidence === "number" ? r.confidence : 1
        if (conf < 0.7) {
          heuristicUnexplained++
          if (samples.length < 300 && samplesHeuristic.length < 100) samplesHeuristic.push({ dir: "HEURISTIC", file: relPath, ...r })
        } else {
          unexplainedInAnalyzer++
          if (samples.length < 300) samples.push({ dir: "UNEXPLAINED", file: relPath, ...r })
        }
      }
    }

    report[lang] = {
      filesSampled: sample.length,
      treeTruthEdges: treeEdgesTotal,
      coveredByAnalyzer,
      missingInAnalyzer,
      analyzerEdges: analyzerEdgesTotal,
      explainableByTree,
      unexplainedInAnalyzer,
      heuristicUnexplained,
      coveragePct: treeEdgesTotal ? +(100 * coveredByAnalyzer / treeEdgesTotal).toFixed(1) : null,
      fabricationPct: analyzerEdgesTotal ? +(100 * unexplainedInAnalyzer / analyzerEdgesTotal).toFixed(1) : null,
      perf: {
        avgMsPerFile: durations.length ? +(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) : null,
        maxMsPerFile: durations.length ? +Math.max(...durations).toFixed(1) : null,
        samplesTimed: durations.length,
      },
      samples,
    }
    console.log(`[${REPO}] ${lang}: files=${sample.length} tree-truth=${treeEdgesTotal} covered=${coveredByAnalyzer} (${report[lang].coveragePct}%) MISSING=${missingInAnalyzer} | analyzer-edges=${analyzerEdgesTotal} unexplained=${unexplainedInAnalyzer} (${report[lang].fabricationPct}%)`)
  }

  // Evaluate against the pinned baseline BEFORE emitting F5 evidence. The
  // previous implementation emitted every check as `pass`, then performed
  // the comparison afterward, allowing stale evidence to claim green.
  const BASELINE = path.join(ROOT, "validation", "m14", "differential-baseline.json")
  const parsedBaseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {}
  const baselineCounts = parsedBaseline.counts ?? parsedBaseline
  const current: Record<string, any> = {}
  for (const [lang, r] of Object.entries<any>(report)) current[`${REPO}:${lang}`] = {
    missing: r.missingInAnalyzer, unexplained: r.unexplainedInAnalyzer,
    heuristic: r.heuristicUnexplained,
    perf: { avgMsPerFile: r.perf.avgMsPerFile },
  }
  const evaluation = evaluateDifferential(report, current, baselineCounts, parsedBaseline.samplePerLang, SAMPLE_PER_LANG, REPO)

  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F5",
    title: "Differential corpus harness",
    claimLevel: "L1",
    layers: ["differential"],
    checks: evaluation.checks.map(check => ({
      ...check,
      description: `${check.description} @${repoPin.slice(0, 10)}`,
    })),
    limitations: [
      { description: "second opinion is a clause-structure re-derivation from the same wasm grammars; a grammar bug shared by both paths would be invisible to this harness" },
      { description: "seeded sample of files per language, deterministic; not exhaustive over the corpus" },
      { description: "coverage/fabrication baselines recorded; wave M14.1 must reduce missing/unexplained counts" },
    ],
    data: {
      corpusPins: { [REPO]: repoPin },
      samplingRule: `seeded ${SAMPLE_PER_LANG} files/language`,
      report,
    },
  })
  console.log("evidence written: validation/m14/results/M14.0.F5.json")

  // Improvement-forcing gate: missing/unexplained counts may never grow.
  // Baseline updates are explicit and are not silently treated as validation.
  const updateBaseline = process.argv.includes("--update-baseline")
  if (updateBaseline) {
    const previous = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {}
    const merged = {
      samplePerLang: SAMPLE_PER_LANG,
      counts: { ...(previous.counts ?? previous), ...current },
    }
    fs.writeFileSync(BASELINE, JSON.stringify(merged, null, 2) + "\n")
    console.log("differential baseline updated:", current)
  } else if (!evaluation.comparable) {
    console.log(`differential baseline gate: SKIPPED (baseline sampled ${parsedBaseline.samplePerLang ?? "unknown"}/lang, this run ${SAMPLE_PER_LANG}/lang — probe mode, not comparable)`)
  } else {
    for (const r of evaluation.regressions) console.error(`DIFFERENTIAL REGRESSION ${r}: ${JSON.stringify(baselineCounts[r])} -> ${JSON.stringify(current[r])}`)
    for (const r of evaluation.perfRegressions) console.error(`PERF BUDGET EXCEEDED ${r}`)
    if (evaluation.regressions.length || evaluation.perfRegressions.length) process.exit(5)
    console.log("differential baseline gate: no regressions; perf budgets respected")
  }
}

if (process.argv[1]?.endsWith("differential.ts")) {
  main().catch(e => { console.error(e); process.exit(1) })
}
