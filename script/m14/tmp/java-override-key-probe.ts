// Measure the java analyzer's `overrides` targets on the file R10 flagged, to
// explain the exact shape of `removeEldestEntry.Entry<String, Boolean>)`.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const f = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-gradle/model/src/main/groovy/org/grails/io/support/GrailsResourceUtils.java"
const res: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
for (const r of res.relationships ?? []) {
  if (r.type === "overrides") {
    console.log(r.source, "->", JSON.stringify(r.target), "| conf", r.confidence, "| line", r.line_number, "|", JSON.stringify(r.metadata ?? {}))
  }
}
