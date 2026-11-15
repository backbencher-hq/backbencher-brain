// script/m14/tmp/c907-fixture-shape.ts — find a minimal snippet that reproduces
// the #907 glue shape, so the fix can be pinned by a fixture instead of by a
// 444-line corpus file.
//
// The shape to reproduce (measured on jq/src/jv_print.c):
//   1. an enclosing `function_definition` that swallows the rest of the file
//      (its body's compound_statement reaches past the real end of the function);
//   2. inside that swallowed body, at least one definition HEADER that survives
//      only as an `ERROR` whose children are a type node + a `function_declarator`,
//      with the source's next non-space character being `{`.
//
// Run: bun script/m14/tmp/c907-fixture-shape.ts
import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const CANDIDATES: Record<string, string> = {
  "unclosed-if-in-body": [
    "int outer(void) {",
    "#if 1",
    "  return 1;",
    "}",
    "",
    "void recovered_one(void) {",
    "  return 2;",
    "}",
    "",
    "void recovered_two(void) {",
    "  return recovered_one();",
    "}",
    "",
  ].join("\n"),
  "unclosed-ifdef-in-body": [
    "int outer(void) {",
    "#ifdef NEVER",
    "  return 1;",
    "#endif",
    "}",
    "",
    "void recovered_one(void) {",
    "  return 2;",
    "}",
    "",
  ].join("\n"),
  "unbalanced-brace-then-def": [
    "int outer(void) {",
    "  if (1) {",
    "    return 1;",
    "",
    "void recovered_one(void) {",
    "  return 2;",
    "}",
    "",
  ].join("\n"),
  // The jq mechanism, minimally: a brace pair whose CLOSE lives inside a later
  // #ifdef while its OPEN lives outside, so the grammar's preproc scanner and the
  // case body disagree about nesting and the `case` runs away.
  "jq-like-ifdef-close": [
    "int outer(int x) {",
    "  switch (x) {",
    "    case 1: {",
    "      if (a) {",
    "        p();",
    "      } else {",
    "#ifdef FEATURE",
    "        q();",
    "      }",
    "#endif",
    "      break;",
    "    }",
    "  }",
    "}",
    "",
    "void recovered_one(void) {",
    "  return 1;",
    "}",
    "",
    "void recovered_two(void) {",
    "  return recovered_one();",
    "}",
    "",
  ].join("\n"),
  "jq-like-ifdef-close-if1": [
    "int outer(int x) {",
    "  switch (x) {",
    "    case 1: {",
    "      if (a) {",
    "        p();",
    "      } else {",
    "#if 1",
    "        q();",
    "      }",
    "#endif",
    "      break;",
    "    }",
    "  }",
    "}",
    "",
    "void recovered_one(void) {",
    "  return 1;",
    "}",
    "",
  ].join("\n"),
  "switch-case-guard": [
    "int outer(int x) {",
    "  switch (x) {",
    "    case 1:",
    "      put(x);",
    "  }",
    "",
    "void recovered_one(void) {",
    "  return 2;",
    "}",
    "",
    "void recovered_two(void) {",
    "  return recovered_one();",
    "}",
    "",
  ].join("\n"),
}

/** Does the tree contain a definition header glued into a swallowed BODY? */
function findGluedDefinitions(root: any, src: string): Array<{ name: string; line: number; where: string }> {
  const hits: Array<{ name: string; line: number; where: string }> = []
  // BROAD form: any function_declarator followed by `{` that is not already the
  // declarator of a function_definition node — i.e. a definition header that the
  // grammar failed to wrap. Reports the wrapper it WAS found under, so the exact
  // shape of any synthetic reproduction is visible.
  const walk = (n: any, insideBody: boolean, wrapper: string) => {
    const nowInside = insideBody || n.type === "compound_statement"
    if (n.type === "function_declarator") {
      const par = n.parent
      const isFdOfFn = par && par.type === "function_definition" && par.childForFieldName?.("declarator")?.startIndex === n.startIndex
      if (!isFdOfFn) {
        let j = n.endIndex
        while (j < src.length && " \t\n\r".includes(src[j])) j++
        if (src[j] === "{") {
          const id = n.childForFieldName?.("declarator")
          hits.push({
            name: id?.text ?? n.text,
            line: n.startPosition.row + 1,
            where: `${par?.type ?? "?"}${nowInside ? " inBody" : " @top"}${wrapper ? ` <- ${wrapper}` : ""}`,
          })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), nowInside, n.type)
  }
  walk(root, false, "")
  return hits
}

for (const [name, src] of Object.entries(CANDIDATES)) {
  const root = parser.parse(src).rootNode
  const hits = findGluedDefinitions(root, src)
  const tops = Array.from({ length: root.namedChildCount }, (_v, i) => root.namedChild(i).type)
  console.log(`${name}: hasError=${root.hasError} topLevel=[${tops.join(", ")}]`)
  console.log(`   glued definitions found: ${hits.length ? hits.map((h) => `${h.name}@L${h.line}(${h.where})`).join(", ") : "(none)"}`)
}
