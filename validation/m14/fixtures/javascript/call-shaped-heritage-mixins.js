// M14 / R3 — THE CALL-SHAPED CLASS HERITAGE.
//
// A class's supertype may be a CALL, and there are TWO shapes of it, and they put the base and
// the mixin in OPPOSITE positions:
//
//   (A) `class X extends Base.extend(M1, M2)` — a MEMBER call. The RECEIVER names the BASE and
//       the ARGUMENTS name the MIXINS composed into X's supertype chain. (Ember / Backbone.)
//   (B) `class X extends MixinFn(Base)` — a plain FUNCTION call. The CALLEE names the MIXIN and
//       the ARGUMENT names the BASE. (The TypeScript / Redwood mixin-factory idiom, where
//       `MixinFn(Base)` evaluates to a class that extends Base.)
//
// THE DEFECT THIS FIXTURE PINS: `findChildByType` scans the DIRECT named children of the node it
// is given, and a call-shaped heritage's single direct named child is the `call_expression` — so
// the base's `identifier` and `member_expression` are GRANDCHILDREN of it. Before the fix, every
// call-shaped heritage published NO edge at all: neither the base nor the mixin. Measured over the
// admitted population by `script/m14/javascript-heritage-census.ts`: 76 call-shaped clauses, of
// which the analyzer's own lookup pair found 0.
//
// THIS IS A BEHAVIOURAL FIXTURE, NOT A NODE LIST: it asserts the EDGES THE ANALYZER PUBLISHES for
// the construct, and the construct arrives as a real node (`class_heritage` → `call_expression` →
// `member_expression` → `extend`), never as recovered text. The fixture runner answers
// `expectNoParseErrors` from its own ERROR-node census over the same tree, so a file that only
// PARSED would not satisfy these rows.
//
// THE POSITIVE CONTROLS ARE THE POINT. A rule that simply published "the first identifier in the
// heritage" would also pass a fixture of plain classes — so the negative half pins the DISCRIMINATOR:
// the plain-`extends` classes below must publish `extends` and NOTHING else, and the mixin rows must
// not appear for them. The discriminator is the SHAPE of the heritage's own expression (a member
// call versus a plain call), never a name: `Route.extend(M)` and `_.extend(obj, props)` are the
// same shape, and it is the shape that decides the roles.
//
// THE ARITY CONTROL: the fixture's own `Factory(...)` argument is a CALL, and a computed mixin
// publishes NO mixin row — the analyzer publishes only what the argument NAMES. That is a
// deliberate refusal, pinned by `forbidRelationships` below.

// ── (A) THE MEMBER-CALL FORM: the receiver is the BASE, the arguments are the MIXINS.
class WithBlockingActions {}
class Route {}
class ApplicationRoute extends Route.extend(WithBlockingActions) {}

// Two mixins in one call — both must be published, in the order they are written.
class WithPolicies {}
class WithRoles {}
class TokenSerializer extends Route.extend(WithPolicies, WithRoles) {}

// ── (B) THE FUNCTION-CALL FORM: the callee is the MIXIN, the argument is the BASE.
class Core {}
function ValidationMixin(Base) {
  return class extends Base {}
}
class RedwoodRecord extends ValidationMixin(Core) {}

// ── THE COMPUTED-MIXIN REFUSAL: a call argument COMPUTES a mixin; it NAMES nothing, so it must
// publish no `mixes_in` row. The named argument beside it still must.
function SortableFactory(fields) {
  return {}
}
class Searchable {}
class ClientsController extends Route.extend(SortableFactory(["id", "name"]), Searchable) {}

// ── THE POSITIVE CONTROLS — plain heritage classes. They publish `extends` and NOTHING else, and
// in particular NO `mixes_in`: the discriminator must not fire on a class that merely names a base.
class PlainBase {}
class PlainDerived extends PlainBase {}

// A qualified base, and a class EXPRESSION with a call-shaped heritage (the second heritage arm).
class Ns {}
const Qualified = class extends Ns.Base.extend(WithBlockingActions) {}
