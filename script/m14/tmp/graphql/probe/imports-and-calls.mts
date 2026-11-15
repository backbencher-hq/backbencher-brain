/**
 * TWO MEASUREMENTS THE RULING TABLE NEEDS AND THE CENSUS DOES NOT CARRY.
 *
 * ## 1. `imports` — is the construct real, and is it countable?
 *
 * The census measured `A:import_node: 0` (the grammar has no import node) and
 * `B:hash_import_directive: 170 occurrences / 131 files` (the `#import "..."` convention,
 * inside `comment` nodes, which the grammar DOES produce — `A:comment_node: 4510 / 269`).
 *
 * That combination is decisive about the INSTRUMENT and not about the verdict. A grammar
 * inventory cannot see a convention written in a comment, which is exactly the reasoning
 * that produced json's wrong `exports` ruling — the gate's own comment records it, and
 * the correction was to EMIT the edge, not to rule it. So `imports` is settled by counting
 * the directives on the tree, and by answering the question the count alone cannot: do
 * these paths name files that EXIST? A convention whose paths are fiction is not an
 * import relationship; 170 comments are a weak number on their own.
 *
 * The two documented shapes, both from the corpus:
 *     #import "./fragments/bar-fragment.gql"                     (graphql-import-node)
 *     # import FooFields from "./fragments/bar-fragment.gql"      (graphql-tools / import-jsdoc)
 * A probe that matches a SHAPE rather than a ROLE produces a number and the number is worth
 * nothing — the json `$ref` ruling was overturned by exactly that. So this probe reports
 * the shape breakdown, and the executor gates on the one thing both shapes share: a quoted
 * path that resolves to a real file.
 *
 * ## 2. `calls` — is a field selection with arguments a call?
 *
 * `calls` is emitted 0 times and `uses|field_selection` 36,751 times. The rule that maps
 * one to the other is a LABELLING decision, and the census does not report the population
 * it applies to: how many `Field` nodes actually carry an `Arguments` child. If it is 0,
 * the decision is not a decision at all — there is no argument-bearing selection and the
 * question is vacuous. If it is large, the number is the honest size of the labelling
 * question, and it belongs in the ruling rather than in a comment nobody reads.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const files: { repo: string; dir: string; label: string; abs: string; text: string; hadComment: boolean }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "graphql") continue
    files.push({ repo: e, dir, label: `${e}/${rel}`, abs, text, hadComment: false })
  }
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-graphql.wasm"))))

/**
 * The `#import` forms, parsed with string operations only — the analyzer must stay
 * regex-free, so the executor in real-graphql-analyzer.ts uses these same operations
 * rather than a pattern, and this probe validates that the operations agree with a
 * pattern on this corpus (the agreement is the finding; either could be wrong alone).
 */
