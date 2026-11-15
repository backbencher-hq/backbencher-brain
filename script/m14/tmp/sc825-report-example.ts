// #825's own reported example, measured at HEAD instead of trusted:
//   scalafix/rules/.../v3_0_0.scala:193 target=dropRight claims line 193,
//   but line 193 is `val toRemove = outerTokens` and `.dropRight(...)` is on 197.
//
// Prints every lined relationship in the file with the source text of the line
// it claims, so "the call is written here" is checkable by eye (Tier A's
// predicate is applied too, so this cannot disagree with the oracle silently).
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const FILES = [
  "/home/ishaq2321/bb_tests/repositories/cats-effect/scalafix/rules/src/main/scala/fix/v3_0_0.scala",
]

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
function boundaryRe(token: string): RegExp {
  return new RegExp(`(^|[^\\w])\\$?${escapeRe(token)}([^\\w]|$)`)
}
function tokenOf(target: unknown): string | null {
  if (typeof target !== "string") return null
  const s = target.trim().split("(")[0].split("<")[0]
  const parts = s.split(".")
  const last = parts[parts.length - 1].replace(/^[`"[]+/, "").replace(/[`"\]]+$/, "")
  return last && /^[\w$#:@-]+$/.test(last) ? last : null
}

async function main() {
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const authored = process.argv[2]
  const files = authored ? [path.resolve(authored)] : FILES
  for (const f of files) {
    const text = readFileSync(f, "utf8")
    const lines = text.split("\n")
    const res: any = await ASTEngine.parseFile(f, text)
    const rels: any[] = (res?.relationships ?? []).filter((r: any) => typeof r?.line_number === "number" && r.line_number > 0)
    let bad = 0
    console.log(`\n=== ${path.basename(f)} — ${rels.length} lined relationship(s) ===`)
    for (const r of rels) {
      const ln = r.line_number
      const src = (lines[ln - 1] ?? "<out of range>").trim()
      const tok = tokenOf(r.target ?? r.to)
      const ok = tok ? boundaryRe(tok).test(lines[ln - 1] ?? "") : null
      if (ok === false) bad++
      console.log(
        `${String(ln).padStart(4)} ${ok === false ? "INCONSISTENT" : ok === true ? "consistent  " : "uncheckable "} ` +
          `${String(r.type).padEnd(12)} ${String(r.source).padEnd(24)} -> ${String(r.target)}`,
      )
      console.log(`      src[${ln}] = ${JSON.stringify(src.slice(0, 110))}`)
    }
    console.log(`--- ${path.basename(f)}: ${bad} inconsistent of ${rels.length}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
