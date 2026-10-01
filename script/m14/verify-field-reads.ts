/**
 * The repeated-field read contract.
 *
 * A tree-sitter `field("x", repeat(...))` applies the field name to EACH element
 * of the repeat, so the field appears N times on the node. `childForFieldName`
 * returns ONE node — the first — and there is no singular accessor that returns
 * them all. Reading such a field that way is not a wrong answer; it is a
 * TRUNCATED one, and nothing warns you.
 *
 * This lane shipped exactly that bug and it was the largest defect in the VB
 * analyzer. `modifierNames` read `childForFieldName("modifiers")`, so
 * `Public Overrides Sub Go()` -- which this grammar writes as
 * `modifiers: (member_modifier) modifiers: (member_modifier)` -- yielded
 * `public` and dropped `overrides`. VB writes `Public` first by convention, so the
 * one modifier that was ever read was the one least worth reading, and every
 * modifier-dependent fact in the index was wrong: `isStatic: false` on every
 * `Shared` member, ZERO `overrides` edges across 435 files, and `Const` fields
 * published as `Variable`.
 *
 * It was found by auditing a claim rather than by running a test: the
 * documentation said `overrides` was published, and it was not. The point of
 * this gate is that the NEXT instance of the class is a build failure instead of
 * a documentation discrepancy somebody has to notice.
 *
 * The check runs both ways, because both are silent:
 *
 *   1. a field the grammar REPEATS, read with `childForFieldName` — truncates.
 *   2. a field the grammar never declares, read with `childForFieldName` — always
 *      null, so the read is dead code that looks live.
 *
 * Usage: `bun run script/m14/verify-field-reads.ts` (env: BB_LANG_GRAMMAR,
 * BB_LANG_ANALYZER, and any extra analyzer sources in BB_EXTRA_ANALYZERS).
 */
import { readFileSync, existsSync } from "node:fs"

const GRAMMAR = process.env.BB_LANG_GRAMMAR ?? "grammars/tree-sitter-vbnet/grammar.js"
const ANALYZERS = (
  process.env.BB_LANG_ANALYZER ?? "src/ast/real-vb-analyzer.ts"
).split(",").filter((p) => existsSync(p))
const EXTRA = (process.env.BB_EXTRA_ANALYZERS ?? "").split(",").filter((p) => p && existsSync(p))
const SOURCES = [...ANALYZERS, ...EXTRA]

type FieldInfo = { name: string; repeatedAt: number; kinds: Set<string> }

function grammarFields(src: string): { fields: Map<string, FieldInfo>; declared: Set<string> } {
  const fields = new Map<string, FieldInfo>()
  const bump = (name: string, kind: string) => {
    const f = fields.get(name) ?? { name, repeatedAt: 0, kinds: new Set<string>() }
    f.repeatedAt++
    f.kinds.add(kind)
    fields.set(name, f)
  }
  // form 1: field("x", repeat(...)) / repeat1(...) -- the field NAME is applied to
  // each element, so the field repeats.
  for (const m of src.matchAll(/field\("([a-z_]+)",\s*repeat[0-9]*\(/g)) bump(m[1], "field-over-repeat")
  // form 2: repeat(field("x", ...)) -- the same thing written the other way round.
  for (const m of src.matchAll(/repeat[0-9]*\(\s*field\("([a-z_]+)"/g)) bump(m[1], "field-inside-repeat")
  // every field the grammar declares at all, for the dead-read direction
  const declared = new Set([...src.matchAll(/field\("([a-z_]+)"/g)].map((m) => m[1]))
  return { fields, declared }
}

type Read = { file: string; line: number; field: string; text: string }

function singularFieldReads(src: string, file: string): Read[] {
  const out: Read[] = []
  const lines = src.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    // A read quoted inside a COMMENT is documentation, not code, and reporting it
    // as a finding makes the gate's own output untrustworthy -- the first run
    // flagged the comment that documents this exact bug.
    const t = l.trim()
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue
    // only the SINGULAR accessor, and only by field name
    for (const m of l.matchAll(/childForFieldName(?:ById)?\("([a-z_]+)"\)/g)) {
      out.push({ file, line: i + 1, field: m[1], text: l.trim().slice(0, 100) })
    }
  }
  return out
}

/** A read of a repeated field is only dangerous if it is used to ENUMERATE. */
function readsWholeField(text: string): boolean {
  // `for (const c of this.kids(node.childForFieldName("x")))` enumerates, and a
  // single node cannot enumerate. A read used for a null check or a single
  // presence test is legitimate on a repeated field -- it means "is there one".
  return /(for\s*\(\s*(const|let)\b|,\s*\.map\(|\.forEach\(|allKids|\.length)/.test(text)
}

function main() {
  if (SOURCES.length === 0) {
    console.error("no analyzer source found; set BB_LANG_ANALYZER")
    process.exit(3)
  }
  const g = grammarFields(readFileSync(GRAMMAR, "utf8"))
  const reads: Read[] = []
  for (const f of SOURCES) reads.push(...singularFieldReads(readFileSync(f, "utf8"), f))

  const repeated = [...g.fields.values()].sort((a, b) => b.repeatedAt - a.repeatedAt)
  const byField = new Map<string, Read[]>()
  for (const r of reads) {
    if (!byField.has(r.field)) byField.set(r.field, [])
    byField.get(r.field)!.push(r)
  }

  const violations: string[] = []
  const warnings: string[] = []

  console.log(`repeated-field read contract  (${GRAMMAR} vs ${SOURCES.join(", ")})`)
  console.log(`  fields the grammar declares        ${g.declared.size}`)
  console.log(`  fields the grammar REPEATS         ${repeated.length}`)
  for (const f of repeated) console.log(`      ${String(f.repeatedAt).padStart(3)}x  ${f.name}  (${[...f.kinds].join(", ")})`)
  console.log(`  singular field reads found         ${reads.length}`)
  console.log("")

  for (const f of repeated) {
    const rs = byField.get(f.name) ?? []
    for (const r of rs) {
      if (readsWholeField(r.text)) {
        violations.push(
          `${r.file}:${r.line}  reads the REPEATED field "${f.name}" with childForFieldName and enumerates it: ` +
            `${r.text}\n    -> the grammar declares this field ${f.repeatedAt}x; the singular accessor returns the FIRST.`,
        )
      } else {
        warnings.push(
          `${r.file}:${r.line}  reads the repeated field "${f.name}" with childForFieldName, but only as a presence test: ${r.text}`,
        )
      }
    }
  }

  // the other direction: a read of a field the grammar never declares is dead
  const dead = reads.filter((r) => !g.declared.has(r.field) && !g.fields.has(r.field))

  if (violations.length) {
    console.log(`VIOLATIONS (${violations.length}) — a repeated field read as if it were singular:`)
    for (const v of violations) console.log("  " + v)
    console.log("")
  }
  if (warnings.length) {
    console.log(`presence tests on repeated fields (${warnings.length}) — legal, listed so the choice is visible:`)
    for (const w of warnings) console.log("  " + w)
    console.log("")
  }
  if (dead.length) {
    console.log(`DEAD READS (${dead.length}) — the field is not declared by the grammar, so this always returns null:`)
    for (const d of dead) console.log(`  ${d.file}:${d.line}  "${d.field}"  ${d.text}`)
    console.log("")
  }

  if (violations.length > 0 || dead.length > 0) {
    console.error(`${violations.length} violation(s), ${dead.length} dead read(s). See docs/vb.md.`)
    process.exit(2)
  }
  console.log(
    `ok — ${repeated.length} repeated field(s) are all read safely, and every singular read names a field the grammar declares`,
  )
}

main()
