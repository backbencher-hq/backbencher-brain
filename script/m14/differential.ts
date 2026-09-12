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
import { PHP_BUILTINS } from "../../src/ast/real-php-analyzer"
import { RUBY_BUILTINS, RAILS_MACRO_METHODS, isRubyStaticSuperclassName } from "../../src/ast/real-ruby-analyzer"
import { PYTHON_BUILTINS } from "../../src/ast/real-python-analyzer"
import { csharpMemberDeclaredTypeText, csharpResolveTargetTypedNew } from "../../src/ast/real-csharp-analyzer"

function loadAvg1(): number {
  try { return parseFloat(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0] ?? "0") } catch { return 0 }
}

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
// Crash-resume journal for full sweeps: each completed lane is persisted
// immediately (see the per-lane write in the sweep loop). Cleared after a
// successful final evidence emit.
const LANE_JOURNAL = "/tmp/m14-f5-lane-journal.json"
// Per-language corpus routing: each language runs against a repo that
// ACTUALLY CONTAINS it. The previous single-repo default (grails-core) gave
// vacuous 0-file "pass" rows for php/ruby/etc (nothing to verify — logged as
// `files=0`), and the single-pin corpusPins emission silently DISCARDED the
// historical multi-repo pin set on every run. Default now sweeps one honest
// repo per language; --repo <name> still restricts to a single repo.
const LANG_REPOS: Record<string, string> = {
  java: "grails-core",
  groovy: "grails-core",
  kotlin: "Exposed",
  scala: "scala3",
  typescript: "vue-core",
  javascript: "grails-core",
  vue: "element-plus",
  svelte: "svelte",
  c: "sqlite",
  cpp: "fmt",
  rust: "ripgrep",
  go: "go-tools",
  zig: "zig",
  csharp: "powershell",
  dart: "proxicall",
  swift: "swift-nio",
  objc: "sdwebimage",
  php: "phpunit",
  ruby: "rake",
  python: "cython",
  haskell: "cabal",
}
// M37.16 two-corpus gate (second-opinion hardening): every gated language runs
// the SAME analyzer-vs-oracle differential on a SECOND, independent real corpus
// in the default sweep, so a defect with zero occurrences in the primary repo
// (SWIFTD18 class — multi-binding in swift-nio had 0 sites) is exercised by a
// different codebase's dialect. Rows are keyed repo:lang in the baseline/current
// maps exactly like the primary rows, so regressions on EITHER corpus block
// release. Each repo is an independent git checkout under CORPUS_ROOT whose
// pin is recorded in corpusPins.
const SECOND_CORPUS: Record<string, string> = {
  java: "clojure",
  groovy: "geb",
  kotlin: "kotlinx-coroutines",
  scala: "cats-effect",
  typescript: "element-plus",
  javascript: "lodash",
  vue: "vue-element-admin",
  svelte: "shadcn-svelte",
  c: "jq",
  cpp: "nlohmann-json",
  rust: "cargo",
  go: "terraform",
  zig: "zls",
  csharp: "fsharp",
  dart: "dart-http",
  swift: "alamofire",
  objc: "afnetworking",
  php: "phpmyadmin",
  ruby: "rack",
  python: "requests",
  haskell: "hledger",
}
const REPO = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : undefined
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
  cpp: { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cc,h" },
  c: { wasm: "tree-sitter-c.wasm", analyzerFile: "real-c-analyzer", className: "RealCAnalyzer", ext: "c" },
  rust: { wasm: "tree-sitter-rust.wasm", analyzerFile: "real-rust-analyzer", className: "RealRustAnalyzer", ext: "rs" },
  go: { wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: "go" },
  zig: { wasm: "tree-sitter-zig.wasm", analyzerFile: "real-zig-analyzer", className: "RealZigAnalyzer", ext: "zig" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", analyzerFile: "real-csharp-analyzer", className: "RealCSharpAnalyzer", ext: "cs" },
  dart: { wasm: "tree-sitter-dart.wasm", analyzerFile: "real-dart-analyzer", className: "RealDartAnalyzer", ext: "dart" },
  swift: { wasm: "tree-sitter-swift.wasm", analyzerFile: "real-swift-analyzer", className: "RealSwiftAnalyzer", ext: "swift" },
  objc: { wasm: "tree-sitter-objc.wasm", analyzerFile: "real-objective-c-analyzer", className: "RealObjectiveCAnalyzer", ext: "m" },
  php: { wasm: "tree-sitter-php.wasm", analyzerFile: "real-php-analyzer", className: "RealPhpAnalyzer", ext: "php" },
  ruby: { wasm: "tree-sitter-ruby.wasm", analyzerFile: "real-ruby-analyzer", className: "RealRubyAnalyzer", ext: "rb" },
  python: { wasm: "tree-sitter-python.wasm", analyzerFile: "real-python-analyzer", className: "RealPythonAnalyzer", ext: "py" },
  haskell: { wasm: "tree-sitter-haskell.wasm", analyzerFile: "real-haskell-analyzer", className: "RealHaskellAnalyzer", ext: "hs" },
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
const ORACLE_HTML_TAGS = new Set(["a","abbr","address","area","article","aside","audio","b","base","bdi","bdo","blockquote","body","br","button","canvas","caption","cite","code","col","colgroup","data","datalist","dd","del","details","dfn","dialog","div","dl","dt","em","embed","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","iframe","img","input","ins","kbd","label","legend","li","link","main","map","mark","menu","meta","meter","nav","noscript","object","ol","optgroup","option","output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","script","search","section","select","slot","small","source","span","strong","style","sub","summary","sup","table","tbody","td","template","textarea","tfoot","th","thead","time","title","tr","track","u","ul","var","video","wbr","svg","path","g","rect","circle","ellipse","line","polyline","polygon","text","tspan","use","defs","stop","view","linearGradient","radialGradient","clipPath","mask","pattern","marker","symbol"])
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
// M37.21 #611 svelte template-snippet truth: {#snippet name(...)} declares a
// callable; {@render name(...)} invokes it. The analyzer emits calls at the
// render site (render_tag branch); the embedded-JS oracle can't see template
// constructs, so this companion derives the SAME contract from the template:
// every render_tag target that matches a declared snippet is calls truth.
// Render targets with NO matching snippet are component-internal bindings
// (e.g. `children` from the $props() destructure) — not independently
// derivable as calls, so the oracle stays silent on them (they are covered
// by the analyzer's render_tag contract, not fabricated).
function deriveSvelteSnippetCalls(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const snippets = new Set<string>()
  const renders: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "snippet_definition") {
      // {#snippet name(args)} — the name is the first identifier child
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "identifier" || c.type === "fragment_reference")) { snippets.add(c.text); break }
        if (c && c.type === "snippet_start_tag") {
          const tn = c.namedChildren?.find((x: any) => x.type === "identifier" || x.type === "snippet_name")
          if (tn) { snippets.add(tn.text); break }
        }
      }
    }
    if (n.type === "render_tag") {
      // render_tag content is opaque text — scan the identifier leaf
      const text = n.text.replace("{@render", "").trim()
      let end = 0
      while (end < text.length && /[A-Za-z0-9_$]/.test(text.slice(0, end + 1))) end++
      if (end > 0) renders.push(text.slice(0, end))
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  for (const r of renders) {
    if (snippets.has(r) && !seen.has(r)) { seen.add(r); edges.push({ label: "calls", from: "(expr)", target: r }) }
  }
  return edges
}

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
// M37.9 cpp oracle: independently re-derive the analyzer's CALLS and member-
// read USES truth so the fmt differential actually audits the surface the
// analyzer emits (11.8k calls on .cc alone were previously never compared —
// cpp sat outside the calls/uses compared-label sets). Contracts mirror
// RealCppAnalyzer exactly:
//   calls:     EVERY call_expression's callable leaf, except operator
//              targets (the analyzer drops operator-starting callees; infix/
//              explicit operator calls are additionally pinned-grammar
//              ERROR-recovered, ruled in the cpp spec). field_expression ->
//              field leaf; qualified_identifier -> last segment; identifier /
//              template_function -> base leaf. No resolvability gate (the
//              analyzer emits external/std leaves unconditionally, like C).
//   uses:      field_expression member READS (obj.field, obj->field) that are
//              not the callee of a call — assignment-LHS fields are writes
//              (no edge; mirrors the analyzer's call_expression callee guard
//              + SCD1-family write gate).
// Both sides walk the SAME pinned parse, so leaf-attribution disagreements
// surface as MISSING/UNEXPLAINED pairs for manual ruling.
//
// M37.21 #610 JVM oracle gap (master-review finding): java/kotlin/scala/groovy
// were the ONLY gated languages with no dedicated calls oracle — the generic
// deriveTreeEdges audited heritage/instantiates/overrides only, so the entire
// JVM call surface (the family's most important graph) was never compared.
// deriveJavaEdges audits it: every method_invocation, explicit constructor
// delegation (super/this/Foo.super), and method reference (T::m) derives an
// independent calls truth edge. The builtin/stdlib exclusion mirrors
// RealJavaAnalyzer.isJavaBuiltin EXACTLY (exact-match list + ROOT-segment
// STDLIB_ROOTS — M37.21 C5: root prefix only, never mid-chain segments) —
// that policy is a documented design decision (JLS-based,
// measured 4.2% fabrication without it); the oracle audits target FINDING,
// not the exclusion policy. Both sides walk the same pinned parse.
const JAVA_EXACT_BUILTINS = new Set([
  "System.out.println", "System.out.print", "System.out.printf",
  "System.err.println", "System.err.print",
  "System.exit", "System.gc", "System.currentTimeMillis",
  "System.nanoTime", "System.getProperty", "System.getenv",
  "System.identityHashCode", "System.arraycopy",
  "toString", "hashCode", "equals", "getClass", "notify", "notifyAll", "wait",
  "clone", "finalize",
])
const JAVA_STDLIB_ROOTS = new Set([
  "System", "String", "Integer", "Long", "Double", "Float", "Boolean",
  "Byte", "Short", "Character", "Math", "StrictMath", "Object", "Class",
  "Thread", "Runnable", "Runtime", "Process", "ProcessBuilder",
  "Throwable", "Error", "Exception", "StackTraceElement",
  "Enum", "Void", "Compiler", "Package",
  "ArrayList", "LinkedList", "HashMap", "HashSet", "TreeMap", "TreeSet",
  "LinkedHashMap", "LinkedHashSet", "WeakHashMap", "IdentityHashMap",
  "Collections", "Arrays", "Objects", "Optional", "OptionalInt",
  "OptionalLong", "OptionalDouble", "Stream", "Collectors", "Comparator",
  "Iterator", "ListIterator", "Spliterator", "Random", "UUID",
  "Date", "Calendar", "TimeZone", "Locale", "Currency",
  "Base64", "Scanner", "Formatter", "StringJoiner",
  "AbstractList", "AbstractMap", "AbstractSet", "AbstractCollection",
  "EnumMap", "EnumSet", "Queue", "Deque", "Stack", "Vector",
  "Hashtable", "Properties", "BitSet", "Dictionary",
  "List", "Map", "Set", "Collection", "Iterable",
  "File", "Files", "Path", "Paths", "InputStream", "OutputStream",
  "Reader", "Writer", "BufferedReader", "BufferedWriter",
  "FileInputStream", "FileOutputStream", "FileReader", "FileWriter",
  "ByteArrayInputStream", "ByteArrayOutputStream",
  "StringReader", "StringWriter", "PrintWriter", "PrintStream",
  "IOException", "FileNotFoundException", "EOFException",
  "URL", "URI", "HttpURLConnection", "URLEncoder", "URLDecoder",
  "Connection", "DriverManager", "ResultSet", "Statement",
  "PreparedStatement", "SQLException", "DataSource",
  "javax", "jakarta",
  "kotlin", "Unit", "Nothing", "Any", "Int", "String",
  "java", "jdk", "sun",
  "Logger", "LoggerFactory", "LogManager", "Level", "LogRecord",
  "Marker", "MDC", "NDC",
  "Override", "Deprecated", "SuppressWarnings", "SafeVarargs",
  "FunctionalInterface", "Nullable", "NotNull", "NonNls",
  "Test", "Before", "After", "BeforeClass", "AfterClass", "Ignore",
  "RunWith", "Suite", "Parameterized",
  "slf4j", "log4j", "logback",
])
function isJavaBuiltinCall(call: string): boolean {
  if (JAVA_EXACT_BUILTINS.has(call)) return true
  // M37.21 C5 mirror: ROOT segment only (see RealJavaAnalyzer.isJavaBuiltin).
  // M49.J3 mirror: org/com removed lockstep (reviewer wave — bare roots
  // dropped user FQ calls like org.apache.commons.io.FileUtils.readFile).
  const segments = call.split(".")
  if (segments.length > 0 && JAVA_STDLIB_ROOTS.has(segments[0])) return true
  if (JAVA_STDLIB_ROOTS.has(call)) return true
  return false
}
export function deriveJavaEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  // Mirror of RealJavaAnalyzer.buildJavaCallExpression: qualified chain text
  // for builtin filtering (leaf extraction happens after the exclusion).
  const javaCallExpr = (n: any): string => {
    const obj = n.childForFieldName?.("object")
    const name = n.childForFieldName?.("name")
    if (!name) return n.text
    if (obj) {
      const objText = obj.type === "method_invocation" ? javaCallExpr(obj) : obj.text
      return `${objText}.${name.text}`
    }
    return name.text
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "method_invocation") {
      const call = javaCallExpr(n)
      if (call && !isJavaBuiltinCall(call)) push("calls", call.split(".").pop() || call)
    } else if (t === "explicit_constructor_invocation") {
      // Mirror the analyzer: super(...)/this(...) keep the keyword target;
      // the qualified form Foo.super(...) keeps its receiver (unnamed keyword
      // children are read from node text — structural syntax, conf 1.0).
      const text = n.text.trim()
      let target = "super"
      if (text.startsWith("this")) target = "this"
      else if (!text.startsWith("super")) {
        const q = text.split("(")[0].trim().split(".")
        target = q[0] + ".super"
      }
      push("calls", target)
    } else if (t === "method_reference") {
      // Mirror: T::m emits calls to m (last named child) when a receiver
      // exists; constructor refs (int[]::new) have one named child only.
      const kids: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) { const k = n.namedChild(i); if (k) kids.push(k) }
      if (kids.length >= 2) push("calls", kids[kids.length - 1].text)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}
// M37.21 #610 kotlin calls oracle: mirrors RealKotlinAnalyzer's call-graph
// contract exactly — buildKotlinCallExpression receiver.selector chains,
// leaf extraction, stdlib exclusion (stdlibPackagePrefixes + kotlinStdlibExact
// + kotlinBuiltinExtras for receiver-less calls), the MEASURED PascalCase
// construction rule (bare PascalCase callee = instantiates; qualified =
// calls), and constructor_delegation_call super/this edges.
const KOTLIN_STDLIB_PREFIXES = ["kotlin.", "kotlinx.", "java.", "javax.", "android.", "androidx."]
const KOTLIN_STDLIB_EXACT = new Set([
  "println", "print", "readLine", "require", "check", "error",
  "let", "run", "with", "apply", "also", "takeIf", "takeUnless",
  "toString", "equals", "hashCode", "copy", "componentN",
  "mutableMapOf", "mapOf", "mutableListOf", "listOf", "setOf", "mutableSetOf",
  "arrayOf", "emptyList", "emptyMap", "emptySet",
  "repeat", "uppercase", "lowercase", "trim", "startsWith", "endsWith",
  "contains", "substring", "map", "filter", "reduce", "fold", "forEach",
  "sorted", "sortedBy", "distinct", "first", "last", "add", "remove",
  "size", "isEmpty", "isNotEmpty", "put", "get", "getOrElse", "getOrDefault",
  "any", "all", "none", "count", "sum", "max", "min", "take", "drop",
])
const KOTLIN_BUILTIN_EXTRAS = new Set([
  "println", "print", "readLine", "require", "check", "error",
  "let", "run", "with", "apply", "also", "takeIf", "takeUnless",
  "toString", "equals", "hashCode", "copy", "componentN",
  "repeat", "uppercase", "lowercase", "trim",
  "mutableMapOf", "mapOf", "mutableListOf", "listOf", "setOf", "mutableSetOf",
  "arrayOf", "emptyList", "emptyMap", "emptySet",
])
function isKotlinStdlibCall(call: string): boolean {
  if (!call) return true
  for (const p of KOTLIN_STDLIB_PREFIXES) if (call.startsWith(p)) return true
  if (KOTLIN_STDLIB_EXACT.has(call)) return true
  if (!call.includes(".") && KOTLIN_BUILTIN_EXTRAS.has(call)) return true
  return false
}
export function deriveKotlinEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const kotlinCallExpr = (n: any): string => {
    // Mirror of RealKotlinAnalyzer.buildKotlinCallExpression: the DIRECT
    // navigation_expression child only (ERROR-recovered nested call chains
    // wrapping comments must never recurse — the analyzer reads the direct
    // callee path and falls back to text.split("(")[0]).
    const nav = n.namedChildren.find((c: any) => c.type === "navigation_expression")
    if (nav) {
      const receiver = nav.namedChild(0)
      let selector = nav.namedChild(nav.namedChildCount - 1)
      if (!receiver || !selector) return n.text
      if (selector.type === "navigation_suffix") {
        const inner = selector.namedChild(selector.namedChildCount - 1)
        if (!inner) return n.text
        selector = inner
      }
      const receiverText =
        receiver.type === "navigation_expression"
          ? kotlinNavText(receiver)
          : receiver.type === "call_expression"
            ? kotlinCallExpr(receiver)
            : receiver.text
      return `${receiverText}.${selector.text}`
    }
    const functionName = n.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "identifier")
    return functionName ? functionName.text : n.text.split("(")[0]
  }
  const kotlinNavText = (n: any): string => {
    const receiver = n.namedChild(0)
    let selector = n.namedChild(n.namedChildCount - 1)
    if (!receiver || !selector) return n.text
    if (selector.type === "navigation_suffix") {
      const inner = selector.namedChild(selector.namedChildCount - 1)
      if (!inner) return n.text
      selector = inner
    }
    const receiverText = receiver.type === "navigation_expression" ? kotlinNavText(receiver) : receiver.text
    return `${receiverText}.${selector.text}`
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "call_expression") {
      const call = kotlinCallExpr(n)
      const leaf = call.split(".").pop() || call
      const isQualified = call.includes(".")
      const isStdlib = KOTLIN_STDLIB_EXACT.has(call) || (!isQualified && KOTLIN_STDLIB_EXACT.has(leaf))
      if (call && call !== "print" && call !== "println" && !isStdlib) {
        const isPascal = leaf.length > 0 && leaf[0] >= "A" && leaf[0] <= "Z"
        if (isPascal && !isQualified) push("instantiates", leaf)
        else push("calls", leaf)
      }
    } else if (t === "constructor_delegation_call") {
      const text = n.text.trim()
      push("calls", text.startsWith("this") ? "this" : "super")
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}
// M37.21 #610 scala calls oracle: mirrors RealScalaAnalyzer.handleCall —
// quote/splice callee skip, curried-application wrapper skip (inner call
// emits, wrapper doesn't), field_expression leaf extraction, bracketed
// type-arg stripping, and the MEASURED companion-apply rule (bare PascalCase
// callee = instantiates; qualified obj.Method() = calls).
export function deriveScalaEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "call_expression") {
      const fnNode = n.childForFieldName?.("function")
      if (fnNode) {
        // Scala 3 quote/splice + backtick literals are never calls.
        if (!(fnNode.text.startsWith("'") || fnNode.text.startsWith("`"))) {
          // Curried wrapper: the INNER call is visited separately; deriving
          // from the wrapper would double-count (SCD7).
          if (fnNode.type !== "call_expression") {
            // M49.S1 #715 lockstep mirror: generic_function callees
            // (`foo.bar[Baz](1)`) extract the LAST identifier leaf BEFORE the
            // bracket strip — mirrors RealScalaAnalyzer.handleCall's S1.10
            // fix. Both sides emitted the dotted "foo.bar" before (shared
            // blind spot, probe s1-probe3).
            let calledName = ""
            let isQualified = false
            if (fnNode.type === "generic_function") {
              const kids: string[] = []
              const findLeaves = (nn: any): void => {
                if (nn.type === "identifier") { kids.push(nn.text); return }
                if (nn.type === "type_arguments") return
                for (let i = 0; i < nn.namedChildCount; i++) { const c = nn.namedChild(i); if (c) findLeaves(c) }
              }
              findLeaves(fnNode)
              if (kids.length > 0) {
                calledName = kids[kids.length - 1]
                isQualified = kids.length > 1
              }
            } else {
              calledName = fnNode.text
              isQualified = fnNode.type === "field_expression"
              if (isQualified) {
                const kids: string[] = []
                for (let i = 0; i < fnNode.namedChildCount; i++) {
                  const c = fnNode.namedChild(i)
                  if (c && c.type === "identifier") kids.push(c.text)
                }
                calledName = kids.length > 0 ? kids[kids.length - 1] : calledName
              }
            }
            // Strip bracketed type args iteratively (nested List[(A[B], C)]).
            let prevCalled: string | undefined
            do {
              prevCalled = calledName
              calledName = calledName.replace(/\[[^\[\]]*\]/g, "").trim()
            } while (calledName !== prevCalled)
            const first = calledName.charCodeAt(0)
            const isCapitalized = first >= 65 && first <= 90
            if (calledName) {
              if (isCapitalized && !isQualified) push("instantiates", calledName)
              else push("calls", calledName)
            }
          }
        }
      }
    } else if (t === "instance_expression") {
      // `new X` / `new X(...)` / `new X[T](...)` — mirror handleInstantiation:
      // generic supertypes collapse to the head, bracketed args stripped.
      const tn = n.namedChild(0)
      if (tn) {
        let name = tn.text
        if (tn.type === "generic_type" && tn.namedChildCount > 0) name = tn.namedChild(0).text
        let prevName: string | undefined
        do {
          prevName = name
          name = name.replace(/\[[^\[\]]*\]/g, "").replace(/<[^<>]*>/g, "").trim()
        } while (name !== prevName)
        if (name && name !== "unknown") push("instantiates", name)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}
// M37.21 #610 groovy calls oracle: mirrors RealGroovyAnalyzer's walk —
// method_invocation (object → buildGroovyQualifiedCall dotted path WITHOUT
// argument text; target is the bare methodName leaf), GROOVY_BUILTINS +
// STDLIB_ROOTS prefix filter, explicit_constructor_invocation honest
// literal ("super"/"this"), juxt_function_call (echo "msg" IS a call).
// M37.21 #611 typescript calls oracle: mirrors RealTypeScriptAnalyzer's
// call contract — call_expression with direct callee leaf (member_expression
// reduced to its property leaf), import()/require() excluded, TS_CONSOLE
// + TS_OBJECT_LEAF builtin sets (identical to the JS sets — verified by diff),
// malformed-call guard (hasBraceEquals), GLOBAL constructor calls kept (the
// analyzer filters only the same console/Object sets on the calls label).
export function deriveTypeScriptEdges(root: any): { label: string; from: string; target: string; fullCallee?: string }[] {
  const edges: { label: string; from: string; target: string; fullCallee?: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string, fullCallee?: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target, fullCallee }) }
  }
  const TS_CONSOLE_BUILTINS = new Set([
    "console.log", "console.warn", "console.error", "console.info", "console.debug",
    "console.trace", "console.table", "console.group", "console.groupEnd",
    "console.groupCollapsed", "console.time", "console.timeEnd", "console.assert",
    "console.count", "console.countReset", "console.dir", "console.dirxml",
    "console.clear", "console.profile", "console.profileEnd",
  ])
  const TS_OBJECT_LEAF_METHODS = new Set([
    "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
    "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
  ])
  const hasBraceEquals = (text: string): boolean => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
    }
    return false
  }
  const stripWhitespace = (s: string): string => {
    let out = ""
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") out += ch
    }
    return out
  }
  const isBuiltinCall = (targetName: string, fullCallee: string): boolean => {
    if (targetName === "super") return true
    if (TS_CONSOLE_BUILTINS.has(fullCallee)) return true
    if (TS_CONSOLE_BUILTINS.has(stripWhitespace(fullCallee))) return true
    if (TS_OBJECT_LEAF_METHODS.has(targetName)) return true
    return false
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "call_expression") {
      const callee = n.namedChild(0)
      // W2 mirror: computed member calls (cbs.doneEnter[trueSerialized](),
      // nodeTransforms[i](...)) are SKIPPED on the analyzer side (JS family
      // contract) — the oracle must skip them too or every skipped shape
      // surfaces as a fake MISSING edge (BaseTransition.spec.ts).
      // require() is a module dependency on BOTH analyzers (JS contract;
      // TS scripts never legitimately call require — vue-element-admin's
      // CommonJS .vue blocks would otherwise surface as fake MISSING).
      if (callee && callee.type !== "subscript_expression" && !((callee.text === "import" || callee.type === "import") || (callee.type === "identifier" && callee.text === "require"))) {
        let targetName = callee.text
        const fullCallee = callee.text
        if (callee.type === "member_expression") {
          const property = callee.childForFieldName("property")
          if (property) targetName = property.text
        }
        if (
          targetName.length <= 100 &&
          !targetName.includes("\n") &&
          !targetName.includes("`") &&
          !targetName.includes("${") &&
          !hasBraceEquals(targetName) &&
          !isBuiltinCall(targetName, fullCallee)
        ) push("calls", targetName, fullCallee)
      }
    } else if (t === "new_expression") {
      // Mirror of the analyzer's instantiation branch: generic_type head,
      // leaf segment, generic arguments stripped, GLOBAL_CTORS filtered.
      const ctor = n.namedChild(0)
      if (ctor) {
        let className = ctor.text
        if (ctor.type === "generic_type") className = ctor.namedChild(0)?.text ?? className
        const dot = className.lastIndexOf(".")
        if (dot !== -1 && dot < className.length - 1) className = className.slice(dot + 1)
        const lt = className.indexOf("<")
        if (lt !== -1) className = className.slice(0, lt)
        if (!TS_GLOBAL_CTORS.has(className)) push("instantiates", className)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}

// M37.21 #611 javascript calls oracle (web-family twin of the TS oracle —
// same call_expression contract with JS naming: require()/import() excluded
// on the ANALYZER side as imports; subscript callees skipped; the two builtin
// sets are identical to TS's — verified by diff).
export function deriveJavaScriptEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const JS_CONSOLE_BUILTINS = new Set([
    "console.log", "console.warn", "console.error", "console.info", "console.debug",
    "console.trace", "console.table", "console.group", "console.groupEnd",
    "console.groupCollapsed", "console.time", "console.timeEnd", "console.assert",
    "console.count", "console.countReset", "console.dir", "console.dirxml",
    "console.clear", "console.profile", "console.profileEnd",
  ])
  const JS_OBJECT_LEAF_METHODS = new Set([
    "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
    "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
  ])
  const hasBraceEquals = (text: string): boolean => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
    }
    return false
  }
  const stripWhitespace = (s: string): string => {
    let out = ""
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") out += ch
    }
    return out
  }
  const isBuiltinCall = (targetName: string, fullCallee: string): boolean => {
    if (targetName === "super") return true
    if (JS_CONSOLE_BUILTINS.has(fullCallee)) return true
    if (JS_CONSOLE_BUILTINS.has(stripWhitespace(fullCallee))) return true
    if (JS_OBJECT_LEAF_METHODS.has(targetName)) return true
    return false
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "call_expression") {
      const fn = n.childForFieldName("function")
      const isImportCallee = !!fn && (fn.type === "import" || (fn.type === "identifier" && fn.text === "import"))
      const isRequire = !!fn && fn.type === "identifier" && fn.text === "require"
      if (fn && !isRequire && !isImportCallee) {
        let targetName = fn.text
        const fullCallee = fn.text
        if (fn.type === "member_expression") {
          const prop = fn.childForFieldName("property")
          if (prop) targetName = prop.text
        }
        if (
          fn.type !== "subscript_expression" &&
          targetName.length <= 100 &&
          !targetName.includes("\n") &&
          !targetName.includes("`") &&
          !targetName.includes("${") &&
          !hasBraceEquals(targetName) &&
          !isBuiltinCall(targetName, fullCallee)
        ) push("calls", targetName)
      }
    }
    // M49 #744 mirror (web fix wave, java #739 family contract): member
    // READ truth with the analyzer's exact gates — not a call callee, not
    // an assignment LHS (JSD1 write), emits EVERY chain segment INCLUDING
    // the root identifier (the pre-fix parity blind spot: the lane never
    // audited uses at all, so the dropped root was invisible).
    if (t === "member_expression") {
      const p7 = n.parent
      const calleeFn = p7?.type === "call_expression" ? p7.childForFieldName("function") : null
      const isCallee = !!calleeFn && calleeFn.id === n.id
      let isWrite = false
      if (p7?.type === "assignment_expression" || p7?.type === "augmented_assignment_expression") {
        const lhs = p7.childForFieldName("left") ?? p7.namedChild(0)
        isWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      }
      if (!isCallee && !isWrite) {
        // flatten the chain: segments + root
        const parts: string[] = []
        let cur: any = n
        while (cur && cur.type === "member_expression") {
          const prop = cur.childForFieldName("property")
          if (prop) parts.unshift(prop.text)
          cur = cur.childForFieldName("object")
        }
        const head = cur ? cur.text : ""
        for (const seg of parts) push("uses", seg)
        if (head && head !== "this" && head !== "super") push("uses", head)
      }
    }
    // M49 #744 mirror: BARE identifier reads (return config; / if (flag)) —
    // identical gate set to the analyzer: not a call callee, not an
    // assignment LHS, not a declaration name (function/variable/class),
    // not this/super/undefined/arguments, not object keys (pair/pair_pattern
    // key), not member parts, not labels, not shorthand properties.
    if (t === "identifier") {
      const txt = n.text
      if (txt !== "this" && txt !== "super" && txt !== "undefined" && txt !== "arguments") {
        const p7 = n.parent
        const calleeFn = p7?.type === "call_expression" ? p7.childForFieldName("function") : null
        const isCallee = !!calleeFn && calleeFn.id === n.id
        let isWrite2 = false
        if (p7?.type === "assignment_expression" || p7?.type === "augmented_assignment_expression") {
          const lhs2 = p7.childForFieldName("left") ?? p7.namedChild(0)
          isWrite2 = !!lhs2 && lhs2.id === n.id
        }
        const isDeclName = (p7?.type === "variable_declarator" && p7.childForFieldName("name")?.id === n.id) ||
          p7?.type === "function_declaration" || p7?.type === "function_expression" ||
          p7?.type === "generator_function_declaration" || p7?.type === "method_definition" ||
          p7?.type === "class_declaration" || p7?.type === "class"
        const isPropKey = (p7?.type === "pair" || p7?.type === "pair_pattern") && p7.childForFieldName("key")?.id === n.id
        const isMemberPart = p7?.type === "member_expression"
        const isPropName = p7?.type === "property_signature" || p7?.type === "property_identifier"
        const isLabel = p7?.type === "labeled_statement"
        const isShorthandProp = p7?.type === "shorthand_property_identifier"
        if (!isCallee && !isWrite2 && !isDeclName && !isPropKey && !isMemberPart && !isPropName && !isLabel && !isShorthandProp) {
          push("uses", txt)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}

// Analyzer's JS_GLOBAL_CONSTRUCTORS set — shared with the instantiation mirror.
const TS_GLOBAL_CTORS = new Set([
  "Promise", "Date", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Proxy",
  "Error", "TypeError", "RangeError", "SyntaxError", "URIError", "EvalError",
  "AggregateError", "RegExp", "Array", "Object", "Function", "Boolean",
  "Number", "String", "BigInt", "ArrayBuffer", "SharedArrayBuffer",
  "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array",
  "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "WeakRef", "FinalizationRegistry",
  "AbortController", "FormData", "Blob", "File", "URL", "URLSearchParams",
  "Headers", "Request", "Response", "Intl", "Image", "Worker", "SharedWorker",
  "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "ResizeObserver",
  "MutationObserver", "IntersectionObserver", "PerformanceObserver",
  "FileReader", "XMLHttpRequest", "WebSocket", "TextEncoder", "TextDecoder",
  "DOMParser", "Notification", "BroadcastChannel", "MessageChannel",
  "FocusEvent", "InputEvent", "PointerEvent", "TouchEvent", "DragEvent", "ErrorEvent", "UIEvent", "StorageEvent", "PromiseRejectionEvent", "HashChangeEvent", "PageTransitionEvent", "PopStateEvent", "ProgressEvent", "SpeechSynthesisEvent", "AnimationEvent", "TransitionEvent", "ClipboardEvent", "WheelEvent", "CompositionEvent", "BeforeUnloadEvent",
])

export function deriveGroovyEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  // Mirror of GROOVY_BUILTINS + STDLIB_ROOTS prefix filter (analyzer lines 46/1096).
  const GROOVY_BUILTINS = new Set([
    "println", "print", "printf", "sprintf",
    "assert", "sleep", "synchronized",
    "toString", "hashCode", "equals", "getClass", "notify", "notifyAll",
    "wait", "clone", "finalize",
    "System.out.println", "System.out.print", "System.out.printf",
    "System.err.println", "System.err.print",
    "System.exit", "System.gc", "System.currentTimeMillis", "System.nanoTime",
    "System.getProperty", "System.getenv", "System.identityHashCode",
    "System.arraycopy", "System.lineSeparator",
  ])
  const STDLIB_ROOTS = new Set([
    "System", "String", "Integer", "Long", "Double", "Float", "Boolean",
    "Byte", "Short", "Character", "Math", "StrictMath", "Object", "Class",
    "Thread", "Runnable", "Runtime", "Process", "ProcessBuilder",
    "Throwable", "Error", "Exception", "StackTraceElement",
    "Enum", "Void", "Compiler", "Package",
    "ArrayList", "LinkedList", "HashMap", "HashSet", "TreeMap", "TreeSet",
    "LinkedHashMap", "LinkedHashSet", "ArrayDeque", "PriorityQueue",
    "Collections", "Arrays", "Objects", "Optional", "Comparator",
    "List", "Map", "Set", "Collection", "Iterator", "Iterable",
    "Calendar", "Date", "UUID", "Locale", "Currency",
    "File", "Path", "Paths", "Files",
    "BigDecimal", "BigInteger", "AtomicInteger", "AtomicLong",
    "StringBuilder", "StringBuffer", "Pattern", "Matcher", "Random",
    "Logger", "Level", "OutputStream", "InputStream", "Reader", "Writer",
    "URL", "URI", "Socket", "ServerSocket",
  ])
  const isBuiltin = (call: string): boolean => {
    if (GROOVY_BUILTINS.has(call)) return true
    const firstDot = call.indexOf(".")
    const rootSeg = firstDot > 0 ? call.slice(0, firstDot) : call
    return STDLIB_ROOTS.has(rootSeg)
  }
  // Mirror of buildGroovyQualifiedCall: dotted path WITHOUT argument text.
  const qualifiedCall = (objectNode: any, methodName: string): string => {
    if (!objectNode) return methodName
    if (objectNode.type === "method_invocation") {
      const innerName = objectNode.childForFieldName?.("name")
      const innerObject = objectNode.childForFieldName?.("object")
      const base = qualifiedCall(innerObject, innerName?.text ?? "")
      return `${base}.${methodName}`
    }
    return `${objectNode.text}.${methodName}`
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "method_invocation") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode) {
        const methodName = nameNode.text
        const objectNode = n.childForFieldName?.("object")
        const callExpr = qualifiedCall(objectNode, methodName)
        if (!isBuiltin(callExpr)) push("calls", methodName)
      }
    } else if (t === "explicit_constructor_invocation") {
      const first = n.namedChild(0)
      if (first && (first.type === "super" || first.type === "this")) push("calls", first.type)
    } else if (t === "juxt_function_call") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode && !isBuiltin(nameNode.text)) push("calls", nameNode.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}
