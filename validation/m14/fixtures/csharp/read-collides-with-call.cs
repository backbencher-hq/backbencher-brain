// csharp/read-collides-with-call — a member READ is not dropped because something else in the
// same function is CALLED by the same name. And a declared TYPE is not a read of the field.
//
// WHAT THIS PINS. Two fabrications, both found by writing the truth side of the `uses` class
// (this round's `uses`-oracle work) and letting it name the rows the analyzer was not publishing.
//
// CS-D6  The field-access `uses` pass used to suppress a read whenever the enclosing function
//        already had a `calls` edge to the same member NAME, keyed on (source, target) with no
//        SITE. In C# a static member and a method call can share a name, and a property and a
//        method can share one, so the guard silently deleted real reads. Four occurrences over
//        150 real roslyn files, all the same shape:
//
//          * `_options.X.Severity == ReportDiagnostic.Suppress` — a READ dropped because
//            `context.ReportDiagnostic(diagnostic)` is CALLED in the same function;
//          * `properties.ContainsKey(K.Negate)` — a READ dropped because `generator.Negate(…)`
//            is CALLED in the same function;
//          * `declarationDeclarators.Count` — a READ dropped because `b.Count()` is CALLED
//            beside it.
//
//        The suppression is now SITE-AWARE: `isCallee` already decided this structurally, by
//        comparing the member-access span against the invocation's `function` field, so the
//        name-keyed guard was a coarser duplicate of a precise rule and nothing else.
//
// CS-D7  The bare-identifier pass gated an entity's name by "the FIRST direct identifier child",
//        which is two different things for two different declarations:
//          * a FIELD's type is not a direct child at all — the grammar nests it
//            (`field_declaration > variable_declaration [ type, variable_declarator ]`), so a
//            field whose TYPE name collides with a MEMBER published a read of itself;
//          * for a PROPERTY the first direct identifier is the TYPE, so the gate took the type
//            and let the property's own NAME through — and a property whose name collided with a
//            member published a read of itself.
//        Both are now read from the grammar's own `name` / `type` FIELDS. The declared-type
//        reference graph already publishes these names, so nothing is lost: R9 owns the type
//        position and this pass stops claiming it.
//
// THE CONTROLS, because both fixes are subtractive and over-application is the failure mode:
//   * a member access that IS a call callee still publishes NO `uses` — `ReadNoCall` and
//     `CallAndRead` differ only in that one fact, so removing the gate entirely fails the first
//     forbid below;
//   * a null-conditional call `h?.M()` still publishes no `uses` for `M` (CSD4's 2-level shape);
//   * an assignment LHS still publishes no `uses` and its RHS still does (SCD1);
//   * a real read of a member still publishes even when a SAME-NAMED member is called elsewhere
//     in the function — that is the pair the whole fixture exists for;
//   * a declared type is published by the declared-type graph, so forbidding it as a `uses`
//     target costs no coverage.

namespace Probe
{
    public class Widget { }
    public class Gadget { }
    public class Doodad { }
    public class Sprocket { }
    public class Suppression { public int Value; }

    public class Registry
    {
        public static bool ContainsKey(string name) => true;
        public static string Negate(string s) => s;
        public static void Report(Suppression s) { }
        public static int Count(Collides c) => c.Count;
    }

    public class Collides
    {
        // A member whose name is also used as a static METHOD name elsewhere: a legal C# shape,
        // because the method lives on a DIFFERENT type.
        public Suppression Report;
        public int Count;
        public string Negate;
        public bool Flag;
        public Widget Widget;

        // CS-D6: a READ of `Report` and a CALL to `Report` in ONE function. The read must
        // publish. Pre-fix it published nothing, because `Report(d)` is called two lines below.
        public object ReadAndCall(Suppression s, object d)
        {
            var level = s.Value > 0 ? Report : null;
            Registry.Report(s);
            return level;
        }

        // CS-D6: the shape the corpus showed — a qualified static READ beside a call to the same
        // member name on a different receiver.
        public string ReadAndCallNegate(Collides other, string s)
        {
            var keep = other.Negate;
            return Registry.Negate(keep);
        }

        // CS-D6: a READ of `Count` beside a CALL to `Count` on the same line's other side.
        public int ReadAndCallBothSides(Collides a, Collides b)
        {
            return a.Count + b.Count;
        }

        // CS-D6, THE CORPUS SHAPE VERBATIM: a READ of `.Count` on one receiver beside a CALL to
        // a `Count` method that lives on ANOTHER type — legal C#, because the method is static
        // and so names nothing on this class. This is `declarationDeclarators.Count ==
        // fieldDeclarators.Count()` from a real roslyn analyzer, and it is the row the new
        // `uses` truth named and the analyzer did not publish.
        public int ReadAndCallSameName(Collides a, Collides b)
        {
            return a.Count + Registry.Count(b);
        }

