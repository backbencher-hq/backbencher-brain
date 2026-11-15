// Which capture group is the MODULE and which is the ITEM LIST, per pattern?
// The fallback derived both positionally (`match[3] || match[2] || match[1]`), which
// is only correct for patterns shaped like the JS/TS one. This prints the actual
// groups so the inversion is visible per language rather than asserted.
const patterns: Record<string, RegExp[]> = {
  typescript: [
    /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/,
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
  ],
  javascript: [/import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/],
  python: [/^from\s+([\w.]+)\s+import\s+(.+)$/, /^import\s+([\w.]+)/],
  go: [/import\s+(?:"([^"]+)"|(\w+)\s+"([^"]+)")/],
  rust: [/use\s+([\w:]+)(?:::\{([^}]+)\})?/],
  java: [/import\s+(?:static\s+)?([\w.]+)/],
}
const samples: Record<string, string[]> = {
  typescript: [`import { a, b as c } from "m"`, `import x from "m"`, `import * as ns from "m"`],
  javascript: [`import { a as b } from "m"`, `const x = require("m")`],
  python: [`from Cython.Debugger import Cygdb as cygdb`, `from os import path as p`, `import os.path`],
  go: [`import "fmt"`, `import alias "fmt"`],
  rust: [`use foo::bar;`, `use foo::{a, b as c};`],
  java: [`import java.util.List;`, `import static java.lang.Math.max;`],
}
console.log("| lane | source | derived `path` | derived `names` | verdict |")
console.log("|---|---|---|---|---|")
for (const [lang, pats] of Object.entries(patterns)) {
  for (const src of samples[lang] ?? []) {
    for (const pat of pats) {
      const m = src.match(pat)
      if (!m) continue
      const path = m[3] || m[2] || m[1] || ""
      const names = m[1] || m[2] || ""
      // A correct row has the module in `path` and the items in `names`.
      const looksLikeModule = /["\'`]|[\w.]+$/.test(path) && !/\sas\s|,/.test(path)
      const itemsAreItems = names === "" || !/^[\w.]+$/.test(names) || names === path
      const verdict = path === names ? "both same (plain import, OK)" : looksLikeModule && itemsAreItems ? "ok" : "**INVERTED**"
      console.log(`| ${lang} | \`${src}\` | \`${path}\` | \`${names}\` | ${verdict} |`)
      break
    }
  }
}