export function deriveCppEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const lastNamed = (n: any): any => n.namedChild(n.namedChildCount - 1)
  // CPPD2 (probe): field LHS of an assignment is a write designator.
  const isAssignLhsField = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    const isWriteParent =
      p.type === "assignment_expression" || p.type === "compound_assignment_expression"
    if (!isWriteParent) return false
    const lhs = p.namedChild(0)
    return !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
        const fn = n.childForFieldName?.("function") ?? n.namedChild(0)
        let target = ""
        if (fn) {
          // CPPD13 mirror: the CALLEE LEAF is the bare name — template args
          // (m<int>), nested `::` chains (std::numeric_limits<X>::lowest),
          // and defense-parentheses ((X)() — Windows min/max) must all
          // unwrap to the innermost identifier. Mirrors the analyzer's
          // calleeLeaf exactly so leaf attribution stays one contract.
          const calleeLeaf = (x: any): string => {
            let cur = x
            let guard = 0
            while (cur && guard++ < 8) {
              const t = cur.type
              if (t === "field_expression") {
                const f = cur.childForFieldName?.("field") ?? cur.namedChild(cur.namedChildCount - 1)
                if (!f) return cur.text
                cur = f
                continue
              }
              if (t === "template_function" || t === "template_method") {
                const base = cur.namedChild(0)
                if (!base) return cur.text
                cur = base
                continue
              }
              // `loc.template get<T>()` — the `template` disambiguator makes
              // the member a dependent_name wrapping the template_method.
              if (t === "dependent_name" && cur.namedChildCount >= 1) {
                const inner = cur.namedChild(0)
                if (inner && (inner.type === "template_method" || inner.type === "template_function" || inner.type === "identifier" || inner.type === "field_identifier")) {
                  cur = inner
                  continue
                }
                return cur.text
              }
              if (t === "qualified_identifier" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(cur.namedChildCount - 1)
                continue
              }
              if (t === "parenthesized_expression" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(0)
                continue
              }
              if (t === "identifier" || t === "field_identifier" || t === "type_identifier" ||
                  t === "operator_name" || t === "destructor_name" || t === "namespace_identifier") {
                return cur.text
              }
              return cur.text
            }
            return cur?.text ?? ""
          }
          if (fn) target = calleeLeaf(fn)
          // CPPD13 mirror: functor-temporary invocation — the callee is itself
          // a call_expression (std::forward<F>(f)(args), Op<int>()(a,b)) whose
          // effective target is an anonymous operator(). No named callee
          // (CPP-D9 ruling); the inner construction call emits separately.
          if (fn && fn.type === "call_expression") target = ""
          // Pointer-to-member invocation ((declval<Class*>()->*pmf)()) —
          // ERROR-recovered by the pinned grammar, callee only knowable at
          // runtime (C fn-pointer class). No trustworthy leaf.
          if (fn && fn.hasError) target = ""
        }
        if (target && !target.startsWith("operator")) {
          const k = "calls|" + target
          if (!seen.has(k)) { seen.add(k); edges.push({ label: "calls", from: "(expr)", target }) }
        }
      } else if (n.type === "field_expression") {
      // member READ unless this field_expression is a call callee or a write
      // LHS (analyzer: uses on obj.field only when not the call function).
      const p = n.parent
      const isCallee = !!p && p.type === "call_expression"
      const f = n.childForFieldName?.("field") ?? lastNamed(n)
      if (f && !isCallee && !isAssignLhsField(n)) {
        const k = "uses|" + f.text
        if (!seen.has(k)) { seen.add(k); edges.push({ label: "uses", from: "(expr)", target: f.text }) }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return edges
}

export function deriveCCalls(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  // CGD1 mirror (M37 #601): compound/plain assignment LHS is a WRITE — the
  // analyzer gates it, so the oracle must too or every write surfaces as
  // "missing" (the SCD1 swift/ruby oracle-staleness lesson). Span-match the
  // first named child; web-tree-sitter gives FRESH objects per child(), so
  // reference identity never matches.
  const isAssignLhs = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "assignment_expression") return false
    const lhs = p.namedChild(0)
    return !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex >= n.endIndex
  }
  // CGD28 (M37 #601, measured fossildelta.c): a cast to a typedef alias —
  // `(i64)x` parses as cast_expression > parenthesized_expression >
  // identifier — is a TYPE REFERENCE position, but ONLY for the cast's TYPE
  // operand: `(sqlite3_syscall_ptr)ts_open` — the function-name VALUE after
  // the type — stays a `uses` read (test_syscall.c syscall tables). The
  // value operand is the LAST named child of the cast; the type operand
  // starts before it. Mirrors the analyzer's isTypePositionIdentifier.
  const isCastTypePosition = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) {
      const t: string = cur.type
      if (t === "sizeof_expression") return true
      if (t === "cast_expression") {
        const kids: any[] = []
        for (let i = 0; i < cur.namedChildCount; i++) kids.push(cur.namedChild(i))
        if (kids.length >= 2) {
          const value = kids[kids.length - 1]
          return n.startIndex < value.startIndex
        }
        return false
      }
      if (/statement|declaration|declarator|specifier|enumerator|compound|argument_list|init/.test(t)) return false
      cur = cur.parent
    }
    return false
  }
  // CGD-IDENT truth scope: names DECLARED in this file. CGD9 fix: the
  // declaring identifier is the identifier whose PARENT is a declaration
  // node (mirrors the analyzer's isDeclarationLikeIdentifier) — the old
  // isDeclarationPosition walked ANCESTORS and included
  // function_definition, so EVERY identifier inside ANY function body was
  // misclassified as a "declaration" and never emitted truth (reproduced:
  // probe c-oracle-min — aSyscall read, callback value, sizeof(RenameToken)
  // all silent). Type truth uses the analyzer's declaredTypes pre-pass
  // contract exactly: struct/union/enum WITH a body, typedef aliases.
  // Macros: preproc_def/preproc_function_def name.
  const DECL_PARENT_TYPES = new Set([
    "declaration", "parameter_declaration", "field_declaration", "init_declarator",
    "function_declarator", "pointer_declarator", "array_declarator", "type_definition",
    "enumerator", "preproc_def", "preproc_function_def",
  ])
  const isDeclaringIdentifier = (n: any): boolean => {
    const p = n.parent
    if (!p || !DECL_PARENT_TYPES.has(p.type)) return false
    // CGD26 (M37 #601, measured jimsh0.c): the TYPE of a field/declaration is
    // a USE, not a declaration — `Jim_FreeInternalRepProc *freeIntRepProc;`
    // parses as field_declaration > [type_identifier, pointer_declarator];
    // the any-position rule made the type_identifier count as a declaring
    // occurrence, suppressing its own references-truth (analyzer correctly
    // emits `references`).
    if (n.type === "type_identifier") return false
    // CGD12: for declarator-chain parents, only the LEFTMOST identifier
    // declares — `int aLock[SQLITE_SHM_NLOCK]` parses as array_declarator
    // with BOTH aLock and the size expression as identifier children; the
    // any-child rule turned every array-size constant into a "declared
    // name" (os_unix.c: false truth from `aMutex[SQLITE_SHM_NLOCK]`).
    if (/declarator$/.test(p.type)) {
      let cur: any = p
      while (cur) {
        if (cur.type === "identifier" || cur.type === "field_identifier") {
          return cur.startIndex === n.startIndex
        }
        let next: any = null
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) {
            next = c
            break
          }
        }
        cur = next
      }
      return false
    }
    return true
  }
  // Truth scope refinement: function-LOCAL declarations are execution
  // artifacts (the analyzer's extractDeclaration only emits file/global
  // symbols), so a local's name must NOT qualify as a resolvable use target
  // — otherwise every read of a shadowed/unrelated name counted as truth and
  // the analyzer's correct silence surfaced as MISSING (first sqlite run:
  // 64.6% coverage / 2037 missing, all from locals). CGD8 refinement: the
  // exclusion must be the function BODY and PARAMETER LIST, not the whole
  // function_definition subtree — a function's own NAME is a file-scope
  // declaration (callback references like `Tcl_CreateObjCommand(interp,
  // "vfslog", test_vfslog, 0, 0)` are genuine reads of it; the old check
  // silenced them, leaving 800+ callback uses with no truth). Struct
  // fields, enum members, macros, typedefs, globals, and function names
  // all remain truth.
  // typedef alias name: the declarator chain's leftmost identifier
  // (`typedef struct VfslogFile VfslogFile` — both occurrences declare).
  // CGD18 (M37 #601): the descent must SKIP type nodes, never terminate on
  // them — `off_t offset` has namedChild(0)=type_identifier(off_t), and the
  // old terminal check stopped there and returned "off_t" as the bound
  // name, so `offset` never entered fnLocals and 32 param reads of the
  // struct field `offset` surfaced as bogus truth (os_unix.c MISSING
  // poison). Two passes: declarator-typed children first, then plain
  // identifier/field_identifier (type_identifier EXCLUDED — it names a
  // TYPE, not the declared entity). Reaching a level with neither ends the
  // walk (unnamed, e.g. abstract declarators).
  const leftmostDeclaratorIdentifier = (n: any): string | undefined => {
    if (!n) return undefined
    let cur = n
    while (cur && cur.type !== "identifier" && cur.type !== "field_identifier") {
      let next: any = null
      for (let k = 0; k < cur.namedChildCount; k++) {
        const c = cur.namedChild(k)
        if (c && c.type.endsWith("declarator")) {
          next = c
          break
        }
      }
      if (!next) {
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && (c.type === "identifier" || c.type === "field_identifier")) {
            next = c
            break
          }
        }
      }
      cur = next
    }
    return cur?.text
  }
  const isFunctionLocal = (n: any): boolean => {
    let cur: any = n
    while (cur) {
      if (cur.type === "compound_statement" || cur.type === "parameter_list") return true
      cur = cur.parent
    }
    return false
  }
  // CGD25 (M37 #601, measured os_win.c/jimsh0.c): a BARE function_declarator
  // glued as a direct ERROR child (tokenize.c sqlite3RunParser, os_win.c
  // winRead/winWrite headers) has no declaration wrapper — its name node's
  // parent IS the fd. Test: walk from the name to the ERROR; a `declaration`
  // wrapper on the path means an ordinary prototype (NOT glue).
  const isBareFdGlueName = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "function_declarator") return false
    const gp = p.parent
    if (!gp || gp.type !== "ERROR") return false
    // POSITION comparison (KAD2/TSD2 class, hygiene F7): web-tree-sitter
    // hands out FRESH node wrappers per property access, so `mid === gp`
    // never holds — this gate was dead code and the oracle admitted glue-fd
    // names the analyzer structurally cannot resolve (no symbol: the
    // declaration's declarator was swallowed by the ERROR, s3jni_config_log
    // in sqlite3-jni.c). Reach the ERROR span by comparing spans.
    const errStart = gp.startIndex
    const errEnd = gp.endIndex
    let mid: any = n
    while (mid) {
      if (mid.startIndex === errStart && mid.endIndex === errEnd) return true
      if (mid.type === "declaration") return false
      mid = mid.parent
    }
    return false
  }
  // Truth scope refinement 2 (CGD-PREPROC): identifiers inside PREPROCESSOR
  // CONDITION TEXT are not code — `#if SQLITE_MAX_MMAP_SIZE>0` conditions,
  // `defined(X)` tests, `#ifndef X` guards, `#define IOMETHODS(...CLOSE,
  // LOCK...)` parameter lists, and macro-replacement bodies. The C
  // preprocessor is textual (C-D2 ruling). BUT the exclusion must not eat
  // CONDITIONAL CODE: test files are often one giant `#ifdef SQLITE_TEST`
  // block, and every declaration/statement inside is real (the analyzer
  // walks them). The precise rule: an identifier is directive text iff the
  // path from it to the first preproc_* ancestor passes through NO code
  // container (any statement/declaration/declarator/specifier/enumerator
  // node). `#if (SQLITE_MAX_MMAP_SIZE>0)` → expression chain only → text;
  // `int eAccess = F_OK;` inside #ifndef → init_declarator on path → code.
  const isDirectiveConditionText = (n: any): boolean => {
    // CGD13: the NAME identifier of a macro definition IS a declaration
    // (`#define FUNC_PERFECT_MATCH 6` — the analyzer's extractMacro emits a
    // Constant symbol, so uses of the name resolve). Everything else inside
    // preproc_* (preproc_arg bodies, preproc_params parameter names, #if
    // conditions) stays text.
    const p0 = n.parent
    if (p0 && (p0.type === "preproc_def" || p0.type === "preproc_function_def")) return false
    let cur: any = n.parent
    while (cur) {
      const t: string = cur.type
      if (/statement|declaration|definition|declarator|specifier|enumerator|compound/.test(t)) return false
      if (t.startsWith("preproc_")) return true
      cur = cur.parent
    }
    return false
  }
  // Type truth (CGD10): the analyzer's declaredTypes pre-pass — struct/
  // union/enum names WITH a body (forward declarations resolve to nothing,
  // no dangling edges) plus typedef aliases.
  const declaredTypes = new Set<string>()
  // File-scope declared value names (globals, functions, macros, enum
  // members). Local declarations inside compound statements are execution
  // artifacts and excluded.
  const declaredNames = new Set<string>()
  // CGD14 (REVISED, measured): blanket ERROR-ancestor exclusion is WRONG —
  // os_win.c parses as ONE giant ERROR span (L1–L5345, #if-chain recovery)
  // containing wholly real declarations the analyzer correctly extracts;
  // status.c's SQLITE_WSD recovery region holds 13 real symbols. The honest
  // discriminator mirrors the analyzer's CGD19 EXACTLY (one contract): an
  // occurrence inside an ERROR span is an artifact iff it sits AFTER the
  // FIRST glued function header in that span — glue = function_definition
  // or a BARE function_declarator (direct ERROR child, tokenize.c
  // sqlite3RunParser shape); ordinary prototypes (os_win.c winMemMalloc,
  // a valid `declaration` with a function_declarator) are NOT glue.
  // Memoized per ERROR span by startIndex.
  const errHeaderIdx = new Map<number, number>()
  const isSuppressedErrorDecl = (n: any): boolean => {
    let cur: any = n
    let innermost: any = null
    while (cur) {
      if (cur.type === "ERROR") innermost = cur
      cur = cur.parent
    }
    if (!innermost) return false
    const key = innermost.startIndex as number
    let headerIdx = errHeaderIdx.get(key)
    if (headerIdx === undefined) {
      headerIdx = -1
      const st: any[] = [innermost]
      while (st.length > 0) {
        const m = st.pop()!
        if (m !== innermost) {
          // Glue = function_definition OR a BARE function_declarator (no
          // declaration/function_definition wrapper between fd and the ERROR
          // — tokenize.c direct child; jimsh0.c nested in preproc_ifdef <
          // ERROR). An fd inside a declaration wrapper is an ordinary
          // prototype (os_win.c winMemMalloc) — NOT glue.
          if (m.type === "function_definition") {
            if ((headerIdx as number) < 0 || m.startIndex < (headerIdx as number)) headerIdx = m.startIndex
          } else if (m.type === "function_declarator") {
            // POSITION comparison (web-tree-sitter object identity never
            // holds — the same trap that hit the analyzer side).
            let w: any = m
            let bare = true
            while (w) {
              if (w.startIndex === innermost.startIndex && w.endIndex === innermost.endIndex) break
              if (w.type === "declaration" || w.type === "function_definition") {
                bare = false
                break
              }
              w = w.parent
            }
            if (bare && w) {
              if ((headerIdx as number) < 0 || m.startIndex < (headerIdx as number)) headerIdx = m.startIndex
            }
          }
        }
        for (let k = 0; k < m.namedChildCount; k++) {
          const c = m.namedChild(k)
          if (c) st.push(c)
        }
      }
      errHeaderIdx.set(key, headerIdx as number)
    }
    return (headerIdx as number) >= 0 && n.startIndex > (headerIdx as number)
  }
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.text) {
        if (n.type === "struct_specifier" || n.type === "union_specifier") {
          // CGD14b: type declarations mirror the ANALYZER — extractStruct has
          // no ERROR gate (only extractDeclaration does). os_win.c's structs
          // sit in one giant ERROR span and are real.
          if (n.childForFieldName("body")) {
            // CGD20-mirror: function-local type declarations are execution
            // artifacts (C-D1) — no declaredTypes admission (measured:
            // test_backup.c BackupSubCommandEnum, test_malloc.c MB_enum).
            const inFunction = (() => { let c: any = n; while (c) { if (c.type === "function_definition") return true; c = c.parent } return false })()
            if (!inFunction) {
              const nm = n.childForFieldName("name")
              if (nm && nm.text.trim()) declaredTypes.add(nm.text)
            }
          }
        } else if (n.type === "enum_specifier") {
          const nm = n.childForFieldName("name")
          // CGD20-mirror (see struct branch): skip function-local enums.
          const inFunction = (() => { let c: any = n; while (c) { if (c.type === "function_definition") return true; c = c.parent } return false })()
          if (nm && nm.text.trim() && !inFunction) declaredTypes.add(nm.text)
        } else if (n.type === "type_definition") {
          // typedef name. TWO shapes (measured, probe c-oswin):
          //  (a) `typedef struct Jim_Obj Jim_Obj;` / `typedef long i64;` —
          //      the DECLARATOR FIELD ITSELF is a leaf type_identifier
          //      (tree-sitter-c names the new type the "declarator" even
          //      though its node type says identifier-ish TYPE). The
          //      leftmost walk never terminates on type_identifier (CGD18:
          //      it must SKIP type nodes inside chains) so these aliases
          //      were silently dropped from declaredTypes — every later
          //      `references i64` truth vanished (fossildelta.c/showwal.c
          //      unexplained mass).
          //  (b) `typedef void (*Fn)(int);` — a real declarator chain.
          // CGD20-mirror: skip function-local typedefs.
          const declField = n.childForFieldName("declarator")
          const inFunction = (() => { let c: any = n; while (c) { if (c.type === "function_definition") return true; c = c.parent } return false })()
          let ident: string | undefined
          if (declField && /^(identifier|field_identifier|type_identifier)$/.test(declField.type)) {
            ident = declField.text
          } else if (declField) {
            ident = leftmostDeclaratorIdentifier(declField)
            // CGD30 (M37 #601, measured libcmpp.c/jimsh0.c): fn-ptr/fn-type
            // typedef chains TERMINATE on a type_identifier leaf — tree-sitter-c
            // names the new type of `typedef int (*cmpp_input_f)(...)` and
            // `typedef void (Jim_FreeInternalRepProc)(...)` with a
            // type_identifier node. The leftmost walk excludes type_identifier
            // mid-chain (CGD18) and returns undefined here; the declared name
            // is the first identifier-ish leaf OUTSIDE the parameter_list
            // (~200 references-truth edges in libcmpp/jimsh0 were unexplained).
            if (!ident) {
              const findLeaf = (m: any): string | undefined => {
                if (m.type === "parameter_list") return undefined
                if (/^(identifier|field_identifier|type_identifier)$/.test(m.type)) return m.text
                for (let k = 0; k < m.namedChildCount; k++) {
                  const c = m.namedChild(k)
                  if (c) {
                    const r = findLeaf(c)
                    if (r) return r
                  }
                }
                return undefined
              }
              ident = findLeaf(declField)
            }
          }
          if (ident && !inFunction) declaredTypes.add(ident)
        } else if (n.type === "identifier" || n.type === "field_identifier") {
          // CGD23/CGD24 (M37 #601): macro definition names are TEXTUALLY
          // file-scoped (the C preprocessor has no lexical scope — a #define
          // inside a function body or inside an error-recovered region is
          // effective to end-of-file; C-D2). They bypass BOTH the
          // function-local exclusion (prepare.c's `#ifndef
          // SQLITE_MAX_PREPARE_RETRY` inside sqlite3Prepare's compound — the
          // L883 use is a genuine macro use) AND the ERROR-ancestor
          // exclusion (status.c's `# define wsdStat x[0]` sits inside the
          // SQLITE_WSD recovery region but is a real directive the analyzer
          // extracts). Directives are line-anchored text, not recoverable
          // grammar — the CGD14 artifact ruling does not apply to their
          // NAME nodes.
          const isMacroName = !!(n.parent && (n.parent.type === "preproc_def" || n.parent.type === "preproc_function_def"))
          // CGD25: glue fd NAMES never declare (analyzer suppresses the
          // symbol). CGD19-mirror: VARIABLE declarations after the first
          // glue in an ERROR span are body locals (analyzer extractDeclaration
          // gate). Function names (extractFunction path) still declare —
          // os_win.c's 54 real fnDefs inside the giant span are truth.
          const fnNameDecl = (() => {
            if (n.parent && n.parent.type === "function_declarator") {
              let mid: any = n.parent
              while (mid) {
                if (mid.type === "function_definition") return true
                if (mid.type === "declaration") return false
                mid = mid.parent
              }
            }
            return false
          })()
          const varDeclSuppressed = !fnNameDecl && isSuppressedErrorDecl(n)
          if (isDeclaringIdentifier(n) && !isDirectiveConditionText(n) && !isBareFdGlueName(n) && (isMacroName || (!isFunctionLocal(n) && !varDeclSuppressed))) {
            declaredNames.add(n.text)
          }
        }
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }
  // CGD15: per-function locals mirror (params + locally-bound names) —
  // the analyzer suppresses a use when the CURRENT function binds the name
  // locally (functionLocals), so `offset` as a PARAMETER of the reading
  // function must not surface as truth merely because some struct elsewhere
  // has a field named offset. Keyed by function startIndex; the emission
  // branch resolves the ENCLOSING function.
  const fnLocals = new Map<number, Set<string>>()
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.type === "function_definition") {
        const locals = new Set<string>()
        const declarator = n.childForFieldName("declarator")
        const collectParam = (node: any): void => {
          if (!node) return
          if (node.type === "parameter_declaration") {
            const id = leftmostDeclaratorIdentifier(node)
            if (id) locals.add(id)
            return
          }
          for (let k = 0; k < node.namedChildCount; k++) collectParam(node.namedChild(k))
        }
        if (declarator) collectParam(declarator)
        const body = n.childForFieldName("body")
        const collectLocalDecl = (node: any): void => {
          if (!node) return
          if (node.type === "declaration") {
            for (let k = 0; k < node.namedChildCount; k++) {
              const c = node.namedChild(k)
              if (c && (c.type.endsWith("declarator") || c.type === "identifier")) {
                const id = leftmostDeclaratorIdentifier(c)
                if (id) locals.add(id)
              }
            }
          }
          for (let k = 0; k < node.namedChildCount; k++) collectLocalDecl(node.namedChild(k))
        }
        if (body) collectLocalDecl(body)
        fnLocals.set(n.startIndex as number, locals)
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
      // identifier callee OR member/pointer callee -> its callable LEAF.
      // CGD3 mirror: a parenthesized callee is a vendor-macro cast or a
      // computed deref — no resolvable NAME, dropped on both sides. Calls
      // INSIDE the call (cast arguments) still walk below and emit.
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
    } else if (n.type === "field_expression") {
      // CGD-FIELD mirror: member reads are `uses` on the field leaf; an
      // assignment-LHS field is a WRITE (analyzer SCD1 gate).
      const parent = n.parent
      const isCallee = !!parent && parent.type === "call_expression"
      if (!isCallee && !isAssignLhs(n)) {
        const leaf = n.namedChildren.find((c: any) => c.type === "field_identifier")
        if (leaf && !seen.has("use:" + leaf.text)) {
          seen.add("use:" + leaf.text)
          edges.push({ label: "uses", from: "(expr)", target: leaf.text })
        }
      }
    } else if (n.type === "type_identifier") {
      // CGD10: a type-name READ (`sizeof(struct RenameToken)`, `sizeof(X)`
      // via type_identifier inside type_descriptor) is a REFERENCES edge to
      // a type DECLARED in this file — the analyzer's type_reference
      // contract. The declaring occurrence itself is skipped via
      // isDeclaringIdentifier (struct_specifier name is captured as the
      // child, so check parent type_identifier positions only).
      if (!isDeclaringIdentifier(n) && !isDirectiveConditionText(n)) {
        const name = n.text
        if (name && declaredTypes.has(name) && !seen.has("ref:" + name)) {
          seen.add("ref:" + name)
          edges.push({ label: "references", from: "(expr)", target: name })
        }
      }
    } else if (n.type === "preproc_include") {
      // CGD16: include truth mirrors the analyzer's include_dependency
      // references — target is the RAW path text (quotes/brackets
      // stripped), measured from the analyzer (`references sqliteInt.h`).
      const pathNode = n.namedChildren.find((c: any) => c.type === "string_literal" || c.type === "system_lib_string")
      if (pathNode) {
        const raw = pathNode.text.replace(/^["<]/, "").replace(/[">]$/, "")
        if (raw && !seen.has("ref:" + raw)) {
          seen.add("ref:" + raw)
          edges.push({ label: "references", from: "(expr)", target: raw })
        }
      }
    } else if (n.type === "identifier" && !isAssignLhs(n)) {
      // CGD-IDENT mirror: a bare identifier READ of a file-scope variable,
      // enum member, or macro constant. Truth requires the name to be
      // DECLARED somewhere in this file (mirrors isResolvableUseTarget:
      // no fabricated edges to undeclared names). Call-target identifiers
      // are covered by the calls branch above.
      const p = n.parent
      // CGD-PREPROC: condition-text mentions emit no truth even when the
      // name is declared elsewhere (a `#if SQLITE_WASI` reference to an
      // external flag is not a code-level use).
      if (p && p.type !== "call_expression" && !isDeclaringIdentifier(n) && !isDirectiveConditionText(n)) {
        const name = n.text
        // CGD15: a function-local BINDING of the name (param or local
        // declaration in the enclosing function) shadows the file-scope
        // name — the analyzer's functionLocals.has gate suppresses those
        // reads, so truth must too.
        let enc: any = n.parent
        while (enc && enc.type !== "function_definition") enc = enc.parent
        const locs = enc ? fnLocals.get(enc.startIndex) : undefined
        // CGD28: cast-to-typedef positions are type references, not value
        // uses — the analyzer re-routes them to `references` via
        // isTypePositionIdentifier(cast_expression); skip as use-truth when
        // the alias is a declared TYPE (declaredTypes), else no truth.
        if (isCastTypePosition(n)) {
          if (name && declaredTypes.has(name) && !seen.has("ref:" + name)) {
            seen.add("ref:" + name)
            edges.push({ label: "references", from: "(expr)", target: name })
          }
        } else if (name && declaredNames.has(name) && !(locs && locs.has(name)) && !seen.has("use:" + name)) {
          seen.add("use:" + name)
          edges.push({ label: "uses", from: "(expr)", target: name })
        }
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
    } else if (n.type === "composite_literal") {
      // Composite-literal construction (`Foo{...}`, `&Foo{...}`,
      // `pkg.Foo{...}`) -> instantiates of the type leaf. Mirror of the
      // analyzer's analyzeGoCompositeLiteralConstruction (M37 #604): only
      // type_identifier / qualified_type children name a type; slice/map/
      // array literals carry wrapper type children and elided element
      // literals have none, so both fall through to no edge. Builtin guard
      // matches the analyzer.
      const typeN = n.childForFieldName?.("type") ?? (n.namedChildCount > 0 ? n.namedChild(0) : undefined)
      let ctorTarget: string | undefined
      if (typeN && typeN.type === "type_identifier") {
        ctorTarget = typeN.text
      } else if (typeN && typeN.type === "qualified_type") {
        const raw = typeN.text
        ctorTarget = lastSegment(raw)
      }
      if (ctorTarget && !GOBUILTINS.has(ctorTarget) && !seen.has("inst-lit:" + ctorTarget)) {
        seen.add("inst-lit:" + ctorTarget)
        edges.push({ label: "instantiates", from: "(expr)", target: ctorTarget })
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
        // Interface embedding (`interface { Reader; io.Closer }`) = Go
        // interface inheritance -> extends, mirror of the analyzer's
        // go_interface_embedding (GOD4/M37 #604). Target is the LEAF so it
        // matches the analyzer byte-for-byte for both local (Reader) and
        // external (io.Closer -> Closer) embeds.
        const ifaceN = ts.namedChildren.find((c: any) => c.type === "interface_type")
        if (nm && ifaceN) {
          for (let j = 0; j < ifaceN.namedChildCount; j++) {
            const elem = ifaceN.namedChild(j)
            if (!elem || elem.type !== "constraint_elem") continue
            const inner = elem.namedChildCount > 0 ? elem.namedChild(0) : undefined
            if (!inner) continue
            const raw = inner.text
            const leaf = raw.lastIndexOf(".") !== -1 ? raw.slice(raw.lastIndexOf(".") + 1) : raw
            const key = "ext:" + nm.text + "->" + leaf
            if (leaf && !seen.has(key)) {
              seen.add(key)
              edges.push({ label: "extends", from: nm.text, target: leaf })
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

// CSD14 (OO family closure 2026-09): single shared source of truth with the
// analyzer — csharpResolveTargetTypedNew handles direct assignments (declared
// type), collection/array element positions (element type) and assignment-form
// member resolution through the memberTypes prepass. The old local DFS over the
// property subtree picked argument/initializer identifiers (Description, UNSET)
// as targets — the exact fabrication class this shared helper eliminates.
function csharpImplicitNewType(node: any, memberTypes?: Map<string, string>): string | null {
  return csharpResolveTargetTypedNew(node, memberTypes)
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
  // CSD11 mirror: field/property declarator name -> declared type, feeding
  // assignment-form target-typed new() resolution (same pre-pass shape as
  // RealCSharpAnalyzer.collectMemberTypes).
  const memberTypes = new Map<string, string>()
  {
    const pre: any[] = [root]
    while (pre.length) {
      const t = pre.pop()!
      if (/^(class|interface|struct|record)_declaration$/.test(t.type)) {
        const nm = t.childForFieldName?.("name")?.text
        if (nm) declKinds.set(nm, t.type.startsWith("interface") ? "interface" : t.type.includes("struct") ? "struct" : "class")
      }
      if (t.type === "field_declaration" || t.type === "property_declaration") {
        const isField = t.type === "field_declaration"
        // CSD14 mirror (OO family closure 2026-09): shared
        // csharpMemberDeclaredTypeText unwraps array/pointer/nullable
        // containers so array-typed members no longer self-map (the old
        // direct-child scan fell through to the member NAME). RAW type text is
        // stored; base/element resolution happens at use time.
        const declaredType = csharpMemberDeclaredTypeText(t) ?? undefined
        const names: string[] = []
        if (isField) {
          const typeContainer = t.namedChildren.find((c: any) => c.type === "variable_declaration")
          if (typeContainer) {
            for (const d of typeContainer.namedChildren) {
              if (d.type === "variable_declarator") {
                const id = d.namedChildren.find((c: any) => c.type === "identifier")
                if (id) names.push(id.text)
              }
            }
          }
        } else {
          const nm = t.childForFieldName?.("name")?.text
          if (nm) names.push(nm)
        }
        if (declaredType) for (const nm of names) if (!memberTypes.has(nm)) memberTypes.set(nm, declaredType)
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
          // CSD12 mirror: struct bases are ALWAYS interfaces; an unknown
          // external index-0 I-prefixed PascalCase name is conventionally an
          // interface (matches the analyzer's looksLikeInterface exactly).
          const isStructDecl = n.type.includes("struct")
          const looksLikeInterface = !declaredKind && (isStructDecl || (i === 0 && /^[I][A-Z]/.test(leaf) && leaf.length > 2))
          const label = knownIface || looksLikeInterface || (i > 0 && !declaredKind) ? "implements" : "extends"
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
    } else if (n.type === "constructor_initializer") {
      // CSD8 mirror (re-review 2026-09-04): `public Sub() : base(42) { }` /
      // `: this()` — a real constructor-to-constructor call the analyzer now
      // emits (calls IS compared for csharp, so both sides must derive it).
      // `from` is a placeholder (the matcher is label+target site-agnostic).
      const tgt = /:\s*base\s*\(/.test(n.text) ? "base" : "this"
      const key = `calls:${tgt}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push({ label: "calls", from: "(ctor)", target: tgt })
      }
    } else if (n.type === "implicit_object_creation_expression") {
      // Target-typed `new()` — the type is NOT inside the node. Resolve it
      // from the enclosing variable_declarator / property_declaration exactly
      // like RealCSharpAnalyzer.resolveImplicitNewType, so the oracle
      // CONFIRMS the analyzer's instantiates (csharp #264 Station-6: `object
      // x = new()` / `Dictionary<..> d = new()` were UNEXPLAINED because the
      // oracle only understood explicit object_creation_expression). Same
      // inst: key dedups explicit+implicit constructions of one type per file.
      const t = csharpImplicitNewType(n, memberTypes)
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

  // DAD1/DAD2 mirror: resolved heritage names from a clause node — keep a
  // raw type child whose next raw sibling is NOT a `.` token (alias prefix),
  // skip type_arguments. Same contract as
  // RealDartAnalyzer.resolvedHeritageNames (probed dart-heritage-shapes.ts).
  const resolvedRawNames = (n: any): string[] => {
    const out: string[] = []
    for (let k = 0; k < n.childCount; k++) {
      const c = n.child(k)
      if (!c) continue
      if (c.type === "type_arguments" || c.type === "mixins") continue
      if (c.type !== "type_identifier" && c.type !== "identifier") continue
      const next = n.child(k + 1)
      if (next && next.type === ".") continue // alias prefix: `A.B` keeps B
      out.push(c.text)
    }
    return out
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "class_definition" || t === "mixin_declaration") {
      const nm = n.childForFieldName?.("name")?.text ||
        (t === "mixin_declaration" ? n.namedChildren.find((c: any) => c.type === "identifier")?.text : undefined)
      if (nm) {
        // DARTD14 mirror: mixin on-base is a DIRECT type_identifier child
        // (mixin_declaration > [mixin, identifier, type_identifier, ...]) —
        // never a superclass child, so the branch below never sees it.
        if (t === "mixin_declaration") {
          const onBase = n.namedChildren.find((c: any) => c.type === "type_identifier")
          if (onBase) push("extends", onBase.text)
        }
        const sup = n.namedChildren.find((c: any) => c.type === "superclass")
        if (sup) {
          // DAD1 mirror: resolved base = first raw name NOT followed by `.`
          // (alias prefix). `extends _i1.SmartFake` resolves to SmartFake,
          // not the alias. Mixins (with-clause) handled below as uses.
          for (const base of resolvedRawNames(sup)) {
            push("extends", base)
            break
          }
          // mixins under superclass (extends A with M)
          const mx = sup.namedChildren.find((c: any) => c.type === "mixins")
          if (mx) for (const m of typeLeaves(mx)) push("uses", m)
        }
        // mixins directly on the class (class A with M implements C)
        const mxDirect = n.namedChildren.find((c: any) => c.type === "mixins")
        if (mxDirect) for (const m of typeLeaves(mxDirect)) push("uses", m)
        // interfaces — DAD2 mirror: resolved names only (alias prefixes
        // dropped, generic args excluded).
        const ifc = n.namedChildren.find((c: any) => c.type === "interfaces")
        if (ifc) for (const m of resolvedRawNames(ifc)) push("implements", m)
      }
    }
    // DARTD15 mirror: enhanced enums carry implements/with heritage like
    // classes (`enum Poly implements Shape`).
    if (t === "enum_declaration") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        const ifc = n.namedChildren.find((c: any) => c.type === "interfaces")
        if (ifc) for (const m of resolvedRawNames(ifc)) push("implements", m)
        const mx = n.namedChildren.find((c: any) => c.type === "mixins")
        if (mx) for (const m of typeLeaves(mx)) push("uses", m)
      }
    }
    if (t === "constructor_invocation" || t === "new_expression" || t === "const_object_expression") {
      const tn = n.namedChildren.find((c: any) => c.type === "type_identifier")
      if (tn && isCapitalized(tn.text)) push("instantiates", tn.text)
    }
    // DARTD19 mirror (OO family closure): redirecting factories
    // (`factory $X() = _$Y;`) construct the implementation class _$Y — the
    // analyzer emits instantiates for the redirect target (probed on the
    // generated jni_bindings.dart where these are the only unexplained
    // instantiates; the redirect target may be private `_`-prefixed so no
    // capitalization filter applies).
    if (t === "redirecting_factory_constructor_signature") {
      const rt = n.namedChildren.find((c: any) => c.type === "type_identifier")
      if (rt) push("instantiates", rt.text)
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
      // DARTD18 mirror (OO family closure): one call per selector immediately
      // followed by its own argument_part sibling — `..headers.addAll(x)`
      // calls addAll (headers is a bare getter), and `..a(x)..b(y)` calls
      // BOTH a and b (previously only the FIRST cascade_selector identifier
      // was emitted, fabricating getter junk and missing later calls).
      const idText = (sel: any): string | null => {
        const stk: any[] = [sel]
        let last: string | null = null
        while (stk.length) {
          const x = stk.pop()!
          if (x.type === "identifier" || x.type === "type_identifier") last = x.text
          for (let k = 0; k < x.namedChildCount; k++) { const c = x.namedChild(k); if (c) stk.push(c) }
        }
        return last
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type !== "cascade_selector" && c.type !== "unconditional_assignable_selector" &&
            c.type !== "conditional_assignable_selector" && c.type !== "selector") continue
        const next = n.namedChild(i + 1)
        if (!next || next.type !== "argument_part") continue
        const id = idText(c)
        if (id && !DART_BUILTINS.has(id) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id)) push("calls", id)
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
    // SWIFTD16 mirror: fixed-width stdlib numerics filtered like Int/Double.
    "UInt", "UInt8", "UInt16", "UInt32", "UInt64",
    "Int8", "Int16", "Int32", "Int64",
  ])
  // SWIFTD15 mirror: stdlib raw-value types of a raw-representable enum.
  // The oracle must skip the SAME first base the analyzer records as
  // meta.rawType (String/Int/...) — everything else is a conformance.
  const SWIFT_ENUM_RAW = new Set([
    "String", "Character",
    "Int", "Int8", "Int16", "Int32", "Int64",
    "UInt", "UInt8", "UInt16", "UInt32", "UInt64",
    "Float", "Float32", "Float64", "Double",
  ])
  // SWIFTD17 mirror (OO family closure family sweep): capitalized = type-name
  // signal regardless of length — the old `length > 1` carve-out mislabeled
  // single-letter constructions (`E()`) as calls on BOTH sides (F5-blind).
  const isCapitalized = (t: string): boolean => t.length > 0 && t.charCodeAt(0) >= 65 && t.charCodeAt(0) <= 90
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
      let next: any = cur.namedChildren.find((c: any) => c.type === "navigation_expression" || c.type === "self_expression")
      // Glued grammar shapes — mirror the analyzer's hasSelfReceiver
      // (probe-verified 2026-09, swift-nio corpus): the receiver spine may
      // be wrapped one level deeper. additive (`buf.readerIndex +
      // self.count` — suffix binds to the RIGHT self spine) and prefix
      // (`&self.ctx` inout — the & wraps the base; passing by reference is
      // a genuine use).
      if (!next && cur.type === "navigation_expression") {
        const spine = cur.namedChildren[0]
        if (spine && (spine.type === "additive_expression" || spine.type === "prefix_expression")) {
          if (spine.namedChildren.some((c: any) => c.type === "self_expression")) return true
          next = spine
        }
      }
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
  // SWIFTD19 mirror: the LEAF of a dotted user_type is the LAST sibling
  // type_identifier (Outer.Inner -> Inner, Foundation.URLSession ->
  // URLSession) — the pre-fix FIRST-segment read fabricated edges to the
  // module/container name.
  const baseName = (spec: any): string | null => {
    for (let i = 0; i < spec.namedChildCount; i++) {
      const c = spec.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier") return c.text
      if (c.type === "user_type") {
        let leaf: any = null
        for (let j = 0; j < c.namedChildCount; j++) {
          const x = c.namedChild(j)
          if (x && x.type === "type_identifier") leaf = x
        }
        if (leaf) return leaf.text
      }
    }
    const txt = spec.text.trim()
    return txt && !txt.includes(" ") ? txt : null
  }

  // SWIFTD17 mirror helper: is this call_expression a SUBSCRIPT access
  // (call_suffix with a `[` value_arguments) rather than a method call?
  const isSubscript = (n: any): boolean => {
    const suffix = n.namedChildren.find((c: any) => c.type === "call_suffix")
    if (!suffix) return false
    const va = suffix.namedChildren.find((c: any) => c.type === "value_arguments" && c.text.startsWith("["))
    return !!va
  }

  const stack: any[] = [{ n: root, parentType: "" }]
  while (stack.length > 0) {
    const { n, parentType } = stack.pop()!
    const t = n.type
    if (t === "class_declaration") {
      // Actor/struct/enum/extension are all class_declaration in the pinned
      // grammar, decided by the anonymous keyword token. Swift semantics:
      // ONLY a class can have a superclass (first base extends); struct/actor
      // bases are all protocol adoptions (implements); enum/extension bases
      // are conformances (SWIFTD14/15, below) — mirrors the analyzer.
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
      const bases: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "inheritance_specifier") {
          const nm = baseName(c)
          if (nm) bases.push(nm)
        }
      }
      if (isEnum || isExtension) {
        // SWIFTD14/15 oracle mirror: extension bases are ALL conformances
        // (no superclass possible); enum bases are conformances except a
        // stdlib raw-value first base (analyzer records it as meta.rawType).
        const skipFirst = isEnum && bases.length > 0 && SWIFT_ENUM_RAW.has(bases[0])
        for (let i = skipFirst ? 1 : 0; i < bases.length; i++) push("implements", bases[i])
      } else {
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
    if (t === "protocol_declaration") {
      // SWIFTD13 oracle mirror: protocol inheritance -> extends per parent;
      // AnyObject/Any class-constraint markers are NOT protocol parents.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "inheritance_specifier") {
          const nm = baseName(c)
          if (nm && nm !== "AnyObject" && nm !== "Any") push("extends", nm)
        }
      }
    }
    if (t === "call_expression") {
      // Subscript READ (`entries[key]`) parses as call_expression with a
      // `[key]` call_suffix — a property access, NOT a call (mirrors the
      // analyzer's isSubscriptRead gate).
      const isSubscriptCall = isSubscript(n)
      if (isSubscriptCall) { for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, parentType: t }) }; continue }
      // callee: simple_identifier / identifier / navigation_expression
      const callee = n.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "identifier" || c.type === "navigation_expression")
      if (callee && callee.type === "navigation_expression") {
        const leaf = navLeaf(callee)
        if (leaf && leaf !== "$0" && !SWIFT_BUILTINS.has(leaf)) push("calls", leaf)
      } else if (callee) {
        const target = callee.text
        // SWIFTD16 mirror: XCTest assertion functions (capitalized free
        // functions, never types) must not fabricate instantiates edges.
        if (target && !SWIFT_BUILTINS.has(target) && !target.startsWith("XCT")) {
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
      // SCD1 write gate — mirrors the analyzer: an assignment LHS is a
      // WRITE, never a read. The pinned grammar wraps the LHS in
      // directly_assignable_expression; gate only when this node sits
      // INSIDE the LHS span (the RHS of `self.x = self.y` stays a read).
      {
        let a: any = n.parent
        while (a && a.type === "directly_assignable_expression") a = a.parent
        if (a && a.type === "assignment") {
          const lhs = a.namedChild(0)
          if (lhs && lhs.startIndex <= n.startIndex && lhs.endIndex >= n.endIndex) continue
        }
      }
      const hasSelf = hasSelfReceiver(n)
      // SWIFTD17 mirror: the funcNode of a METHOD call is not a member read
      // (analyzer RULED), but the base navigation of a SUBSCRIPT access is a
      // genuine container read — php/objc emit uses there too. The analyzer
      // inspects node.parent; the oracle receives the parent type via the
      // walk, so re-derive subscript-ness from this node's parent node.
      const parCallSubscript = n.parent && n.parent.type === "call_expression" && isSubscript(n.parent)
      if (hasSelf && (parentType !== "call_expression" || parCallSubscript)) {
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

// Objective-C tree-truth oracle (objective-c managed-OO wave #267, selector
// identity wave #2). Mirrors RealObjectiveCAnalyzer's emission contract:
//   - extends: superclass (the first identifier/type_identifier AFTER the
//     class name, past the `:` in class_interface/class_implementation),
//     from non-category declarations only
//   - implements: protocols under parameterized_arguments (type_identifier /
//     identifier / type_name children)
//   - instantiates: message_expression whose selector is alloc/new — the
//     receiver leaf is the instantiated class (nested [[Foo alloc] ...] too)
//   - calls: message_expression FULL SELECTORS (OBJCD7: the keyword segments
//     are identifiers whose next child is an anonymous ':' — leaf naming
//     merged distinct overloads; zero-arg selectors are the last identifier)
//     AND C call_expression identifiers, ONLY inside method/function bodies
//   - overrides (verified in-file only, OBJCD8): a class whose superclass is
//     declared in-file and declares the same full selector emits overrides
//     target `Base.method` (the analyzer's verified 0.95 edges; external-base
//     first-parent guesses at 0.5 are heuristic, no oracle counterpart)
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
  const isRootBase = (name: string) => name === "NSObject" || name === "NSProxy"
  // OBJCD8 oracle mirror: collect in-file class superclass clauses + full
  // selectors per class (interface/implementation both contribute; a Set
  // dedups the same selector declared in @interface and defined in
  // @implementation, mirroring the analyzer's symbol dedup).
  const classBase = new Map<string, string>()
  const classMethods = new Map<string, Set<string>>()
  const fullMethodSelector = (mnode: any): string => {
    let sel = ""
    for (let i = 0; i < mnode.namedChildCount; i++) {
      const c = mnode.namedChild(i)
      if (!c) continue
      if (c.type === "identifier") {
        sel += c.text
        const next = i + 1 < mnode.namedChildCount ? mnode.namedChild(i + 1) : null
        if (next && next.type === "method_parameter") sel += ":"
      }
    }
    return sel
  }
  const fullMessageSelector = (mnode: any): string => {
    let sel = ""
    let lastId: string | null = null
    for (let i = 0; i < mnode.childCount; i++) {
      const c = mnode.child(i)
      if (!c) continue
      if (c.isNamed && c.type === "identifier") {
        const nxt = i + 1 < mnode.childCount ? mnode.child(i + 1) : null
        if (nxt && !nxt.isNamed && nxt.type === ":") {
          sel += c.text + ":"
        } else {
          lastId = c.text
        }
      }
    }
    if (sel) return sel
    return lastId ?? ""
  }
  const collectCls = (cnode: any) => {
    let hasParen = false
    for (let i = 0; i < cnode.childCount; i++) {
      const c = cnode.child(i)
      if (c && !c.isNamed && c.type === "(") { hasParen = true; break }
    }
    if (hasParen) return
    // class_interface: identifier(class), identifier(superclass),
    // parameterized_arguments(protocols), then method_declaration nodes
    // DIRECTLY. class_implementation: identifier(class), then methods nest
    // under implementation_definition wrappers. Collect superclass from the
    // top-level identifiers (probe-verified 2026-09) and methods via a
    // subtree scan that stops at nested class/protocol boundaries.
    let foundName = false
    let superName: string | null = null
    let className: string | null = null
    const methods = new Set<string>()
    for (let i = 0; i < cnode.namedChildCount; i++) {
      const c = cnode.namedChild(i)
      if (!c) continue
      if ((c.type === "identifier" || c.type === "type_identifier") && !foundName && !className) {
        className = c.text
        foundName = true
        continue
      }
      if (c.type === "identifier" && className && !superName && !c.text.startsWith("@")) superName = c.text
    }
    const mstack: any[] = [{ n: cnode, top: true }]
    while (mstack.length > 0) {
      const { n } = mstack.pop()!
      const tt = n.type
      if (!n || n === cnode) { /* root of scan */ }
      if (n !== cnode && (tt === "class_interface" || tt === "class_implementation" || tt === "protocol_declaration")) continue
      if (tt === "method_declaration" || tt === "method_definition") {
        const sel = fullMethodSelector(n)
        if (sel) methods.add(sel)
        continue
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const cc = n.namedChild(i)
        if (cc) mstack.push({ n: cc })
      }
    }
    if (className) {
      if (superName && !isRootBase(superName)) classBase.set(className, superName)
      let set = classMethods.get(className)
      if (!set) { set = new Set<string>(); classMethods.set(className, set) }
      for (const m of methods) set.add(m)
    }
  }
  // In-file verified overrides (OBJCD8): for each class with a KNOWN in-file
  // base that declares the same selector. NSObject/NSProxy bases never appear
  // (excluded above); external bases emit no oracle edge (the analyzer's 0.5
  // guess is heuristic by design).
  const scanStack: any[] = [root]
  while (scanStack.length > 0) {
    const nn = scanStack.pop()!
    if (nn.type === "class_interface" || nn.type === "class_implementation") collectCls(nn)
    for (let i = nn.namedChildCount - 1; i >= 0; i--) {
      const cc = nn.namedChild(i)
      if (cc) scanStack.push(cc)
    }
  }
  for (const [cls, base] of classBase) {
    const baseSet = classMethods.get(base)
    const clsSet = classMethods.get(cls)
    if (!baseSet || !clsSet) continue
    for (const m of clsSet) {
      if (baseSet.has(m)) push("overrides", `${base}.${m}`)
    }
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
      // OBJCD7: full selector (mirrors the analyzer) — a keyword is an
      // identifier whose next child is an anonymous ':'; zero-arg messages
      // fall back to the last identifier. alloc/new -> instantiates the
      // receiver leaf (first keyword check); nested [[Foo alloc] ...]
      // resolves through the inner message.
      const msgSel = fullMessageSelector(n)
      if (msgSel) {
        const firstKw = msgSel.split(":")[0]
        if (firstKw === "alloc" || firstKw === "new") {
          let receiverLeaf: string | null = null
          const receiver = n.namedChild(0)
          if (receiver) {
            if (receiver.type === "identifier" || receiver.type === "type_identifier") receiverLeaf = receiver.text
            else if (receiver.type === "message_expression") {
              const innerSel = fullMessageSelector(receiver)
              const innerKw = innerSel.split(":")[0]
              if (innerKw === "alloc" || innerKw === "new") {
                const innerRecv = receiver.namedChild(0)
                if (innerRecv && (innerRecv.type === "identifier" || innerRecv.type === "type_identifier")) receiverLeaf = innerRecv.text
              }
            }
          }
          if (receiverLeaf) push("instantiates", receiverLeaf)
        } else {
          push("calls", msgSel)
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

// PHP tree-truth oracle (php managed-OO wave #268). Mirrors
// RealPhpAnalyzer's emission contract exactly:
//   - extends: class base_clause (FIRST child = superclass) + interface
//     base_clause (ALL children — interfaces inherit multiple parents)
//   - implements: class_interface_clause children
//   - calls: function_call_expression (PHP_BUILTINS filtered), member_call /
//     nullsafe_member_call / scoped_call name fields
//   - uses: trait use_declaration names (isTraitUse) AND member_access_expression
//     READS (the field name; assignment-LHS writes and call receivers excluded)
//   - instantiates: object_creation_expression first name/qualified_name
//   - references: require/include expression include paths (mirrors
//     emitInclude — namespace `use` declarations go to imports, NOT
//     references, exactly like the analyzer)
// The oracle emits UNIQUE (label,target) edges (seen-set per label+target),
// matching the site-agnostic coverage match in main().
export function derivePhpEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const classBase = new Map<string, string>()  // class -> declared base (for new parent)
  // Import the analyzer's EXACT builtin set (never a hand-duplicated copy —
  // a drift here would fabricate or hide call edges).
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const leafName = (t: string): string => {
    const parts = t.split(/\\|\./).filter(Boolean)
    return parts[parts.length - 1] ?? t
  }
  // PHPD10 mirror (M37.13): a qualified base/interface whose leaf equals the
  // declaring class's own name must keep its qualification (leading \\
  // stripped) — leaf-collapse would fabricate self extends/implements truth
  // for same-leaf cross-namespace inheritance (Setup\\FeaturesForm extends
  // User\\FeaturesForm). Bare names and non-colliding leaves are unchanged.
  const heritageTarget = (raw: string, ownName: string): string => {
    const leaf = leafName(raw)
    if (raw.includes("\\") && leaf === ownName) {
      return raw.replace(/^\\+/, "")
    }
    return leaf
  }
  // PHPD10 mirror: returns undefined when qualification cannot disambiguate
  // a same-leaf base/interface (global single-segment: `class Foo extends
  // \\Foo`) — the analyzer emits NO edge there (self-loop would be
  // fabrication); the oracle must not fabricate truth for it either.
  const heritageOrSkip = (raw: string, ownName: string): string | undefined => {
    const t = heritageTarget(raw, ownName)
    if (t === ownName && raw !== t) return undefined
    return t
  }
  // Mirror RealPhpAnalyzer.extractIncludePath (probe-verified shapes).
  const cleanString = (t: string): string => {
    const m = t.match(/^['"](.*)['"]$/s)
    return m ? m[1] : t
  }
  const collapseWhitespace = (t: string): string => t.replace(/\s+/g, "")
  const extractPhpIncludePath = (node: any): string | undefined => {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "encapsed_string" || child.type === "string") return cleanString(child.text)
      if (child.type === "binary_expression") return collapseWhitespace(child.text)
      if (child.type === "name" || child.type === "qualified_name") return child.text
    }
    return undefined
  }

  const stack: any[] = [{ n: root, parent: null, inBody: false, cls: undefined as string | undefined, base: undefined as string | undefined }]
  while (stack.length > 0) {
    const { n, parent, inBody, cls, base } = stack.pop()!
    const t = n.type
    if (t === "class_declaration") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const className = nameNode?.text ?? "?"
      const baseClause = n.namedChildren.find((c: any) => c.type === "base_clause")
      let declaredBase: string | undefined
      if (baseClause) {
        const first = baseClause.namedChild(0)
        if (first) {
          declaredBase = heritageOrSkip(first.text, className)
          if (declaredBase) push("extends", declaredBase)
        }
      }
      const ifaceClause = n.namedChildren.find((c: any) => c.type === "class_interface_clause")
      if (ifaceClause) {
        for (let i = 0; i < ifaceClause.namedChildCount; i++) {
          const c = ifaceClause.namedChild(i)
          if (c) {
            const ifaceT = heritageOrSkip(c.text, className)
            if (ifaceT) push("implements", ifaceT)
          }
        }
      }
      // Hoisted for the walk-tail (nextCls/nextBase) via the stack object:
      ;(stack as any)._curCls = className
      ;(stack as any)._curBase = declaredBase
    }
    if (t === "enum_declaration") {
      // M37.13 mirror: PHP 8.1 enums implement interfaces via the SAME
      // class_interface_clause shape as classes (analyzer emits the edges).
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const enumCls = nameNode?.text ?? "?"
      if (nameNode) (stack as any)._curCls = enumCls
      const ifaceClause = n.namedChildren.find((c: any) => c.type === "class_interface_clause")
      if (ifaceClause) {
        for (let i = 0; i < ifaceClause.namedChildCount; i++) {
          const c = ifaceClause.namedChild(i)
          if (c) {
            const ifaceT = heritageOrSkip(c.text, enumCls)
            if (ifaceT) push("implements", ifaceT)
          }
        }
      }
    }
    if (t === "interface_declaration") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const ifaceName = nameNode?.text ?? "?"
      const baseClause = n.namedChildren.find((c: any) => c.type === "base_clause")
      if (baseClause) {
        for (let i = 0; i < baseClause.namedChildCount; i++) {
          const c = baseClause.namedChild(i)
          if (c) {
            const extT = heritageOrSkip(c.text, ifaceName)
            if (extT) push("extends", extT)
          }
        }
      }
    }
    if (t === "use_declaration" && inBody) {
      // Trait use inside a class body
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "name" || c.type === "qualified_name")) push("uses", leafName(c.text))
      }
    }
    if (t === "require_once_expression" || t === "include_once_expression" ||
        t === "require_expression" || t === "include_expression") {
      // Mirror the analyzer's emitInclude: references -> the include path
      // (cleanString/collapseWhitespace equivalents).
      const p = extractPhpIncludePath(n)
      if (p) push("references", p)
    }
    if (t === "function_call_expression") {
      const fn = n.childForFieldName?.("function") ?? n.namedChildren.find((c: any) => c.type === "name" || c.type === "qualified_name")
      if (fn) {
        const target = leafName(fn.text)
        // M37.13 mirror: the analyzer's processFunctionCall returns EARLY for
        // the WordPress hook registrars (framework detection only, no calls
        // edge). Without this mirror the oracle fabricated calls:add_action/
        // add_filter truth on every procedural WP-style file.
        const isWpHook = target === "add_action" || target === "add_filter"
        if (!isWpHook && !PHP_BUILTINS.has(target)) push("calls", target)
      }
    }
    if (t === "member_call_expression" || t === "nullsafe_member_call_expression") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode) push("calls", nameNode.text)
    }
    if (t === "scoped_call_expression") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode) push("calls", nameNode.text)
    }
    if (t === "object_creation_expression") {
      // Mirror the analyzer: named/qualified target -> leaf; self/static ->
      // enclosing class; parent -> declared base class (probe-verified:
      // pinned grammar parses new self/parent/static as name, not
      // relative_scope). Unresolvable parent emits NOTHING.
      const named = n.namedChildren.find((c: any) => c.type === "name" || c.type === "qualified_name")
      if (named) {
        if (named.text === "self" || named.text === "static" || named.text === "parent") {
          const resolved = named.text === "parent" ? base : cls
          if (resolved) push("instantiates", resolved)
        } else {
          push("instantiates", leafName(named.text))
        }
      } else {
        const rel = n.namedChildren.find((c: any) => c.type === "relative_scope")
        if (rel) {
          const resolved = rel.text === "parent" ? base : cls
          if (resolved) push("instantiates", resolved)
        }
      }
    }
    if ((t === "member_access_expression" || t === "nullsafe_member_access_expression") && inBody) {
      // Member READS only: assignment/augmented-assignment LHS is a write;
      // member_call receiver is a call target (mirrors the analyzer's
      // read/write + call-receiver gate — M37.13 added
      // augmented_assignment_expression to this oracle gate after the
      // analyzer's SCD1 fix showed the oracle fabricating phantom uses for
      // `$this->count += $step` when the member is never read elsewhere).
      // PHPD11 mirror (M37 #606 master-review wave-2): PHP 8 nullsafe reads
      // `$this->svc?->name` parse as nullsafe_member_access_expression with
      // the SAME "name" field (probe-verified 2026-09-07); both sides were
      // dropping the trailing member read the non-null form emits.
      const lhs = parent ? parent.namedChild(0) : null
      const isWrite = parent && (parent.type === "assignment_expression" || parent.type === "augmented_assignment_expression") && lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      const isCallReceiver = parent && (parent.type === "member_call_expression" || parent.type === "nullsafe_member_call_expression")
      if (!isWrite && !isCallReceiver) {
        const nameNode = n.childForFieldName?.("name")
        if (nameNode) push("uses", nameNode.text)
      }
    }
    const nextBody = inBody || t === "method_declaration" || t === "function_definition"
    const nextCls = t === "class_declaration" ? (stack as any)._curCls : cls
    const nextBase = t === "class_declaration" ? (stack as any)._curBase : base
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, parent: n, inBody: nextBody, cls: nextCls, base: nextBase })
    }
  }
  return edges
}

