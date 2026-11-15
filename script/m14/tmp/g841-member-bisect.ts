// #841 handoff: `MailMessageBuilder.groovy`'s class body fails while NO member fails
// alone (0 of 55 — g841-member-sweep.ts), so the trigger is a combination. This
// searches for the minimal CONTIGUOUS group of members that reproduces it, by
// ascending window size, and also reports members whose individual removal fixes the
// whole body (the signature of an interaction rather than an accumulation).
//
// Every candidate is `class W { … }` built from the ORIGINAL member texts, so the
// result is a real Groovy snippet a reader can paste. Nothing is inferred: a window
// is reported only if the parser says it fails.
//
// Usage: bun script/m14/tmp/g841-member-bisect.ts <file.groovy> [--cap N]
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const MEMBER_TYPES = new Set([
  "method_declaration", "method_definition", "function_definition",
  "field_declaration", "constructor_definition",
])

async function main() {
  const file = process.argv[2]
  const capArg = process.argv.find((a) => a.startsWith("--cap="))
  const cap = capArg ? Number(capArg.split("=")[1]) : 4000
  if (!file) throw new Error("usage: bun script/m14/tmp/g841-member-bisect.ts <file.groovy> [--cap=N]")

  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const parser = await ASTEngine.getParser("groovy")
  const text = readFileSync(file, "utf8")
  const root = parser.parse(text)?.rootNode
  const dir = mkdtempSync(path.join(tmpdir(), "g841b-"))

  const members: Array<{ type: string; row: number; text: string }> = []
  const walk = (n: any): void => {
    if (MEMBER_TYPES.has(n.type)) {
      members.push({ type: n.type, row: n.startPosition.row + 1, text: n.text })
      return
    }
    for (const c of n.namedChildren ?? []) walk(c)
  }
  walk(root)
  console.log(`${path.basename(file)}: ${members.length} member(s) recovered`)

  let tests = 0
  const hash = new Map<string, boolean>()
  const fails = (subset: typeof members): boolean => {
    const key = subset.map((m) => m.row).join(",")
    const hit = hash.get(key)
    if (hit !== undefined) return hit
    if (tests >= cap) throw new Error(`test cap ${cap} reached`)
    const src = `class W {\n${subset.map((m) => m.text).join("\n")}\n}\n`
    const f = path.join(dir, "W.groovy")
    writeFileSync(f, src)
    tests++
    const bad = !!parser.parse(src)?.rootNode?.hasError
    hash.set(key, bad)
    return bad
  }

  // precondition: the whole body fails
  if (!fails(members)) {
    console.log("the whole class body does NOT fail when rebuilt as `class W { … }` — the failure needs the file's class header or imports, not the members")
    return
  }
  console.log(`whole body fails (rebuilt as class W) — searching windows…`)

  // (a) minimal contiguous window
  let found: { i: number; j: number } | null = null
  outer: for (let size = 2; size <= members.length; size++) {
    for (let i = 0; i + size <= members.length; i++) {
      const j = i + size - 1
      if (fails(members.slice(i, j + 1))) {
        found = { i, j }
        break outer
      }
    }
    if (size % 10 === 0) console.log(`  … no window of size ${size} fails yet (tests=${tests})`)
  }

  if (found) {
    const win = members.slice(found.i, found.j + 1)
    console.log(`\nMINIMAL CONTIGUOUS FAILING WINDOW: ${win.length} member(s), rows ${win[0].row}–${win[win.length - 1].row}`)
    for (const m of win) console.log(`  L${String(m.row).padStart(4)} ${m.type}  ${JSON.stringify(m.text.split("\n")[0].slice(0, 80))}`)
    // is it the pair, or does each half alone fail?
    if (win.length > 1) {
      const halves: string[] = []
      for (let k = 1; k < win.length; k++) {
        if (fails(win.slice(0, k))) halves.push(`prefix 0..${k - 1} fails`)
        if (fails(win.slice(k))) halves.push(`suffix ${k}..end fails`)
      }
      console.log(`  sub-window results: ${halves.length === 0 ? "no proper sub-window fails — the window is the minimal combination" : halves.join("; ")}`)
    }
  } else {
    console.log("\nno contiguous window of any size fails — the trigger is non-contiguous")
  }

  // (b) does removing one member fix the whole body? (interaction signature)
  const fixedBy: number[] = []
  for (let k = 0; k < members.length; k++) {
    if (!fails(members.filter((_, idx) => idx !== k))) fixedBy.push(members[k].row)
  }
  console.log(`\nmembers whose removal makes the whole body parse clean: ${fixedBy.length === 0 ? "none" : fixedBy.map((r) => `L${r}`).join(", ")}`)
  console.log(`\nparser calls: ${tests}`)
}

main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
