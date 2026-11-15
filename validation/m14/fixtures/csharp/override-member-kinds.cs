// CSHARP FIXTURE — `override` on every member kind, not only on methods.
//
// Found by cs-ont-07-overrides.ts, this lane's OWN independent overrides oracle, which
// reported 118 rows on 250 roslyn files that the tree supports and the analyzer did not
// publish — and the first of them was a PROPERTY
// (`...DiagnosticAnalyzer.AccessibilityFacts -> Abstract...DiagnosticAnalyzer.AccessibilityFacts`).
// The cause was structural rather than accidental: the only branch that pushed an
// OverrideTask was the METHOD branch, so `public override int P => 1;` produced a symbol,
// a `contains` edge, a declared-type `references` edge — and no `overrides` edge at all.
// Five member kinds are pinned here, plus the two that must NOT be edges.
//
// `this[int]` and `this[string]` are the load-bearing pair: an indexer's parameter list is
// part of its signature in C#, so the two overloads are distinct members and the fixture
// has to say which one the override names. The published label is name-keyed (`localEdgeLabel`
// drops the signature), so both collapse to `this` — pinned as a stated limit rather than
// left as a surprise.

namespace Acme.Overrides
{
    public abstract class BaseThing
    {
        public virtual int Prop => 0;
        public virtual string this[int index] => "";
        public virtual int this[string key] => 0;
        public virtual int Field;
        public virtual event System.EventHandler Changed;
        public virtual void Method(int x) { }
        public virtual void Overloaded() { }
        public virtual void Overloaded(int x) { }
    }

    public class DerivedThing : BaseThing
    {
        public override int Prop => 1;
        public override string this[int index] => "x";
        public override int Field = 2;
        public override event System.EventHandler Changed;
        public override void Method(int x) { }
        public override void Overloaded() { }

        /// <summary>NOT an override: no `override` modifier, so no edge may be invented.</summary>
        public virtual void NewVirtual() { }

        /// <summary>Overloads the base by name only — still not an override.</summary>
        public void Shadow(int x) { }

        /// <summary>A HIDER, not an override: `new` replaces, and C# has no base edge for it.</summary>
        public new void Hider() { }
    }

    /// <summary>Two `override` FIELD declarators on one declaration are two members.</summary>
    public class FieldPair : BaseThing
    {
        public override int Field;
        public override int Other;

        /// <summary>ONE declaration, TWO declarators — two members, and C# requires both.</summary>
        public override int MultiA, MultiB;
    }
}