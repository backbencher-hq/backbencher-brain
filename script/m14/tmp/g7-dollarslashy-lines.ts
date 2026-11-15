// G7: the two REAL dollar-slashy interpolation sites in the corpus, plus
// regex-anchor controls. DocPublisher.groovy:249 is `~/^.+\.adoc$/` — that is a
// `~/ … /` PATTERN slashy (regex literal), where `$/` is an END ANCHOR, not a
// `$/ … /$` string opener. DomainFieldModifier has the same shape. If either
// file's lines actually use the `$/string/$` form my source-side regex counted,
// the probe prints the raw lines so the claim is decided by the source.
import { readFileSync } from "node:fs"

const REPO = "/home/ishaq2321/bb_tests/repositories/grails-core"
const FILES = [
  "build-logic/docs-core/src/main/groovy/grails/doc/DocPublisher.groovy",
  "grails-bootstrap/src/main/groovy/grails/codegen/model/DomainFieldModifier.groovy",
]

for (const f of FILES) {
  console.log(`=== ${f}`)
  const lines = readFileSync(`${REPO}/${f}`, "utf8").split("\n")
  lines.forEach((l, i) => {
    if (/\$\//.test(l)) console.log(`${i + 1}: ${l.trim().slice(0, 160)}`)
  })
}
