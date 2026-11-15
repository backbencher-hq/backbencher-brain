// script/m14/tmp/r7-drift-debug.ts — one-shot: why does G1's R7 check pass when
// the register still carries the csharp pType site (count 1, live 0)?
//
// The gate calls `main()` at module scope, so the only way to drive its pure
// classifier directly is a copy without that call, written next to the original
// (same directory ⇒ the same relative imports and the same ROOT).
import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const SRC = path.join(ROOT, "script/m60/verify-standing-rules.ts")
const COPY = path.join(ROOT, "script/m60/_tmp-vsr-debug.ts")

const src = readFileSync(SRC, "utf8")
const patched = src.replace(/\nmain\(\)\s*$/, "\n") + "\nexport { readJsonOrNull, SENTINEL_CENSUS, SENTINEL_REGISTER }\n"
writeFileSync(COPY, patched)

try {
  const mod: any = await import(path.join(ROOT, "script/m60/_tmp-vsr-debug.ts"))
  run(mod)
} finally {
  unlinkSync(COPY)
}

function run(mod: any) {
  const census = mod.readJsonOrNull(mod.SENTINEL_CENSUS)
  const register = mod.readJsonOrNull(mod.SENTINEL_REGISTER)
  console.log("census sites:", (census?.sites ?? []).length, "violations:", (census?.sites ?? []).filter((s: any) => s.verdict === "violation").length)
  console.log("register entries:", (register?.entries ?? []).length, "baseline:", JSON.stringify(register?.baseline))
  const keyOf = (s: any) => [s.file, s.shape, s.key ?? "-", String(s.statement ?? "").replace(/\s+/g, " ").trim()].join("\u0000")
  const live = new Map<string, number>()
  for (const s of census?.sites ?? []) live.set(keyOf(s), (live.get(keyOf(s)) ?? 0) + 1)
  for (const e of register?.entries ?? []) {
    const n = live.get(keyOf(e)) ?? 0
    if (n !== (e.count ?? 0)) console.log("DRIFT:", e.file, e.shape, e.key, "live", n, "registered", e.count)
  }
  console.log("DETAIL >>>", mod.sentinelRegisterDetail(census, register))
}


const census = mod.readJsonOrNull(mod.SENTINEL_CENSUS)
const register = mod.readJsonOrNull(mod.SENTINEL_REGISTER)
console.log("census sites:", (census?.sites ?? []).length, "violations:", (census?.sites ?? []).filter((s: any) => s.verdict === "violation").length)
console.log("register entries:", (register?.entries ?? []).length, "baseline:", JSON.stringify(register?.baseline))
const keyOf = (s: any) => [s.file, s.shape, s.key ?? "-", String(s.statement ?? "").replace(/\s+/g, " ").trim()].join("\u0000")
const live = new Map<string, number>()
for (const s of census?.sites ?? []) live.set(keyOf(s), (live.get(keyOf(s)) ?? 0) + 1)
for (const e of register?.entries ?? []) {
  const n = live.get(keyOf(e)) ?? 0
  if (n !== (e.count ?? 0)) console.log("DRIFT:", e.file, e.shape, e.key, "live", n, "registered", e.count)
}
console.log("DETAIL >>>", mod.sentinelRegisterDetail(census, register))
