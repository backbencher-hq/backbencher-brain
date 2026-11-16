/**
 * JAVASCRIPT FIELD-OWNER CENSUS — does a file give one field name to more than one class, and does a
 * member read inside a class that never wrote the field get another class's type?
 *
 * WHY THIS FILE EXISTS. `collectLocalReceiverTypes` keyed `fieldTypes` by FIELD NAME alone, so
 * `this.svc = new SvcA()` in class A was visible to a read of `this.svc` in class B, and B's member
 * call was published with `owner=SvcA` — a class B has no relationship with. The store then acts on
 * that (`claimOwnerCarryingTargets` withdraws the name binding and re-resolves inside the owner), so
 * the graph can end up with a member call bound to an unrelated class's declaration. That was fixed
 * by keying the map by class; this instrument is how the population was sized, committed so the
 * number is reproducible rather than quoted.
 *
 * THE DISCIPLINE. The census walks the TREE and never asks the analyzer for the field map. An
 * instrument that asks the analyzer "what types did you give this field?" inherits the defect it is
 * measuring — the shared-premise failure this lane records for X1. The analyzer is consulted only for
 * which rows it published, which is the question.
 *
 * WHAT IT COUNTS, per file:
 *   writes            `this.<f> = new T()` inside a class declaration, per (field -> classes, types)
 *   crossClassReads   `this.<f>.<m>` reads inside a class that never writes `<f>`, where exactly one
 *                     other class does — the owner published there is the OTHER class's type
 *   correctReads      the same read inside a class that DOES write the field
 *
 * A cross-class read is not automatically a wrong EDGE: the owner only binds if that class declares
 * the member. It is the population of rows carrying a false owner claim, which is what this lane can
 * decide without a full index.
 *
 * READ-ONLY. Writes one artifact under validation/m14/tmp/.
 *
 *   bun run script/m14/javascript-field-owner-census.ts --repo=<dir> [--sample=400] [--json=<out>]
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { getParser } from "../../src/ast/engine"

const ROOT = process.cwd()
const SIZE_CAP = 512 * 1024

function argOf(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1] ?? null
  const hit = argv.find((a) => a.startsWith(flag + "="))
  return hit ? hit.slice(flag.length + 1) : null
}

const REPO = argOf("--repo") ?? "<corpus-root>/bb_tests/repositories/bootstrap"
if (!existsSync(REPO)) {
  console.error(`field-owner-census: corpus not found at ${REPO} (pass --repo=<dir>)`)
  process.exit(2)
}
const SAMPLE = Number(argOf("--sample") ?? 400)
const JSON_OUT = argOf("--json")

/** the class declaration a node sits in, or null. A `method_definition` is NOT a boundary: it is
 *  where a constructor writes `this.<f>`, so treating it as one would find no writes at all. */
function enclosingClass(n: any): { name: string; node: any } | null {
  for (let p = n.parent; p; p = p.parent) {
    if (p.type === "class_declaration") {
      const nm = p.childForFieldName("name")
      return nm ? { name: nm.text, node: p } : null
    }
    if (p.type === "function_declaration" || p.type === "function_expression" ||
        p.type === "generator_function_declaration" || p.type === "generator_function") return null
  }
  return null
}

function ctorLeaf(v: any): string | null {
  if (v?.type !== "new_expression") return null
  const c = v.childForFieldName("constructor") ?? v.namedChild(0)
  if (c?.type === "identifier") return c.text
  if (c?.type === "member_expression") return c.childForFieldName("property")?.text ?? null
  return null
}

