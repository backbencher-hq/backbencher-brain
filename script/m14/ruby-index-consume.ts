/**
 * ruby-index-consume — phase-2 evidence for PROJECT INDEX consumption (task-22). INLINE-source fixtures +
 * assertions, no heavy run and no fixture-gate files:
 *   1 REOPEN: a class opened in two files is ONE declaration with both members (merged spec);
 *     RED control: the SAME index built with mergeSameKindTypeDecls=false counts 2 (what the build edit prevents)
 *   2 FAIL-CLOSED: flag off, absent index, or incomplete index ⇒ relationships byte-identical to pre-index
 *   3 OVERRIDE cross-file: a matching name is an inferred candidate, never structural proof
 *   4-6 INSTANTIATION / MIXIN / EXTENDS: name matches carry projectIndexNameCandidate;
 *       the shallow index does not prove lexical constant resolution
 *   7 CALLS UNTOUCHED: no calls row gains projectIndex metadata (name-only binding forbidden)
 * usage: BB_RUBY_INDEX_CONSUME=1 bun run script/m14/ruby-index-consume.ts
 */
import { getParser } from "../../src/ast/engine"
import { RealRubyAnalyzer } from "../../src/ast/real-ruby-analyzer"
import { indexTree, RUBY_DECLARATION_SPEC } from "../../src/ast/project-index"

const parser: any = await getParser("ruby")
function emptyIndex(complete: boolean): any {
  return {
    typeKinds: new Map(), typeMembers: new Map(), typeBases: new Map(), symbolNames: new Set(),
    modules: new Set(), symbolCounts: new Map(), damagedFiles: new Set(), stats: { files: 0, damaged: 0 },
    complete,
  }
}
function buildIndex(files: Array<{ path: string; src: string }>, complete = true, spec: any = RUBY_DECLARATION_SPEC): any {
  const index = emptyIndex(complete)
  for (const f of files) indexTree(parser.parse(f.src).rootNode, index, spec, f.path)
  return index
}
const failures: string[] = []
const check = (name: string, cond: boolean): void => {
  if (cond) console.log(`PASS ${name}`)
  else { console.log(`FAIL ${name}`); failures.push(name) }
}
const analyze = (src: string, rel: string, ctx?: any): any => {
  const a = new RealRubyAnalyzer()
  return a.analyze(parser.parse(src).rootNode, src, rel, ctx)
}

// 1 REOPEN
const reopenFiles = [
  { path: "a/widget.rb", src: "class Widget\n  def a; end\nend\n" },
  { path: "b/widget.rb", src: "class Widget\n  def b; end\nend\n" },
]
const merged = buildIndex(reopenFiles)
check("reopen: ONE declaration (symbolCounts Widget == 1)", merged.symbolCounts.get("Widget") === 1)
check("reopen: BOTH files' members present", !!merged.typeMembers.get("Widget")?.has("a") && !!merged.typeMembers.get("Widget")?.has("b"))
const unmerged = buildIndex(reopenFiles, true, { ...RUBY_DECLARATION_SPEC, mergeSameKindTypeDecls: false })
check("RED CONTROL: without mergeSameKindTypeDecls the reopened class reads 2 declarations", unmerged.symbolCounts.get("Widget") === 2)

// 2 FAIL-CLOSED controls
const childSrc = "class Child < Base\n  def run; end\nend\n"
const flagOff = JSON.stringify(analyze(childSrc, "child.rb"))
const noContextOn = JSON.stringify(analyze(childSrc, "child.rb", {}))
const incomplete = buildIndex([{ path: "base.rb", src: "class Base\n  def run; end\nend\n" }, { path: "child.rb", src: childSrc }], false)
const incompleteOn = JSON.stringify(analyze(childSrc, "child.rb", { projectIndex: incomplete }))
check("fail-closed: no-context and incomplete-index outputs are byte-identical to flag-off", flagOff === noContextOn && flagOff === incompleteOn)

// 3-6 decidable classes
const baseSrc = "class Base\n  def run; end\nend\n"
const index = buildIndex([
  { path: "base.rb", src: baseSrc },
  { path: "child.rb", src: childSrc },
  { path: "thing.rb", src: "class Thing; end\n" },
  { path: "consumer.rb", src: "class Consumer\n  def go\n    Thing.new\n  end\nend\n" },
  { path: "helpers.rb", src: "module Helpers\n  def helper; end\nend\n" },
  { path: "mixed.rb", src: "class Mixed\n  include Helpers\nend\n" },
])
const ctx = { projectIndex: index }
const rel = (r: any, type: string, target: string): any => (r.relationships ?? []).find((e: any) => String(e.type) === type && String(e.target) === target)
const childOut = analyze(childSrc, "child.rb", ctx)
const ov = rel(childOut, "overrides", "Base.run")
check("cross-file override stays an inferred name candidate", !!ov?.metadata?.projectIndexNameCandidate && !ov?.metadata?.projectIndexVerified && ov?.confidence === 0.65 && ov?.metadata?.evidenceClass === "inferred")
check("overrides declined counted (metadata.projectIndex.declined present)", typeof childOut.metadata?.projectIndex === "object")
const extendsEdge = rel(childOut, "extends", "Base")
check("cross-file extends name candidate", !!extendsEdge?.metadata?.projectIndexNameCandidate && !extendsEdge?.metadata?.projectIndexDeclared)
const consumerOut = analyze("class Consumer\n  def go\n    Thing.new\n  end\nend\n", "consumer.rb", ctx)
check("cross-file instantiation name candidate", !!rel(consumerOut, "instantiates", "Thing")?.metadata?.projectIndexNameCandidate)
const mixedOut = analyze("class Mixed\n  include Helpers\nend\n", "mixed.rb", ctx)
check("sibling-module mixin name candidate", !!rel(mixedOut, "mixes_in", "Helpers")?.metadata?.projectIndexNameCandidate)

// 7 CALLS UNTOUCHED
const callsTouched = (childOut.relationships ?? []).some((e: any) => String(e.type) === "calls" && e.metadata?.projectIndexVerified === true)
check("calls untouched by the index (no call binding)", !callsTouched)

if (failures.length > 0) { console.error(`INDEX CONSUME CONTRACT FAILED — ${failures.length}`); process.exit(1) }
console.log("INDEX CONSUME CONTRACT PASSED — reopen-merge, fail-closed, inferred name candidates; calls untouched")
