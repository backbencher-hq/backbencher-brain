/**
 * java-varargs-annotation-grammar.ts — DERIV_EXPORTS_JAVA3.
 *
 * A MINIMAL reproduction of the defect java-ownerless-why.ts located in the
 * corpus, with nothing else in the file.
 *
 * The corpus case is
 * $HOME/fixtures/repositories/java-lib/guava/src/com/google/common/base/Preconditions.java
 * which tree-sitter-java (the pinned REDISTRIBUTOR wasm, sha256 637aac44…) parses
 * with the class_declaration ENDING at line 1003 of 1541 and 30 methods after it
 * re-parented to `program`, so they lose their owner. The trigger region is
 *
 *     @Nullable Object @Nullable ... errorMessageArgs
 *
 * — an ANNOTATED VARARGS PARAMETER: a type-use annotation before the type, the
 * type, a declaration annotation after the type, then `...`.
 *
 * Each CASE below is a complete, syntactically legal Java compilation unit. The
 * question each answers is mechanical: does the tree keep the method inside the
 * class_body, and does the tree report an ERROR? Nothing here is inferred from
 * the source text; the shape of the method is read back off the parse tree by
 * ancestor chain.
 *
 * NO REGEX. The source snippets are literals (they are the INPUT, not a match),
 * and every assertion is a tree walk.
 */
import { getParser } from "../../../src/ast/engine"

interface Case { name: string; src: string; note: string }

const PRE = `package p;
import java.lang.annotation.ElementType;
import java.lang.annotation.Target;
@Target({ElementType.TYPE_USE, ElementType.PARAMETER})
@interface N {}
`
const POST = `
  static int after() { return 1; }
}
`

const CASES: Case[] = [
  {
    name: "A. plain varargs (baseline)",
    note: "no annotation anywhere on the varargs parameter",
    src: PRE + `public class C {
  static int m(Object a, Object... rest) { return rest.length; }
` + POST,
  },
  {
    name: "B. type-use annotation only, on the array type",
    note: "@N Object... rest — annotation before the type, none after",
    src: PRE + `public class C {
  static int m(Object a, @N Object... rest) { return rest.length; }
` + POST,
  },
  {
    name: "C. declaration annotation only, after the type",
    note: "Object @N ... rest — annotation after the type, none before",
    src: PRE + `public class C {
  static int m(Object a, Object @N ... rest) { return rest.length; }
` + POST,
  },
  {
    name: "D. BOTH — the corpus shape",
    note: "@N Object @N ... rest — this is the Preconditions.java parameter",
    src: PRE + `public class C {
  static int m(Object a, @N Object @N ... rest) { return rest.length; }
` + POST,
  },
  {
    name: "E. BOTH, single line, short names",
    note: "same shape as D but written on one line",
    src: PRE + `public class C {
  static int m(Object a, @N Object @N ... rest) { return 0; }
` + POST,
  },
  {
    name: "F. BOTH on a NON-varargs parameter",
    note: "@N Object @N x — both annotations, no ellipsis",
    src: PRE + `public class C {
  static int m(Object a, @N Object @N x) { return 0; }
` + POST,
  },
]

function chainOf(n: any): string {
  const parts: string[] = []
  let cur = n
  while (cur) { parts.push(cur.type); cur = cur.parent }
  return parts.reverse().join(" > ")
}

function errorNodes(root: any): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop(); if (!n) continue
    if (n.type === "ERROR" || n.isMissing) {
      out.push({ line: n.startPosition.row + 1, text: n.text.slice(0, 60) })
    }
    for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
  }
  return out
}

function methodsWithPath(root: any) {
  const out: { name: string; line: number; path: string }[] = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop(); if (!n) continue
    if (n.type === "method_declaration") {
      let nm = "(none)"
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier") { nm = c.text; break }
      }
      out.push({ name: nm, line: n.startPosition.row + 1, path: chainOf(n) })
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  out.sort((a, b) => a.line - b.line)
  return out
}

async function main() {
  const parser = await getParser("java")
  console.log(`grammar: the pinned wasm engine.ts resolves for "java"`)
  console.log(`population: ${CASES.length} hand-written minimal compilation units — every one is printed in full below\n`)
  for (const c of CASES) {
    const tree = parser.parse(c.src)
    if (!tree) throw new Error("parser.parse returned no tree (null result)")
    const errs = errorNodes(tree.rootNode)
    const ms = methodsWithPath(tree.rootNode)
    const insideClass = ms.filter(m => m.path.indexOf("class_body") !== -1).length
    console.log(`CASE ${c.name}`)
    console.log(`  note: ${c.note}`)
    console.log(`  tree: root.hasError=${tree.rootNode.hasError}  ERROR/MISSING nodes=${errs.length}`)
    for (const e of errs) console.log(`    line ${e.line}: ${JSON.stringify(e.text)}`)
    for (const m of ms) console.log(`    method ${m.name}@${m.line}  ${m.path}`)
    console.log(`  VERDICT: ${errs.length === 0 ? "parses clean" : "TREE HAS ERRORS"}; ${insideClass}/${ms.length} methods inside a class_body`)
    // Two INDEPENDENT questions. The first version of this line joined them with
    // `&&` inside a template and printed "OWNER LOST" for any case that had an
    // ERROR node, including cases where every method kept its class_body parent.
    // An ERROR node and a lost owner are different defects and the label has to
    // name only the second.
    const ownerKept = insideClass === ms.length
    console.log(`  -> tree-errors: ${errs.length === 0 ? "none" : `${errs.length}`}; owner: ${ownerKept ? "PRESERVED for every method" : `LOST for ${ms.length - insideClass} method(s)`}`)
    console.log("")
  }

  // The one thing that decides whether this is a grammar defect or ours: run the
  // same shapes through the ANALYZER and see whether it reports the ERROR on its
  // ParseResult.errors channel. An analyzer that reports it has told the truth and
  // the loss is downstream of it.
  console.log(`=== does the ANALYZER surface the ERROR on ParseResult.errors? ===`)
  const { RealJavaAnalyzer } = await import("../../../src/ast/real-java-analyzer")
  const analyzer = new RealJavaAnalyzer()
  for (const c of CASES) {
    const tree = parser.parse(c.src)
    if (!tree) throw new Error("parser.parse returned no tree (null result)")
    const res: any = analyzer.analyze(tree.rootNode, c.src, "C.java", { filePath: "C.java" } as any)
    const errs = res.errors ?? []
    const TOP = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"])
    const ownerless = (res.symbols ?? []).filter((s: any) => !s.ownerName && !TOP.has(String(s.metadata?.nodeType ?? "")))
    console.log(`  ${c.name}: ParseResult.errors=${errs.length}` +
      `  owner-less non-type symbols=${ownerless.length}` +
      (ownerless.length ? ` [${ownerless.map((s: any) => `${s.name}/${s.metadata?.nodeType}`).join(", ")}]` : "") +
      (errs.length ? `  first="${String(errs[0].message)}" line=${errs[0].range?.startLine}` : ""))
  }
}

main().catch(e => { console.error(e); process.exit(1) })