// Ruby truth: derive the same structural edges the analyzer emits, from
// clause node structure only. Mirrors RealRubyAnalyzer (probe-verified):
export function deriveRubyEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const leafName = (t: string): string => {
    const parts = t.replace(/^<\s*/, "").split(/::|\./).filter(Boolean)
    return parts[parts.length - 1] ?? t
  }
  const isRubyBuiltin = (name: string): boolean => {
    // Mirror RealRubyAnalyzer.pushBareCall filters: builtins, Rails macros,
    // self/nil/true/false, capitalized constants (a bare uppercase identifier
    // is a CONSTANT, never a call), __dunder__.
    if (RUBY_BUILTINS.has(name)) return true
    if (RAILS_MACRO_METHODS.has(name)) return true
    if (name === "self" || name === "nil" || name === "true" || name === "false") return true
    const firstChar = name.charCodeAt(0)
    if (firstChar >= 65 && firstChar <= 90) return true
    if (name.startsWith("__") && name.endsWith("__")) return true
    return false
  }
  // Call-node filter mirrors RealRubyAnalyzer.processCall, which skips ONLY
  // RUBY_BUILTINS + RAILS_MACRO_METHODS — NOT the uppercase rule: `Pathname
  // (FOOFILE)` is a real Kernel method call (rake test_rake_rules.rb L86),
  // and the analyzer emits calls:Pathname. Filtering uppercase names here
  // wrongly dropped every capitalized Kernel call from the oracle.
  const isRubyCallBuiltin = (name: string): boolean => {
    if (RUBY_BUILTINS.has(name)) return true
    if (RAILS_MACRO_METHODS.has(name)) return true
    if (name === "self" || name === "nil" || name === "true" || name === "false") return true
    if (name.startsWith("__") && name.endsWith("__")) return true
    return false
  }
  const isVisibilityDirective = (name: string | undefined): boolean =>
    name === "private" || name === "protected" || name === "public"

  // Implicit overrides (RUBYD2): methods redeclared in a subclass that also
  // exist in its superclass, from local class declarations in this file.
  const classBases = new Map<string, string>()
  const classMethods = new Map<string, Set<string>>()
  const collectDecls = (start: any) => {
    const stack: any[] = [start]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "class") {
        const nameNode = n.childForFieldName?.("name")
        const sup = n.childForFieldName?.("superclass")
        if (nameNode?.text) {
          if (sup) classBases.set(nameNode.text, leafName(sup.text.replace(/^<\s*/, "")))
          const body = n.namedChildren.find((c: any) => c.type === "body_statement")
          if (body) {
            const names = classMethods.get(nameNode.text) ?? new Set<string>()
            const mstack: any[] = [body]
            while (mstack.length > 0) {
              const m = mstack.pop()!
              if (m.type === "method" || m.type === "singleton_method") {
                const mn = m.childForFieldName?.("name")
                if (mn?.text) names.add(mn.text)
              }
              for (let i = 0; i < m.namedChildCount; i++) mstack.push(m.namedChild(i))
            }
            classMethods.set(nameNode.text, names)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
  }
  collectDecls(root)

  // Same-file method names (all classes + top-level): a bare identifier that
  // names a method defined in this file is a CALL of that method, not noise.
  // The analyzer emits these (bare-identifier branch); the oracle must too.
  const fileMethods = new Set<string>()
  for (const names of classMethods.values()) for (const m of names) fileMethods.add(m)

  // Local-variable resolution (mirrors RealRubyAnalyzer.walkBody localNames):
  // a bare identifier is a LOCAL READ, not a method call, if it names a
  // parameter, a block parameter, or an assignment target ANYWHERE IN THE
  // ENCLOSING METHOD BODY. Ruby resolves this at parse-of-scope time. The
  // analyzer pre-scans EACH method body for assignment targets + block/lambda
  // params and threads the method's own params in (walkBody scoping). The
  // oracle must scope the same way: a whole-file pass wrongly treats `runlist`
  // (assigned in test_invoke) as a local inside test_investigation_output,
  // where Ruby actually resolves it as a METHOD CALL — verified on rake
  // test_rake_task.rb (the analyzer's `calls:runlist` there is correct).
  const methodLocals = new Map<string, Set<string>>()
  const collectLocals = (start: any, into: Set<string>) => {
    const st: any[] = [start]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "assignment" || n.type === "operator_assignment") {
        const left = n.childForFieldName?.("left") ?? n.namedChild(0)
        if (left) {
          if (left.type === "identifier") into.add(left.text)
          for (let i = 0; i < left.namedChildCount; i++) {
            const c = left.namedChild(i)
            if (c?.type === "identifier") into.add(c.text)
          }
        }
      }
      // Method/block parameters live in a container node (method_parameters,
      // block_parameters, lambda_parameters) and come in several forms:
      // plain identifier, optional_parameter, splat_parameter,
      // keyword_parameter, block_parameter, destructured_parameter. Recurse
      // into the whole subtree so the bound name inside every form is added.
      if (n.type === "method_parameters" || n.type === "block_parameters" ||
          n.type === "lambda_parameters" || n.type === "parameters") {
        // Only the BOUND NAMES are locals. optional_parameter / keyword_parameter
        // also carry a default VALUE expression whose identifiers are NOT
        // locals — `def f(x = challenge)` must leave `challenge` a method call
        // (RB-B parity fix, rack wave: handler.rb). Block/lambda containers
        // hold names only, so the plain recursion stays correct for them.
        const collectParamName = (qn: any) => {
          for (let i = 0; i < qn.namedChildCount; i++) {
            const c = qn.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") into.add(c.text)
            else if (c.type === "optional_parameter" || c.type === "keyword_parameter") {
              const nm = c.childForFieldName?.("name") ?? c.namedChild(0)
              if (nm?.type === "identifier") into.add(nm.text)
            } else collectParamName(c)
          }
        }
        collectParamName(n)
      }
      // `rescue Exception => ex` binds `ex` as a local (mirrors the analyzer's
      // exception_variable rule — probe-verified 2026-08-31).
      if (n.type === "exception_variable") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c?.type === "identifier") into.add(c.text)
        }
      }
      // Ruby 3 pattern-matching bindings (RUBYG1 — mirrors the analyzer rule
      // with the identical shape set): identifiers in array_pattern /
      // find_pattern / as_pattern, the value position of keyword_pattern,
      // splat_parameter names, and a bare in_clause pattern are BINDINGS =
      // locals, never calls. Without this the oracle (and the analyzer, now
      // fixed) fabricated calls:a/calls:b etc. for every `in [a, b]`.
      if (n.type === "array_pattern" || n.type === "find_pattern" ||
          n.type === "as_pattern") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") into.add(c.text)
          else if (c.type === "splat_parameter") {
            const nm = c.childForFieldName?.("name") ?? c.namedChild(0)
            if (nm?.type === "identifier") into.add(nm.text)
          }
        }
      } else if (n.type === "keyword_pattern") {
        // `{name:}` binds `name` via the hash_key_symbol (shorthand);
        // `{age: x}` binds x via the value identifier.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") into.add(c.text)
          else if (c.type === "hash_key_symbol") into.add(c.text.replace(/^:/, ""))
        }
      } else if (n.type === "in_clause") {
        const first = n.namedChild(0)
        if (first?.type === "identifier") into.add(first.text)
      }
      for (let i = 0; i < n.namedChildCount; i++) st.push(n.namedChild(i))
    }
  }
  // Per-method local sets, keyed by the method node's id (nested defs get
  // their own scope). Code OUTSIDE any method has no local set — bare
  // identifiers there are calls, matching the analyzer's walkBody scoping.
  const methodScan: any[] = [root]
  while (methodScan.length > 0) {
    const n = methodScan.pop()!
    if (n.type === "method" || n.type === "singleton_method" || n.type === "setter") {
      const set = new Set<string>()
      collectLocals(n, set)
      methodLocals.set(String(n.id), set)
    }
    for (let i = 0; i < n.namedChildCount; i++) methodScan.push(n.namedChild(i))
  }

  const stack: any[] = [{ n: root, parent: null, inBody: false, cls: undefined as string | undefined, methodId: undefined as string | undefined }]
  while (stack.length > 0) {
    const { n, parent, inBody, cls: enclosingClass, methodId } = stack.pop()
    const t = n.type
    if (t === "class") {
      // superclass field text is "< Name" — strip the marker, keep the leaf.
      // Static-superclass gate mirrors the analyzer's isStaticSuperclassName
      // (RUBD13 master-review): `class X < Struct.new(:a)` has an ANONYMOUS
      // base (RB-C: no extends). The old rule leaf-split the raw expression
      // text into a DIFFERENT junk target than the analyzer's, a latent
      // missing+unexplained pair whenever the shape was sampled.
      const sup = n.childForFieldName?.("superclass")
      if (sup) {
        const cleaned = sup.text.replace(/^<\s*/, "").trim()
        // Shared single-source-of-truth gate with the analyzer
        // (isRubyStaticSuperclassName) — a duplicated inline regex previously
        // produced a DIFFERENT junk target than the analyzer (master-review
        // 2026-09), a latent missing+unexplained pair on real corpora.
        if (isRubyStaticSuperclassName(cleaned)) {
          push("extends", leafName(cleaned))
        }
      }
    }
    // Keyword `alias new_name old_name` (class/module/top-level): the
    // analyzer treats it as the RB-E alias_method contract (calls:<newname>,
    // aliasedTo metadata). Mirror so the edge is covered, not unexplained
    // (master-review 2026-09). Method-body aliases emit nothing on either
    // side (the identifier skip suppresses both names).
    if (t === "alias" && !inBody) {
      // Keyword alias is a declaration-time construct (class/module/top
      // level). The analyzer's walkBody consumes method bodies and its
      // `alias` skip-parent suppresses method-body aliases (runtime
      // redefinition) — gate on !inBody to stay in exact parity.
      const names: string[] = []
      for (let i = 0; i < n.namedChildCount && names.length < 2; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "identifier") names.push(c.text)
        else if (c.type === "simple_symbol") names.push(c.text.replace(/^:/, ""))
      }
      if (names.length === 2) push("calls", names[0])
    }
    // Mixins: the analyzer emits include/extend/prepend wherever they appear
    // (class level AND inside method bodies — `base.extend(ClassMethods)`,
    // `exception.extend(Mixin)`). The oracle must not gate on !inBody.
    if (t === "call" || t === "command" || t === "command_call") {
      const methodNode = n.childForFieldName?.("method")
      const methodName = methodNode?.text
      if (methodName === "include" || methodName === "prepend") {
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i)
            if (arg && (arg.type === "constant" || arg.type === "scope_resolution")) {
              push("implements", leafName(arg.text))
            }
          }
        }
      } else if (methodName === "extend") {
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i)
            if (arg && (arg.type === "constant" || arg.type === "scope_resolution")) {
              push("extends", leafName(arg.text))
            }
          }
        }
      } else if (methodName === "alias_method") {
        // `alias_method :local_path, :path` makes the alias name a callable
        // member of the class — the analyzer emits calls:local_path with
        // aliasedTo metadata (long-standing contract); mirror it so the edge
        // is covered rather than flagged unexplained (RB-E, rack wave:
        // uploaded_file.rb). Only simple_symbol args, like the analyzer.
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        if (args) {
          const names: string[] = []
          for (let i = 0; i < args.namedChildCount && names.length < 2; i++) {
            const arg = args.namedChild(i)
            if (arg && arg.type === "simple_symbol") names.push(arg.text.replace(/^:/, ""))
          }
          if (names.length === 2) push("calls", names[0])
        }
      }
    }
    if (t === "call" || t === "command" || t === "command_call") {
      const methodNode = n.childForFieldName?.("method")
      if (methodNode) {
        const methodName = methodNode.text
        if (methodName === "new") {
          // `X.new(...)` instantiates the receiver class. A receiverless `new`
          // (e.g. `EMPTY = EmptyLinkedList.new` inside the class body, or a
          // bare `new` in a class method) constructs the ENCLOSING class —
          // resolve it from the nearest enclosing class/module, mirroring the
          // analyzer. Track enclosing class names on the walk stack.
          // The analyzer's contract (real-ruby-analyzer processCall): an
          // UPPERCASE receiver -> instantiates:leaf; a lowercase-identifier
          // receiver (`task_class.new`) is a REGULAR call (calls:new, not an
          // instantiation — the receiver is a local, its class is unknowable);
          // no receiver at all -> instantiates the enclosing class. The old
          // scan only matched constant/scope_resolution, so `task_class.new`
          // fell through to enclosingClass and fabricated instantiates
          // (verified: rake task_manager.rb `task_class.new(task_name, self)`
          // -> bogus instantiates:TaskManager).
          // RB-A note (rack wave): the receiver scan below intentionally skips
          // expression receivers (`Class.new { ... }.new`, `self.class.new`) —
          // they read as receiverless, so `self.new` / `self.class.new` inside
          // a class resolve to the ENCLOSING class (instantiates, mirroring the
          // analyzer's owner fallback) and a complex receiver at TOP level has
          // no enclosing class and correctly emits nothing. The analyzer's
          // own rb-A gate suppresses its junk `calls:new` for the same shapes.
          let receiver: string | undefined
          let receiverIsConst = false
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (child && child.id === methodNode.id) break
            if (child && (child.type === "constant" || child.type === "scope_resolution")) {
              receiver = child.text
              receiverIsConst = true
            } else if (child && child.type === "identifier") {
              receiver = child.text
            }
          }
          if (!receiver) {
            if (enclosingClass) push("instantiates", leafName(enclosingClass))
          } else if (receiverIsConst) {
            push("instantiates", leafName(receiver))
          } else {
            // lowercase receiver (`task_class.new`) — analyzer emits calls:new
            push("calls", "new")
          }
        } else if (!isRubyCallBuiltin(methodName) && !isVisibilityDirective(methodName)) {
          push("calls", methodName)
        }
      }
    }
    if (t === "identifier" && inBody) {
      // Bare identifiers in expression position are calls (RUBYD4) —
      // mirrors the analyzer's bare-identifier branch. Skip assignment
      // LHS, def names, parameters, hash keys, and LOCALS (parameters,
      // block params, assignment targets — resolved just above), so Ruby
      // locals are not misread as method calls.
      const pt = parent?.type
      // `assignment`/`operator_assignment` are deliberately NOT in the skip
      // list: the LHS is already covered by the per-method local set
      // (collectLocals adds assignment targets), while the RHS is a genuine
      // bare call — `loc = find_location` must emit calls:find_location (the
      // analyzer's walkBody recurses into the RHS; verified on rake
      // task_manager.rb L242). Local check is scoped to the ENCLOSING METHOD
      // (mirrors walkBody): an identifier assigned in test_invoke but used in
      // test_investigation_output is a CALL in Ruby, not a local.
      const localsHere = methodId ? methodLocals.get(methodId) : undefined
      // `pair` is deliberately ABSENT (RUBD12, master-review 2026-09): a
      // hash/argument pair's VALUE is a real expression (`{ x: helper }`,
      // `foo(k: helper)`) and colon-form KEYS are hash_key_symbol nodes, so
      // the old `pair` skip only ever suppressed genuine value-position
      // calls — on BOTH sides, a shared blind spot F5 cannot see.
      // `alias` is present: `alias a b` identifiers are method-name
      // declarations, never expression calls (analyzer + oracle parity).
      const skip = pt === "method" || pt === "singleton_method" || pt === "setter" ||
        pt === "method_parameters" || pt === "parameters" ||
        pt === "block_parameters" || pt === "lambda_parameters" ||
        pt === "alias" || pt === "class" || pt === "module" ||
        pt === "singleton_class" || pt === "call" || pt === "command" || pt === "command_call"
      if (!skip && !(localsHere?.has(n.text) ?? false) && !isRubyBuiltin(n.text) && !isVisibilityDirective(n.text)) {
        // A bare identifier naming a method defined in this file resolves to
        // that method (Ruby parse-of-scope rule) — the analyzer emits it as a
        // bare call, so the oracle must too (`until (fn = have_rakefile)`).
        push("calls", n.text)
      }
    }
    // Call node in a METHOD BODY: also emit the bare method name as a call
    // (mirrors the analyzer's walkBody: `service.authorize(x)` -> calls:authorize
    // regardless of receiver). Without this, the oracle misses the member-call
    // surface the analyzer surfaces on every receiver.
    // `new` is excluded here: `X.new` is handled above as instantiates (the
    // analyzer RETURNS from processCall on `new`, so it never emits calls:new
    // for an uppercase receiver — the old rule fabricated 41 bogus calls:new
    // edges across rake). Lowercase `task_class.new` IS a calls:new, and the
    // new-branch above now emits it.
    if ((t === "call" || t === "command" || t === "command_call") && inBody) {
      const methodNode = n.childForFieldName?.("method")
      if (methodNode && methodNode.text !== "new" && !isRubyCallBuiltin(methodNode.text) && !isVisibilityDirective(methodNode.text)) {
        push("calls", methodNode.text)
      }
    }
    if (t === "instance_variable") {
      // READS only (mirrors RUBD1 + RUBD5 + SCD1): BOTH `assignment` (@x = v)
      // and `operator_assignment` (@x += / -= / ||= v) LHS are WRITES — the
      // family contract (JAD1/KAD1/SCD1/CSD1 sweep, commit 2807164) gates
      // compound-assign LHS too, and the ruby fixture re-authoring removed
      // the refund `@balance += amount` pin accordingly. The old "RMW emits a
      // use" behavior predated that sweep (its rake `@options ||=` witness
      // then matched an analyzer that leaked the same write) — stale, removed.
      const lhs = parent ? parent.childForFieldName?.("left") : null
      const isWrite = parent && (parent.type === "assignment" || parent.type === "operator_assignment") &&
        lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      if (!isWrite) push("uses", n.text)
    }
    // Track nearest enclosing class/module for receiverless-new resolution.
    let nextCls = enclosingClass
    if (t === "class" || t === "module") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode?.text) nextCls = nameNode.text
    }
    // Track nearest enclosing method for per-method local resolution.
    let nextMethodId = methodId
    if (t === "method" || t === "singleton_method" || t === "setter") {
      nextMethodId = String(n.id)
    }
    const nextBody = inBody || t === "method" || t === "singleton_method"
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, parent: n, inBody: nextBody, cls: nextCls, methodId: nextMethodId })
    }
  }
  // Implicit overrides (RUBYD2): subclass methods redeclaring a superclass
  // method, emitted as `Sub.method -> Base.method` (analyzer contract).
  for (const [cls, base] of classBases) {
    const baseMethods = classMethods.get(base)
    const subMethods = classMethods.get(cls)
    if (!baseMethods || !subMethods) continue
    for (const m of subMethods) {
      // Analyzer contract: overrides edges point at the BASE method
      // (source=Sub.method, target=Base.method). The old rule pushed the
      // SUBclass method as target, so every ruby overrides edge was BOTH
      // missing (oracle Sub.method) and unexplained (analyzer Base.method) —
      // 6 phantom gaps on linked_list.rb alone.
      if (baseMethods.has(m)) push("overrides", `${base}.${m}`)
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
  // Generic type names (type_spec with type_parameter_list): implements
  // satisfaction across generic instantiations needs type UNIFICATION, so
  // BOTH sides refuse (M37 #604, mirrors the analyzer's hasGenerics skip).
  const genericNames = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "type_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const ts = n.namedChild(i)
        if (!ts || ts.type !== "type_spec") continue
        const nm = ts.childForFieldName?.("name")?.text
        // Generic type_spec (`MapLattice[Key comparable, ...]`): satisfaction
        // needs unification — record for the pair-level skip below.
        if (nm && (ts.namedChildren ?? []).some((c: any) => c.type === "type_parameter_list")) {
          genericNames.add(nm)
        }
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
            // Strip pointer AND generic brackets — Go generics use `[...]`,
            // not `<...>` (M37 #604: MapLattice[Key, Elem, L] receivers were
            // never matched to the declared MapLattice).
            if (tn) receiverType = lastSegment(tn.text.replace(/^\*/, "").replace(/[\[<].*$/, ""))
          }
        }
      }
      if (nm && receiverType) {
        if (!structMethods[receiverType]) structMethods[receiverType] = new Set()
        structMethods[receiverType].add(nm)
      }
    }
    // Package-scope-only mirror (LocalsAreNotSymbols contract): function-,
    // method- and func-literal-local type/method declarations are not
    // symbols in the analyzer, so no implements edge may be derived from
    // them. All needed info is processed at the declaration node itself —
    // their subtrees carry nothing relevant, so skip descending entirely
    // (M37 #604 go-tools: function-local `interface hasCommands` in
    // gopls/internal/cmd/subcommands.go was over-derived).
    if (n.type === "function_declaration" || n.type === "method_declaration" || n.type === "func_literal") {
      continue
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
    // Generic pairs skipped on BOTH sides (mirrors the analyzer).
    if (genericNames.has(iface)) continue
    for (const [structName, methods] of Object.entries(structMethods)) {
      if (structName === iface) continue
      if (genericNames.has(structName)) continue
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
export function derivePythonEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    const k = label + ":" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  // Mirror the analyzer's PYTHON_BUILTINS filter (imported — never duplicated).
  const isBuiltin = (name: string): boolean =>
    PYTHON_BUILTINS.has(name) ||
    (name.startsWith("__") && name.endsWith("__"))
  // Uppercase-head leaf the analyzer treats as a possible class name; only
  // in-file declared names become instantiates (tracked via declaredTypes
  // pass below).
  const isUpper = (name: string): boolean => {
    const c = name.charCodeAt(0)
    return c >= 65 && c <= 90
  }

  // Pass 1: collect in-file declared class/enum names (the analyzer's
  // declaredTypes gate — instantiates is only emitted for those).
  const declaredTypes = new Set<string>()
  const scan = (n: any) => {
    if (n.type === "class_definition") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "identifier")
      if (nameNode?.text) declaredTypes.add(nameNode.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i))
  }
  scan(root)

  // Class structure maps for in-file override resolution (same contract as
  // the analyzer's extractOverrideRelationships: base from the FIRST
  // extends edge — Python MRO; methods registered per class).
  const baseByClass = new Map<string, string>()
  const classMethods = new Map<string, Set<string>>()
  const regMethod = (cls: string | undefined, m: string) => {
    if (!cls || !m) return
    const set = classMethods.get(cls) ?? new Set()
    set.add(m)
    classMethods.set(cls, set)
  }

  // Pass 2: structural edge derivation (mirrors RealPythonAnalyzer).
  const stack: any[] = [{ n: root, parent: null, inFn: undefined as string | undefined }]
  while (stack.length > 0) {
    const { n, parent, inFn } = stack.pop()!
    const t = n.type
    // PYD5: rebind the owner ONLY when entering a symbol-level def (inFn is
    // still undefined). A def inside a def is NOT a symbol — the calls
    // contract attributes its body to the ENCLOSING function, so its member
    // reads must keep the outer owner too (mirrors extractMemberUses).
    let nextFn = inFn
    if (t === "function_definition" && !inFn) {
      const nameNode = n.namedChildren.find((c: any) => c.type === "identifier")
      nextFn = nameNode?.text ?? inFn
    }
    // Enum flag shared by both class_definition branches below (extends
    // derivation sets it; member registration reads it).
    let isEnumCls = false

    if (t === "class_definition") {
      const className = n.namedChildren.find((c: any) => c.type === "identifier")?.text ?? "?"
      const args = n.namedChildren.find((c: any) => c.type === "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (!arg) continue
          // base-class LEAF only: subscript Generic[T] -> Generic,
          // attribute a.b -> b (mirrors baseClassLeaf).
          let leaf: string | undefined
          if (arg.type === "identifier") leaf = arg.text
          else if (arg.type === "subscript" || arg.type === "attribute") {
            const inner = arg.type === "attribute"
              ? arg.namedChild(arg.namedChildCount - 1)
              : arg.namedChild(0)
            leaf = inner?.text
            if (leaf && leaf.includes(".")) leaf = leaf.split(".").pop()
          }
          if (leaf && leaf !== className) {
            push("extends", leaf)
            if (leaf === "Enum") isEnumCls = true
            if (!baseByClass.has(className)) baseByClass.set(className, leaf)
          }
        }
      }
    }

    if (t === "assignment") {
      // annotated assignment `x: T = v` → references:declared_type (the
      // analyzer's walk emits these from the assignment case; builtin
      // scalars excluded; attribute-path types descend to leaves)
      const typeNode = n.namedChildren.find((c: any) => c.type === "type")
      if (typeNode) {
        const stackT: any[] = [typeNode]
        while (stackT.length > 0) {
          const tn = stackT.pop()!
          if (tn.type === "identifier") {
            if (!["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"].includes(tn.text)) push("references", tn.text)
          } else if (tn.type !== "string" && tn.type !== "concatenated_string" && tn.type !== "none") {
            for (let i = 0; i < tn.namedChildCount; i++) stackT.push(tn.namedChild(i))
          }
        }
      }
    }

    if (t === "function_definition") {
      // return annotation → references:return_type (builtin scalars excluded)
      const typeNode = n.namedChildren.find((c: any) => c.type === "type")
      if (typeNode) {
        const stackT: any[] = [typeNode]
        while (stackT.length > 0) {
          const tn = stackT.pop()!
          if (tn.type === "identifier") {
            if (!["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"].includes(tn.text)) push("references", tn.text)
          } else if (tn.type !== "string" && tn.type !== "concatenated_string" && tn.type !== "none") {
            for (let i = 0; i < tn.namedChildCount; i++) stackT.push(tn.namedChild(i))
          }
        }
      }
      // typed params → references:declared_type
      const paramsNode = n.namedChildren.find((c: any) => c.type === "parameters")
      if (paramsNode) {
        for (let i = 0; i < paramsNode.namedChildCount; i++) {
          const p = paramsNode.namedChild(i)
          const ptype = p?.type === "typed_parameter" || p?.type === "typed_default_parameter"
            ? p.namedChildren.find((c: any) => c.type === "type")
            : undefined
          if (ptype) {
            const stackT: any[] = [ptype]
            while (stackT.length > 0) {
              const tn = stackT.pop()!
              if (tn.type === "identifier") {
                if (!["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any"].includes(tn.text)) push("references", tn.text)
              } else if (tn.type !== "string" && tn.type !== "concatenated_string" && tn.type !== "none") {
                for (let j = 0; j < tn.namedChildCount; j++) stackT.push(tn.namedChild(j))
              }
            }
          }
        }
      }
    }

    if (t === "function_definition" && parent && parent.type === "class_definition") {
      const clsName = parent.namedChildren.find((c: any) => c.type === "identifier")?.text
      const mname = n.namedChildren.find((c: any) => c.type === "identifier")?.text
      regMethod(clsName, mname)
    }

    if (t === "class_definition") {
      // register own DIRECT methods too (the generic regMethod branch above
      // needs parent — but during the LIFO walk the class node is popped
      // before its methods, so methods deep inside the block reach the
      // generic branch only via their own parent chain; direct scan here is
      // the belt-and-braces pass the analyzer does at extractClass time)
      const clsName2 = n.namedChildren.find((c: any) => c.type === "identifier")?.text
      const block = n.namedChildren.find((c: any) => c.type === "block")
      if (clsName2 && block) {
        if (isEnumCls) {
          // Enum class: members are ONLY the analyzer's extractClass contract
          // — direct-body constant-valued assignments (string/integer/float/
          // true/false/none/identifier RHS). No deep scan, no method
          // registration (enum methods are registered by the generic
          // function_definition branch above).
          for (let i = 0; i < block.namedChildCount; i++) {
            const stmt = block.namedChild(i)
            if (stmt?.type !== "expression_statement") continue
            const assign = stmt.namedChild(0)
            if (assign?.type !== "assignment") continue
            const left = assign.namedChild(0)
            const right = assign.namedChild(assign.namedChildCount - 1)
            if (left?.type !== "identifier") continue
            if (right && (right.type === "string" || right.type === "integer" ||
                right.type === "float" || right.type === "true" || right.type === "false" ||
                right.type === "none" || right.type === "identifier")) {
              regMethod(clsName2, left.text)
            }
          }
        } else {
          // register every method declared anywhere in the class body except
          // inside NESTED classes (methods of inner classes belong to them) —
          // descends decorated_definition wrappers and compound statements.
          // Class-body assignment LHS also register: the analyzer's
          // extractAssignment class-variable branch turns `code_object = None`
          // at class scope into a Property owned by the class, and
          // baseDeclares treats ANY base-owned symbol as an override target
          // (Cython's CFuncDefNode.code_object -> FuncDefNode hook pattern).
          // Function bodies are skipped (locals are not symbols); compound
          // statements descend (the analyzer's currentClass persists inside
          // if/for/try at class scope). `__all__` is intercepted before the
          // Property branch by the analyzer, so it never registers.
          const mstack: any[] = [block]
          while (mstack.length > 0) {
            const m = mstack.pop()!
            if (m.type === "function_definition") {
              regMethod(clsName2, m.namedChildren.find((c: any) => c.type === "identifier")?.text)
              continue
            }
            if (m.type === "class_definition") continue
            if (m.type === "assignment" || m.type === "augmented_assignment" || m.type === "named_expression") {
              const lhs = m.namedChild(0)
              if (lhs?.type === "identifier" && lhs.text !== "__all__") regMethod(clsName2, lhs.text)
              continue
            }
            for (let i = 0; i < m.namedChildCount; i++) mstack.push(m.namedChild(i))
          }
        }
      }
    }

    if (t === "function_definition") {
      // In-file overrides (mirror the analyzer's harness-companion contract):
      // method redeclared in a subclass whose base (from the extends edges
      // derived above) declares the same-name method. Pure clause structure.
      // NOTE: the method's structural parent is the class BLOCK, not the
      // class — use the node's real .parent pointer and walk up to the
      // class_definition.
      let owner: any = null
      let up: any = n.parent
      while (up) {
        if (up.type === "class_definition") { owner = up; break }
        if (up.type === "function_definition" || up.type === "module") break
        up = up.parent
      }
      if (owner) {
        const clsName = owner.namedChildren.find((c: any) => c.type === "identifier")?.text
        const mname = n.namedChildren.find((c: any) => c.type === "identifier")?.text
        if (clsName && mname) {
          const base = baseByClass.get(clsName)
          if (base && classMethods.get(base)?.has(mname)) {
            push("overrides", `${base}.${mname}`)
          }
        }
      }
    }

    if (t === "call") {
      // isinstance(x, T) / issubclass(a, B): second positional arg names a
      // type → references:instanceof_check (mirror extractDeclaredTypeRefs).
      const fn = n.namedChild(0)
      if (fn && (fn.text === "isinstance" || fn.text === "issubclass")) {
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        const last = args && args.namedChildCount >= 2 ? args.namedChild(args.namedChildCount - 1) : undefined
        if (last) {
          // Same primitive exclusion as the analyzer's PRIMITIVES — self/cls
          // are conventional method/classmethod receivers (and here `cls` is
          // a local bound class), never type-name references (PYD cython
          // corpus: Pipeline.py `isinstance(t, cls)` was oracle-only noise).
          const stackT: any[] = [last]
          while (stackT.length > 0) {
            const tn = stackT.pop()!
            if (tn.type === "identifier") {
              if (!["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"].includes(tn.text)) push("references", tn.text)
            } else for (let i = 0; i < tn.namedChildCount; i++) stackT.push(tn.namedChild(i))
          }
        }
      }
      // Decorator-position calls (@wraps(f), @magic_arguments()): the
      // analyzer treats decorators as metadata on the decorated symbol, not
      // runtime call edges — the oracle must skip them identically (PYD1
      // differential: 8 decorator-site calls were oracle-only noise).
      let anc: any = parent
      let inDecorator = false
      while (anc) {
        if (anc.type === "decorator") { inDecorator = true; break }
        if (anc.type === "function_definition" || anc.type === "class_definition" || anc.type === "module") break
        anc = anc.parent
      }
      if (!inDecorator) {
      const fn = n.namedChild(0)
      if (fn) {
        // Leaf of the callee: identifier -> text; attribute -> last child;
        // subscript (computed/dynamic call FACTORIES[key](x)) -> SKIP, the
        // analyzer does not fabricate calls to the dict variable (PYD1).
        const calleeLeaf =
          fn.type === "identifier" ? fn.text :
          fn.type === "attribute" ? fn.namedChild(fn.namedChildCount - 1)?.text :
          undefined
        if (calleeLeaf && fn.type !== "subscript" && !isBuiltin(calleeLeaf)) {
          if (isUpper(calleeLeaf) && declaredTypes.has(calleeLeaf)) push("instantiates", calleeLeaf)
          else if (!isUpper(calleeLeaf)) push("calls", calleeLeaf)
        }
      }
      }
    }

    if (t === "attribute" && inFn && parent) {
      const leaf = n.namedChild(n.namedChildCount - 1)
      if (leaf && leaf.type === "identifier") {
        // Write / call-function / call-receiver gates (byte-range compare —
        // web-tree-sitter wrappers are per-access, identity never holds).
        const gp = parent.parent
        const isAssignLhs = parent.type === "assignment" &&
          parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
        const gpIsAssign = gp?.type === "assignment"
        const gpLhs = gpIsAssign ? gp!.namedChild(0) : undefined
        const isGpAssignLhs = !!gpLhs && gpLhs.startIndex === n.startIndex && gpLhs.endIndex === n.endIndex
        const isAugLhs = parent.type === "augmented_assignment" &&
          parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
        const isCallFn = parent.type === "call" &&
          parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
        const gpIsCall = gp?.type === "call"
        const gpFn = gpIsCall ? gp!.namedChild(0) : undefined
        const isReceiverOfCall = !!gpFn && gpFn.type === "attribute" &&
          gpFn.startIndex === n.startIndex && gpFn.endIndex === n.endIndex
        if (!isAssignLhs && !isGpAssignLhs && !isAugLhs && !isCallFn && !isReceiverOfCall) {
          push("uses", leaf.text)
        }
      }
    }

    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, parent: n, inFn: nextFn })
    }
  }
  return edges
}

