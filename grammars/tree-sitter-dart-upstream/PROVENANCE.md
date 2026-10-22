# PROVENANCE — the dart grammar SOURCE this lane owns

**UPSTREAM**: https://github.com/UserNobody14/tree-sitter-dart
**COMMIT**: `be07cf7` (the source of the WIRED build's bytes)
**NEWEST AVAILABLE**: `0038280` — TWO node types ahead (`primary_constructor`,
`primary_constructor_body_signature`); 529 ids / 221 named / 23 fields.

**THIS DIRECTORY IS THE SOURCE OF THE WIRED BYTES, PROVEN BY DIGEST AND NOT BY A PATH.** The
wired artifact is `wasm/tree-sitter-dart.wasm`, sha256
`7d05aa385f3b59a6fa9c10263c1cbabcd002ca5d0880b8b9cd61b3db169d98f1` — 527 node-type ids, 222 named
ids, 219 distinct named names, 22 fields. Building THIS source at `be07cf7` and comparing the
digests gives:

| digest | value |
|---|---|
| id-order | `98855db104b0c7603bdc42cc255e9b98eeb6c73637f835690cad7994dfa7935b` |
| type-set | `c844ddcf9fe6d58f7ecd3f18166849c3bfe44d2465a2b82a084d2036b34a9560` |
| field-set | `1599dfd9ecb9f7719c296102fd845374706d9f0830a4777aaa04787be756fbdb` |

**added 0, removed 0** against the wired build. The id-order digest is the one that SURVIVES A
REBUILD, so it is the identity that binds a source to a build; a path proves nothing.

**⇒ R2 IS AVAILABLE FOR DART.** Any ruling that says "R2 was unavailable" is refuted by this
measurement. Reproduce with:

    bun run script/m14/grammar-remedy.ts prove --dir grammars/tree-sitter-dart-upstream --wired wasm/tree-sitter-dart.wasm

The `.git` directory was removed deliberately: the upstream clone is a PROVENANCE, not a
submodule, and the commit is named above. Re-clone with
`git clone https://github.com/UserNobody14/tree-sitter-dart grammars/tree-sitter-dart-upstream &&
git -C grammars/tree-sitter-dart-upstream checkout be07cf7`.
