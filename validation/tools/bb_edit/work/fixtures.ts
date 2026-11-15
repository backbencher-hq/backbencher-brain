// Fixture builder for the bb_edit Phase A audit.
// Every project lives under validation/tools/bb_edit/work/fx and is indexed under
// validation/tools/bb_edit/bbdata — never the shared .bb-data.
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs"
import path from "node:path"

export const WORK = path.resolve("validation/tools/bb_edit/work")
export const FX = path.join(WORK, "fx")

function clean(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

function w(file: string, content: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

const LONG_41 = Array.from({ length: 41 }, (_, i) => `export const cell${i} = ${i}`).join("\n") + "\n"

export function buildFixtures(): Record<string, string> {
  clean(FX)
  // ── ts-basic: the primary cross-file fixture (indexed) ──────────────────
  const ts = path.join(FX, "ts-basic")
  w(path.join(ts, "package.json"), JSON.stringify({ name: "ts-basic", version: "1.0.0", type: "module" }, null, 2) + "\n")
  w(path.join(ts, "src/a.ts"), [
    "export function target(x: number): number {",
    "  return x + 1",
    "}",
    "",
    "export function helper(): number {",
    "  return target(41)",
    "}",
    "",
  ].join("\n"))
  w(path.join(ts, "src/b.ts"), 'import { target } from "./a"\n\nexport const across = target(2)\n')
  w(path.join(ts, "src/c.ts"), "const target = 3\n\nexport const local = String(target)\n")
  w(path.join(ts, "src/d.ts"), 'import * as a from "./a"\n\nexport const ns = a.target(3)\n')
  w(path.join(ts, "src/e.ts"), 'import "./a"\n\nexport const side = 1\n')
  w(path.join(ts, "src/f.ts"), 'import { target as aliased } from "./a"\n\nexport const indirect = aliased(4)\n')
  w(path.join(ts, "src/g.ts"), 'export function callerOnly(): number {\n  return 7\n}\n')
  w(path.join(ts, "src/del.ts"), "export function doomed(): number {\n  return 1\n}\n")
  w(path.join(ts, "src/used.ts"), "export function used(): number {\n  return 2\n}\n")
  w(path.join(ts, "src/uses.ts"), 'import { used } from "./used"\n\nexport const kept = used()\n')
  // a caller of `doomed` at MODULE TOP LEVEL (a cross-file call with no indexed source symbol)
  w(path.join(ts, "src/callsDoomed.ts"), 'import { doomed } from "./del"\n\nexport const topLevel = doomed()\n')

  // ── ts-multi: two same-name functions in ONE file (lineStart disambiguation)
  const multi = path.join(FX, "ts-multi")
  w(path.join(multi, "package.json"), '{ "name": "ts-multi", "version": "1.0.0" }\n')
  w(path.join(multi, "src/pick.ts"), [
    "export function pick(): number {",
    "  return 1",
    "}",
    "",
    "export function pick(): string {",
    '  return "a"',
    "}",
    "",
  ].join("\n"))

  // ── py-basic ────────────────────────────────────────────────────────────
  const py = path.join(FX, "py-basic")
  w(path.join(py, "src/target.py"), "def target(x):\n    return x + 1\n\ndef helper():\n    return target(1)\n")

  // ── rb-basic (keyword-terminated body; no formatter mapping) ─────────────
  const rb = path.join(FX, "rb-basic")
  w(path.join(rb, "src/target.rb"), "def target\n  1\nend\n\ndef helper\n  target\nend\n")

  // ── elixir (do/end body: insert-inside must refuse) ─────────────────────
  const ex = path.join(FX, "elixir-basic")
  w(path.join(ex, "src/m.ex"), 'defmodule M do\n  def target do\n    1\n  end\nend\n')

  // ── java: the indexer starts the span at the NAME (declaration widening) ─
  const java = path.join(FX, "java-basic")
  w(path.join(java, "src/com/demo/Target.java"), [
    "package com.demo;",
    "",
    "public class Target {",
    "    int target() {",
    "        return 1;",
    "    }",
    "}",
    "",
  ].join("\n"))

  // ── kotlin: name has no `name` field on the declaration node ────────────
  const kt = path.join(FX, "kotlin-basic")
  w(path.join(kt, "src/T.kt"), "fun target(): Int {\n    return 1\n}\n")

  // ── go (gofmt is installed on this machine: real formatter effect) ───────
  const go = path.join(FX, "go-basic")
  w(path.join(go, "go.mod"), "module fixture\n\ngo 1.21\n")
  w(path.join(go, "target.go"), "package fixture\n\nfunc target(x int) int {\n\treturn x + 1\n}\n\nfunc helper() int {\n\treturn target(1)\n}\n")

  // ── crlf: a CRLF TS file ────────────────────────────────────────────────
  const crlf = path.join(FX, "crlf-basic")
  w(path.join(crlf, "src/crlf.ts"), "export function target(): number {\r\n  return 1\r\n}\r\n")

  // ── nonutf8: a valid-TS file containing an invalid UTF-8 byte in a string ─
  const nonutf8 = path.join(FX, "nonutf8-basic")
  const latin = Buffer.concat([
    Buffer.from('export function target(): number {\n  return 1\n}\n\nexport const note = "caf'),
    Buffer.from([0xe9]),
    Buffer.from('"\n'),
  ])
  w(path.join(nonutf8, "src/latin.ts"), latin)

  // ── perm: an existing 0755 file for write-mode mode preservation ─────────
  const perm = path.join(FX, "perm-basic")
  w(path.join(perm, "bin/run.sh"), "#!/bin/sh\necho one\necho two\necho three\necho four\necho five\necho six\n")
  chmodSync(path.join(perm, "bin/run.sh"), 0o755)

  // ── guard: a 41-line file for the overwrite guard ────────────────────────
  const guard = path.join(FX, "guard-basic")
  w(path.join(guard, "src/long.ts"), LONG_41)
  w(path.join(guard, "src/six.ts"), "export const a = 1\nexport const b = 2\nexport const c = 3\nexport const d = 4\nexport const e = 5\nexport const f = 6\n")

  // ── batch: three planes for batch atomicity ──────────────────────────────
  const batch = path.join(FX, "batch-basic")
  w(path.join(batch, "package.json"), '{ "name": "batch-basic", "version": "1.0.0" }\n')
  w(path.join(batch, "src/a.ts"), "export function alpha(): number {\n  return 1\n}\n\nexport function common(): number {\n  return 0\n}\n")
  w(path.join(batch, "src/b.ts"), "export function beta(): number {\n  return 2\n}\n\nexport function common(): number {\n  return 0\n}\n")
  w(path.join(batch, "src/c.ts"), "export function gamma(): number {\n  return 3\n}\n")
  w(path.join(batch, "src/d.ts"), 'import { alpha } from "./a"\n\nexport const usesAlpha = alpha()\n')

  // ── stale: indexed then edited on disk before the bb_edit call ───────────
  const stale = path.join(FX, "stale-basic")
  w(path.join(stale, "package.json"), '{ "name": "stale-basic", "version": "1.0.0" }\n')
  w(path.join(stale, "src/stale.ts"), "export function target(): number {\n  return 1\n}\n\nexport function keep(): number {\n  return 2\n}\n")

  // ── rename-moved: indexed, then the symbol is renamed on disk ────────────
  const moved = path.join(FX, "moved-basic")
  w(path.join(moved, "package.json"), '{ "name": "moved-basic", "version": "1.0.0" }\n')
  w(path.join(moved, "src/moved.ts"), "export function target(): number {\n  return 1\n}\n")

  // ── noindex: never indexed — the bootstrap path ──────────────────────────
  const noindex = path.join(FX, "noindex-basic")
  mkdirSync(noindex, { recursive: true })

  // ── path-safety: an outside directory + a symlink that escapes it ────────
  const safety = path.join(FX, "path-safety")
  w(path.join(FX, "outside-secret.ts"), "export const secret = 1\n")
  w(path.join(safety, "src/inside.ts"), "export function inside(): number {\n  return 1\n}\n")
  symlinkSync("../../outside-secret.ts", path.join(safety, "src/escape.ts"))
  mkdirSync(path.join(safety, "src/real-dir"), { recursive: true })

  // ── yaml-zero: a grammar (YAML) whose key may expose no rename site ──────
  const yaml = path.join(FX, "yaml-basic")
  w(path.join(yaml, "conf.yaml"), "target: 1\nother: 2\n")

  return { ts, multi, py, rb, ex, java, kt, go, crlf, nonutf8, perm, guard, batch, stale, moved, noindex, safety, yaml, outside: path.join(FX, "outside-secret.ts") }
}

/** Rewrite a fixture file (used to simulate an external edit inside a window). */
export function edit(file: string, content: string): void {
  writeFileSync(file, content)
}

export function read(file: string): string {
  return readFileSync(file, "utf8")
}

export function exists(file: string): boolean {
  return existsSync(file)
}
