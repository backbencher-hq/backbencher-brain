// CONTROL for the case-insensitivity claim itself, on the package that does the matching.
import ignore from "ignore"
const ig = ignore().add(["**/testData/**", "**/perf/**", "**/wwwroot/**", "**/Microbenchmarks/**", "**/testassets/**", "**/benchmarkapps/**"])
const arms = [
  ["camelCase  testData   (what was WRITTEN)", "src/testData/foo.yaml"],
  ["lowercase  testdata   (what it SWALLOWS)", "src/testdata/foo.yaml"],
  ["uppercase  TESTDATA", "src/TESTDATA/foo.yaml"],
  ["lowercase  perf", "src/perf/foo.yaml"],
  ["camelCase  perf not applicable (already lower)", "src/perf/bar.yaml"],
  ["lowercase  microbenchmarks", "src/microbenchmarks/x.cs"],
  ["unrelated path", "src/lib/foo.yaml"],
]
let mismatch = 0
for (const [label, p] of arms) console.log(`  ${ig.ignores(p) ? "IGNORED " : "kept    "}  ${label}  ->  ${p}`)
console.log(`\n  testData ignored: ${ig.ignores("src/testData/foo.yaml")} · testdata ignored: ${ig.ignores("src/testdata/foo.yaml")}`)
console.log(ig.ignores("src/testdata/foo.yaml")
  ? "CONTROL CONFIRMS — the camelCase glob IGNORES lowercase `testdata/`, so the rule excludes files nobody chose to exclude."
  : "CONTROL REFUTES — lowercase testdata is NOT matched; the census's premise fails on this package version.")
