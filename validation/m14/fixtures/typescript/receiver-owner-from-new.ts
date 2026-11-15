/*
** task iteration 3: THE RECEIVER'S TYPE ON A MEMBER CALL, from the two syntactic
** forms TypeScript states it in — `const c = new Widget()` and `const d: Widget = make()`.
**
** Why this lane needs its own fixture rather than sharing the JavaScript one: the
** annotation form does not exist in JavaScript, and it is the form where a receiver's
** type is stated WITHOUT a constructor call. A rule that only read `new` would leave
** `d.other()` bound by name; the store's member-owner pass (`src/ast/member-owner-resolution.ts`)
** binds it inside Widget only because the row carries `metadata.owner`.
**
** THE CONTROL, and the reason it is a separate receiver: `const e = make()` states no
** type at all — the initialiser is a call and there is no annotation — so `e.other()`
** must carry NO owner. A rule that read any initialiser as a type, or that leaked the
** previous declaration's annotation, would put `Widget` on that row.
**
** MEASURED on the same shape in the JavaScript twin (its fixture records the
** end-to-end run through `indexProjectParallel`: with two classes each declaring
** `run()`, the call bound to the lexicographically-first WRONG declaration without the
** metadata and to the intended one with it).
*/
class Widget {
  run(): number {
    return 1;
  }
  other(): number {
    return 2;
  }
}

const c = new Widget();
c.run();

function make(): Widget {
  return new Widget();
}
const d: Widget = make();
d.other();

// SUPERSEDED CONTROL (2026-10-18, factory-return class): this comment used to read "`const e = make()`
// states no type at all" — that was TRUE before the factory-return class existed and is FALSE now:
// `make()` is declared `: Widget` above, so `e` is Widget-typed with evidence `factory`. The positive
// is now an expected row below (coverage strengthened), and the absent-owner control moved to a
// genuinely UNANNOTATED factory.
const e = make();
e.other();

function untypedMake() {
  return new Widget();
}
function viaUntypedFactory(): void {
  const f = untypedMake();
  f.other();
}

/*
** EXTENDED (2026-10-18): the two remaining syntactic forms that state the receiver's type
** without inference, plus the control that keeps the rule from reading anything it cannot see.
**
** `this.inner` where the FIELD is annotated (`private inner: Widget`) — evidence class "this".
** `w.run()` where `w` is an ANNOTATED PARAMETER — evidence class "param".
** `u.run()` where `u` is an UNANNOTATED parameter — no owner at all; a rule that read any
** parameter, or that defaulted to the previous form, would put Widget on that row and the
** store would withdraw a name binding that was previously correct.
*/
class Holder {
  private inner: Widget = new Widget();

  viaField(): number {
    return this.inner.other();
  }
}

function viaParam(w: Widget): number {
  return w.run();
}

function viaUntypedParam(u: any): number {
  return u.other();
}

/*
** ONE MORE HOP THE SYNTAX PROVES: a member OF a typed parameter. `settings: Settings` states
** the parameter's type; `Settings` is declared in THIS file and declares `worker: Widget`; so
** `settings.worker.other()` is a call on a Widget — evidence class `param` (the chain's ROOT is
** the parameter), owner `Widget` (the member's own declared type). One hop only: the type of a
** member of a member is a type-inference walk this pass does not have, so it is left unowned
** rather than guessed.
*/
interface Settings {
  worker: Widget;
}

function viaMemberOfParam(settings: Settings): number {
  return settings.worker.other();
}

/*
** DESTRUCTURED, TYPED BY THE MEMBER'S OWN TYPE. `{ worker }: Settings` where the file's own
** `Settings` declares `worker: Widget` — the binding's type is the member's declared type, one hop,
** evidence class `param` (the chain's root is the parameter). Only the member's own type is used:
** a destructured binding whose member has no stated type stays unowned rather than guessed.
*/
function viaDestructuredParam({ worker }: Settings): number {
  return worker.other();
}
