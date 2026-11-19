// DECORATES — the attribute-as-applied-callable fixture (P0-1 of the 2026-11-19 close-out).
//
// WHAT THIS PROVES. A C# attribute is APPLIED TO a declaration, and the edge's direction is the
// emitted one (`src/ast/types.ts:120-143`): source = the decorated declaration, target = the
// decorator's name. The fixture exists because the lane previously published NOTHING for this —
// ruled "ontological" on the grounds that an attribute is passive metadata — while the grammar
// produces `attribute`, `attribute_list` AND `attribute_argument` (3 of the 239 named node types)
// and the fleet already publishes the same shape for Rust's `#[derive(...)]`
// (`real-rust-analyzer.ts:2391`) and python's `@deco` (`real-python-analyzer.ts:6139`).
//
// THE SIX SHAPES, one per claim. Each has a reason to be here rather than padding:
//   MARKER     `[Flags]` on an enum            -> the marker class (no argument list)
//   APPLIED    `[Obsolete("x")]` on a class    -> the applied_callable class
//   QUALIFIED  `[System.Obsolete]`             -> the dotted name is the target, not its leaf
//   GENERIC    `[Marker<int>]`                 -> the type arguments are DROPPED from the name
//   MEMBER     `[Required]` on a property      -> a member host, not only a type host
//
// A PARAMETER attribute is deliberately NOT here, and that is a claim rather than an omission.
// `[In] int a` DOES carry a direct `attribute_list` (probed), so the pass sees it — but a
// parameter is not a SYMBOL in this lane (the symbol contract covers types and members, not
// parameters), so a `decorates` edge sourced from one would name a node nothing declares. The
// pass therefore sources only symbols, and PARAMETER below pins that refusal.
//
// WHAT MUST NOT FIRE, and why each control matters:
//   PLAIN      a declaration with no attribute list emits NOTHING. A pass that sourced every
//              declaration would fabricate an edge for every symbol in the file.
//   UNRELATED  a method with no attribute, inside an attributed class, must not inherit its
//              owner's attributes. The attribute_list is a DIRECT child of its host, so an
//              ancestor walk would leak the class's attributes onto every member — the single
//              most likely way this pass could be wrong.
//   PARAMETER  `[In]` on a parameter must not source an edge: the parameter has no symbol.
using System;

[Flags]
public enum E { A, B }

[Obsolete("use B")]
public class Decorated
{
    [Required]
    public int P { get; set; }

    // The accessor attribute: `[Obsolete]` on the GETTER. An accessor is not a symbol, so the
    // edge must be sourced from the PROPERTY that owns the accessor list — this is the shape a
    // naive symbol-host-only pass drops silently (24 accessor hosts in a 300-file draw).
    public int R { [Obsolete] get; set; }

    public void M(int a) { }

    public void N([In] int a) { }
}

[System.Obsolete]
public class Qualified { }

[Marker<int>]
public class Generic { }

public class Plain
{
    public int Q { get; set; }
}