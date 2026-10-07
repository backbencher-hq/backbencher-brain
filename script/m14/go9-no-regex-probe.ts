// AST-level regex census: parse the analyzer with the TypeScript parser and
// count RegExpLiteral nodes plus string arguments to the regex-taking String
// methods. A text scan cannot tell `split("\n")` from `split(/x/)`.
import ts from "typescript"
import { readFileSync } from "node:fs"
const files = process.argv.slice(2)
for (const f of files) {
  const src = readFileSync(f, "utf8")
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const regexMethods = new Set(["match", "matchAll", "replace", "replaceAll", "search", "split"])
  let literals = 0, ctor = 0, strArg = 0, strCall = 0
  const where: string[] = []
  const visit = (n: ts.Node) => {
    if (ts.isRegularExpressionLiteral(n)) { literals++; where.push(`L${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} RegExpLiteral`) }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "RegExp") {
      ctor++; where.push(`L${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} new RegExp`)
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text
      if (regexMethods.has(m)) {
        const a = n.arguments[0]
        if (a && ts.isStringLiteral(a)) { strArg++; where.push(`L${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} .${m}(string literal)`) }
        else if (a && ts.isRegularExpressionLiteral(a)) { strCall++; where.push(`L${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} .${m}(REGEX)`) }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  console.log(`${f}\n  RegExpLiteral=${literals}  new RegExp=${ctor}  .method("string")=${strArg}  .method(/regex/)=${strCall}`)
  for (const w of where) console.log("    " + w)
}
