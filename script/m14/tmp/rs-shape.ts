import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
const p = new P(); p.setLanguage(gl)
const src = `pub mod outer {
    pub const C: i32 = 1;
    pub fn helper() {}
    pub struct S { pub f: i32 }
    impl S {
        pub fn new() -> Self { S { f: 0 } }
        fn priv(&self) {}
    }
    pub enum E { A, B(i32) }
    pub trait T { fn m(&self); }
    mod inner { pub fn deep() {} }
}
`
const root = p.parse(src).rootNode
const sub = (n: any, d: number): void => {
  console.log("  ".repeat(d) + `${n.type}  ${JSON.stringify(n.text.slice(0,42).replace(/\n/g," "))}`)
  if (d < 4) for (const c of n.namedChildren ?? []) sub(c, d + 1)
}
sub(root, 0)
