// script/m14/tmp/sw-framework-dump.ts — measure the swift fixture's emitted
// framework surface before it is pinned (author-then-measure, never the reverse).
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FIX = path.join(ROOT, "validation/m14/fixtures/swift/framework-surface-pins.swift")
const src = fs.readFileSync(FIX, "utf8")

const parsed: any = await (ASTEngine as any).parseFile(FIX, src, { language: "swift" })
const md: any = parsed.metadata

console.log("detectedFrameworks:", JSON.stringify(md.detectedFrameworks))
console.log("framework         :", JSON.stringify(md.framework))
console.log("frameworkPatterns :", JSON.stringify(md.frameworkPatterns))
console.log("patterns          :", JSON.stringify(md.patterns))
console.log("symbols           :", JSON.stringify((parsed.symbols ?? []).map((s: any) => ({ name: s.name, kind: s.kind }))))
console.log("errors            :", (parsed.errors ?? []).length)
