// M60 dart lane — an enum constant is a DECLARATION, not a read.
//
// The bare-member-read branch (DT-F+ #752) gates on the identifier's parent
// being a declaration-name position (`isDartDeclNameParent`). That set covered
// the class / enum / mixin / extension container names and the field
// declarators, but NOT `enum_constant` — the node that wraps each enum value
// (`(enum_body (enum_constant (identifier)))`, probe-verified against the
// pinned grammar). So every enum constant was emitted as a bare read of its own
// enum: `uses Shape -> circle` on the declaration line, confidence 0.6.
//
// WHY IT SURVIVED THE WHOLE LANE. 0.6 is BELOW the M12 harness's 0.7 claim
// threshold, so the fact was recorded as `unknown`, not as a false positive —
// an edge the analyzer itself declines to claim, which no gate scores. The
// fixture's forbids are what make it visible in both directions.
//
// The fixture also pins the two REAL reads around it, so the fix cannot be a
// blunt "silence the enum body": the enum-constant ARGUMENT (`small(kSmall)`)
// is an ordinary value read of a top-level constant, and `Shape.circle` in
// `describe` is an ordinary member read of an enum constant.
const int kSmall = 1;
const int kLarge = 9;

enum Shape { circle, square }

enum Payload {
  small(kSmall),
  large(kLarge);

  const Payload(this.bytes);

  final int bytes;

  bool isLarge() => bytes > 5;
}

String describe(Shape s) {
  if (s == Shape.circle) return 'round';
  return 'boxy';
}
