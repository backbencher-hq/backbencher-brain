#!/usr/bin/env tsx
// M24.L8 — a usage count must declare the SCOPE it was measured over.
//
// THE DEFECT (found by the owner, 2026-10-07). Hovering `formatAddress` in
// `backbencher-brain/src` rendered:
//
//     **formatAddress** — function, 0 usages
//       (usage sites only; declaration and callees excluded)
//
// and that zero is CORRECT for the index — the project holds 201 files. But
// `formatAddress` is genuinely called 5 times, every one of them in
// `script/m62/`. So the number was true and the sentence was misleading: "0
// usages" with nothing after it reads as "nothing calls this", and a reader has
// no way to know the answer is bounded by what was indexed.
//
// The count line is NOT wrong. It deliberately states zero rather than going
// silent — §14 Truth Rule 1, and `hover.ts:404-406` says so. What is missing is
// the bound. A zero without its scope is a global claim wearing a local
// measurement.
//
// WHAT THIS GATES: whenever the count is rendered, the scope it was measured
// over is rendered with it. A count of zero is the case that matters — that is
// the one a reader will act on ("so nothing uses this") — so the leg is
// exercised at zero and at non-zero, and it asserts the scope appears in both,
// because a qualifier that appears only for zero would itself be misleading.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// Reproducibility: the LSP server under test resolves its index from
// `<BB_DATA_DIR || ~/.bb>/projects/<sha1(realpath(root))>/brain.db`. Without the
// variable the server targets the real `~/.bb`, and on a host where that path is
// not writable (sandboxed agent session, read-only HOME, CI container) it answers
// -32603 ENOENT and every absence-carrier path dies — a red gate about the
// environment, not the component. `??=` keeps an explicitly supplied
// BB_DATA_DIR authoritative. Same fix as script/m24/verify-server.ts and
// script/m44/verify-usages-fallback.ts.
process.env.BB_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), "bb-usage-scope-data-"))

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()
const work = mkdtempSync(path.join(tmpdir(), "bb-scope-"))
const src = path.join(work, "src")
mkdirSync(src, { recursive: true })

// Two exported functions: one nobody calls in this tree (the zero case the
// owner hit), one called three times.
writeFileSync(
  path.join(src, "lib.ts"),
  `export interface Cfg { n: number }
export function orphan(c: Cfg): number { return c.n }
export function used(c: Cfg): number { return c.n * 2 }
export function driver(c: Cfg): number { return used(c) + used(c) + used(c) }
`,
)

const { getProjectId } = await import(path.join(ROOT, "src", "util", "project-id"))
const { indexProjectParallel } = await import(path.join(ROOT, "src", "ast", "parallel-indexer"))
const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database"))
const { hover } = await import(path.join(ROOT, "src", "lsp", "hover"))

const projectId = getProjectId(src) as never
await indexProjectParallel(projectId, src as never, { logger: { log: () => {}, write: () => {} } } as never)
const raw = BrainDatabase.openByPath(BrainDatabase.getPath(projectId as never))

const file = path.join(src, "lib.ts")
const text = (await import("node:fs")).readFileSync(file, "utf8")

/** Hover the identifier `name` at its declaration and return the rendered body. */
async function hoverName(name: string): Promise<{ body: string; count: number | null; got: string | null }> {
  const line = text.split("\n").findIndex((l) => new RegExp(`function ${name}\\(`).test(l))
  if (line < 0) return { body: "", count: null, got: null }
  const col = text.split("\n")[line]!.indexOf(name) + 1
  // LSP positions are 0-BASED for the line. The first version passed
  // `line + 1`, which hovered the NEXT declaration — asking for `used` and being
  // answered for `driver`. Nothing errored; the numbers were simply about a
  // different symbol, which is why the probe now asserts the name it got back.
  await hover(raw, { filePath: file, position: { line, character: col } } as never)
  const r = await hover(raw, { filePath: file, position: { line, character: col } } as never)
  const body = String(r?.contents?.value ?? (typeof r?.contents === "string" ? r.contents : ""))
  const m = /(\d+)\s+usages?\b/.exec(body)
  // WHICH symbol came back. The first version of this fixture reported
  // `orphan` as having 1 usage and `used` as having 0 — the counts were swapped
  // because the probe was hovering the wrong declaration and nothing said so.
  // A gate that cannot name the symbol it measured will happily pass while
  // measuring the wrong thing, so the name is returned and asserted.
  const got = /\*\*([A-Za-z_$][\w$]*)\*\*/.exec(body)
  return { body, count: m === null ? null : Number(m[1]), got: got === null ? null : got[1]! }
}