// Haskell oracle (HSD wave 2026-09-03): independently derivable truth for
// class/instance/data/deriving/superclass structure + in-file calls. Mirrors
// the analyzer's declared contract (see script/m14/spec/haskell-completeness.json).
export function deriveHaskellEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    // Self-edges are REAL for calls (Haskell self-recursion is a genuine
    // call edge; the analyzer emits it deliberately). Structural labels
    // (extends/implements/instantiates) can never legitimately be self-
    // loops in this contract, so keep the from!==target guard for them.
    if (!from || !target) return
    if (label !== "calls" && from === target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }
  const classMethods = new Map<string, Set<string>>()
  const classAttrs = new Map<string, Set<string>>()
  const instanceBases = new Map<string, string>() // instance CLASS name -> anonymous
  const declared = new Set<string>()
  const declaredOps = new Set<string>()

  // Pass 1: declarations — classes (name/methods/superclass context),
  // instances (class + target), data/newtype (constructors), callables.
  const stack1: any[] = [{ n: root, cls: undefined as string | undefined, inBody: false }]
  while (stack1.length > 0) {
    const { n, cls, inBody } = stack1.pop()
    const t = n.type

    if (t === "function" || t === "bind") {
      // Type-position function nodes (parameter/result fields) are types.
      const isTypeFn = t === "function" && (n.childForFieldName?.("parameter") || n.childForFieldName?.("result"))
      if (!isTypeFn) {
        // Do-binds (`z <- fetch x`) are values, not callables.
        const isArrowBind = t === "bind" && n.children.some((c: any) => c.type === "<-")
        if (!isArrowBind) {
          const head = n.namedChildCount > 0 ? n.namedChild(0) : null
          if (head?.type === "variable") declared.add(head.text)
          else if (head && (head.type === "infix" || head.type === "prefix_id")) {
            const op = head.namedChildren.find((c: any) => c.type === "operator")
            // HSD19 mirror: backtick-operator definitions declare the
            // infix_id's variable; constructor/tuple-pattern heads declare
            // nothing (the old fallthrough declared the raw head text).
            let callable: string | undefined = op?.text
            if (!callable) {
              const infixId = head.namedChildren.find((c: any) => c.type === "infix_id")
              const tv = infixId?.namedChildren.find((c: any) => c.type === "variable")
              callable = tv?.text
            }
            if (callable) declaredOps.add(callable)
          }
        }
      }
      // NO early return: where/let locals hold more callables.
    }
    if (t === "signature" && !inBody) {
      // HSD17 mirror: only DECLARATION signatures declare callables
      // (declarations/local_binds/class/instance bodies). Expression-position
      // annotations (`(e :: T)`) declare nothing.
      const p2 = n.parent?.type
      // foreign_import: FFI declarations (`foreign import capi ... c_foo :: ...`)
      // are real in-file callables — mirror the analyzer's prepass.
      if (p2 === "declarations" || p2 === "local_binds" || p2 === "class" || p2 === "instance" || p2 === "class_declarations" || p2 === "instance_declarations" || p2 === "foreign_import") {
        const nameNode = n.namedChildCount > 0 ? n.namedChild(0) : null
        if (nameNode?.type === "variable") declared.add(nameNode.text)
      }
    }
    if (t === "class") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const cn = nameNode?.text
      if (cn) {
        classMethods.set(cn, new Set())
        classAttrs.set(cn, new Set())
        // Superclass context: context -> apply(s); first child of each apply
        // is the superclass name (name/constructor).
        const context = n.namedChildren.find((c: any) => c.type === "context")
        if (context) {
          const supers: string[] = []
          const stackC: any[] = [context]
          while (stackC.length > 0) {
            const x = stackC.pop()!
            if (x.type === "apply") {
              const first = x.namedChildCount > 0 ? x.namedChild(0) : null
              if (first && (first.type === "name" || first.type === "constructor")) supers.push(first.text)
            } else if (x.type === "parens") {
              const ap = x.namedChildren.find((c: any) => c.type === "apply")
              const first = ap?.namedChildCount ? ap.namedChild(0) : null
              if (first && (first.type === "name" || first.type === "constructor")) supers.push(first.text)
            }
            for (let i = 0; i < x.namedChildCount; i++) stackC.push(x.namedChild(i))
          }
          for (const s of supers) push("extends", cn, s)
        }
      }
    }
    if (t === "instance") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const tp = n.namedChildren.find((c: any) => c.type === "type_patterns")
      let target: string | undefined
      if (tp) {
        const direct = tp.namedChildren.find((c: any) => c.type === "name" || c.type === "constructor")
        if (direct) target = direct.text
        else {
          const list = tp.namedChildren.find((c: any) => c.type === "list")
          if (list) target = "[]"
          else {
            const parens = tp.namedChildren.find((c: any) => c.type === "parens")
            const ap = parens?.namedChildren.find((c: any) => c.type === "apply")
            const first = ap?.namedChildCount ? ap.namedChild(0) : null
            if (first) target = first.text
          }
        }
      }
      const cn = nameNode?.text
      if (cn && target) push("implements", target, cn)
      if (cn && !target) instanceBases.set(cn, cn)
      // Instance method bodies attribute to the TARGET name.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack1.push({ n: c, cls: target ?? cn, inBody: true })
      }
      continue
    }
    if (t === "data_type" || t === "newtype") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const dn = nameNode?.text
      if (dn) {
        // deriving -> implements
        const dv = n.namedChildren.find((c: any) => c.type === "deriving")
        if (dv) {
          // HSD18 mirror: entry-wise extraction — bare name, qualified full
          // text, or class-APPLICATION head. Argument leaves (the SessionError
          // in `MonadError SessionError`) are NOT classes — the old
          // descend-all-names pass fabricated Session->SessionError.
          const entries: string[] = []
          const grabD = (nn: any) => {
            for (let i = 0; i < nn.namedChildCount; i++) {
              const c = nn.namedChild(i)
              if (!c) continue
              if (c.type === "name") entries.push(c.text)
              else if (c.type === "qualified") entries.push(c.text)
              else if (c.type === "apply") {
                const h = c.namedChildCount > 0 ? c.namedChild(0) : null
                if (h?.text) entries.push(h.text)
              } else if (c.type === "parens") grabD(c)
            }
          }
          const tuple = dv.namedChildren.find((c: any) => c.type === "tuple")
          if (tuple) grabD(tuple)
          grabD(dv)
          for (const e2 of entries) push("implements", dn, e2)
        }
      }
      // Do NOT descend into data bodies — constructor references there are
      // declarations, not call sites.
      continue
    }
    if (t === "deriving_instance") {
      // HSD12 (probe 2026-09-03, postgrest Routine.hs:65): standalone
      // `deriving instance Show Foo` — same emission as data-level deriving:
      // implements target -> class. Parens wrapper handled recursively.
      let cls: string | undefined
      let target: string | undefined
      const grab = (nn: any) => {
        for (let i = 0; i < nn.namedChildCount; i++) {
          const c = nn.namedChild(i)
          if (!c) continue
          // HSD18 mirror: qualified class heads and apply heads are
          // entry-wise extracted (matches the analyzer's standalone-deriving
          // handling exactly).
          if (c.type === "name" || c.type === "qualified") cls = c.text
          else if (c.type === "apply") {
            const h = c.namedChildCount > 0 ? c.namedChild(0) : null
            if (h?.text) cls = h.text
          } else if (c.type === "type_patterns") {
            const t2 = c.namedChildren.find((x: any) => x.type === "name" || x.type === "constructor")
            target = t2?.text
          } else if (c.type === "parens") grab(c)
        }
      }
      grab(n)
      if (cls && target) push("implements", target, cls)
      continue
    }

    let nextCls = cls
    if (t === "signature" && cls) {
      const nameNode = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (nameNode?.type === "variable") classMethods.get(cls)?.add(nameNode.text)
    }
    if (t === "class") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      if (nameNode?.text) nextCls = nameNode.text
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack1.push({ n: c, cls: nextCls, inBody: inBody || t === "function" || t === "bind" })
    }
  }

  // Pass 2: call sites — apply heads (variable/qualified/constructor) and
  // backtick infix_id, attributed to the enclosing callable; record
  // construction in body position (constructor head) -> instantiates.
  const stack2: any[] = [{ n: root, fn: undefined as string | undefined, inBody: false }]
  while (stack2.length > 0) {
    const { n, fn, inBody } = stack2.pop()
    const t = n.type

    if (t === "apply" || t === "infix" || t === "record") {
      if (t === "apply" && fn) {
        const head = n.namedChildCount > 0 ? n.namedChild(0) : null
        if (head?.type === "variable" && declared.has(head.text)) push("calls", fn, head.text)
        else if (head?.type === "qualified") {
          const mod = head.namedChildren.find((c: any) => c.type === "module")
          const modText = mod?.text?.replace(/\.$/, "") ?? ""
          // HSD16 (probe 2026-09-03, 985 corpus occurrences): qualified
          // CONSTRUCTOR application in body position (`M.Just 1`) →
          // instantiates with the pattern gate; the function form stays calls.
          const ctor = head.namedChildren.find((c: any) => c.type === "constructor")
          if (modText && ctor?.text) {
            if (inBody && !isPatternPos(n)) push("instantiates", fn, `${modText}.${ctor.text}`)
          } else {
            const func = head.namedChildren.find((c: any) => c.type === "variable")
            if (modText && func?.text) push("calls", fn, `${modText}.${func.text}`)
          }
        } else if (head?.type === "constructor" || head?.type === "prefix") {
          // Body-position constructor application → instantiates. Pattern-
          // position applies (inside `patterns`) are excluded — mirror the
          // analyzer's isPatternPosition gate.
          if (inBody && !isPatternPos(n)) push("instantiates", fn, head.text)
        }
      } else if (t === "infix" && fn) {
        const infixId = n.namedChildren.find((c: any) => c.type === "infix_id")
        const opNode = n.namedChildren.find((c: any) => c.type === "operator")
        if (infixId) {
          // HSD19 mirror: infix DEFINITION heads are pattern territory — the
          // head's own infix_id names the callable being defined, not a call.
          if (isPatternPos(n)) {
            // fall through: no call emission from a definition head
          } else {
            const target = infixId.namedChildren.find((c: any) => c.type === "variable")
            if (target?.text && (declared.has(target.text) || declaredOps.has(target.text))) push("calls", fn, target.text)
          }
        } else if (opNode?.text === "$") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c || c.type === "operator") continue
            if (c.type === "variable" && declared.has(c.text)) push("calls", fn, c.text)
            else if (c.type === "qualified") {
              const mod = c.namedChildren.find((x: any) => x.type === "module")
              const func = c.namedChildren.find((x: any) => x.type === "variable")
              const modText = mod?.text?.replace(/\.$/, "") ?? ""
              if (modText && func?.text) push("calls", fn, `${modText}.${func.text}`)
            }
            break
          }
        }
      } else if (t === "record" && fn && inBody) {
        // Body-position record with a CONSTRUCTOR head = construction; a
        // variable head is an update (no edge). Data-declaration records sit
        // under data_constructor and are excluded via inBody + parent chain:
        // only descend here from function/bind bodies. HSD14-record: record
        // PATTERNS (function heads, pattern guards) are excluded via
        // isPatternPos — mirror the analyzer.
        const ctor = n.namedChildren.find((c: any) => c.type === "constructor")
        const inDecl = (() => {
          let cur = n.parent
          while (cur) {
            if (cur.type === "match" || cur.type === "do" || cur.type === "bind" || cur.type === "let_in") return false
            if (cur.type === "data_constructor" || cur.type === "newtype_constructor") return true
            cur = cur.parent
          }
          return false
        })()
        if (ctor?.text && !inDecl && !isPatternPos(n)) push("instantiates", fn, ctor.text)
      }
    }
    if (t === "signature") {
      // HSD17 mirror: declaration signatures are TYPE trees — no calls inside,
      // never descend (the old descent fabricated type-application calls like
      // `t (t B.ByteString)` from `t :: T (T B.ByteString)` annotations).
      // Expression-position annotations host the annotated EXPRESSION as
      // child 0; descend into it only — the sibling type subtree would
      // fabricate calls the same way.
      const p2 = n.parent?.type
      const isDeclSig = p2 === "declarations" || p2 === "local_binds" || p2 === "class" || p2 === "instance" || p2 === "class_declarations" || p2 === "instance_declarations" || p2 === "foreign_import"
      if (isDeclSig) continue
      const expr = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (expr) stack2.push({ n: expr, fn, inBody })
      continue
    }
    if (t === "function" || t === "bind") {
      const isTypeFn = t === "function" && (n.childForFieldName?.("parameter") || n.childForFieldName?.("result"))
      const isArrowBind = t === "bind" && n.children.some((c: any) => c.type === "<-")
      if (!isTypeFn && !isArrowBind) {
        const head = n.namedChildCount > 0 ? n.namedChild(0) : null
        let nextFn = fn
        if (head?.type === "variable") nextFn = head.text
        else if (head && (head.type === "infix" || head.type === "prefix_id")) {
          const op = head.namedChildren.find((c: any) => c.type === "operator")
          if (op?.text) {
            nextFn = op.text
          } else {
            // HSD19 mirror: backtick-operator definition heads name their
            // infix_id variable; constructor/tuple-pattern heads are NOT
            // callables — keep the enclosing fn (no reset), mirroring the
            // analyzer's caller-preservation for the non-callable head slot.
            const infixId = head.namedChildren.find((c: any) => c.type === "infix_id")
            const tv = infixId?.namedChildren.find((c: any) => c.type === "variable")
            if (tv?.text) nextFn = tv.text
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack2.push({ n: c, fn: nextFn, inBody: true })
        }
        continue
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack2.push({ n: c, fn, inBody: inBody || t === "do" })
    }
  }
  for (const op of declaredOps) if (!declared.has(op)) declared.add(op)
  return edges
}

