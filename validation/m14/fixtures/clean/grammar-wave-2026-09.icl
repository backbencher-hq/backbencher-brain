// Clean fixture: the three node types the 2026-09-29 grammar wave added.
//
// All three are grammar-SOURCE changes, so this fixture exists to pin the
// analyzer's reading of them rather than to pin a new analyzer feature. Each
// one was unreadable at grammar v1.2.7, and each was found by measuring parse
// health over the 2,179-file union corpus, not by reading the language spec.
//
//   foreign_code_import / foreign_code_item
//     `import code from "ctty.o"` — 30 corpus files (CleanSerial,
//     clean-graph-copy, clean-ide/Mac, the ObjectIO FCI layers). It names
//     OBJECT FILES and LIBRARIES, not a Clean module, so there is no module to
//     bind and the analyzer emits no `imports` edge for it. That is a
//     DECISION, and the fixture pins the decision by pinning the published
//     metadata counter `foreignCodeImports` — a decision that is not counted is
//     indistinguishable from a gap. The `library "..."` spelling is included
//     because it is a separate item form under the same declaration.
//
//   let_group
//     `let { (BoxP p) = gtk } in p` — 53 corpus files, and the whole Gtk FFI
//     layer is built from it. The braces look like a record pattern and are
//     NOT one: its members are ordinary patterns, which is why `(BoxP p)` is
//     legal there and illegal as a record-pattern field. The `p` below must
//     scope to the enclosing frame, which is the property this fixture is
//     really checking — a group binder that leaks to module scope would
//     publish a symbol with no owner.
//
//   record_binding
//     `where` / `{ ix, iy } = toDevicePoint s` — the record-pattern binding,
//     split out of `local_binding` by the same wave. The split is what lets a
//     brace inside a `let` be unambiguously a group. Both `ix` and `iy` must
//     scope to the frame. The brace form sits on its OWN indented line, which is
//     how a `where` block writes a binding that is not a function definition:
//     on the `where` line itself the block is being opened, and a brace there
//     reads as the `where {` block form this grammar cannot afford (see
//     GRAMMAR-GAPS.md §10).
//
// The `-with` function also pins that a `let_group` member is a BINDER and not
// a value: `st` appears in the group, and a walk that treated the group's
// right-hand sides as binders would name a symbol for each of them.

implementation module CleanGrammarWave;

import StdEnv;
import code from "widget.o"
import code from library "CleanSerial_library"
import code from "SUBSERVER.OBJ", library "KERNEL32.TXT", library "USER32.TXT"

:: Point = { x :: !Int, y :: !Int }

:: BoxP =: BoxP Point

toDevicePoint :: !Point -> (!Int, !Int)
toDevicePoint p = (p.x, p.y)

unwrapBox :: !BoxP -> !BoxP
unwrapBox gtk = let { (BoxP p) = gtk } in p

sizeOf :: !Point -> !Int
sizeOf s = ix + iy
where
	{ ix, iy } = toDevicePoint s

withGroup :: !Point -> !Int
withGroup s = let { a = s.x; b = s.y } in a + b
