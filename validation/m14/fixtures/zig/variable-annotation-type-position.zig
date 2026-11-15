// Z68 (pass 27): a variable's TYPE ANNOTATION is a declared-type fact, not a
// runtime member read.
//
// Z38 removed the `uses`-on-a-type-name defect for parameters, return types and
// container fields. It could not reach a variable's own annotation, because
// `variable_declaration` is in `isTypePosition`'s VALUE_BOUNDARY set — it has to
// be, because an assignment LHS parses as one (ZGD1). So `var x: c.Foo = ...`
// published the SAME fact twice: once correctly as
// `references (declared_type) -> Foo` (Z16 reads the `type` field), and once,
// wrongly, as a `uses` runtime read of `Foo`.
//
// The discriminator is which child of the declaration the chain arrived through,
// decided on the grammar's `type` field — the same field the declared-type pass
// reads, so the two cannot drift.

const c = @import("c.zig");

pub fn annotationIsNotARead() void {
    // ANNOTATED — a plain dotted annotation.
    var annotated: c.Foo = .{};

    // WRAPPED — `?c.Bar` is ONE field_expression in the `type` field, so the
    // inner segment reaches the declaration from beneath that node. An identity
    // test would miss this and publish `uses -> Bar`.
    var wrapped: ?c.Bar = null;

    // ARRAY-WRAPPED — `[4]c.Quux`, the same shape one node wider.
    var arrayed: [4]c.Quux = undefined;

    // INFERRED — the INITIALIZER is a value read. This edge must survive: it is
    // the negative half that fails if the fix tests the declaration rather than
    // the annotation.
    var inferred = annotated.baz;

    // NESTED — a dotted value read in an initializer, also a real read.
    var nested = inferred.qux;

    _ = .{ annotated, wrapped, arrayed, inferred, nested };
}

pub fn lhsIsAWriteNotAnAnnotation() void {
    // `self.count = 5;` parses as a variable_declaration (ZGD1), so this
    // declaration has the same node type as the annotations above. It carries no
    // `type` field, which is what keeps it a write.
    var self = .{};
    self.count = 5;
    _ = self;
}