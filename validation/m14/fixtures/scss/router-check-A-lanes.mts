/** ROUTER FIRST: which spelling does each candidate extension get from the production router? */
import { detectLanguageFromPath } from "../src/ast/language-detection"
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
const CR = "/home/ishaq2321/bb_tests/repositories"
const CANDIDATES = ["cpp","cc","cxx","c++","hpp","hh","hxx","h","h++","inl","ipp","tpp",
                    "c","pl","pm","pod","t","psgi","groovy","gvy","gy","gradle","gsh","jenkinsfile",
                    "cu","cuh","ipp"]
for (const ext of CANDIDATES) {
  const lang = detectLanguageFromPath(`/x/file.${ext}`, "")
  let corpus = 0
  for (const r of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean)) {
    try { if (!statSync(`${CR}/${r}`).isDirectory()) continue } catch { continue }
    try { corpus += execFileSync("git", ["-C", `${CR}/${r}`, "ls-files"], { encoding: "utf8", maxBuffer: 256*1024*1024 }).split("\n").filter((f) => f.toLowerCase().endsWith(`.${ext}`)).length } catch { /* not a repo */ }
  }
  console.log(`  .${ext.padEnd(10)} -> ${JSON.stringify(lang ?? null).padEnd(14)} corpus ${corpus}`)
}
