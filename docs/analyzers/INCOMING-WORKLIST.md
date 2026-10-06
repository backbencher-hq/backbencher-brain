# INCOMING WORKLIST — the fix class the gate found, per lane

Produced by `script/m14/incoming-gate.ts` with its worklist output. Each entry is a real
colliding target string with its declaration count, over a 60-file stride sample through
production `parseFile`. Ambiguous is counted by **declaration**.

Read this before choosing work. The first three lanes share ONE root cause, and it is not
per-lane at all.

## The shared root cause: the module symbol is basename-scoped

| lane | colliding targets | cause |
|---|---|---|
| **yaml** | `selinuxoptions1.apiVersion`, `.metadata`, `.spec.containers[0].image` — **20 of 1,519 edges** | two corpus files whose basename is `selinuxoptions1`; the document symbol both publish is the same string, and every qualified path under it inherits the collision |
| **json** | `package.name`, `package.dependencies`, `meta.pages`, `package.private` | every `package.json` in the corpus publishes a module symbol named `package`. `package.dependencies` alone carries **3 declarations** |
| **sql** | `immutable_columns` (**5 declarations**), `update_time_column` (**6**), `read_only_auth_password_argon2_conf` | members published with NO owner path at all, so the same function name in 6 files is one node |

This is cause A in its purest form and it is the cheapest large win available: **publish the
document/module symbol under a path-scoped name, not a basename-scoped one.** A qualifier
that is unique per file — the repo-relative path, or a short hash of it — removes the
collision at the root, and every qualified path beneath it stops colliding with it.

Note what this does NOT require: it does not require changing any edge target. If the
qualified paths under the module are already derived from the module's name, then changing
the module's name moves the whole subtree with it. Check that before assuming otherwise —
`fsharp` measured that `extractLeaf` (`parallel-indexer.ts:3867`) strips a qualified
spelling back to the bare leaf for INSERT-TIME resolution, so publishing a qualified
symbol name does not change what the store matches; it changes what `qualified_name` and the
edge `target_external` say, which is what the global resolution strategies and
`bb_impact` read.

## Closest to a PASS

| lane | edges | amb | unres | what stands between it and PASS |
|---|---|---|---|---|
| **yaml** | 1,519 | 20 | 0 | one basename collision |
| **protobuf** | 8,841 | 430 | 778 | — |
| **json** | 22,256 | 222 | 0 | basename collision (`package`) |
| **sql** | 1,136 | 24 | 516 | unowned members |
| **toml** | 1,351 | 569 | 0 | — |

yaml is 20 edges from PASS and has zero unresolved. It is the lane that proves this gate can
return PASS, which matters more than its size: a gate that has never gone green is still
unproven.

## External marking — the other half of `unresolved`

Only four lanes mark external targets at all. An unmarked stdlib name, cmdlet or file path
counts against a lane, because a genuinely-external target and a broken edge are otherwise
indistinguishable.

    markdown 1,602      zig 721      julia 134      nim 64      (everything else: 0)

Recognised keys, from the committed analyzers:
`zigExternalRef` (zig), `nimStdlibModule` (nim), and the lane-defined
`isExternal` / `isExternalTarget` / `external` / `externalRef` / `isStdlib` /
`stdlibModule` / `moduleNamingEdges` / `markAsExternal`.

Marking is **additive metadata** and costs zero edges. A lane that marks nothing and
reports a large `unresolved` should ask whether those targets are external before it asks
why they do not resolve.

## What a PASS does not mean

Resolution only. An edge can resolve to the **wrong** declaration and this gate will call it
resolved. That is `script/m14/differential.ts`'s question, untouched here. When you change a
published name, pin it with a fixture and a mutant that fails when the old behaviour
returns.

## Run it

    npx tsx script/m14/incoming-gate.ts <lang> <ext> [maxFiles]
    npm run audit:incoming-gate -- <lang> <ext> [maxFiles]
    npx tsx script/m14/incoming-gate.ts --all [maxFiles]
