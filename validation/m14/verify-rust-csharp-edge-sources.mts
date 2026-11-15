import assert from "node:assert/strict"
import { ASTEngine } from "../../src/ast/engine"
import {
  compareEdgeIdentities,
  deriveCSharpEdges,
  deriveCSharpUsingReferences,
  deriveRustBareUses,
} from "../../script/m14/differential"
import { deriveRustContainsTruth } from "../../script/m14/oracles/rust-contains"
import { deriveRustImportsTruth } from "../../script/m14/rust-truth"

const rust = `
use std::{io::{Read, Write}, path::{Path, PathBuf}};
const LIMIT: usize = 3;
fn first() -> usize { LIMIT }
fn second() -> usize { LIMIT }
mod inner { fn local() { use std::borrow::Cow; } }
trait Describe { fn describe(&self); }
impl Describe for std::io::Error { fn describe(&self) {} }
`
const rustTree = (await ASTEngine.parseTree("ownership.rs", rust)).tree
try {
  assert.equal(rustTree.rootNode.hasError, false)
  const truth = deriveRustBareUses(rustTree.rootNode).filter(edge => edge.target === "LIMIT")
  assert.deepEqual(truth.map(edge => edge.from).sort(), ["first", "second"])
  const result = await ASTEngine.parseFile("ownership.rs", rust)
  for (const target of ["std::io", "std::path"]) {
    assert.ok(deriveRustImportsTruth(rustTree.rootNode).some(edge => edge.from === "(file)" && edge.target === target))
    assert.ok(result.relationships.some(edge => edge.type === "imports" && edge.source === "(file)" && edge.target === target))
  }
  assert.ok(!result.relationships.some(edge => edge.type === "imports" && ["io", "path"].includes(edge.target)))
  assert.ok(deriveRustImportsTruth(rustTree.rootNode).some(edge => edge.from === "local" && edge.target === "std::borrow"))
  assert.ok(result.relationships.some(edge => edge.type === "imports" && edge.source === "local" && edge.target === "std::borrow"))
  assert.ok(deriveRustContainsTruth(rustTree.rootNode).some(edge => edge.from === "std::io::Error" && edge.target === "describe"))
  assert.ok(result.relationships.some(edge => edge.type === "contains" && edge.source === "std::io::Error" && edge.target === "describe"))
  const actual = result.relationships.filter(edge => edge.type === "uses" && edge.target === "LIMIT")
    .map(edge => ({ label: edge.type, from: edge.source, target: edge.target }))
  assert.equal(compareEdgeIdentities(truth, actual).matched, 2)
  assert.equal(compareEdgeIdentities(truth, actual.slice(0, 1)).missing.length, 1)
} finally {
  rustTree.delete()
}

const csharp = `
using System;
#if EXAMPLE
namespace Example {
    class Base {
        protected Base(int number) {}
        object Create() { return new System.Text.StringBuilder(); }
    }
    class Outer { class Child : Base { public Child() : base(1) {} } }
}
#endif
`
const csTree = (await ASTEngine.parseTree("Ownership.cs", csharp)).tree
try {
  assert.equal(csTree.rootNode.hasError, false)
  const truth = [
    ...deriveCSharpUsingReferences(csTree.rootNode),
    ...deriveCSharpEdges(csTree.rootNode).filter(edge => edge.target === "base" || edge.label === "extends" || edge.label === "instantiates"),
  ]
  assert.deepEqual(truth, [
    { label: "references", from: "Base", target: "System" },
    { label: "extends", from: "Outer.Child", target: "Base" },
    { label: "calls", from: "constructor", target: "base" },
    { label: "instantiates", from: "Create", target: "System.Text.StringBuilder" },
  ])
  const result = await ASTEngine.parseFile("Ownership.cs", csharp)
  const actual = result.relationships.map(edge => ({ label: edge.type, from: edge.source, target: edge.target }))
  assert.equal(compareEdgeIdentities(truth, actual).matched, 4)
} finally {
  csTree.delete()
}
console.log("Rust read and C# using-reference and constructor sources verified")
process.exit(0)