const tracked: string[] = execFileSync("git", ["-C", REPO, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)

const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(REPO, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch {
    continue
  }
  admitted.push(rel)
}
admitted.sort()
const stride = Math.max(1, Math.floor(admitted.length / SAMPLE))
const sample: string[] = []
for (let i = 0; i < admitted.length && sample.length < SAMPLE; i += stride) sample.push(admitted[i])

const parser = await getParser("javascript")

type Totals = {
  files: number
  writes: number
  readsInClasses: number
  correct: number
  crossClass: number
  noWriter: number
  conflictFields: number
}
const t: Totals = { files: 0, writes: 0, readsInClasses: 0, correct: 0, crossClass: 0, noWriter: 0, conflictFields: 0 }
const examples: Array<Record<string, unknown>> = []

for (const rel of sample) {
  let src: string
  try {
    src = readFileSync(path.join(REPO, rel), "utf8")
  } catch {
    continue
  }
  let root: any
  try {
    root = parser.parse(src)?.rootNode
  } catch {
    continue
  }
  if (!root || root.hasError) continue
  t.files++

  type Fact = { classes: Set<string>; types: Set<string> }
  const fields = new Map<string, Fact>()
  const reads: Array<{ field: string; cls: string; line: number; member: string }> = []

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "assignment_expression") {
      const l = n.childForFieldName("left")
      const r = n.childForFieldName("right")
      const o = l?.childForFieldName?.("object")
      const p = l?.childForFieldName?.("property")
      if (o?.type === "this" && p?.type === "property_identifier") {
        const cls = enclosingClass(n)
        if (cls) {
          const fact = fields.get(p.text) ?? { classes: new Set<string>(), types: new Set<string>() }
          fact.classes.add(cls.name)
          const ty = ctorLeaf(r)
          if (ty) {
            fact.types.add(ty)
            t.writes++
          }
          fields.set(p.text, fact)
        }
      }
    }
    const isRead = n.type === "call_expression" || n.type === "member_expression"
    if (isRead) {
      const fn = n.type === "call_expression" ? n.childForFieldName("function") : n
      if (fn?.type === "member_expression") {
        const inner = fn.childForFieldName("object")
        if (inner?.type === "member_expression") {
          const io = inner.childForFieldName("object")
          const ip = inner.childForFieldName("property")
          const op = fn.childForFieldName("property")
          if (io?.type === "this" && ip?.type === "property_identifier" && op) {
            const cls = enclosingClass(n)
            if (cls) {
              reads.push({ field: ip.text, cls: cls.name, line: n.startPosition.row + 1, member: op.text })
              t.readsInClasses++
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }

  for (const [, f] of fields) if (f.types.size > 1) t.conflictFields++

  for (const r of reads) {
    const fact = fields.get(r.field)
    if (!fact || fact.types.size === 0) {
      t.noWriter++
      continue
    }
    if (fact.classes.has(r.cls)) {
      t.correct++
      continue
    }
    if (fact.classes.size === 1) {
      t.crossClass++
      if (examples.length < 25) {
        const onlyClass = [...fact.classes][0] ?? ""
        const onlyType = [...fact.types][0] ?? ""
        examples.push({
          file: rel,
          line: r.line,
          field: r.field,
          member: r.member,
          readIn: r.cls,
          writtenIn: onlyClass,
          owner: onlyType,
          note: "the owner published is the OTHER class's field type",
        })
      }
    } else {
      // 2+ classes write it: the conflict rule withdraws it, so there is no wrong owner to count.
      t.correct++
    }
  }
}

console.log(`field-owner census — ${path.basename(REPO)}`)
console.log(`  admitted ${admitted.length}   sampled ${sample.length}   parsed clean ${t.files}`)
console.log(`  this.<f> = new T() writes (in a class)  ${t.writes}`)
console.log(`  this.<f>.<m> reads inside a class       ${t.readsInClasses}`)
console.log(`    correct owner (same class)            ${t.correct}`)
console.log(`    CROSS-CLASS (other class's type)      ${t.crossClass}  <- false owner claim`)
console.log(`    no writer at all                      ${t.noWriter}`)
console.log(`  fields written with 2+ types            ${t.conflictFields}  (withdrawn: safe)`)
for (const e of examples) console.log(`    ${JSON.stringify(e)}`)

if (JSON_OUT) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        repo: REPO,
        admittedFiles: admitted.length,
        sampledFiles: sample.length,
        parseCleanFiles: t.files,
        totals: t,
        note:
          "Class-scoped and tree-only: the instrument never asks the analyzer for the field map, so it cannot inherit the defect it measures. crossClass = a `this.<f>.<m>` read inside a class that never writes `<f>`, where exactly one other class does — the analyzer's file-level key gave that read the other class's type.",
        examples,
      },
      null,
      2,
    ),
  )
  console.log(`  artifact: ${JSON_OUT}`)
}