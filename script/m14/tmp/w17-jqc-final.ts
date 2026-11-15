// W17 jq:c FINAL classification. For each of the 23 unexplained targets:
//   (1) where is its DECLARING occurrence (file, ERROR-span? glue zone?)
//   (2) where are its reads
// Verdicts written by hand from the probe series (w17-jqc-*).
import * as fs from "fs"
const jq = "/home/ishaq2321/bb_tests/repositories/jq"
// For builtin.c: are the reads of last_var inside gen_last_1 (the declaring fn)?
const builtin = fs.readFileSync(`${jq}/src/builtin.c`, "utf8").split("\n")
const fnAt = (line: number): string => {
  for (let i = line - 1; i >= 0; i--) {
    const m = builtin[i].match(/^(?:static\s+)?[\w\s\*]*?\b(\w+)\s*\([^;{]*\)\s*\{\s*$/)
    if (m) return m[1]
  }
  return "?"
}
const pairs: [string, number][] = [["last_var",2068],["last_var",2078],["last_var",2090],["is_empty_var",2086],["call_arg",2084],["if_empty",2082]]
for (const [t, ln] of pairs) console.log(`${t} @ L${ln} -> in fn: ${fnAt(ln)}`)
// builtin_defs decl L2093ish, reads L2101.. in gen_builtin? and builtin_def_1arg decl L2107, reads L2113
console.log("builtin_defs decl in fn:", fnAt(2093), "| read in fn:", fnAt(2101))
console.log("builtin_def_1arg decl in fn:", fnAt(2107), "| read in fn:", fnAt(2113))
console.log("rangevar decl in fn:", fnAt(2122), "| rangestart:", fnAt(2123), "| range:", fnAt(2124))
