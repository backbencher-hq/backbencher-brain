import { readFileSync } from "node:fs"
import * as path from "node:path"
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const p = new WSP()
p.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

const CASES: [string, string][] = [
  ["for-word", `for NAME in a b c; do echo "$NAME"; done\n`],
  ["for-noin", `for NAME; do echo "$NAME"; done\n`],
  ["for-cstyle", `for ((i=0; i<3; i++)); do echo $i; done\n`],
  ["read-plain", `read line\n`],
  ["read-flags", `read -r -p "Name: " reply\n`],
  ["read-prompt-word", `read -p "Name: " reply\n`],
  ["read-ifs-prefix", `IFS='/:' read -ra args <<< "$1"\n`],
  ["read-bundle-tO", `mapfile -tO 3 cvsroots <CVS/Root\n`],
  ["mapfile", `mapfile -t lines < "$f"\n`],
  ["readarray", `readarray -t arr < "$f"\n`],
  ["printf-v", `printf -v out '%s' "$x"\n`],
  ["printf-v-plain", `printf -v out "%s\\n" hi\n`],
  ["read-dest", `read -d '' blob\n`],
  ["local-read", `f() { read -r x; echo "$x"; }\n`],
  ["declare-read", `declare -a a; read -a a\n`],
  // ---- adversarial: shapes that must DECLINE, not fabricate
  ["adv-printf-v-expansion", `printf -v "$2" '%s' "$REPLY"\n`],
  ["adv-printf-v-missing", `printf -v\n`],
  ["adv-read-no-target", `read\n`],
  ["adv-read-expansion-target", `read "$target"\n`],
  ["adv-read-concat-target", `read pre\${n}fix\n`],
  ["adv-for-subscript", `for arr[i]; do echo x; done\n`],
  ["adv-read-subsub", `read -u \${fd} x\n`],
  ["adv-mapfile-expansion", `mapfile -t "$name"\n`],
  ["adv-read-in-comment", `# read x\necho "$x"\n`],
  ["adv-read-in-string", `echo "read x"\n`],
  ["adv-read-in-heredoc", `cat <<'EOF'\nread x\nEOF\n`],
  ["adv-read-glob-target", `read *.txt\n`],
  ["adv-printf-v-then-only-word", `printf -v\n`],
  ["adv-read-p-then-eof", `read -p\n`],
  // ---- bundled options: the value can live INSIDE the bundle, not after it
  ["bundle-u3", `read -u3 name\n`],
  ["bundle-n5", `read -n5 name\n`],
  ["bundle-t10", `read -t10 name\n`],
  ["bundle-ra", `read -ra args\n`],
  ["bundle-tO", `mapfile -tO 3 cvsroots\n`],
  ["bundle-rp", `read -rp "Name: " reply\n`],
  ["bundle-prompt-word", `read -p Enter value extra_target\n`],
  // ---- is the printf -v node-TYPE guard reachable at all? These are the shapes
  // where the node is NOT a `word` AND its text could plausibly be an identifier.
  ["printf-v-subscript", `printf -v arr[0] '%s' hi\n`],
  ["printf-v-bare-expansion", `printf -v $2 '%s' hi\n`],
  ["printf-v-double-dash", `printf -- '%s' hi\n`],
  ["printf-v-concat", `printf -v pre\${n}fix '%s' hi\n`],
]

const dump = (n: any, d = 0): string => {
  const field = ""
  let s = `${"  ".repeat(d)}${n.type}${field}`
  if (n.namedChildCount === 0 && n.text.length <= 24 && n.text.trim()) s += `  ${JSON.stringify(n.text)}`
  s += "\n"
  for (let i = 0; i < n.childCount; i++) s += dump(n.child(i), d + 1)
  return s
}
for (const [name, src] of CASES) {
  const t = p.parse(src)
  console.log(`\n===== ${name} :: ${JSON.stringify(src)}`)
  console.log(dump(t.rootNode))
  t.delete?.()
}