function isPatternPos(node: any): boolean {
  let cur = node.parent
  let prev = node
  while (cur) {
    if (cur.type === "patterns") return true
    // HSD14 (probe 2026-09-03): case-alternative patterns are direct children
    // of `alternative`; bind-form pattern guards keep only their FIRST child
    // as pattern territory; an infix head as FIRST child of function/bind is
    // pattern territory (`Tok a == Tok b = ...`), while do-bind RHS is a
    // direct child at index >= 1 — expression, stays emitting. Node IDs are
    // compared (web-tree-sitter hands out fresh wrappers per access).
    if (cur.type === "alternative") return true
    if (cur.type === "pattern_guard") {
      if (prev.id === cur.namedChild(0)?.id) return true
    } else if (cur.type === "match" || cur.type === "do" || cur.type === "class" || cur.type === "instance") {
      return false
    } else if (cur.type === "function" || cur.type === "bind") {
      // HSD19 mirror: the child-0 head SLOT of function/bind is pattern
      // territory (infix definitions, constructor/tuple patterns); match and
      // patterns children are expression territory; do-bind RHS (index >= 1)
      // stays emitting.
      if (prev.type === "match" || prev.type === "patterns") return false
      if (prev.id === cur.namedChild(0)?.id) return true
      return false
    }
    prev = cur
    cur = cur.parent
  }
  return false
}

