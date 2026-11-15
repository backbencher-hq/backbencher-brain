// Sizing probe: every DYNAMIC member-name shape in the pinned php grammar, with
// both sides' edges printed. `$postParams->$param` (phpmyadmin) produced a truth
// target `uses -> $param` that no other edge in the lane can spell, while the
// analyzer emitted nothing at all — one shape, two complementary defects. The
// other spellings must be measured before either rule is touched.
import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const SRC = `<?php
class Box {
  public $plain = 1;
  public function run($param, array $arr, $key, Box $other): void {
    $a = $this->plain;
    $b = $this->$param;
    $c = $this->{$param};
    $d = $this->{$key[0]};
    $e = $other?->$param;
    $f = $other?->plain;
    $g = $this->plain->$key;
    $this->$param = 2;
    $arr[$param] = 3;
    $h = $arr[$param];
    $i = $this->{'quoted'};
    $j = $this->{CONST_NAME};
    $k = $this->{1};
    $l = $this->{$this->plain};
  }
}
const CONST_NAME = 'x';

`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const mod: any = await import("../../m14/differential")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(SRC).rootNode
  console.log("hasError:", root.hasError)
  const lineOf = (n: any) => SRC.slice(0, n.startIndex).split("\n").length
  // name-field shape of every member access
  const shapes: string[] = []
  const walk = (n: any) => {
    if (n.type === "member_access_expression" || n.type === "nullsafe_member_access_expression") {
      const nn = n.childForFieldName?.("name")
      shapes.push(`line ${lineOf(n)}  ${n.text}  nameField=${nn?.type} text=${JSON.stringify(nn?.text)}`)
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  console.log("--- member-access name fields:")
  for (const s of shapes) console.log("  " + s)
  const r: any = await new RealPhpAnalyzer().analyze(root, SRC, "probe.php")
  const az = (r.relationships ?? []).filter((x: any) => ["uses", "calls", "references"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type).toLowerCase()} ${x.source} -> ${x.target}`)
  const truth = mod.derivePhpEdges(root).map((t: any) => `${t.label} -> ${t.target}`)
  console.log("--- analyzer:", JSON.stringify([...new Set(az)].sort(), null, 0))
  console.log("--- truth   :", JSON.stringify([...new Set(truth)].sort(), null, 0))
  const norm = (s: string) => s.replace(/^\S+\s+/, "")
  const azSet = new Set(az.map(norm))
  const trSet = new Set(truth.map(norm))
  console.log("--- analyzer-only:", JSON.stringify([...azSet].filter((x) => !trSet.has(x)).sort()))
  console.log("--- oracle-only  :", JSON.stringify([...trSet].filter((x) => !azSet.has(x)).sort()))
}
main()
