## The finding (found by DEPTH, not by the canonical draw)

The canonical 60-file dart-http draw is clean. The **full extent** (335/335 files, sample hash `2dee60fd89aee7be`) was not:

```
[dart-http] dart: files=335 tree-truth=13628 covered=13627 (100%) MISSING=1 | analyzer-edges=12708 unexplained=27 (0.2%) heuristic=0
  MISSING     …/native_cupertino_bindings.dart  calls (expr) -> as
  UNEXPLAINED …/native_cupertino_bindings.dart  instantiates alloc -> NSCondition (line 801)   [×27, same shape]
```

## Triage against the source text (not against either side's output)

`pkgs/cupertino_http/lib/src/native_cupertino_bindings.dart:801` is `return NSCondition.fromPointer($ret, retain: false, release: true);` inside `static NSCondition alloc()`, and `:776` declares `NSCondition.fromPointer(...) : object$ = …` — a **named constructor**. So the analyzer's 27 `instantiates` edges are **correct**, and the truth instrument was under-deriving them. The one MISSING edge is the same root cause from the other side: for `NSURLSessionDataDelegate.as(builder.build(...))` (line 7301 — `as` is the FFI bindings' own named constructor), the oracle's fall-through published the keyword `as` as a call target because it did not recognize `NSURLSessionDataDelegate.as` as a named constructor at all.

## Root cause

`deriveDartEdges`' named-constructor prescan walked up from each constructor signature looking **only for `class_definition`**. These bindings declare their whole surface as Dart 3 `extension type` containers:

```
740  constructor_signature  dids=[NSCachedURLResponse,as]  chain=method_signature>class_body>extension_type_declaration>program
```

Registered named constructors for that file: **0 of 159**. The analyzer's set is built from SYMBOLS — and an `extension type` has been a container with owned members since DARTD21 — so the two sides disagreed on every named-constructor call inside one.

## The fix (this round)

The prescan accepts `extension_type_declaration` as a constructor-owning container (its name via `childForFieldName("name")` / first `identifier`), mirroring DARTD21 and the oracle's existing extension-type container branch. Oracle-side only; the analyzer was not touched.

Same file, after: analyzer-only 0, oracle-only 0 (`script/m14/tmp/dt-extent-triage.ts`). Full extent, after: `tree-truth=13654 covered=13654 MISSING=0 | analyzer-edges=12708 unexplained=0 (0%)` — truth 13,628 → 13,654 (+27 instantiates, −1 keyword `calls`) with the analyzer's edge count **unmoved** at 12,708, i.e. the truth learned to explain edges the analyzer had been emitting correctly all along.
