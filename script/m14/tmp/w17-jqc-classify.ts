// W17 jq:c classification, final: for every unexplained jq target, which side
// is wrong? VERDICT table produced from the probes in this file series:
//   - yy_*/YY_* (lexer.c, parser.c): flex/bison-GENERATED machinery inside
//     ERROR spans (jv.c-style glue) — the analyzer resolves them from its
//     macro/enum/global maps; the oracle's CGD14 glue-suppression + generated
//     file origin makes them unrecoverable there. Same class as the sqlite
//     amalgamation floor (CGD31-38).
//   - Round_* (jv_dtoa.c): file-scope enum members inside a macro-mangled
//     ERROR span — analyzer extracts via extractMacro/extractEnum; oracle's
//     isSuppressedErrorDecl drops the declaring occurrence (AFTER glue).
//   - builtin_def_1arg / builtin_defs (builtin.c): struct-typed locals in
//     function scope — analyzer emits (globalVars map from a parallel
//     declaration?), oracle's fnLocals shadow excludes them (CGD15 works).
//   - last_var/is_empty_var/call_arg/if_empty/rangestart/rangevar/range
//     (builtin.c): block-local `block X = gen_op_var_fresh(...)` chains —
//     analyzer's locals map is keyed per FUNCTION; nested blocks inside
//     `for` bodies... the reads sit in DIFFERENT functions than the decls.
// Wait — verify: are these reads in the same function as the decls?

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const fs = require("fs")
const src = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/builtin.c", "utf8")
const lines = src.split("\n")
// find decl lines and read lines with function boundaries
const decls: [number, string][] = []
const reads: [number, string][] = []
const targets = ["last_var","is_empty_var","call_arg","if_empty","rangestart","rangevar","range","builtin_defs","builtin_def_1arg"]
lines.forEach((l, i) => {
  for (const t of targets) {
    if (new RegExp(`\\b${t}\\b`).test(l)) {
      if (new RegExp(`(block|struct bytecoded_builtin\\w*)\\s+${t}\\s*=|${t}\\s*\\[\\]`).test(l)) decls.push([i+1, t])
      else reads.push([i+1, t])
    }
  }
})
console.log("decl lines:", decls.slice(0, 10))
console.log("read lines:", reads.slice(0, 10))
// which function is L2068 in?
let fnStart = 0, fnName = "?"
for (let i = 2067; i >= 0; i--) {
  const m = lines[i].match(/^(?:static\s+)?(?:block\s+)?block\s+(\w+)\s*\(|^\w[\w\s\*]*\s+(\w+)\s*\([^;]*\)\s*\{/)
  if (m) { fnStart = i+1; fnName = (m[1] ?? m[2]); break }
}
console.log(`L2068 sits in function ${fnName} starting ~L${fnStart}`)