// The zero case.
const zero = await hoverName("orphan")
check(
  "fixture: the probe hovered the symbol it asked for (a gate that measures the wrong symbol proves nothing)",
  zero.got === "orphan",
  `asked for "orphan", hover answered for "${zero.got}"`,
)
check(
  "fixture: a function nothing calls in this tree really does hover as 0 usages",
  zero.count === 0,
  `count parsed from the hover: ${zero.count}`,
)

// The non-zero case, so a scope qualifier cannot appear only for zero.
const nonZero = await hoverName("used")
check(
  "fixture: the probe hovered the symbol it asked for, second case",
  nonZero.got === "used",
  `asked for "used", hover answered for "${nonZero.got}"`,
)
check(
  "fixture: the called function hovers with a non-zero count",
  nonZero.count !== null && nonZero.count > 0,
  `count parsed from the hover: ${nonZero.count}`,
)

// THE LEG. The count line must carry the bound it was measured over.
const scopeWord = /\b(indexed|in the index|of the \d+ indexed|in this project|in the indexed)\b/i
check(
  "a ZERO usage count declares the scope it was measured over",
  zero.count === 0 && scopeWord.test(zero.body),
  zero.count === 0 && scopeWord.test(zero.body)
    ? `scope language present in: ${(zero.body.split("\n").find((l) => /usage/.test(l)) ?? "").slice(0, 120)}`
    : `no scope language on the count line: ${(zero.body.split("\n").find((l) => /usage/.test(l)) ?? "(none)").slice(0, 120)}`,
)
check(
  "a NON-ZERO usage count declares the same scope (a qualifier shown only for zero would mislead the other way)",
  nonZero.count !== null && nonZero.count > 0 && scopeWord.test(nonZero.body),
  `count=${nonZero.count}; scope language present: ${scopeWord.test(nonZero.body)}`,
)

// The scope must be a REAL number, not a vague word: "the indexed scope" alone
// still does not tell a reader how much was searched.
const scopeNumber = /(\d[\d,]*)\s+(?:indexed\s+)?files?\b/i
check(
  "the scope is quantified — a reader can see HOW MUCH was searched, not just that something was",
  scopeNumber.test(zero.body),
  scopeNumber.test(zero.body)
    ? `quantified scope: ${(zero.body.match(/\d[\d,]*\s+(?:indexed\s+)?files?\b/i) ?? [""])[0]}`
    : `no quantified scope on the count line: ${(zero.body.split("\n").find((l) => /usage/.test(l)) ?? "").slice(0, 120)}`,
)

// And the number must be the TRUE indexed file count, or the disclosure is a
// different kind of lie.
{
  const counted = await import("node:child_process")
  void counted
  const { default: Database } = await import("better-sqlite3")
  const probe = new Database(BrainDatabase.getPath(projectId as never), { readonly: true })
  const actual = (probe.prepare("SELECT count(*) c FROM brain_file WHERE project_id = ?").get(projectId as never) as any).c
  probe.close()
  const m = zero.body.match(/(\d[\d,]*)\s+(?:indexed\s+)?files?\b/i)
  const stated = m === null ? null : Number(m[1]!.replace(/,/g, ""))
  check(
    "the stated scope is the TRUE indexed file count (a disclosure with the wrong number is worse than none)",
    stated !== null && stated === actual,
    `stated=${stated}; actual indexed files for this project=${actual}`,
  )
}

rmSync(work, { recursive: true, force: true })
const failed = checks.filter((c) => !c.ok).length
console.log(`\nUSAGE SCOPE: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)