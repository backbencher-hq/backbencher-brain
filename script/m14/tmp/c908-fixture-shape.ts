// #908: does the minimized fixture reproduce the jq misparse (macro invocation
// absorbed into a declaration, real declared name demoted to type_identifier)?
import fs from "node:fs"

const WTS: any = await import("web-tree-sitter")
const P = WTS.Parser ?? WTS.default ?? WTS
const L = WTS.Language ?? WTS.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const SRC = `#define YY_INITIAL_VALUE(Value) Value

typedef int YYSTYPE;

int yyparse(void) {
  YY_INITIAL_VALUE (static YYSTYPE yyval_default;)
  YYSTYPE yylval YY_INITIAL_VALUE (= yyval_default);
  YY_INITIAL_VALUE (static YYSTYPE zz_default;)
  return yylval;
}
`
const tree = parser.parse(SRC)
const show = (n: any, d = 0): void => {
  console.log(`${"  ".repeat(d)}${n.type}@${n.startPosition.row + 1} :: ${n.text.replace(/\s+/g, " ").slice(0, 60)}` + (n.hasError ? "   << hasError" : ""))
  if (d >= 4) return
  for (let i = 0; i < n.namedChildCount; i++) show(n.namedChild(i), d + 1)
}
show(tree.rootNode)
console.log(`root hasError=${tree.rootNode.hasError}`)
