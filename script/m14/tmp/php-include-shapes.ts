// Probe: the php include/binary-expression shapes, so the static-path predicate
// is written against the pinned grammar rather than assumed.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const SRC = `<?php
include __DIR__ . '/helpers.php';
include $this->baseDir . 'revision-info.php';
require $dir . '/x.php';
include "{$a}/dyn.php";
include 'plain.php';
include FILE_PREFIX . '/y.php';
include __DIR__ . $suffix;
`
const tmp = path.join(ROOT, "script/m14/tmp/.php-include-shapes.php")
fs.writeFileSync(tmp, SRC)
const wasm = fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm"))
const p = new ParserClass()
p.setLanguage(await Language.load(wasm))
const tree = p.parse(SRC)!

function dump(n: any, depth = 0) {
  const fieldName = n.parent ? n.parent.fieldNameForChild?.(n.parent.children?.indexOf?.(n) ?? -1) : null
  if (n.type === "binary_expression" || n.type === "include_expression" || n.type === "require_expression" ||
      n.type === "encapsed_string" || n.type === "string" || n.type === "name" || n.type === "variable_name" ||
      n.type.endsWith("_name")) {
    console.log(`${"  ".repeat(depth)}${n.type}${fieldName ? `<${fieldName}>` : ""} ${JSON.stringify(n.text.slice(0, 60))}`)
  }
  for (const c of n.children ?? []) dump(c, depth + 1)
}
dump(tree.rootNode)
p.delete()
fs.rmSync(tmp, { force: true })
