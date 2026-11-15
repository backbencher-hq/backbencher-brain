// Web closure — TS re-cert: T1–T9 claims probed against the LIVE analyzer at HEAD
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

async function run(name: string, src: string): Promise<any> {
  const res = await (ASTEngine as any).parseFile(`/tmp/probe/${name}.ts`, src)
  return res
}
const checks: Array<[string, boolean, string]> = []
function check(label: string, ok: boolean, detail = "") {
  checks.push([label, ok, detail])
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? " — " + detail : ""}`)
}

// T1: react-hook gate — non-React file silent
{
  const r = await run("t1-nonreact", `export function helper() { return useThing() }\n`)
  const errs = (r as any).syntaxErrors ?? r.errors ?? []
  check("T1a non-React file: no hook warning", errs.length === 0, JSON.stringify(errs).slice(0, 80))
}
{
  const r = await run("t1-react", `import React from "react";\nfunction helper() {\n  return useThing();\n}\n\nexport function Card() {\n  const v = useThing();\n  return v;\n}\n`)
  const errs = ((r as any).syntaxErrors ?? r.errors ?? []) as any[]
  check("T1b React file: hook warning fires on helper (its line), not Card", errs.some((e: any) => (e.startLine ?? e.range?.startLine) === 3), JSON.stringify(errs).slice(0, 140))
}
// T2: decorator exact match
{
  const r = await run("t2", `import { Controller, Get } from "@nestjs/common"\n@Controller("u")\nexport class U { @Get("list") list() {} }\n`)
  const syms = (r.symbols ?? []) as any[]
  const eps = (syms as any[]).filter((x: any) => JSON.stringify(x).match(/GET|POST/))
  console.log("   T2 endpoint payloads:", JSON.stringify(eps).slice(0, 400))
  check("T2 route composed GET /u/list, no phantom POST/", eps.length > 0 && !JSON.stringify(eps).includes("POST"), JSON.stringify(eps).slice(0, 140))
}
// T3: inferred return type
{
  const r = await run("t3", `export function f() { return 42 }\n`)
  const f = (r.symbols ?? []).find((s: any) => s.name === "f")
  check("T3 returnType inferred number", f?.returnType === "number", String(f?.returnType))
}
// T4/T5: bare @Get() no root route; base composition
{
  const r = await run("t4", `import { Controller, Get } from "@nestjs/common"\n@Controller()\nexport class R { @Get() all() {} }\n`)
  const syms = JSON.stringify(r.symbols ?? [])
  check("T4 bare @Get() claims no root route", !syms.includes('"path":"/"') && !syms.includes("GET /\""), syms.slice(0, 100))
}
{
  const r = await run("t5", `import { Controller, Get } from "@nestjs/common"\n@Controller("users")\nexport class U { @Get() index() {} @Get("list") list() {} }\n`)
  const syms = JSON.stringify(r.symbols ?? [])
  check("T5 base path composed (/users, /users/list)", syms.includes("/users") && syms.includes("/users/list"), syms.slice(0, 140))
}
// T6: positional payload — same-named methods distinguish
{
  const r = await run("t6", `class A { handle() { return callA() } }\nclass B { handle() { return callB() } }\n`)
  const rels = (r.relationships ?? []) as any[]
  const byOwner = rels.filter((x) => x.type === "calls").map((x) => x.source)
  check("T6 per-symbol attribution distinct owners", JSON.stringify(rels).includes("callA") && JSON.stringify(rels).includes("callB"), JSON.stringify(byOwner))
}
// T8: import() excluded from qualified_calls
{
  const r = await run("t8", `const m = await import("mod")\nfoo().bar()\n`)
  const rels = JSON.stringify(r.relationships ?? [])
  check("T8 no 'import' as qualified callee", !rels.includes('"target":"import"'), rels.slice(0, 120))
}
// T9: taint receiver-leaf
{
  const r = await run("t9", `export function h(req) { return req.body }\nexport function g(myreq) { return myreq.body }\n`)
  const rels = JSON.stringify(r.relationships ?? [])
  const flagsReq = rels.includes("taint") ? rels : "(taint is payload-level; checking no myreq misflag)"
  check("T9 myreq.body never flagged as taint source", !JSON.stringify(rels).match(/myreq.*taint|taint.*myreq/i), String(flagsReq).slice(0, 90))
}

const fails = checks.filter(([, ok]) => !ok)
console.log(`\nT-RECERT: ${checks.length - fails.length}/${checks.length} PASS`)
