import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const vueLang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-vue.wasm")))
  const p = new P(); p.setLanguage(vueLang)
  const src = `<template>
  <MyComp :label="label" @click="onSave" v-if="show" />
  <div v-for="item in items" :key="item.id">{{ item.name }}</div>
</template>
<script>
export default {
  name: "Demo",
  props: ["title"],
  data() { return { count: 0 }; },
  methods: {
    onSave() { this.save(this.count); }
  }
};
</script>`
  const root = p.parse(src).rootNode
  const dump = (n: any, d: number, out: string[]) => {
    out.push("  ".repeat(d) + n.type + (n.isNamed ? "" : " (anon)") + " = " + JSON.stringify(n.text.slice(0, 44).replace(/\n/g, "\\n")))
    const lim = d < 3 ? 12 : 6
    for (let i = 0; i < n.namedChildCount && i < lim; i++) dump(n.namedChild(i), d + 1, out)
  }
  const out: string[] = []
  dump(root, 0, out)
  console.log(out.slice(0, 75).join("\n"))
}
main()
