/**
 * dart-index-shape-probe — WHAT THE DART PROJECT INDEX ACTUALLY NAMES, AND WHETHER A FIXED SPEC
 * NAMES THE MIXINS.
 *
 * ## WHAT IT IS FOR
 *
 * The `--index` production arm reads extFAIL 86, and every named row is an `overrides` row whose
 * base is a Dart MIXIN. The diagnosis turned on one question: **does the dart project index name
 * mixin declarations at all?**
 *
 * The answer was NO, and the reason is the grammar: the generic index builder reads a declaration's
 * name with `node.childForFieldName("name")`, and Dart's `mixin_declaration` has NO `name` field —
 * the mixin's name is a direct `identifier` child (`(mixin_declaration (mixin) (identifier)
 * (class_body))`, probed). So `DART_DECLARATION_SPEC` indexed the mixin SHAPE and held NOTHING for
 * its name — the failure mode `project-index.ts`'s own header names for a spec that does not match
 * the grammar.
 *
 * MEASURED on dart-http before the fix: `typeKinds` census `class 524 · extension_type 278 ·
 * extension 183 · enum 16 · unknown 11` — **`mixin 0`** — and `typeKinds.has("TerminatableMixin")
 * === false`.
 *
 * ## WHAT THIS PROBE DOES
 *
 * It builds the index TWICE — once with the spec as committed, once with a `nameResolver` added —
 * and prints both censuses, so the effect of the one-line spec change is a measurement rather
 * than an argument. It also prints the MEMBER sets, because the analyzer's fix depends on the index
 * knowing which mixin DECLARES a member (`typeMembers`), not merely that the mixin exists.
 *
 * It emits NOTHING into the analyzer and changes no count of any other tool.
 */
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { buildProjectIndexStreaming, DART_DECLARATION_SPEC } from "../../src/ast/project-index"
import type { DeclarationSpec } from "../../src/ast/project-index"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const arg = (name: string): string | undefined => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : undefined
}
const REPO = arg("repo") ?? "dart-http"
const REPO_ROOT = path.join(CR, REPO)
const WASM = path.join(ROOT, "wasm", "tree-sitter-dart.wasm")

const tracked = execFileSync("git", ["-C", REPO_ROOT, "ls-files", "*.dart"], {
  encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
}).split("\n").filter(Boolean).map((f) => path.join(REPO_ROOT, f))

const censusOf = (idx: any): string[] => {
  const c = new Map<string, number>()
  for (const [, k] of idx.typeKinds) c.set(k, (c.get(k) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`)
}

const committed = await buildProjectIndexStreaming(WASM, tracked, DART_DECLARATION_SPEC)
console.log(`repo ${REPO}: ${tracked.length} file(s)`)
console.log(`  COMMITTED spec — typeKinds ${committed.typeKinds.size}: ${censusOf(committed).join(" · ")}`)
console.log(`    TerminatableMixin named? ${committed.typeKinds.has("TerminatableMixin")}   ClosableMixin named? ${committed.typeKinds.has("ClosableMixin")}`)

// THE CANDIDATE FIX, applied here so its effect is MEASURED and not argued. The Lead applies it to
// `src/ast/project-index.ts`; this probe only proves what it does.
const fixedSpec: DeclarationSpec = {
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
const fixed = await buildProjectIndexStreaming(WASM, tracked, fixedSpec)
console.log(`  FIXED spec — typeKinds ${fixed.typeKinds.size}: ${censusOf(fixed).join(" · ")}`)
console.log(`    TerminatableMixin named? ${fixed.typeKinds.has("TerminatableMixin")}   ClosableMixin named? ${fixed.typeKinds.has("ClosableMixin")}`)
console.log(`    TerminatableMixin members: ${JSON.stringify([...(fixed.typeMembers.get("TerminatableMixin") ?? [])].sort())}`)
console.log(`    ClosableMixin members: ${JSON.stringify([...(fixed.typeMembers.get("ClosableMixin") ?? [])].sort())}`)
console.log(`  typeMembers ${committed.typeMembers.size} -> ${fixed.typeMembers.size}   typeBases ${committed.typeBases.size} -> ${fixed.typeBases.size}`)
console.log(`  symbolNames ${committed.symbolNames.size} -> ${fixed.symbolNames.size}`)
const added = [...fixed.typeKinds.keys()].filter((n) => !committed.typeKinds.has(n))
console.log(`  names ADDED by the fix: ${added.length} (${added.slice(0, 12).join(" · ")}${added.length > 12 ? " …" : ""})`)
