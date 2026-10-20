/**
 * dart-extfail-probe — the 86-row `extFAIL` on the dart `--index` production population, named.
 *
 * ## THE DEFECT
 *
 * The dart `--index` production arm reads **extFAIL 86** — refuted external claims — where the
 * no-index arm reads 0. Every one of them is an `overrides` row carrying the `owner` claim kind
 * whose target is `<Base>.<member>`, and the arbiter refutes it because the PROJECT declares the
 * OWNER (`TerminatableMixin`) while the row claims the base is outside the project.
 *
 * The measured shape (dart-http, 5 rows — the whole reproduction):
 *
 *     class StreamHandler extends Object with TerminatableMixin, ClosableMixin {
 *       @override void onCheckForClose() { … }     // line 937
 *     }
 *
 * `onCheckForClose` is declared by **`ClosableMixin`** (`error_handler.dart:79`), NOT by
 * `TerminatableMixin`. The class applies BOTH mixins (`with TerminatableMixin, ClosableMixin`), so
 * the member IS overridden — but the base the analyzer names is the FIRST mixin in the with-clause,
 * and the arbiter's owner lookup finds `TerminatableMixin` declared in the project and refutes the
 * claim that the base is outside it.
 *
 * THE TWO HALVES ARE BOTH RIGHT AND THEY CONTRADICT EACH OTHER:
 *
 *   * the ANALYZER names the first heritage parent (`TerminatableMixin`) as the base — a declared
 *     guess at 0.8 confidence, gated on `@override`;
 *   * the ARBITER refutes "this base is outside the project" by looking the OWNER up — and the
 *     owner IS in the project (`error_handler.dart:10`), so the claim is false.
 *
 * So the refutation is not the arbiter being wrong: the ANALYZER's base is wrong, and the arbiter
 * caught it. The row names a base that does not declare the member.
 *
 * ## WHAT THIS INSTRUMENT DOES
 *
 * It reproduces the analyzer's decision on the exact files, prints the base the analyzer chose, the
 * bases that ACTUALLY declare the member (in-file and index-wide), and the with-clause order — so
 * the fix is written against a measurement rather than a hypothesis.
 *
 * It emits NOTHING into the analyzer and changes no count of any other tool.
 */
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"
import { buildProjectIndexStreaming, buildResolutionTables, DART_DECLARATION_SPEC } from "../../src/ast/project-index"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (name: string): string | undefined => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : undefined
}
const REPO = arg("repo") ?? "dart-http"
const RELS = (arg("files") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
if (RELS.length === 0) {
  console.error("usage: bun run script/m14/dart-extfail-probe.ts --repo=<name> --files=<rel1,rel2>")
  process.exit(2)
}
const REPO_ROOT = path.join(CR, REPO)
const WASM = path.join(ROOT, "wasm", "tree-sitter-dart.wasm")

const tracked = (await import("node:child_process")).execFileSync(
  "git", ["-C", REPO_ROOT, "ls-files", "*.dart"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
).split("\n").filter(Boolean).map((f) => path.join(REPO_ROOT, f))
// THE SPEC UNDER TEST. `BB_DART_FIXED_SPEC=1` builds the index with the candidate `nameResolver`
// (the one-line spec change the Lead applies to `src/ast/project-index.ts`), so the ANALYZER-side
// fix can be verified BEFORE that shared file moves. The default is the committed spec, so the
// probe still measures the production population as it is.
const useFixed = process.env.BB_DART_FIXED_SPEC === "1"
const spec: any = useFixed
  ? {
    ...DART_DECLARATION_SPEC,
    nameResolver: (node: any): string => {
      if (node.type === "mixin_declaration") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type === "identifier") return c.text
        }
        return ""
      }
      return node.childForFieldName("name")?.text ?? ""
    },
  }
  : DART_DECLARATION_SPEC
console.log(`spec: ${useFixed ? "CANDIDATE (nameResolver applied)" : "COMMITTED (as in src/ast/project-index.ts)"}`)
const projectIndex = await buildProjectIndexStreaming(WASM, tracked, spec)
buildResolutionTables(projectIndex)

const parser = await getParser("dart")
const analyzer = new RealDartAnalyzer()
for (const rel of RELS) {
  const abs = path.join(REPO_ROOT, rel)
  const content = readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  const root = tree?.rootNode
  if (!root) continue
  const result: any = await analyzer.analyze(root, content, rel, { projectIndex } as any)

  // The class's own with-clause, in SOURCE ORDER, with the mixin names as written.
  const walk = (n: any, owner: string | null, out: Map<string, string[]>): void => {
    const cls = n.type === "class_definition" ? (n.childForFieldName?.("name")?.text ?? owner) : owner
    if (n.type === "class_definition") {
      const sup = (n.namedChildren ?? []).find((c: any) => c?.type === "superclass")
      const names: string[] = []
      if (sup) {
        for (const c of (sup.namedChildren ?? [])) {
          if (c?.type === "mixins" || c?.type === "mixin") {
            for (const t of (c.namedChildren ?? [])) if (t?.type === "type_identifier") names.push(t.text)
          }
        }
      }
      out.set(cls!, names)
    }
    for (const c of (n.namedChildren ?? [])) if (c) walk(c, cls, out)
  }
  const withClauses = new Map<string, string[]>()
  walk(root, null, withClauses)

  // Which mixin/base actually DECLARES the member, index-wide.
  const declOwner = (member: string): string[] => {
    const out: string[] = []
    for (const [t, members] of projectIndex.typeMembers) if (members.has(member)) out.push(t)
    return out
  }
  const basesOf = (t: string): string[] => [...(projectIndex.typeBases?.get(t) ?? [])]

  console.log(`\n=== ${REPO}/${rel}`)
  for (const r of result?.relationships ?? []) {
    if (String(r.type) !== "overrides") continue
    const tgt = String(r.target ?? "")
    const dot = tgt.lastIndexOf(".")
    if (dot <= 0) continue
    const base = tgt.slice(0, dot)
    const member = tgt.slice(dot + 1)
    const src = String(r.source ?? "")
    const ownerCls = src.slice(0, src.lastIndexOf("."))
    const md = (r as any).metadata ?? {}
    const isExternalBase = md.isExternalBase === true
    const beyondScope = md.baseBeyondRunScope !== undefined
    const chosen = md.overrideBaseEvidence === "declaresMember"
    if (!isExternalBase && !beyondScope && !chosen) continue
    const decls = declOwner(member)
    const bases = basesOf(ownerCls)
    console.log(`  ${src} -> ${tgt}  conf=${r.confidence}  isExternalBase=${isExternalBase} baseBeyondRunScope=${String(md.baseBeyondRunScope ?? "-")} overrideBaseEvidence=${String(md.overrideBaseEvidence ?? "-")}`)
    console.log(`     class ${ownerCls} with-clause: ${JSON.stringify(withClauses.get(ownerCls) ?? [])}`)
    console.log(`     index bases of ${ownerCls}: ${JSON.stringify(bases)}`)
    console.log(`     index types DECLARING ${member}: ${JSON.stringify(decls)}`)
    console.log(`     the named base ${base} declares ${member}? ${projectIndex.typeMembers.get(base)?.has(member) === true}`)
    const idx = projectIndex.typeKinds.get(base)
    console.log(`     the named base ${base} kind in index: ${idx ?? "(not in index)"}`)
  }
}
