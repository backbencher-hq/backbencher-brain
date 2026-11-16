// M49.Sv3 svelte closeout: re-verify the Sv1 (H1-H4, M1-M4) and Sv2 (D1, D3,
// D4, D5) claims against the CURRENT tree — the review notes claim "fixed", and
// the closeout record must rest on probes, not on the notes.
import * as fs from "fs"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

type Case = { id: string; claim: string; src: string; pass: (r: any) => boolean; want: string }

const SFC = (tpl: string, script = "let value = 1; let props = {}; let user = { name: 'n' };") =>
  `<script>\n${script}\n</script>\n\n<template>\n${tpl}\n</template>\n`

const cases: Case[] = [
  {
    id: "H1",
    claim: "shorthand {value} attribute is read",
    src: SFC('  <Comp {value} />'),
    want: 'uses includes "value"',
    pass: (r) => targets(r, "uses").includes("value"),
  },
  {
    id: "H2",
    claim: "this={Comp} dynamic dispatch reads the component reference",
    src: SFC('  <svelte:component this={Comp} />', "import Comp from './Comp.svelte';"),
    want: 'instantiates/uses/references includes "Comp"',
    pass: (r) => ["instantiates", "uses", "references"].some((t) => targets(r, t).includes("Comp")),
  },
  {
    id: "H3",
    claim: "spread {...props} reads props",
    src: SFC('  <Comp {...props} />'),
    want: 'uses includes "props"',
    pass: (r) => targets(r, "uses").includes("props"),
  },
  {
    id: "M1",
    claim: "a MEMBER read inside an await block emits (the phantom \" x\" shadow used to kill it)",
    src: SFC('  {#await p}\n    <p>wait</p>\n  {:then v}\n    <p>{x}</p>\n  {/await}', "let p = Promise.resolve(1); let x = 1;"),
    want: 'uses includes "x" (the sibling shadow must not reach it)',
    pass: (r) => targets(r, "uses").includes("x"),
  },
  {
    id: "M1b",
    claim: "the then-binding is a template LOCAL: no use edge for `v` (shadowing is correct)",
    src: SFC('  {#await p}{:then v}<p>{v}</p>{/await}', "let p = Promise.resolve(1);"),
    want: 'uses does NOT include "v"',
    pass: (r) => !targets(r, "uses").includes("v"),
  },
  {
    id: "M2",
    claim: "string contents are NOT tokenized as members",
    src: SFC('  <button on:click={() => f("a=b")}>x</button>', "function f(s) { return s }"),
    want: 'no uses for "a" / "b"',
    pass: (r) => !targets(r, "uses").includes("a") && !targets(r, "uses").includes("b"),
  },
  {
    id: "M3",
    claim: "member-chain leaf not misattributed (receiver-only)",
    src: SFC("  <p>{{ user.name }}</p>"),
    want: 'uses includes receiver, leaf "name" NOT emitted as a use',
    pass: (r) => targets(r, "uses").includes("user") && !targets(r, "uses").includes("name"),
  },
  {
    id: "M4",
    claim: "inline await `then value` registers value as template-local — NO false member use",
    src: SFC('  {#await p then value}\n    <p>{value}</p>\n  {/await}', "let p = Promise.resolve(1);"),
    want: 'uses does NOT include "value" (the pre-fix leak was a false member use)',
    pass: (r) => !targets(r, "uses").includes("value"),
  },
  {
    id: "M4b",
    claim: "a MEMBER read alongside an inline-await local still emits",
    src: SFC('  {#await p then value}\n    <p>{value} {y}</p>\n  {/await}', "let p = Promise.resolve(1); let y = 1;"),
    want: 'uses includes "y" but not "value"',
    pass: (r) => targets(r, "uses").includes("y") && !targets(r, "uses").includes("value"),
  },
  {
    id: "D1",
    claim: "module-block export ranges carry SFC-relative line (not script-relative)",
    src: '<script context="module">\nexport const helper = 1;\n</script>\n\n<script>\nlet x = 1;\n</script>\n',
    want: "export `helper` startLine == 2",
    pass: (r) => (r.exports ?? []).some((e: any) => e.name === "helper" && (e.range?.startLine ?? -1) === 2),
  },
  {
    id: "D3",
    claim: "comment contents are NOT tokenized",
    src: SFC('  <p>{f(a) /* b */}</p>', "let a = 1; function f(v) { return v }"),
    want: 'no uses for "b"',
    pass: (r) => !targets(r, "uses").includes("b"),
  },
  {
    id: "D4",
    claim: "render-tag dotted target resolves to the callable leaf",
    src: SFC("  {@render helpers.row(it)}", "let it = 1; const helpers = { row: (v) => v };"),
    want: 'calls target "row" (not the namespace "helpers")',
    pass: (r) => targets(r, "calls").includes("row") && !targets(r, "calls").includes("helpers"),
  },
  {
    id: "D5",
    claim: "if / else-if / key condition heads are read",
    src: SFC('  {#if flag}<p>a</p>{:else if other}<p>b</p>{/if}\n  {#key k}<p>c</p>{/key}', "let flag = true; let other = false; let k = 1;"),
    want: 'uses includes flag, other, k',
    pass: (r) => ["flag", "other", "k"].every((t) => targets(r, "uses").includes(t)),
  },
  {
    id: "H4",
    claim: "script error positions are SFC-relative in all three dimensions",
    src: "<script>\nlet ok = 1;\nconst bad = (;\n</script>\n",
    want: "an error record exists (position sanity checked in the fixture harness)",
    pass: (r) => (r.errors ?? []).length > 0,
  },
]

function targets(r: any, type: string): string[] {
  return (r.relationships ?? []).filter((x: any) => x.type === type).map((x: any) => x.target)
}

async function main() {
  const engine: any = await import("../../../src/ast/engine")
  const p = `${ROOT}/script/m14/tmp/svelte-closeout.svelte`
  let pass = 0
  for (const c of cases) {
    fs.writeFileSync(p, c.src)
    let res: any
    try { res = await engine.ASTEngine.parseFile(p, c.src) } catch (e: any) { console.log(`ERROR ${c.id}: ${e?.message?.slice(0, 80)}`); continue }
    const ok = c.pass(res)
    if (ok) pass++
    const rel = ["uses", "calls", "instantiates", "references"].map((t) => `${t}=${JSON.stringify([...new Set(targets(res, t))])}`).join(" ")
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.id}  ${c.claim}`)
    if (!ok) console.log(`        want: ${c.want}\n        got:  ${rel}`)
  }
  fs.rmSync(p, { force: true })
  console.log(`\nsvelte closeout re-check: ${pass}/${cases.length} claims verified on the current tree`)
}
main().catch((e) => { console.error(e); process.exit(1) })