export function deriveZigEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seenCalls = new Set<string>()
  const seenUses = new Set<string>()
  // ZGD1/ZGD5/ZGD5b oracle mirroring (zig wave M37 #600): F5 previously only
  // compared calls/uses here, so these facets were gate-invisible on BOTH
  // sides. Now the oracle is the independent derivation the differential
  // was always meant to be.
  const TYPE_POSITIONS = new Set(["parameter", "container_field", "function_declaration"])
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
      // ZGD4 mirror: usingnamespace is an import operator, not a user symbol.
      if (leaf === "usingnamespace") leaf = undefined
      if (leaf && !seenCalls.has("call:" + leaf)) {
        seenCalls.add("call:" + leaf)
        edges.push({ label: "calls", from: "(expr)", target: leaf })
      }
    }
    if (n.type === "field_expression") {
      const parent = (n as any).parent
      const isCallee = !!parent && parent.type === "call_expression"
      // ZGD5: single-named-child field_expression is `.bad` enum literal /
      // `.{...}` init field — no base, not a member read.
      const isEnumLiteral = n.namedChildCount < 2
      // ZGD1: zig assignments parse as variable_declaration, LHS = first
      // named child (probe-verified). An assignment LHS is a WRITE.
      const isAssignLhs = !!parent && parent.type === "variable_declaration" && parent.namedChild(0)?.id === n.id
      // ZGD5b: type-annotation positions are declared-type facts, not reads.
      const isTypePos = !!parent && TYPE_POSITIONS.has(parent.type)
      if (!isCallee && !isEnumLiteral && !isAssignLhs && !isTypePos) {
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
      // CARGO-D1 (two-corpus gate, cargo tree.rs:242): a QUALIFIED struct
      // literal `cargo_tree::TreeOptions { .. }` carries a scoped_type_
      // identifier whose text starts LOWERCASE (the crate/module path), so a
      // whole-text /^[A-Z]/ test silently dropped the construction while the
      // analyzer (leaf contract) emitted instantiates TreeOptions. Casing is
      // judged on the LEAF segment (the type), matching the analyzer.
      if (typeNode) {
        const rawLeaf = lastSegment(typeNode.text)
        const t2 = rawLeaf.split("<")[0].trim()
        if (/^[A-Z]/.test(t2) && !seenCalls.has("struct:" + t2)) {
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
    // DAD3 fix (dart): the flat dart parse (`_i1.SmartFake` -> two adjacent
    // type_identifiers joined by an anonymous `.`) made blanket descent emit
    // the import-ALIAS as a base (extends -> _i1) and generic ARGUMENTS as
    // implemented interfaces (implements -> T1). Dart heritage must emit
    // resolved leaves only: skip type_arguments entirely, and skip a type
    // name whose next raw sibling is a `.` token (alias prefix). Mirrors
    // RealDartAnalyzer.resolvedHeritageNames exactly (probed shapes:
    // dart-heritage-shapes.ts 2026-09-03).
    if (lang === "dart") {
      if (x.type === "type_arguments") return
      if (x.type === "type_identifier" || x.type === "identifier") {
        // NOTE: web-tree-sitter returns FRESH node objects per child() call,
        // so indexOf-style reference identity never matches. Find the sibling
        // by source position instead (startIndex/endIndex are exact).
        let next: any = null
        if (x.parent) {
          for (let k = 0; k < x.parent.childCount; k++) {
            const s = x.parent.child(k)
            if (s && s.startIndex === x.startIndex && s.endIndex === x.endIndex) {
              next = x.parent.child(k + 1)
              break
            }
          }
        }
        if (next && next.type === ".") return // alias prefix
        edges.push({ label, from: clsName, target: x.text })
        return
      }
      for (let k = 0; k < x.childCount; k++) collect(x.child(k), label, clsName)
      return
    }
    if (TYPE.test(x.type)) {
      // M49.S1: heritage targets must be CLEAN head names. Decl keys are
      // bracket-stripped at registration (M37.9), so a target like groovy's
      // `Cache<T>` (the pinned grammar folds type args into the supertype
      // token text) could never match its interface's decl — the override
      // chain died silently (geb CachingDriverFactory:
      // SimpleCache.get -> Cache.get surfaced unexplained). Strip type
      // arguments; dotted paths keep the full path (M14 #419 kotlin rule).
      let target = x.text
      const ltIdx = target.indexOf("<")
      if (ltIdx !== -1) target = target.slice(0, ltIdx)
      edges.push({ label, from: clsName, target })
    } else for (let k = 0; k < x.namedChildCount; k++) collect(x.namedChild(k), label, clsName)
  }
  const walk = (n: any) => {
    const t = n.type
    if (/^(class|interface|record|trait|object)_declaration$|^enum_declaration$|^class_definition$|^trait_definition$|^object_definition$|^(class|struct|union)_specifier$/.test(t) || (lang === "scala" && t === "enum_definition")) {
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
      // M49.S1 #715 (J3-class shared blind spot closed): enum_definition
      // heritage. `enum Color(val hex: Int) extends Serializable` emitted
      // ZERO extends on BOTH sides before (the oracle never matched
      // enum_definition, so no differential could ever flag it). The oracle
      // mirror joins handleEnum's S1-NEW-1 fix: all supertypes are extends
      // (an enum cannot extend a class in Scala 3).
      if (t === "class_definition" || t === "trait_definition" || t === "object_definition" || t === "enum_definition") {
        const extClause = n.namedChildren.find((c: any) => c.type === "extends_clause")
        if (extClause) {
        const isTraitDecl = t === "trait_definition"
        const isEnumDecl = t === "enum_definition"
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
            if (isTraitDecl || isEnumDecl || first) edges.push({ label: "extends", from: clsName, target })
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
        // ScalaD-I (M37.21 #610, cats-effect SecureRandomCompanionPlatform):
        // the analyzer strips bracketed type args ITERATIVELY from the raw
        // constructor text (`ScalaRandom[F](Applicative[F].pure(random)) with
        // SecureRandom[F]` -> `ScalaRandom(Applicative.pure(random)) with
        // SecureRandom`), so truth must normalize identically or the pair
        // never matches. Iterative strip covers nested args List[(A[B], C)].
        let prevName
        do { prevName = name; name = name.replace(/\[[^\[\]]*\]/g, "").replace(/<[^<>]*>/g, "").trim() } while (name !== prevName)
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
      } else if (callee?.type === "generic_function") {
        // M49.S1 #715 lockstep mirror of deriveScalaEdges's S1.10 handler:
        // scala3 parses dotted/typed callees as generic_function — the raw
        // text fell through to the generic fallback, fabricating junk truth
        // like `instantiates CC.ff()\n + CC.ff("abc")\n + CC.ff` (infix
        // chains) and `instantiates Comparator.reverseOrder` (dotted factory
        // calls). Extract the LAST identifier leaf BEFORE the bracket strip,
        // exactly as deriveScalaEdges does. Shared-blind-spot class: the
        // dedicated oracle was fixed while the generic oracle (the live scala
        // sweep path) kept the stale fallback — no differential could flag it
        // because truth vs truth was never compared.
        qualified = true
        const kids: string[] = []
        const findLeaves = (nn: any): void => {
          if (nn.type === "identifier") { kids.push(nn.text); return }
          if (nn.type === "type_arguments") return
          for (let i = 0; i < nn.namedChildCount; i++) { const c = nn.namedChild(i); if (c) findLeaves(c) }
        }
        findLeaves(callee)
        if (kids.length > 0) leaf = kids[kids.length - 1]
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
      // M49.S1 #715 refinement (scala3 @200: 9 MISSING were exactly this
      // class): the construction rule is RECEIVER-LESS per the measured
      // contract — a qualified call whose LEAF is lowercase-style
      // (`Comparator.reverseOrder()`, `CC.ff()`) is a FACTORY-METHOD call,
      // not a construction; fabricating `instantiates Comparator.reverseOrder`
      // produced unmatchable dotted targets the analyzer (correctly emitting
      // calls -> reverseOrder) could never cover. Construction requires the
      // leaf itself to be the type (capitalized): `Foo.make(...)`.
      const leafIsTypeStyle = leaf.length > 0 && leaf[0] >= "A" && leaf[0] <= "Z"
      if (leaf && leafIsTypeStyle && !qualified) edges.push({ label: "instantiates", from: "(expr)", target: leaf })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  // dedupe identical edges (oracle double-push guard)
  // overrides truth: same-name methods across in-file inheritance chains.
  // CPPD-R1 (M37.9): cpp overrides are NOT independently derivable — same-
  // name across a base chain conflates C++ NAME-HIDING with virtual override
  // (chrono.h: null_chrono_spec_handler.on_24_hour(numeric_system) vs
  // chrono_format_checker.on_24_hour(numeric_system, pad_type) — different
  // arity hides, it does not override; the analyzer's type-only signature
  // check is correct). Signature-aware override truth would just mirror the
  // analyzer's own virtual-registry contract (shared blind spot), so cpp
  // overrides are excluded here and stay pinned by the analyzer fixtures
  // (cpp/override-signature-aware, cpp/virtual-override-resolution).
  // Only declarations related by extends/implements within THIS file count -
  // cross-file override resolution is the analyzer's job, not the oracle's.
  const decls: Record<string, { parents: string[]; methods: Set<string>; sigs: Map<string, Set<string>> }> = {}
  const declParents: { child: string; parent: string }[] = []
  // M49.S1 #715 scala companion-union guard: per-occurrence provenance.
  // decls[nm] unions methods across same-named declarations (ScalaD-F
  // companion semantics) but parents arrive per derived extends edge — so
  // object IsEq inherited the trait IsEq's `toProp` while carrying the
  // object's own `extends IsEqLowPriorityImplicits` link, fabricating
  // `IsEq.toProp -> IsEqLowPriorityImplicits.toProp` (cats-effect IsEq.scala;
  // the analyzer resolves per-symbol and emits nothing). Scala declarations
  // therefore register per-occurrence method sets and parent links from
  // their OWN extends_clause; scala override emission (below) verifies the
  // first hop against the exact occurrence, never the pooled entry.
  const occMethods = new Map<string, Set<string>>()
  const occSigs = new Map<string, Map<string, Set<string>>>()
  const occParents: { childOcc: string; childName: string; parentName: string }[] = []
  const scalaOccCounter: Record<string, number> = {}
  // Best-effort parameter TYPE signature for a method node (java/kotlin/scala/
  // groovy/csharp/dart style typed params). Empty/unknown -> the language keeps
  // the legacy name-only pairing (never a false negative from a missing sig).
  const extractSig = (m: any): string | undefined => {
    const container = m.namedChildren.find((c: any) =>
      /^(formal_parameters|parameters|parameter_list|parameter_clause|method_parameters|function_value_parameters)$/.test(c?.type ?? ""))
    if (!container) return undefined
    const types: string[] = []
    for (let i = 0; i < container.namedChildCount; i++) {
      const p = container.namedChild(i)
      if (!p) continue
      let pt = p.childForFieldName?.("type")
      // M49.K1 kotlin: this pinned wasm exposes NO named fields, so
      // childForFieldName("type") is null on every language — java/cpp get
      // their types positionally elsewhere, but kotlin `parameter` nodes
      // carry the type as the LAST named child (name pattern first,
      // `:` separator is anonymous). Falling back to it restores exact
      // overload separation to match the analyzer's metadata params
      // (probe: {name:"x",type:"Int"}); without it every kotlin sig was
      // undefined and override matching degraded to name-only.
      if (!pt && lang === "kotlin" && p.type === "parameter") {
        pt = p.namedChild(p.namedChildCount - 1)
      }
      if (pt?.text) types.push(pt.text.replace(/\s+/g, ""))
      else return undefined // untyped parameter form — fall back to name-only
    }
    return types.length > 0 || container.namedChildCount === 0 ? "(" + types.join(",") + ")" : undefined
  }
  // ScalaD-E (M37.21 #610, scala3 byname-implicits-13.scala): textual sig
  // comparison is invalid when a param type is a GENERIC TYPE VARIABLE —
  // trait Eq's abstract `def eqv[T](x: T, y: T)` has sig (T,T) while its
  // anonymous implementations carry the substituted (Int,Int)/(String,String).
  // That is a genuine override (type-parameter substitution), not an
  // overload. Rule: if EITHER side's sig contains a type-variable token
  // (single-capital identifier, possibly in a compound type like `H :: T`),
  // fall back to name-only pairing — mirroring the analyzer's own name-based
  // findDeclaringAncestor. Concrete types keep strict sig checks so overloads
  // still never pair.
  // M49.S1 #715: bracket-aware token scan mirrors the analyzer's
  // sigHasTypeVar char-scan — the old regex missed bracketed vars
  // (`def m(x: List[A])` vs `def m(x: List[Int])` never paired).
  const hasTypeVar = (sig: string | undefined): boolean => {
    if (!sig) return false
    const n = sig.length
    let i = 0
    while (i < n) {
      const c = sig[i]
      if (c === "(" || c === "," || c === ":" || c === "|" || c === "[" || c === "<" || c === "&" || i === 0) {
        let j = i
        while (j < n && (sig[j] === "(" || sig[j] === "[" || sig[j] === " " || sig[j] === ":" || sig[j] === ",")) j++
        if (j < n && sig[j] >= "A" && sig[j] <= "Z") {
          let end = j + 1
          while (end < n && ((sig[end] >= "A" && sig[end] <= "Z") || (sig[end] >= "a" && sig[end] <= "z") || (sig[end] >= "0" && sig[end] <= "9") || sig[end] === "_")) end++
          if (end === j + 1) return true
          i = end
          continue
        }
        i = j > i ? j : i + 1
        continue
      }
      i++
    }
    return false
  }
  const sigCompatible = (child: any, parent: any, m: string): boolean => {
    const cs = child.sigs?.get(m)
    const ps = parent.sigs?.get(m)
    if (cs && ps && cs.size > 0 && ps.size > 0) {
      for (const s of cs) if (ps.has(s)) return true
      // Generic-substitution fallback: type-variable sigs cannot be compared
      // textually across instantiation — name-only pairing (analyzer mirror).
      for (const s of cs) if (hasTypeVar(s)) return true
      for (const s of ps) if (hasTypeVar(s)) return true
      return false // same name, different signature = OVERLOAD, not an override
    }
    return true // signature unavailable on a side -> legacy name-only pairing
  }
  const collectDecl = (n: any) => {
    const t2 = n.type
    if (/^(class|interface|record|trait|object)_declaration$|^class_definition$|^trait_definition$|^object_definition$|^(class|struct|union)_specifier$/.test(t2)) {
      const nameNode = n.childForFieldName?.("name") ?? n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")
      // M37.9 cpp: class names are CLEANED like the analyzer's — template
      // class declarations/partial specs carry their args in the name node
      // text (`IteratorImpl<IndexSequence<I...>>`); the class is
      // IteratorImpl. Without the strip, truth emitted override pairs the
      // analyzer (leaf-named) could never match.
      let nm = nameNode?.text
      if (nm) {
        const lt = nm.indexOf("<")
        if (lt !== -1) nm = nm.slice(0, lt).trim()
        nm = lastSegment(nm)
      }
      // ScalaD-F (M37.21 #610, scala3 HashSet.scala): scala companions share a
      // NAME (object SetNode at L394 + sealed abstract class SetNode at L404).
      // The old `!decls[nm]` first-wins guard dropped the class's 19 abstract
      // methods because the companion registered first — the analyzer's
      // methodSigsByOwner unions methods across same-named owners, so every
      // BitmapIndexedSetNode override of SetNode surfaced as unexplained
      // fabrication. Always ensure the decl entry exists and MERGE members
      // across every same-named declaration (companion union semantics).
      if (nm) {
        if (!decls[nm]) decls[nm] = { parents: [], methods: new Set(), sigs: new Map() }
        // cpp classes use field_declaration_list (no 'body' substring)
        const body = n.namedChildren.find((c: any) => /body|field_declaration_list/.test(c.type))
        if (body) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const m = body.namedChild(i)
            // Method/function nodes only. The old trailing `|declaration`
            // catch-all ALSO admitted NESTED class/interface/enum_declaration
            // nodes, counting the nested type's name as a method of the
            // enclosing class (two-corpus wave 2026-09: SubVector "overrides"
            // its own nested Iterator/Spliterator/Object).
            if (/function_definition|function_declaration|method_declaration|method_definition|method_signature|field_declaration/.test(m?.type ?? "")) {
              // cpp class members are field_declaration > function_declarator;
              // other families keep the name as a direct identifier child.
              const fd = m.namedChildren.find((c: any) => c.type === "function_declarator")
              let mn: any = null
              // Member VARIABLES, not methods. Must be field_declaration ONLY:
              // java/kotlin/dart methods are method_declaration/function_declaration
              // and were wrongly skipped by the old /declaration/ regex, silently
              // disabling override truth for those languages (two-corpus wave
              // 2026-09: clojure:java SubVector.spliterator -> APersistentVector).
              if (!fd && m.type === "field_declaration") continue
              // M49.K1 kotlin mirror: tree-sitter-kotlin function_declaration
              // carries its name as a `simple_identifier` child, so the
              // generic branch below (childForFieldName("name") ??
              // identifier) never matched — kotlin methods were never
              // REGISTERED in override truth and every analyzer override
              // (0.9/structural after the K2 verification fix) would surface
              // unexplained. Kotlin's name is a direct simple_identifier
              // child; sigs flow through extractSig (function_value_parameters
              // now in the container regex).
              if (!fd && lang === "kotlin" && m.type === "function_declaration") {
                const kName = m.namedChildren.find((c: any) => c.type === "simple_identifier")
                if (kName && kName.text !== nm && kName.text !== "constructor") {
                  decls[nm].methods.add(kName.text)
                  const sig = extractSig(m)
                  if (sig) {
                    let ss = decls[nm].sigs.get(kName.text)
                    if (!ss) { ss = new Set(); decls[nm].sigs.set(kName.text, ss) }
                    ss.add(sig)
                  }
                }
                continue // generic branch must not double-register
              }
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
                // The METHOD NAME, never the return type. The old
                // /identifier/ test matched `type_identifier` FIRST, so any
                // method with a class/interface return type (`public Iterator
                // iterator()`) was registered under its RETURN TYPE
                // (`Iterator`) — fabricating override pairs (two-corpus wave
                // 2026-09: clojure SubVector.Iterator "overrides"
                // APersistentVector.Iterator). Prefer the grammar `name`
                // field, then a plain (non-type) identifier child.
                mn = m.childForFieldName?.("name") ??
                  m.namedChildren.find((c: any) => c.type === "identifier") ?? null
              }
              // constructors are NOT virtually dispatched - no family
              // analyzer emits ctor-overrides, so truth must not either.
              // (cpp ctor name == class name; also skip same-name-as-class
              // members to avoid self/hierarchy name collisions)
              if (mn && mn.text !== "constructor" && mn.text !== nm) {
                decls[nm].methods.add(mn.text)
                // Record the parameter-type signature (when extractable) so
                // overloads (same name, different signature) never pair as
                // overrides — java/kotlin-style overloading is common
                // (two-corpus gate 2026-09: SubVector.nth(int) is NOT an
                // override of APersistentVector.nth(int, Object)).
                const sig = extractSig(m)
                if (sig) {
                  let ss = decls[nm].sigs.get(mn.text)
                  if (!ss) { ss = new Set(); decls[nm].sigs.set(mn.text, ss) }
                  ss.add(sig)
                }
              }
            }
          }
        }
        // M49.S1 #715 scala per-occurrence provenance (companion-union
        // guard, see occMethods above): register this DECLARATION's own
        // method set and its OWN extends_clause parents. Scala only — the
        // pooled path stays truth for every other family.
        if (lang === "scala") {
          const occKey = `${nm}#${scalaOccCounter[nm] = (scalaOccCounter[nm] ?? -1) + 1}`
          const ownMethods = new Set<string>()
          const ownSigs = new Map<string, Set<string>>()
          if (body) {
            for (let i = 0; i < body.namedChildCount; i++) {
              const m = body.namedChild(i)
              if (!/function_definition|function_declaration/.test(m?.type ?? "")) continue
              const smn = m.childForFieldName?.("name") ?? m.namedChildren.find((c: any) => c.type === "identifier")
              if (smn && smn.text !== "constructor" && smn.text !== nm) {
                ownMethods.add(smn.text)
                const sig = extractSig(m)
                if (sig) {
                  let ss = ownSigs.get(smn.text)
                  if (!ss) { ss = new Set(); ownSigs.set(smn.text, ss) }
                  ss.add(sig)
                }
              }
            }
          }
          occMethods.set(occKey, ownMethods)
          if (ownSigs.size > 0) occSigs.set(occKey, ownSigs)
          // Parents come from this declaration's OWN extends_clause — never
          // from the pooled extends-edge walk, which is what conflated the
          // companion's link with the same-named trait. Head names only;
          // dotted targets are EXTERNAL inheritance (SCALA-D1) and seed no
          // in-file override chain.
          const extClause = n.namedChildren.find((c: any) => c.type === "extends_clause")
          if (extClause) {
            for (let i = 0; i < extClause.namedChildCount; i++) {
              const h = extClause.namedChild(i)
              if (!h) continue
              let hName = h.type === "generic_type" && h.namedChildCount > 0 ? h.namedChild(0).text : h.text
              const hBracket = hName.indexOf("[")
              if (hBracket !== -1) hName = hName.slice(0, hBracket)
              if (hName && !hName.includes(".")) {
                occParents.push({ childOcc: occKey, childName: nm, parentName: hName })
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) collectDecl(n.namedChild(i))
  }
  collectDecl(root)
  // M37.21 #610 scala anonymous bodies (JD18 mirror): `new Sync[F] { ... }`
  // parses as instance_expression + template_body — the analyzer now emits
  // anonymous_<Super> class symbols whose members attribute to the ANONYMOUS
  // type, so the oracle must register the same synthetic declaration with
  // its supertype as a parent (an extends edge the tree never derives).
  // Mirrors RealScalaAnalyzer's anonymous-symbol push: generic supertypes
  // collapse to the head name, bracketed args stripped.
  const anonScalaDecl = (n: any) => {
    if (n.type !== "instance_expression") return
    const body = n.namedChildren.find((c: any) => c.type === "template_body")
    if (!body) return
    const tn = n.namedChild(0)
    if (!tn) return
    let superName = tn.text
    if (tn.type === "generic_type" && tn.namedChildCount > 0) superName = tn.namedChild(0).text
    superName = superName.replace(/\[[^\[\]]*\]/g, "").replace(/<[^<>]*>/g, "").trim()
    if (!superName) return
    const anonName = `anonymous_${superName}`
    if (!decls[anonName]) {
      decls[anonName] = { parents: [], methods: new Set(), sigs: new Map() }
      for (let i = 0; i < body.namedChildCount; i++) {
        const m = body.namedChild(i)
        if (!/function_definition|function_declaration/.test(m?.type ?? "")) continue
        const mn = m.childForFieldName?.("name") ?? m.namedChildren.find((c: any) => c.type === "identifier")
        if (mn && mn.text !== "constructor" && mn.text !== anonName) {
          decls[anonName].methods.add(mn.text)
          const sig = extractSig(m)
          if (sig) {
            let ss = decls[anonName].sigs.get(mn.text)
            if (!ss) { ss = new Set(); decls[anonName].sigs.set(mn.text, ss) }
            ss.add(sig)
          }
        }
      }
      // M49.S1 scala per-occurrence registration for the anonymous body —
      // same provenance discipline as named declarations above.
      if (lang === "scala" && !superName.includes(".")) {
        const occKey = `${anonName}#0`
        const ownMethods = new Set<string>()
        const ownSigs = new Map<string, Set<string>>()
        for (let i = 0; i < body.namedChildCount; i++) {
          const m = body.namedChild(i)
          if (!/function_definition|function_declaration/.test(m?.type ?? "")) continue
          const smn = m.childForFieldName?.("name") ?? m.namedChildren.find((c: any) => c.type === "identifier")
          if (smn && smn.text !== "constructor" && smn.text !== anonName) {
            ownMethods.add(smn.text)
            const sig = extractSig(m)
            if (sig) {
              let ss = ownSigs.get(smn.text)
              if (!ss) { ss = new Set(); ownSigs.set(smn.text, ss) }
              ss.add(sig)
            }
          }
        }
        occMethods.set(occKey, ownMethods)
        if (ownSigs.size > 0) occSigs.set(occKey, ownSigs)
        occParents.push({ childOcc: occKey, childName: anonName, parentName: superName })
      }
    }
    if (!decls[superName]) decls[superName] = { parents: [], methods: new Set(), sigs: new Map() }
    declParents.push({ child: anonName, parent: superName })
  }
  anonScalaDecl(root)
  const anonStack: any[] = []
  for (let i = 0; i < root.namedChildCount; i++) { const c = root.namedChild(i); if (c) anonStack.push(c) }
  while (anonStack.length) {
    const x = anonStack.pop()!
    anonScalaDecl(x)
    // M37.21 C30 mirror (java twin of the scala block): `new QueryHandler()
    // { public int handle(...) {...} }` — the analyzer now declares
    // anonymous_${Super} class symbols, attributes the body's methods to
    // the anonymous type, and registers the supertype in classHierarchy so
    // @Override methods resolve (exact-in-file). The oracle must register
    // the same synthetic declaration or every verified
    // anonymous_X.m -> Super.m edge surfaces as unexplained fabrication
    // (grails-core JpaQueryBuilder: 13 anon bodies, 1 unexplained @200).
    // Scoped supertypes collapse to the base segment; generic args stripped
    // — mirrors extractJavaTypeBaseName.
    if (x.type === "object_creation_expression") {
      const jbody = x.namedChildren.find((c: any) => c.type === "class_body")
      const jtn = x.namedChildren.find((c: any) => /type_identifier|scoped_type_identifier|generic_type$/.test(c.type))
      if (jbody && jtn) {
        let jSuper = jtn.text
        if (jtn.type === "generic_type" && jtn.namedChildCount > 0) jSuper = jtn.namedChild(0).text
        jSuper = jSuper.replace(/<[^<>]*>/g, "").trim()
        const jDot = jSuper.lastIndexOf(".")
        if (jDot !== -1) jSuper = jSuper.slice(jDot + 1)
        if (jSuper) {
          const jAnon = `anonymous_${jSuper}`
          if (!decls[jAnon]) {
            decls[jAnon] = { parents: [], methods: new Set(), sigs: new Map() }
            for (let i = 0; i < jbody.namedChildCount; i++) {
              const m = jbody.namedChild(i)
              if (m?.type !== "method_declaration") continue
              const mn = m.childForFieldName?.("name")
              if (mn) {
                decls[jAnon].methods.add(mn.text)
                const sig = extractSig(m)
                if (sig) {
                  let ss = decls[jAnon].sigs.get(mn.text)
                  if (!ss) { ss = new Set(); decls[jAnon].sigs.set(mn.text, ss) }
                  ss.add(sig)
                }
              }
            }
          }
          if (!decls[jSuper]) decls[jSuper] = { parents: [], methods: new Set(), sigs: new Map() }
          declParents.push({ child: jAnon, parent: jSuper })
        }
      }
    }
    // M49.K1 kotlin twin: `object : Runnable { override fun run() {...} }`
    // parses as object_literal + class_body. RealKotlinAnalyzer declares an
    // anonymous_<Super> class symbol, attributes the body's methods to it,
    // and its K2 override BFS verifies through metadata.superTypes — the
    // oracle must register the same synthetic declaration or every verified
    // anonymous_X.m -> Super.m edge surfaces as unexplained fabrication.
    // Supertypes resolve through delegation_specifier > user_type >
    // type_identifier (nested — the analyzer recurses too).
    if (x.type === "object_literal") {
      const kbody = x.namedChildren.find((c: any) => c.type === "class_body")
      const kdeleg = x.namedChildren.find((c: any) => c.type === "delegation_specifier")
      if (kbody && kdeleg) {
        const findKType = (nn: any): any => {
          if (nn.type === "type_identifier") return nn
          for (let i = 0; i < nn.namedChildCount; i++) { const c = nn.namedChild(i); if (c) { const r = findKType(c); if (r) return r } }
          return null
        }
        const ktn = findKType(kdeleg)
        if (ktn?.text) {
          const kSuper = ktn.text
          const kAnon = `anonymous_${kSuper}`
          if (!decls[kAnon]) {
            decls[kAnon] = { parents: [], methods: new Set(), sigs: new Map() }
            for (let i = 0; i < kbody.namedChildCount; i++) {
              const m = kbody.namedChild(i)
              if (m?.type !== "function_declaration") continue
              const mn = m.namedChildren.find((c: any) => c.type === "simple_identifier")
              if (mn && mn.text !== "constructor" && mn.text !== kAnon) {
                decls[kAnon].methods.add(mn.text)
                const sig = extractSig(m)
                if (sig) {
                  let ss = decls[kAnon].sigs.get(mn.text)
                  if (!ss) { ss = new Set(); decls[kAnon].sigs.set(mn.text, ss) }
                  ss.add(sig)
                }
              }
            }
          }
          if (!decls[kSuper]) decls[kSuper] = { parents: [], methods: new Set(), sigs: new Map() }
          declParents.push({ child: kAnon, parent: kSuper })
        }
      }
    }
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) anonStack.push(c) }
  }
  // hierarchy from already-derived extends edges (head-segment normalized)
  // SCALA-D1 (two-corpus gate finding, cats-effect Queue.scala): a QUALIFIED
  // heritage target (`with unsafe.BoundedQueue[F, A]`) must never seed an
  // override chain. unsafe.BoundedQueue is an EXTERNAL trait (different
  // package/file); lastSegment() collapsed it onto the unrelated IN-FILE
  // sync class `BoundedQueue extends AbstractQueue`, fabricating
  // `BoundedAsyncQueue.offer -> AbstractQueue.offer` through a chain the
  // analyzer (correctly descending BaseBoundedAsyncQueue -> Queue) never
  // emits. Override truth is in-file verification: a dotted target cannot
  // resolve to a declaration in THIS file, so qualified names are excluded
  // from declParents on every language (external inheritance is the
  // analyzer's cross-file job, not the oracle's).
  for (const e of edges) {
    if (e.label !== "extends" && e.label !== "implements") continue
    if (e.target.includes(".")) continue // qualified = external, not in-file
    const parent = lastSegment(e.target)
    if (decls[e.from] && decls[parent] && e.from !== parent) {
      declParents.push({ child: e.from, parent })
    }
  }
  for (const rel of declParents) {
    if (lang === "cpp") break // CPPD-R1: no cpp overrides truth (see above)
    // M49.S1: scala never uses pooled emission — per-occurrence loop below.
    if (lang === "scala") continue
    const childDecl = decls[rel.child]
    if (!childDecl) continue
    // M37.9 cpp: overrides resolve TRANSITIVELY (A->B->C: a method defined
    // only in A and C still overrides through B) with a depth cap — mirrors
    // the analyzer's classBases BFS. The old code checked DIRECT parents
    // only, so every transitive override the analyzer emitted surfaced as
    // unexplained fabrication.
    for (const m of childDecl.methods) {
      const seenBase = new Set<string>()
      const queue = [rel.child]
      let depth = 0
      while (queue.length && depth < 10) {
        depth++
        const cls = queue.shift()!
        if (seenBase.has(cls)) continue
        seenBase.add(cls)
        for (const b of declParents.filter((r2) => r2.child === cls)) {
          if (b.parent === rel.child) continue // self-collision guard
          const parentDecl = decls[b.parent]
          if (parentDecl?.methods.has(m) && !seenBase.has(b.parent) &&
              sigCompatible(childDecl, parentDecl, m)) {
            edges.push({ label: "overrides", from: `${rel.child}.${m}`, target: `${b.parent}.${m}` })
          }
          if (decls[b.parent]) queue.push(b.parent)
        }
      }
    }
  }
  // M49.S1 #715 scala per-occurrence override emission. Same transitive BFS
  // and sigCompatible gate as the pooled loop, but methods and every hop's
  // parent links come from ONE declaration occurrence — companion-union
  // conflation (object IsEq × trait IsEq) can never fabricate again. The
  // first hop uses the occurrence's OWN sigs; further hops fall back to the
  // pooled sigs (the union) — signature over-strictness at depth only
  // suppresses a truth edge in a name-collision case the analyzer's own
  // name-based BFS would also have paired, never fabricates one.
  if (lang === "scala") {
    for (const [occKey, methods] of occMethods) {
      const occName = occKey.slice(0, occKey.lastIndexOf("#"))
      const ownSigs = occSigs.get(occKey)
      for (const m of methods) {
        const seenOcc = new Set<string>()
        // Frontier entries are EXACT occurrence keys. Matching parents by
        // childOcc only (never by name) is the whole point of the guard: a
        // name fallback would let the trait IsEq#1 inherit the companion
        // object's extends link (IsEq#0 -> IsEqLowPriorityImplicits) — the
        // exact conflation this block exists to kill. Every scala
        // declaration (collectDecl) and anonymous body (anonScalaDecl)
        // registers an occurrence, so exact-key resolution always closes.
        let frontier: string[] = [occKey]
        let depth = 0
        while (frontier.length && depth < 10) {
          depth++
          const next: string[] = []
          for (const cur of frontier) {
            if (seenOcc.has(cur)) continue
            seenOcc.add(cur)
            for (const op of occParents.filter((p) => p.childOcc === cur)) {
              if (op.parentName === occName) continue // self-collision guard
              const parentOccKeys = [...occMethods.keys()].filter((k) => k.startsWith(op.parentName + "#"))
              if (parentOccKeys.length === 0) {
                // No per-occurrence registration (defensive only): the
                // pooled decls entry still carries its methods so a parent
                // known only through companion sharing stays reachable.
                const parentDecl = decls[op.parentName]
                if (parentDecl?.methods.has(m)) {
                  const cs = ownSigs?.get(m)
                  const ps = parentDecl.sigs.get(m)
                  const compat = cs && ps ? [...cs].some((s) => ps.has(s) || hasTypeVar(s) || [...ps].some((p2) => hasTypeVar(p2))) : true
                  if (compat) edges.push({ label: "overrides", from: `${occName}.${m}`, target: `${op.parentName}.${m}` })
                }
              } else {
                for (const pk of parentOccKeys) {
                  const pm = occMethods.get(pk)
                  if (!pm?.has(m)) continue
                  const cs = ownSigs?.get(m)
                  const ps = occSigs.get(pk)?.get(m)
                  const compat = cs && ps ? [...cs].some((s) => ps.has(s) || hasTypeVar(s) || [...ps].some((p2) => hasTypeVar(p2))) : true
                  if (compat) edges.push({ label: "overrides", from: `${occName}.${m}`, target: `${op.parentName}.${m}` })
                }
                next.push(...parentOccKeys)
              }
            }
          }
          frontier = next
        }
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
  repo: string | ((lang: string) => string),
): DifferentialEvaluation {
  const repoOf = typeof repo === "function" ? repo : () => repo
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
  // Lane-aware failed set: report rows (and current/baseline rows) are keyed
  // `repo:lang` under the two-corpus gate, so regressions carry the FULL lane
  // key and mark that lane's check failed. The function also still accepts the
  // legacy bare-`lang` report shape (unit tests / single-corpus probe callers):
  // a regression key `repo:lang` then marks the bare-lang check by matching on
  // the language part (also added to the set below).
  const failed = new Set([...regressions])
  for (const key of regressions) {
    const parts = key.split(":")
    if (parts.length >= 2) failed.add(parts[parts.length - 1])
  }
  // Perf messages are `repo:lang: avg Xms -> Yms` — derive the full lane key
  // (`repo:lang`) plus the bare lang so both shapes of report keys match.
  for (const x of perfRegressions) {
    const parts = x.split(":")
    if (parts.length >= 3) failed.add(`${parts[0]}:${parts[1]}`)
    if (parts.length >= 2) failed.add(parts[1])
  }
  const checks = Object.entries(report).map(([lang, r]: any) => {
    const laneFailed = failed.has(lang)
    return {
      id: `differential-${lang}`,
      description: `${repoOf(lang)}: tree-truth vs analyzer diff`,
      status: comparable && !laneFailed ? "pass" as const : "fail" as const,
      detail: comparable
        ? `${r.filesSampled} files, coverage ${r.coveragePct}%, unexplained ${r.fabricationPct}%${laneFailed ? "; regression detected" : ""}`
        : `${r.filesSampled} files; NOT COMPARABLE: baseline sampled ${baselineSample ?? "unknown"}/lang, run ${samplePerLang}/lang`,
    }
  })
  return { comparable, regressions, perfRegressions, checks }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  // Two-corpus gate: active repos = primary set ∪ second-corpus set.
  const activeRepos = REPO ? [REPO] : [...new Set([...Object.values(LANG_REPOS), ...Object.values(SECOND_CORPUS)])]
  for (const rp of activeRepos) {
    const rd = path.join(CORPUS_ROOT, rp)
    if (!fs.existsSync(rd)) throw new Error(`corpus repo missing: ${rd}`)
  }
  const repoPins: Record<string, string> = {}
  for (const rp of activeRepos) {
    repoPins[rp] = execSync("git rev-parse HEAD", { cwd: path.join(CORPUS_ROOT, rp) }).toString().trim()
  }
  const repoFor = (lang: string) => {
    if (REPO) return REPO
    const mapped = LANG_REPOS[lang]
    if (!mapped) throw new Error(`no corpus repo mapped for language ${lang} — extend LANG_REPOS`)
    return mapped
  }

  const report: Record<string, any> = {}
  const reportSecond: Record<string, any> = {}
  // Crash-resume: seed from the per-lane journal (written after every lane).
  // Only for canonical full sweeps — probe runs (--repo/--sample) always
  // recompute and never read the journal.
  const resume = !REPO && !process.argv.includes("--sample")
  let resumedLanes = 0
  const laneJournal: Record<string, any> = resume && fs.existsSync(LANE_JOURNAL) ? JSON.parse(fs.readFileSync(LANE_JOURNAL, "utf8")) : {}
  // Lane sweep: primary + second corpus per gated language (two-corpus gate).
  // Lanes are (lang, repo) pairs; rows keyed `repo:lang` in the baseline map so
  // regressions on EITHER corpus fail the language's check.
  const lanes: { lang: string; repo: string; isSecond: boolean }[] = []
  for (const lang of Object.keys(LANGS)) {
    lanes.push({ lang, repo: repoFor(lang), isSecond: false })
    // Probe mode (--repo X): single corpus only — the second lane would point
    // at an unrelated repo and defeat the probe's intent.
    if (REPO) continue
    const second = SECOND_CORPUS[lang]
    if (second && second !== repoFor(lang)) lanes.push({ lang, repo: second, isSecond: true })
  }
  for (const lane of lanes) {
    const { lang, repo: langRepo } = lane
    // Crash-resume: a lane already in the journal is trusted verbatim.
    const jKey = lane.isSecond ? `${langRepo}:${lang}` : lang
    if (resume && laneJournal[jKey]) {
      const jRow = laneJournal[jKey].row
      if (lane.isSecond) reportSecond[jKey] = jRow
      else report[lang] = jRow
      resumedLanes++
      console.log(`[${langRepo}] ${lang}: RESUMED from journal (files=${jRow.filesSampled} cov=${jRow.coveragePct}% missing=${jRow.missingInAnalyzer} unexp=${jRow.unexplainedInAnalyzer})`)
      continue
    }
    const cfg = LANGS[lang]
    const repoDir = path.join(CORPUS_ROOT, langRepo)
    const repoPin = repoPins[langRepo]
    const files: string[] = []
    const scan = (d: string) => {
      if (files.length > 4000) return
      let entries
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) scan(p) }
        else if (cfg.ext.split(",").some((x: string) => e.name.endsWith("." + x))) files.push(p)
      }
    }
    scan(repoDir)
    // Probe mode: --repo X with an off-language repo would report files=0 as a
    // vacuous pass. Explicitly reporting the skip keeps probe output honest
    // (the vacuous-pass THROW below applies only to full-sweep default runs,
    // where every language has a mapped repo that MUST contain it).
    if (files.length === 0 && REPO) {
      console.log(`[${langRepo}] ${lang}: files=0 SKIPPED (repo probe mode; no ${lang} files in ${langRepo})`)
      continue
    }

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

    const sample = seededPick(files, SAMPLE_PER_LANG, `${langRepo}:${lang}:m14-f5`)
    let treeEdgesTotal = 0, coveredByAnalyzer = 0, missingInAnalyzer = 0
    let analyzerEdgesTotal = 0, explainableByTree = 0, unexplainedInAnalyzer = 0
    let heuristicUnexplained = 0
    const samples: any[] = []
    const samplesHeuristic: any[] = []

    const durations: number[] = []
    // Perf under load: this gate is a CORRECTNESS gate with a perf budget on
    // top, but the box runs several agent sessions in parallel (measured: load
    // avg 10-12 on 8 cores, kswapd0 active) and one-off scheduler stalls
    // inflated kotlin 25.5ms -> 96ms (3.5x) while other languages ran FASTER
    // than baseline (svelte 0.35x) — impossible for a real regression, classic
    // noise. When the 1-minute load average exceeds 4, the timed loop is run a
    // second time and the per-file average takes the MINIMUM of the two runs:
    // min over runs converges on true steady-state cost under any load
    // profile. Correctness counts are computed once and never re-derived.
    let retryDurations: number[][] | null = null
    if (loadAvg1() > 4) {
      // Up to 3 spaced attempts; per-file average takes the MINIMUM across
      // the primary run and every attempt. min-over-runs converges on the
      // true steady-state cost; a budget breach surviving 3 min-taken runs
      // under load is treated as a REAL regression.
      retryDurations = []
      for (let attempt = 0; attempt < 3; attempt++) {
        const durs: number[] = []
        for (const f of sample) {
          const content = fs.readFileSync(f, "utf8")
          let r0
          try { r0 = parser.parse(content).rootNode } catch { continue }
          if (!r0) continue
          const t0 = performance.now()
          try {
            if (lang === "vue" || lang === "svelte") {
              const eng = await import("../../src/ast/engine")
              await (eng as any).ASTEngine.parseFile(f, content)
            } else {
              await analyzer.analyze(r0, content, path.relative(repoDir, f))
            }
          } catch { continue }
          durs.push(performance.now() - t0)
        }
        if (durs.length) retryDurations.push(durs)
        if (loadAvg1() <= 4) break
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
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
      if (lang === "typescript") {
        // M37.21 #611: dedicated typescript calls/instantiates oracle (web
        // family precedent — the generic tree walker never audited the call
        // surface; truth was 25 edges per 60 files vs java's 739).
        for (const e of deriveTypeScriptEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "javascript") {
        // M37.21 #611: wire the dedicated JS calls oracle into the plain
        // javascript lane's truth. The analyzer-side filter already compares
        // calls for javascript, but without this push the truth side emitted
        // ZERO calls — every real analyzer call surfaced as unexplained
        // (vue-core:javascript 294 in the first gated run; per-file parity
        // was already proven on scripts/verify-commit.js).
        for (const e of deriveJavaScriptEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "vue" || lang === "svelte") {
        // M37.21 #611: web-embedded-script CALLS truth (the JD-oracle gap).
        // The analyzers emit script-side calls (vue merges the JS/TS
        // sub-analyzer's relationships; svelte ditto + template handlers);
        // the truth previously carried only structural edges. The embedded
        // tree's calls derive with the SAME leaf-target contract (site-
        // agnostic label+target matching). lang=ts blocks run the TS oracle.
        const subTrees = await deriveEmbeddedScriptTrees(root, content, lang)
        // Vue's merge pass filters compiler macros (VUE_COMPILER_MACROS:
        // defineProps/defineEmits/withDefaults/...) from sub-analyzer
        // relationships — they are LANGUAGE keywords, not call edges. The
        // oracle mirrors that filter or every macro call is a fake MISSING
        // (30/60 element-plus files). Svelte's rune filter is separate and
        // handled inside the analyzer contract (SVELTE_RUNES — the JS oracle
        // never emits $-prefixed targets, so no mirror needed there).
        const MACROS = new Set(["defineProps", "defineEmits", "defineExpose", "withDefaults", "defineModel", "defineSlots", "defineOptions"])
        // Svelte rune mirror (SVELTE_RUNES + RUNE_LEAF_SEGMENTS contract):
        // the analyzer gates on isRuneCallee(FULL callee text) — `$derived.by`
        // and `$effect.pre` are member calls whose LEAF lands in the oracle's
        // target, so a target-side `$`-prefix check never fires (4 fake
        // MISSING in the svelte repo: by/pre). The TS oracle carries
        // fullCallee; the mirror re-derives the exact isRuneCallee ruling.
        const SVELTE_RUNES = new Set(["$state", "$state.raw", "$state.snapshot", "$derived", "$derived.by", "$effect", "$effect.pre", "$effect.tracking", "$effect.root", "$effect.untracked", "$props", "$props.id", "$props.is_safe", "$bindable", "$host", "$inspect", "$inspect.trace", "$render"])
        const RUNE_LEAFS = new Set(["state", "raw", "snapshot", "derived", "by", "effect", "pre", "tracking", "root", "untracked", "props", "id", "is_safe", "bindable", "host", "inspect", "trace", "render"])
        const isRuneCalleeMirror = (callee: string): boolean => {
          if (!callee.startsWith("$")) return false
          if (SVELTE_RUNES.has(callee)) return true
          return RUNE_LEAFS.has(callee.split(".").pop() ?? "")
        }
        for (const st of subTrees) {
          for (const e of deriveTypeScriptEdges(st)) {
            if (lang === "vue" && e.label === "calls" && MACROS.has(e.target)) continue
            if (lang === "svelte" && e.label === "calls" && isRuneCalleeMirror(e.fullCallee ?? e.target)) continue
            ;(truth as any[]).push(e)
          }
        }
        // M37.21 #611 svelte TEMPLATE call truth — the analyzer's template
        // pass emits calls the embedded-script trees cannot express:
        //   on:click={inc} / on:click={() => bump()} → handler leaf (0.85)
        //   {@render children(...)}                    → snippet name (0.9)
        // The svelte grammar exposes attribute values as opaque
        // svelte_raw_text leaves, so both are scanned with the analyzer's
        // pure-String contract, mirrored verbatim here.
        if (lang === "svelte") {
          const isIdent = (s: string): boolean => {
            if (!s) return false
            const ok = (c: string, first: boolean) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$" || (!first && c >= "0" && c <= "9")
            for (let i = 0; i < s.length; i++) if (!ok(s[i], i === 0)) return false
            return true
          }
          const rawText = (attr: any): string => {
            const value = attr.namedChildren?.find((c: any) => c.type === "expression")
            if (!value) return ""
            const st2: any[] = [value]
            while (st2.length > 0) {
              const m = st2.pop()!
              if (m.type === "svelte_raw_text") return m.text
              for (let i = (m.namedChildCount ?? 0) - 1; i >= 0; i--) { const c = m.namedChild(i); if (c) st2.push(c) }
            }
            return ""
          }
          const handlerLeaf = (text: string): string | undefined => {
            for (let i = 0; i < text.length; i++) {
              const ch = text[i]
              if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
                let end = i
                while (end < text.length) {
                  const c = text[end]
                  if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$") end++
                  else break
                }
                const ident = text.slice(i, end)
                if (end < text.length && text[end] === "(") return ident
                i = end
              }
            }
            return isIdent(text) ? text : undefined
          }
          const moduleName = path.basename(relPath, path.extname(relPath))
          const seenRender = new Set<string>()
          const twalk = (n: any): void => {
            const t = n.type
            if (t !== "script_element" && t !== "style_element") {
              if (t === "element" || t === "self_closing_tag") {
                const startTag = n.namedChildren?.find((c: any) => c.type === "start_tag") ?? (t === "self_closing_tag" ? n : undefined)
                if (startTag) {
                  for (const attr of startTag.namedChildren ?? []) {
                    if (attr.type !== "attribute") continue
                    const nameNode = attr.namedChildren?.find((c: any) => c.type === "attribute_name")
                    const attrName = nameNode?.text ?? ""
                    if (!attrName.startsWith("on:")) continue
                    const handler = handlerLeaf(rawText(attr))
                    if (handler && handler !== moduleName && !seenRender.has("h|" + handler)) {
                      seenRender.add("h|" + handler)
                      ;(truth as any[]).push({ label: "calls", from: "(template)", target: handler })
                    }
                  }
                }
              }
              if (t === "render_tag") {
                const text = n.text.replace("{@render", "").trim()
                let end = 0
                while (end < text.length && isIdent(text.slice(0, end + 1))) end++
                const target = text.slice(0, end)
                if (target && !seenRender.has("r|" + target)) {
                  seenRender.add("r|" + target)
                  ;(truth as any[]).push({ label: "calls", from: "(template)", target })
                }
              }
            }
            for (let k = 0; k < (n.namedChildCount ?? 0); k++) { const c = n.namedChild(k); if (c) twalk(c) }
          }
          twalk(root)
        }
      }
      if (lang === "java") {
        // M37.21 #610: dedicated java calls oracle (first JVM language with
        // one — the generic walker never audited the call surface).
        for (const e of deriveJavaEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "kotlin") {
        // M37.21 #610: kotlin calls oracle (JD-oracle gap, java precedent).
        for (const e of deriveKotlinEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "scala") {
        // M37.21 #610: scala calls oracle (JD-oracle gap, java precedent).
        for (const e of deriveScalaEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "groovy") {
        // M37.21 #610: groovy calls oracle (JD-oracle gap, java precedent).
        for (const e of deriveGroovyEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "c") {
        for (const e of deriveCCalls(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "cpp") {
        // M37.9: dedicated cpp oracle — calls + member-read uses truth so the
        // fmt differential audits the analyzer's real surface (previously
        // neither label was compared for cpp).
        for (const e of deriveCppEdges(root)) {
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
      if (lang === "php") {
        for (const e of derivePhpEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "ruby") {
        for (const e of deriveRubyEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "python") {
        for (const e of derivePythonEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "haskell") {
        for (const e of deriveHaskellEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "svelte") {
        for (const e of deriveSvelteComponentUsages(root)) {
          ;(truth as any[]).push(e)
        }
        // Snippet render-call truth ({@render X()} where X is a declared
        // {#snippet X}) — see deriveSvelteSnippetCalls.
        for (const e of deriveSvelteSnippetCalls(root)) {
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
      // as unexplained. CGD (M37 #601): c's oracle now derives member/bare
      // USES truth as well (write-gated), so c joins the uses-audited set.
      }))      .filter((r: any) => ["extends", "implements", "instantiates", ...(lang !== "csharp" && lang !== "dart" && lang !== "swift" && lang !== "cpp" ? ["overrides"] : []), ...(lang === "c" || lang === "cpp" || lang === "rust" || lang === "go" || lang === "dart" || lang === "objc" || lang === "php" || lang === "ruby" || lang === "python" || lang === "haskell" || lang === "java" || lang === "kotlin" || lang === "scala" || lang === "groovy" || lang === "typescript" || lang === "vue" || lang === "svelte" || lang === "javascript" ? ["calls"] : []), ...(lang === "zig" || lang === "swift" || lang === "objc" || lang === "php" || lang === "python" || lang === "c" || lang === "cpp" ? ["calls", "uses"] : []), ...(lang === "c" ? ["references"] : []), ...(lang === "dart" || lang === "ruby" || lang === "javascript" ? ["uses"] : []), ...(lang === "csharp" ? ["calls"] : []), ...(lang === "swift" || lang === "objc" || lang === "php" || lang === "python" ? ["references"] : [])].includes(r.label))
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

    const row = {
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
        avgMsPerFile: durations.length
          ? +Math.min(
              durations.reduce((a, b) => a + b, 0) / durations.length,
              ...(retryDurations ?? []).map((d) => d.reduce((a, b) => a + b, 0) / d.length),
            ).toFixed(1)
          : null,
        maxMsPerFile: durations.length ? +Math.max(...durations).toFixed(1) : null,
        samplesTimed: durations.length,
        loadAvgRetried: retryDurations !== null,
      },
      samples,
    }
    if (sample.length === 0) {
      // Vacuous-pass guard: a repo with zero files of this language produces a
      // 0/0 row that "passes" without verifying anything. That dishonesty
      // shipped before (php/ruby on grails-core logged files=0 as pass). The
      // language must be re-routed to a repo that contains it. Applies to BOTH
      // primary and second lanes (a second corpus with no files is a routing
      // error, never a silent skip).
      throw new Error(`differential: corpus repo ${langRepo} contains no ${lang} files — fix LANG_REPOS/SECOND_CORPUS routing for ${lang}`)
    }
    if (lane.isSecond) reportSecond[`${langRepo}:${lang}`] = row
    else report[lang] = row
    console.log(`[${langRepo}] ${lang}: files=${sample.length} tree-truth=${treeEdgesTotal} covered=${coveredByAnalyzer} (${row.coveragePct}%) MISSING=${missingInAnalyzer} | analyzer-edges=${analyzerEdgesTotal} unexplained=${unexplainedInAnalyzer} (${row.fabricationPct}%)`)
    // M37.21 #610 operational lesson (web-tree-sitter WASM heap aborts kill
    // the sweep mid-run — twice during the JVM wave): persist each completed
    // lane immediately so a crash never loses finished lanes again. The
    // final emitEvidence still writes the complete artifact; this is a
    // crash-resume journal keyed by lane, re-read on startup.
    fs.mkdirSync(path.dirname(LANE_JOURNAL), { recursive: true })
    const journal = fs.existsSync(LANE_JOURNAL) ? JSON.parse(fs.readFileSync(LANE_JOURNAL, "utf8")) : {}
    journal[lane.isSecond ? `${langRepo}:${lang}` : lang] = { row, repo: langRepo, isSecond: !!lane.isSecond }
    fs.writeFileSync(LANE_JOURNAL, JSON.stringify(journal, null, 2))
  }

  // Evaluate against the pinned baseline BEFORE emitting F5 evidence. The
  // previous implementation emitted every check as `pass`, then performed
  // the comparison afterward, allowing stale evidence to claim green.
  const BASELINE = path.join(ROOT, "validation", "m14", "differential-baseline.json")
  const parsedBaseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {}
  const baselineCounts = parsedBaseline.counts ?? parsedBaseline
  // Two-corpus gate: the current map carries the PRIMARY lane (repo:lang key,
  // derived from the lang-keyed report) AND every SECOND lane (repo:lang keys
  // from reportSecond). Baseline rows are repo:lang-keyed, so regressions on
  // either corpus compare 1:1 against their pinned row. The F5 evidence
  // keeps the per-language checks (differential-<lang>, consumed by the
  // completeness inventory) PLUS a per-language second-corpus check.
  const current: Record<string, any> = {}
  for (const [lang, r] of Object.entries<any>(report)) current[`${repoFor(lang)}:${lang}`] = {
    missing: r.missingInAnalyzer, unexplained: r.unexplainedInAnalyzer,
    heuristic: r.heuristicUnexplained,
    perf: { avgMsPerFile: r.perf.avgMsPerFile },
  }
  const currentSecond: Record<string, any> = {}
  for (const [key, r] of Object.entries<any>(reportSecond)) currentSecond[key] = {
    missing: r.missingInAnalyzer, unexplained: r.unexplainedInAnalyzer,
    heuristic: r.heuristicUnexplained,
    perf: { avgMsPerFile: r.perf.avgMsPerFile },
  }
  const evaluation = evaluateDifferential(report, current, baselineCounts, parsedBaseline.samplePerLang, SAMPLE_PER_LANG, (lang: string) => repoFor(lang))
  // Second-corpus evaluation: same baseline file (repo:lang rows), report keyed
  // repo:lang, so evaluateDifferential's failed-set must match full lane keys.
  const evaluationSecond = evaluateDifferential(reportSecond, currentSecond, baselineCounts, parsedBaseline.samplePerLang, SAMPLE_PER_LANG, (key: string) => key.split(":")[0])

  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F5",
    title: "Differential corpus harness (two-corpus gate)",
    claimLevel: "L1",
    layers: ["differential"],
    checks: [
      ...evaluation.checks.map(check => {
        const lang = check.id.replace("differential-", "")
        return { ...check, description: `${check.description} @${repoPins[repoFor(lang)]?.slice(0, 10) ?? "?"}` }
      }),
      ...evaluationSecond.checks.map(check => {
        const repo = (check.id.replace("differential-", "")).split(":")[0]
        return { ...check, description: `${check.description} (second corpus) @${repoPins[repo]?.slice(0, 10) ?? "?"}` }
      }),
    ],
    limitations: [
      { description: "second opinion is a clause-structure re-derivation from the same wasm grammars; a grammar bug shared by both paths would be invisible to this harness" },
      { description: "seeded sample of files per language, deterministic; not exhaustive over the corpus" },
      { description: "coverage/fabrication baselines recorded; wave M14.1 must reduce missing/unexplained counts" },
    ],
    data: {
      corpusPins: repoPins,
      samplingRule: `seeded ${SAMPLE_PER_LANG} files/language (primary + second corpus lanes)`,
      report,
      secondCorpus: { mapping: SECOND_CORPUS, report: reportSecond },
    },
  })
  console.log(`evidence written: validation/m14/results/M14.0.F5.json (resumed ${resumedLanes} lane(s) from journal)`)
  // Full sweep completed: the crash-resume journal served its purpose.
  try { fs.rmSync(LANE_JOURNAL, { force: true }) } catch { /* already gone */ }

  // Improvement-forcing gate: missing/unexplained counts may never grow.
  // Baseline updates are explicit and are not silently treated as validation.
  const updateBaseline = process.argv.includes("--update-baseline")
  if (updateBaseline) {
    const previous = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {}
    // Merge BOTH lanes (primary + second) into the repo:lang baseline file.
    const clean: Record<string, any> = {}
    for (const [k, v] of Object.entries<any>({ ...current, ...currentSecond })) {
      clean[k] = { missing: v.missing, unexplained: v.unexplained, heuristic: v.heuristic, perf: v.perf }
    }
    const merged = {
      samplePerLang: SAMPLE_PER_LANG,
      counts: { ...(previous.counts ?? previous), ...clean },
    }
    fs.writeFileSync(BASELINE, JSON.stringify(merged, null, 2) + "\n")
    console.log("differential baseline updated (primary + second lanes):", clean)
  } else if (!evaluation.comparable) {
    console.log(`differential baseline gate: SKIPPED (baseline sampled ${parsedBaseline.samplePerLang ?? "unknown"}/lang, this run ${SAMPLE_PER_LANG}/lang — probe mode, not comparable)`)
  } else {
    for (const r of [...evaluation.regressions, ...evaluationSecond.regressions]) console.error(`DIFFERENTIAL REGRESSION ${r}: ${JSON.stringify(baselineCounts[r])} -> ${JSON.stringify(current[r] ?? currentSecond[r])}`)
    for (const r of [...evaluation.perfRegressions, ...evaluationSecond.perfRegressions]) console.error(`PERF BUDGET EXCEEDED ${r}`)
    if (evaluation.regressions.length || evaluation.perfRegressions.length || evaluationSecond.regressions.length || evaluationSecond.perfRegressions.length) process.exit(5)
    console.log("differential baseline gate: no regressions (primary + second corpus); perf budgets respected")
  }
}

if (process.argv[1]?.endsWith("differential.ts")) {
  main().catch(e => { console.error(e); process.exit(1) })
}
