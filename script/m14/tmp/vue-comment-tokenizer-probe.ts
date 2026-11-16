// M49 W3 probe: the svelte Sv2 review (D3) fixed comment tokenizing in the
// svelte template char-walk and flagged VUE's twin machine as an unscheduled
// family follow-up ("Vue's twin machine has the same hole"). Verify it live
// rather than trusting the note.
import * as fs from "fs"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const cases: { name: string; src: string }[] = [
  {
    name: "block comment inside interpolation",
    src: [
      "<template>",
      "  <div>{{ f(a) /* b */ }}</div>",
      "</template>",
      "<script>",
      "export default { data() { return { a: 1 } }, methods: { f(v) { return v } } }",
      "</script>",
      "",
    ].join("\n"),
  },
  {
    name: "line comment inside interpolation",
    src: [
      "<template>",
      "  <div>{{ url // pick }}</div>",
      "</template>",
      "<script>",
      "export default { data() { return { url: '/' } } }",
      "</script>",
      "",
    ].join("\n"),
  },
  {
    name: "comment inside a directive expression",
    src: [
      "<template>",
      "  <div v-if=\"flag /* decoy */\">x</div>",
      "  <div :title=\"title // decoy2\">y</div>",
      "</template>",
      "<script>",
      "export default { data() { return { flag: true, title: 't' } } }",
      "</script>",
      "",
    ].join("\n"),
  },
  {
    name: "control: no comments",
    src: [
      "<template>",
      "  <div>{{ f(a) }}</div>",
      "</template>",
      "<script>",
      "export default { data() { return { a: 1 } }, methods: { f(v) { return v } } }",
      "</script>",
      "",
    ].join("\n"),
  },
]

async function main() {
  const engine: any = await import("../../../src/ast/engine")
  const tmp = `${ROOT}/script/m14/tmp/vue-comment-probe.vue`
  for (const c of cases) {
    fs.writeFileSync(tmp, c.src)
    const res: any = await engine.ASTEngine.parseFile(tmp, c.src)
    const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses").map((r: any) => r.target)
    const calls = (res.relationships ?? []).filter((r: any) => r.type === "calls").map((r: any) => r.target)
    const junk = ["b", "pick", "decoy", "decoy2"].filter((t) => uses.includes(t) || calls.includes(t))
    console.log(`${junk.length ? "DEFECT " : "clean  "} ${c.name}`)
    console.log(`        uses=${JSON.stringify([...new Set(uses)])}`)
    console.log(`        calls=${JSON.stringify([...new Set(calls)])}${junk.length ? `   <-- FABRICATED FROM COMMENT TEXT: ${junk.join(", ")}` : ""}`)
  }
  fs.rmSync(tmp, { force: true })
}
main().catch((e) => { console.error(e); process.exit(1) })