const IMPORT_FORMS = {
  none: 0,
  /** `#import "path"` — the whole rest is a quoted path. */
  bare: 0,
  /** `# import Name from "path"` — a binding name, then `from`, then a quoted path. */
  from_binding: 0,
  /** `# import "path" as Name` — a quoted path, then a binding. */
  as_binding: 0,
  /** the first word after `#` is not `import`, or no quoted path follows it. */
  unrecognised: 0,
}
const QUOTE = new Set([0x22, 0x27, 0x60]) // " ' `
const parseHashImport = (text: string): { form: keyof typeof IMPORT_FORMS; target?: string } => {
  let i = 0
  while (i < text.length && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09)) i++ // horizontal ws
  if (text.charCodeAt(i) !== 0x23) return { form: "none" } // '#'
  i++
  while (i < text.length && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09)) i++
  // The first word must BE `import`. A comment whose first word is anything else is not
  // an import directive at all — the first version of this probe reported
  // hashImportDirectives: 4510 == commentNodes: 4510, i.e. it counted every comment in
  // the corpus, because "first word is not import" fell through to `unrecognised` and
  // `unrecognised` was counted as a hit. A classifier with no negative case counts its
  // own input.
  for (let k = 0; k < 6; k++) {
    const ch = text.charCodeAt(i + k)
    if (Number.isNaN(ch) || ch !== "import".charCodeAt(k)) return { form: "none" }
  }
  i += 6
  if (i < text.length && /[A-Za-z0-9_]/.test(text[i])) return { form: "unrecognised" } // `imported`, `imports`
  const skipWs = () => {
    while (i < text.length && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09)) i++
  }
  const quoted = (): string | undefined => {
    skipWs()
    const q = text.charCodeAt(i)
    if (!QUOTE.has(q)) return undefined
    i++
    const start = i
    while (i < text.length && text.charCodeAt(i) !== q) i++
    if (i >= text.length) return undefined // unterminated
    const v = text.slice(start, i)
    i++
    return v
  }
  const first = quoted()
  skipWs()
  // `#import "x" as Name` — the next word is `as`; `#import Name from "x"` — the next word
  // is a BINDING NAME and `from` comes after it. The first version of this parser tried
  // `quoted()` first and so could not see the `from` form at all: it required a quote in
  // the first position and returned `unrecognised` for every `# import FooFields from "x"`,
  // which is 159 of the corpus's 170 directives. A parser that only recognises the shape
  // it was written for reports the other shape as absent.
  const word = () => {
    skipWs()
    const s = i
    while (i < text.length && !/[\s"'`]/.test(text[i])) i++
    return text.slice(s, i)
  }
  if (first !== undefined) {
    const after = word()
    if (after === "") return { form: "bare", target: first }
    if (after === "as") return { form: "as_binding", target: first }
    return { form: "unrecognised" }
  }
  const binding = word()
  if (binding === "") return { form: "unrecognised" }
  if (word() !== "from") return { form: "unrecognised" }
  const second = quoted()
  if (second === undefined) return { form: "unrecognised" }
  return { form: "from_binding", target: second }
}

const hits = {
  commentNodes: 0,
  commentFiles: 0,
  hashImport: 0,
  hashImportFiles: new Set<string>(),
  byForm: IMPORT_FORMS,
  forms: new Set<string>(),
  targetExistsOnDisk: 0,
  targetMissingFromDisk: 0,
  targetIsOutsideTheRepo: 0,
  targetNotAPath: 0,
  existingExamples: [] as string[],
  missingExamples: [] as string[],
  unrecognisedExamples: [] as string[],
  notAPathExamples: [] as string[],
  /** --- calls / labelling population --- */
  fieldNodes: 0,
  fieldNodesWithArguments: 0,
  fieldNodesWithArgumentsInACleanDoc: 0,
  argumentNodes: 0,
  argumentNodesOnAField: 0,
  directiveApplicationsWithArguments: 0,
  /** what the analyzer emits as `uses|field_selection`, for the ratio. */
  usesFieldSelection: 0,
  filesWithArgumentBearingField: new Set<string>(),
}

for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  let dirty = 0
  const visit = (n: any) => {
    if (n.type === "ERROR" || n.isMissing) dirty++
    if (n.type === "comment") {
      hits.commentNodes++
      const r = parseHashImport(n.text)
      if (r.form !== "none") {
        f.hadComment = true
        hits.hashImport++
        hits.hashImportFiles.add(f.label)
        hits.byForm[r.form]++
        hits.forms.add(r.form)
        if (r.form === "unrecognised" && hits.unrecognisedExamples.length < 10) {
          hits.unrecognisedExamples.push(`${f.label}: ${JSON.stringify(n.text.slice(0, 90))}`)
        }
        if (r.target !== undefined) {
          // A bare `b.graphql` IS a path — the graphql-import convention resolves the
          // target against the importing document's directory, so `./` is optional. The
          // first version of this probe tested only for a leading `.` or `/` and
          // classified 59 of the 170 directives as "not a path", including every one of
          // graphql-tools' own import fixtures. A path test stricter than the convention
          // it is measuring undercounts the convention.
          const isUrl = r.target.indexOf("://") !== -1 || r.target.charAt(0) === "@" && r.target.indexOf("/") !== -1
          if (!isUrl) {
            const abs = path.resolve(path.dirname(f.abs), r.target)
            if (!abs.startsWith(path.resolve(f.dir) + path.sep)) hits.targetIsOutsideTheRepo++
            else if (existsSync(abs)) {
              hits.targetExistsOnDisk++
              if (hits.existingExamples.length < 8) hits.existingExamples.push(`${f.label} -> ${r.target} [${r.form}]`)
            } else {
              hits.targetMissingFromDisk++
              if (hits.missingExamples.length < 8) hits.missingExamples.push(`${f.label} -> ${r.target} [${r.form}]`)
            }
          } else {
            hits.targetNotAPath++
            if (hits.notAPathExamples.length < 10) hits.notAPathExamples.push(`${f.label} -> ${r.target} [${r.form}]`)
          }
        }
      }
    }
    if (n.type === "Field") {
      hits.fieldNodes++
      let hasArgs = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c?.type === "Arguments") hasArgs = true
        if (c?.type === "Argument") {
          hits.argumentNodesOnAField++
          hasArgs = true
        }
      }
      if (hasArgs) {
        hits.fieldNodesWithArguments++
        hits.filesWithArgumentBearingField.add(f.label)
      }
    }
    if (n.type === "Argument") hits.argumentNodes++
    if (n.type === "Directive") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c?.type === "Arguments") {
          hits.directiveApplicationsWithArguments++
          break
        }
      }
    }
    if (n.type === "Field" && dirty === 0) {
      // counted below in a second pass instead: `dirty` is only final at the end
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(t.rootNode)
  // A second, cheap pass for the clean-document variant, now that `dirty` is final.
  if (dirty === 0) {
    const again = (n: any) => {
      if (n.type === "Field") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c?.type === "Arguments") {
            hits.fieldNodesWithArgumentsInACleanDoc++
            break
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) again(c)
      }
    }
    again(t.rootNode)
  }
  hits.commentFiles += f.hadComment ? 1 : 0
  t.delete?.()
}

