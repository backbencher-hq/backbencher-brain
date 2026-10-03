/**
 * M60 — lua mutants for LUA-48 and LUA-49.
 *
 * A fixture that cannot fail is a comment. These three mutants each reinstate one
 * defect in the analyzer and require `script/m60/run-lua-fixtures.ts` to go RED; the
 * fourth restores the source and requires green again. Each mutant names the corpus
 * measurement that made it worth writing.
 *
 * The third one is the reason this file has three mutants and not two. LUA-49 has two
 * OPPOSITE wrong answers — do not suppress at all, and suppress forever — and a
 * fixture that only pins the first is satisfied by the second. `loop-bindings.lua`
 * carries both halves for exactly that reason (`for i = 1, 3 do i = i + 1 end` and the
 * `local after = 1` after it differ only in whether the loop has closed), so the
 * over-suppressing mutant is caught by a POSITIVE row.
 *
 * Usage: npx tsx script/m60/mutate-lua-bindings.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const SRC = path.join(ROOT, "src", "ast", "real-lua-analyzer.ts")
const RUNNER = "script/m60/run-lua-fixtures.ts"
const original = readFileSync(SRC, "utf8")

type Mutant = {
  id: string
  defect: string
  consequence: string
  /** Every needle must appear exactly once, or the mutant refuses to run. */
  find: string
  replace: string
}

const MUTANTS: Mutant[] = [
  {
    id: "LUA-48",
    defect: "`setmetatable(D, D)` publishes `extends D -> D`",
    consequence: "2 fabricated `extends` edges over the 3,252-file draw (lazy.nvim/lua/lazy/state.lua:45, trouble.nvim/lua/trouble/cache.lua:59), each at confidence 1.0 and `evidenceClass: structural`",
    find: "srcName && mtName && srcName !== mtName",
    replace: "srcName && mtName",
  },
  {
    id: "LUA-49-narrow",
    defect: "the for-clause binding is not consulted at all (the pre-fix state)",
    consequence: "every re-assignment of a loop variable publishes a `contains` edge for a declaration that never happened — 18 on kong's 200-file draw, 14 luarocks, 23 snacks.nvim, 1 plenary.nvim",
    find: "if ((frame.callable && frame.localNames.has(name)) || this.inOpenLoopBinding(frame, name, node.startIndex)) continue // local re-assignment",
    replace: "if (frame.callable && frame.localNames.has(name)) continue // local re-assignment",
  },
  {
    id: "LUA-49-wide",
    defect: "the loop binding is remembered for the whole function — the OPPOSITE wrong answer",
    consequence: "an assignment AFTER a closed loop stops declaring, so 18 real `contains` edges disappear on kong's 200-file draw. This is the mutant a fixture pinning only the negative half would NOT catch, and it is the one that made the first version of the fix wrong.",
    find: "if (list[i].name === name && at < list[i].endIndex) return true",
    replace: "if (list[i].name === name) return true",
  },
]

function run(): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", RUNNER, "--fixture", "loop-bindings"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: typeof e.status === "number" ? e.status : 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
}

let caught = 0
let failingRows = 0
try {
  for (const m of MUTANTS) {
    const occurrences = original.split(m.find).length - 1
    if (occurrences !== 1) {
      console.error(`mutant ${m.id}: needle appears ${occurrences} times, expected exactly 1 — the source moved and this mutant is stale.`)
      process.exitCode = 1
      continue
    }
    writeFileSync(SRC, original.replace(m.find, m.replace))
    const r = run()
    const rows = (r.out.match(/MATCHED|no actual edge matched|not found/g) ?? []).length
    failingRows += rows
    if (r.code !== 0) {
      caught++
      console.log(`  RED   loop-bindings  mutant ${m.id} — ${m.defect}`)
      console.log(`        consequence if it shipped: ${m.consequence}`)
      for (const line of r.out.split("\n").filter((l) => /MATCHED|no actual edge matched|not found/.test(l)).slice(0, 8)) {
        console.log(`          ${line.trim()}`)
      }
    } else {
      console.log(`  GREEN loop-bindings  mutant ${m.id} SURVIVED — the fixture does not pin this defect`)
    }
    writeFileSync(SRC, original)
  }
} finally {
  writeFileSync(SRC, original)
}

const restored = run()
console.log(`\nrestored: exit ${restored.code}`)
if (restored.code !== 0) {
  console.log("the restore is NOT clean — the source does not match the committed state")
  process.exitCode = 1
} else if (caught === MUTANTS.length) {
  console.log(`\nPASS: ${caught}/${MUTANTS.length} mutants caught and the restore is clean.`)
  console.log(`failing assertion rows observed under mutation: ${failingRows}`)
} else {
  console.log(`\nFAIL: ${caught}/${MUTANTS.length} caught.`)
  process.exitCode = 1
}