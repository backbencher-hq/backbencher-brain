// The symbol key is `${fileId}:${name}:${startLine}`. This checks whether that
// is a vue-design constraint or a FAMILY identity hazard: a plain .ts file where
// a name is claimed twice on ONE line by two different owners.
import { plain, vue } from "./harness"

async function main() {
  console.log("=== K.1  the family form: .ts, two owners of one name on one line ===")
  {
    const src = "class C { a = 1 }\nconst a = 2\nexport { a }\n"
    const r = await plain(src, "/tmp/probe/K.ts")
    for (const s of r.symbols ?? []) {
      console.log(`  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(6)} owner=${String(s.ownerName ?? "-").padEnd(4)} L${s.range?.startLine} C${s.range?.startColumn}  ->  key "${s.name}:${s.range?.startLine}"`)
    }
  }
  console.log("\n  A same-line collision needs the SAME line. Construct one:")
  {
    // `class C { }` and a same-line property are hard; use the vue Options shape
    // instead — a prop and a same-named data key on one line is a real corpus shape.
    const src = `<template><p/></template>
<script>
export default { name: 'W', props: { a: String, b: Number }, data: () => ({ a: 0, b: 0 }) }
</script>`
    const r = await vue(src, "/tmp/probe/K2.vue")
    for (const s of r.symbols ?? []) {
      console.log(`  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(6)} owner=${String(s.ownerName ?? "-").padEnd(6)} L${s.range?.startLine}  ->  key "${s.name}:${s.range?.startLine}"`)
    }
  }
  console.log("\n=== K.2  the DUP-KEY ruling's own case: `props` twice, last-wins ===")
  {
    const src = `<template><p/></template>
<script>
export default { name: 'W', props: { a: String }, props: { b: Number } }
</script>`
    const r = await vue(src, "/tmp/probe/K3.vue")
    for (const s of r.symbols ?? []) {
      console.log(`  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(6)} owner=${String(s.ownerName ?? "-").padEnd(6)} L${s.range?.startLine}  ->  key "${s.name}:${s.range?.startLine}"`)
    }
  }
  console.log("\n=== K.3  a component whose prop name collides with its own method name ===")
  {
    const src = `<template><p/></template>
<script>
export default { name: 'W', methods: { a() {} }, props: { a: String } }
</script>`
    const r = await vue(src, "/tmp/probe/K4.vue")
    for (const s of r.symbols ?? []) {
      console.log(`  ${String(s.kind).padEnd(9)} ${String(s.name).padEnd(6)} owner=${String(s.ownerName ?? "-").padEnd(6)} L${s.range?.startLine}  ->  key "${s.name}:${s.range?.startLine}"`)
    }
  }
}
main()