const out = {
  kind: "m60-imports-and-calls-measurement",
  producedBy: "script/m14/tmp/graphql/probe/imports-and-calls.mts",
  corpusRoot: CR,
  admittedFiles: files.length,
  imports: {
    commentNodes: hits.commentNodes,
    commentFiles: hits.commentFiles,
    hashImportDirectives: hits.hashImport,
    hashImportFiles: hits.hashImportFiles.size,
    byForm: hits.byForm,
    formsObserved: [...hits.forms].sort(),
    targetExistsOnDisk: hits.targetExistsOnDisk,
    targetMissingFromDisk: hits.targetMissingFromDisk,
    targetIsOutsideTheRepo: hits.targetIsOutsideTheRepo,
    targetNotAPath: hits.targetNotAPath,
    existingExamples: hits.existingExamples,
    missingExamples: hits.missingExamples,
    unrecognisedExamples: hits.unrecognisedExamples,
    notAPathExamples: hits.notAPathExamples,
  },
  calls: {
    fieldNodes: hits.fieldNodes,
    fieldNodesWithArguments: hits.fieldNodesWithArguments,
    fieldNodesWithArgumentsInACleanDoc: hits.fieldNodesWithArgumentsInACleanDoc,
    filesWithArgumentBearingField: hits.filesWithArgumentBearingField.size,
    argumentNodes: hits.argumentNodes,
    argumentNodesOnAField: hits.argumentNodesOnAField,
    directiveApplicationsWithArguments: hits.directiveApplicationsWithArguments,
  },
}
console.log(JSON.stringify(out, null, 1))