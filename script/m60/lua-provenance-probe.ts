// LUA-G2: identify the wired tree-sitter-lua.wasm. Three candidates compared by
// sha256 against the wired bytes. The gate re-measures; this records the result.
import { createHash } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
const G = "$HOME/fixtures/grammars"
const sha = (p: string) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null)
const wired = sha("wasm/tree-sitter-lua.wasm")
const cands = [
  ["@tree-sitter-grammars/tree-sitter-lua@0.4.1 (npm tarball)", `${G}/npm-0.4.1.wasm`],
  ["tree-sitter-wasms@0.1.13 out/ (npm tarball)", `${G}/tswasms-0.1.13-lua.wasm`],
] as const
console.log(`wired sha256: ${wired}`)
let matched = false
for (const [label, p] of cands) {
  const h = sha(p)
  const same = h === wired
  if (same) matched = true
  console.log(`  ${same ? "MATCH  " : "differs"} ${label.padEnd(52)} ${h ?? "(absent)"}`)
}
console.log(matched ? "\nPROVENANCE RESOLVED" : "\nPROVENANCE UNRESOLVED: the wired bytes match no candidate examined")