        // CS-D6, the member form: a READ of `this.Report` beside a CALL to a same-named static.
        public object ReadAndCallMember(Suppression s)
        {
            var mine = this.Report;
            Registry.Report(s);
            return mine;
        }

        // CONTROL 1: a read with NO same-named call anywhere in the function. Pre-fix this
        // published; post-fix it must still, or the fix is over-broad rather than precise.
        public object ReadOnly(Suppression s, object d)
        {
            var level = s.Value > 0 ? Report : null;
            Registry.ContainsKey("k");
            return level;
        }

        // CONTROL 2: a member access that IS the callee publishes no `uses` — the calls edge
        // owns it. `Registry.Negate(...)` below is the only occurrence of the name in this
        // function, and if the callee gate were gone this function would publish one.
        public string CallOnly(Collides other, string s)
        {
            return Registry.Negate(other.Negate);
        }

        // CONTROL 3: a null-conditional call publishes no `uses` for the method name (CSD4's
        // 2-level shape), while the plain read on the next line is one.
        public string NullConditional(Collides other)
        {
            var keep = other.Negate;
            other?.Report?.ToString();
            return keep;
        }

        // CONTROL 4: an assignment LHS is a write and its RHS is a read (SCD1). The twin of
        // this fixture's whole claim in the assignment form.
        public void WriteAndRead(Collides other)
        {
            Flag = other.Count > 0;
        }

        // CS-D7: a field whose declared TYPE shares a member's name. Pre-fix this published
        // `uses Collides -> Widget` on its own declaration line.
        public Widget Widget;

        // CS-D7: a property whose own NAME shares a member's name. Pre-fix this published
        // `uses Widget -> Widget`.
        public Widget Widget { get; set; }

        // CS-D8: a PARAMETER'S TYPE is not a read of a member. The name resolves — the inventory
        // holds a `Widget` member of this class, and nothing binds the name — so pre-fix the
        // signature line published a read of a name the position does not carry. The source was
        // the enclosing method, which made the row look like a read INSIDE it:
        //
        //     public void TakesGadget(Gadget gadget) { … }
        //                          ^^^^^^ pre-fix: `uses TakesGadget -> Gadget`, confidence 1.0
        //
        // `Gadget`, not `Widget`, and that is the load-bearing choice in this fixture. If the
        // parameter type were `Widget` the pre-fix row and the control read below would be the
        // SAME (source, target) pair, the emitter's dedup would collapse them, and the fixture
        // would pass pre-fix — pinning nothing. A defect that shares a row with a correct row
        // cannot be observed by row presence, so the fixture gives the defect its own name. That
        // is the same trap CS-D6 walked into, where a name-keyed guard with no site deleted real
        // reads: in this lane, a fixture and a defect can both be hidden by a key.
        //
        // All three parameter shapes carry a type and all three were affected: a method
        // parameter, a primary-constructor parameter, and a lambda parameter. 6 rows over 200
        // real roslyn files (cs-deep-33); the corpus shapes are `SemanticModel semanticModel`
        // where the class also has a `SemanticModel` member, and `State state` likewise.
        public int Gadget;
        public int Doodad;

        public void TakesGadget(Gadget gadget)
        {
        }

        public void TakesDoodadInLambda()
        {
            Func<Doodad, Doodad> f = doodad => doodad;
        }

        // CONTROL: the same class, a member read as a VALUE from a parameter's TYPE position —
        // `Widget` is read here and MUST publish. This is what stops the D8 fix from being
        // "stop publishing the name", which would turn a published type into a missing read and
        // trade one wrong row for another. It also pins the adjacent case from the same round:
        // a type name that reaches a GENERIC METHOD is a read, not a type
        // (`Document.GetRequiredLanguageService<ISyntaxFactsService>()`), which one gate
        // over-broadly treating `generic_name` as a type position silenced for 1 corpus row.
        public Widget ReadWidget(Widget widget)
        {
            var same = Widget;
            return GetService<Widget>(same);
        }

        private static T GetService<T>(T value)
        {
            return value;
        }
    }

    // CS-D8: a primary-constructor parameter's TYPE. The parameter list lives on the TYPE
    // DECLARATION, not in a method body, which is exactly why the D7 rule missed it: D7 gated
    // a `variable_declaration`'s type field, and a primary-constructor parameter is not one.
    // `findContainingCSharpFunction` finds no callable here either, so the row's source fell
    // back to the class — a published type stamped as if the class read it. `Sprocket` is read
    // nowhere in this file, for the reason given above.
    public class PrimaryCtorTakesSprocket(Sprocket sprocket)
    {
        public int Sprocket;
    }
}
