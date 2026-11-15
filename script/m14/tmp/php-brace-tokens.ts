// Does the pinned grammar distinguish `$o->NAME` from `$o->{NAME}`? Both have a
// `name` field, so if the braces are not visible in the tree the two shapes are
// indistinguishable and any rule keyed on the field alone must treat them the
// same. Prints EVERY child (anonymous included) for both spellings.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const SRC = `<?php
function f($o, $v, $k) {
  $a = $o->NAME;
  $b = $o->{NAME};
  $c = $o->$v;
  $d = $o->{$v};
  $e = $o->{'lit'};
  $g = $o->{2};
  $h = $o->{$k[0]};
  $i = $o->NAME[0];
  $j = $o?->NAME;
}
const NAME = 'n';
`
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(SRC).rootNode
  const walk = (n: any) => {
    if (n.type === "member_access_expression" || n.type === "nullsafe_member_access_expression" || n.type === "subscript_expression") {
      const kids: string[] = []
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        kids.push(`${c.isNamed ? "" : "~"}${c.type}${c.text.length <= 10 ? `(${JSON.stringify(c.text)})` : ""}`)
      }
      console.log(`${n.type} ${JSON.stringify(n.text)}  children: ${kids.join(" ")}`)
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
}
main()
