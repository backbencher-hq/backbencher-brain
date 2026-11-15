// JVM adversarial round (the web-closure playbook applied to the JVM four):
// corpus-absent construct reconstructions through the PRODUCTION entry
// (parseFile). For each case: does the GRAMMAR error, does the PIPELINE
// error, and does the ANALYZER actually surface the symbols a correct parse
// must produce? Parse error without extraction loss is a different verdict
// than extraction loss — the two-question form #841 established.
//
// Corpus recency (measured before writing these): grails-core 2026-08,
// Exposed/kotlinx-coroutines 2026-09, scala3 (compiler repo), geb 2026-08.
// So constructs in those repos are already census-measured; the probes below
// are deliberately the ones ABSENT from them.
//
// Run: bun script/m14/tmp/jvm-adv-battery.ts
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

type Lang = "java" | "kotlin" | "scala" | "groovy"

const CASES: Array<[string, Lang, string, string[]]> = [
  // ---------------- JAVA (pinned corpus: grails-core, 2026-08) ----------------
  // Java 21 final: record patterns in switch — no occurrence class in grails-core's
  // Spring-era sources; record decls exist, pattern switches do not.
  ["java:record-pattern-switch", "java", "A.java",
    `public class A {\n  record Point(int x, int y) {}\n  static String describe(Object o) {\n    return switch (o) {\n      case Point(int x, int y) -> "p";\n      case null -> "none";\n      default -> "?";\n    };\n  }\n}\n`, ["A", "Point", "describe", "x", "y"]],
  // Java 21 final: unnamed variables (`_`) — corpus absent.
  ["java:unnamed-variables", "java", "B.java",
    `import java.util.List;\npublic class B {\n  void run(List<String> xs) {\n    for (var _ : xs) { count(); }\n  }\n  void count() {}\n}\n`, ["B", "run", "count"]],
  // Java 25 final: compact source files + instance main — no class decl at all.
  ["java:compact-source-main", "java", "C.java",
    `void main() {\n  System.out.println("hello");\n}\n`, ["main"]],
  // Java 25 final: module import declarations.
  ["java:module-import", "java", "D.java",
    `import module java.base;\npublic class D {\n  List<String> names() { return List.of("a"); }\n}\n`, ["D", "names"]],
  // Java 21 final: record patterns in enhanced for heads.
  ["java:record-pattern-for", "java", "E.java",
    `public class E {\n  record Pair(int a, int b) {}\n  int total(Pair[] ps) {\n    int t = 0;\n    for (Pair(int a, int b) : ps) { t += a + b; }\n    return t;\n  }\n}\n`, ["E", "Pair", "total"]],
  // Java 23+ preview: primitive type patterns.
  ["java:primitive-patterns", "java", "F.java",
    `public class F {\n  static String kind(Object o) {\n    return switch (o) {\n      case int i -> "int";\n      case long l -> "long";\n      default -> "other";\n    };\n  }\n}\n`, ["F", "kind"]],

  // ---------------- KOTLIN (pinned corpora: Exposed, kotlinx-coroutines) ------
  // Kotlin 2.2: context parameters — bleeding edge, corpus absent.
  ["kotlin:context-parameters", "kotlin", "A.kt",
    `context(name: String)\nfun greet(): String = "hi $name"\n\nclass K {\n  fun run(): String = context(Int) { greet() }\n}\n`, ["greet", "K", "run"]],
  // Kotlin 2.1: when-guards.
  ["kotlin:when-guards", "kotlin", "B.kt",
    `sealed interface Msg\ndata class Text(val body: String): Msg\n\nfun handle(m: Msg): String = when (m) {\n  is Text if m.body.length > 3 -> "long"\n  is Text -> "short"\n  else -> "?"\n}\n`, ["Msg", "Text", "handle", "body"]],
  // Kotlin 1.9: data object (distinct from object) — likely corpus-absent.
  ["kotlin:data-object", "kotlin", "C.kt",
    `data object Unset\n\nopen class Holder {\n  val state = Unset\n}\n`, ["Unset", "Holder", "state"]],
  // Kotlin 2.0: multi-dollar string interpolation.
  ["kotlin:multi-dollar-interpolation", "kotlin", "D.kt",
    `fun tmpl(): String = $$"raw $$name and {x} stay literal"\n`, ["tmpl"]],
  // Kotlin: nested type-parameter constraints (multiple where bounds).
  ["kotlin:multi-where-bounds", "kotlin", "E.kt",
    `fun <T> join(a: T, b: T): T where T : CharSequence, T : Comparable<T> {\n  return if (a > b) a else b\n}\n`, ["join"]],

  // ---------------- SCALA (pinned corpus: scala3 compiler repo) ---------------
  // The compiler repo uses its own syntax, so the probes target the rarest
  // surface it does not contain.
  ["scala:match-type-alias", "scala", "A.scala",
    `type Elem[X] = X match {\n  case String => Char\n  case Array[t] => t\n}\n\nval e: Elem[String] = 'c'\n`, ["Elem", "e"]],
  // Scala 3: dependent function types.
  ["scala:dependent-function-type", "scala", "B.scala",
    `class Reader { type In; def read(i: In): String = "" }\n\ndef extractor(r: Reader): (r.In) => String = (i: r.In) => r.read(i)\n`, ["Reader", "extractor", "read"]],
  // Scala 3.6: `erased` definitions (experimental, corpus absent).
  ["scala:erased-defs", "scala", "C.scala",
    `erased def unused(x: Int): Int = x\n\nobject Live {\n  def now(): Int = 1\n}\n`, ["Live", "now"]],
  // Scala 3: implicit by-name parameters.
  ["scala:implicit-by-name", "scala", "D.scala",
    `def log(msg: => String)(using StringBuilder): Unit = ()\n\nclass Ctx {\n  given StringBuilder = StringBuilder()\n  def go(): Unit = log("x")\n}\n`, ["log", "Ctx", "go"]],
  // Scala 3: `infix` declared operators + type lambda bounds.
  ["scala:infix-declaration", "scala", "E.scala",
    `infix type Or[A, B] = Either[A, B]\n\ninfix def alt[A, B](a: A, b: B): A Or B = Left(a)\n`, ["Or", "alt"]],

  // ---------------- GROOVY (pinned corpora: grails-core, geb) -----------------
  // Groovy 4 records — grails-core has groovy classes, records uncertain.
  ["groovy:record-decl", "groovy", "A.groovy",
    `record Point(int x, int y) {}\n\nclass Use {\n  String show(Point p) { return "p" }\n}\n`, ["Point", "Use", "show"]],
  // Groovy 4 sealed hierarchies.
  ["groovy:sealed-class", "groovy", "B.groovy",
    `sealed interface Shape permits Circle, Square {}\nclass Circle implements Shape {}\nclass Square implements Shape {}\n\nclass Area {\n  double of(Shape s) { return 0.0d }\n}\n`, ["Shape", "Circle", "Square", "Area", "of"]],
  // Groovy 3+ `var`, lamda + method reference corpus-present; probe the
  // pattern-style instanceof (groovy 4 java-parity).
  ["groovy:pattern-instanceof", "groovy", "C.groovy",
    `class C {\n  String kind(Object o) {\n    if (o instanceof String s) { return s }\n    return "?"\n  }\n}\n`, ["C", "kind"]],
  // Groovy 5 arrow switch (java-parity switch expressions).
  ["groovy:arrow-switch", "groovy", "D.groovy",
    `class D {\n  String pick(int n) {\n    switch (n) {\n      case 1 -> "one"\n      case 2 -> "two"\n      default -> "many"\n    }\n  }\n}\n`, ["D", "pick"]],
]

