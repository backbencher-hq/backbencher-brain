**CLOSED — fixed at `12da50ee`, pinned in both directions (DARTD21).**

An `extension type` is a container like a class: `extension_type_declaration` dispatches into the container path (its `identifier[name]` is the symbol, `class_body[body]` the body), members resolve their owner through it, `interfaces` emits `implements` (`extension type X._(T o) implements I` in the pinned jni/objc bindings), and the `representation_declaration`'s field becomes an OWNED `property` while its NAME stays a declaration — never a read.

Corpus: 303 declarations over 4 pinned dart-http files (ok_http `bindings.dart` 169, cupertino_http 68, cronet_http 65).

Evidence:
- fixture `validation/m14/fixtures/dart/extension-type.dart` + expectation (9 symbols / 12 relationships), including the `forbid` that the fix's own first measurement wrote after it exposed a fabricated `uses Wrapper -> shape$ @26`;
- mutant `dart/extension-type-members-unowned` — **CAUGHT**;
- spec gap entry removed and `extension_type_declaration` / `representation_declaration` promoted into `handled_verified` — F6 fixture-coverage dart PASS (`handled=93 uncovered=0 deadLiterals=0`);
- the same shape had to be mirrored in the truth instrument, which is where the follow-up defect lived: the oracle's named-ctor prescan accepted only `class_definition`, so these containers' constructed-with-named-ctor calls were invisible at full extent (**#937**, fixed in the same commit; 27 unexplained + 1 MISSING → 0/0 with the analyzer's edge count unmoved at 12,708).