async function main() {
  const rows: any[] = []
  let anyMissing = 0
  for (const [name, lang, ext, src, expected] of CASES) {
    const file = join(tmpdir(), `jvm-adv-${name.replace(/[^a-z0-9-]/gi, "_")}.${ext}`)
    writeFileSync(file, src)
    let treeErr = 0
    try {
      const parser = await ASTEngine.getParser(lang)
      const tree = parser.parse(src)
      if ((tree.rootNode as any).hasError) {
        const stack = [tree.rootNode]
        while (stack.length) {
          const n = stack.pop()!
          if (n.type === "ERROR" || n.isMissing) treeErr++
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
        }
      }
    } catch { treeErr = -1 }
    let symbols: any[] = []
    let pipelineErr = 0
    let analyzeErr = ""
    try {
      const parsed = await parseFile(file, process.cwd())
      symbols = parsed.symbols ?? []
      pipelineErr = (parsed.errors ?? []).length
    } catch (e: any) { analyzeErr = String(e?.message ?? e).slice(0, 90) }
    const names = new Set(symbols.map((s: any) => s.name))
    const missing = expected.filter((n) => !names.has(n))
    if (missing.length) anyMissing++
    rows.push({ case: name, grammarErrNodes: treeErr, pipelineErrors: pipelineErr, symbolsFound: symbols.length, expectedSymbols: expected.length, missing })
    console.log(
      `${name.padEnd(36)} grammarErr=${String(treeErr).padStart(3)} pipeErr=${pipelineErr} ` +
      `syms=${symbols.length}/${expected.length} ${missing.length ? "MISSING:" + missing.join(",") : "all-found"} ${analyzeErr}`,
    )
  }
  console.log(`\ncases with extraction loss: ${anyMissing}/${CASES.length}`)
  console.log(JSON.stringify(rows, null, 1))
}

main().then(() => process.exit(0))
