// csharp/qualified-type-spelling — the ALIAS QUALIFIER (`global::`) is not part of a name.
//
// WHAT THIS PINS. `global::System.Text.StringBuilder` and `System.Text.StringBuilder` are ONE
// type, and this lane's contract publishes the full dotted path, so a source file that writes
// the qualifier must produce the SAME target as one that does not. Measured before the fix
// (script/m14/tmp/cs-alias-qualifier-census.ts over BOTH pinned corpora — all 76 files
// containing `::`): 146 rows carried the qualifier — 49 `instantiates`, 2 `extends`, and 95
// ATTRIBUTE names in the decorator payload — and none in any other position. R10's own reading
// moved with the fix (`sep=1 unruled=instantiates|:` before, `sep=0 unruled=-` after).
//
// THE POSITIONS ARE NOT ALL THE CORPORA CONTAIN. The corpora exercise creation, heritage and
// attributes; the rest were found by probing every type-name position the language has
// (script/m14/tmp/cs-alias-position-battery.ts and -battery2.ts/-battery3.ts/-battery4.ts and
// cs-alias-single-segment-probe.ts). That is how this fixture came to cover the four positions
// a corpus measurement cannot see — the using directive's module, the target-typed `new()`
// resolved from a qualified declared type, the conversion OPERATOR's name (a SYMBOL name, which
// never passes through the type-name cleaning the relationship targets do), and the plain
// `using global::System;` form — plus three positions where the qualifier shape published
// NOTHING AT ALL rather than the wrong spelling: explicit `new global::Root()`, a method return
// type, and an indexer's return type. Those three share one root cause: a hardcoded node list
// that omitted `alias_qualified_name`, the node the pinned grammar gives a `global::`-qualified
// name with a SINGLE segment (it is only wrapped in a `qualified_name` when a dot follows the
// qualifier). The corpora contain 550 multi-segment `global::` occurrences and 0 single-segment
// ones, so no draw could ever have seen it.
//
// CONTROLS, because the fix is "remove a qualifier", not "remove everything before a `::`":
//   * a plain qualified target keeps its FULL PATH (`System.Text.StringBuilder`), so a fix that
//     collapsed targets to their last segment would fail here;
//   * an identifier literally named `global` (legal C#; the keyword is contextual) is never
//     touched — the rule requires the two colons;
//   * an `extern alias` qualifier (`Sql::Data`) is left alone. Removing it would mean resolving
//     the alias binding, which this lane does not do; guessing a namespace would be fabrication.
//     Measured: the shape occurs 0 times in either pinned corpus AND publishes no edge at all
//     today, so it is recorded as an open item rather than blessed as contract.

extern alias Sql;

using PlainBuilder = System.Text.StringBuilder;
using AliasedBuilder = global::System.Text.StringBuilder;
using static System.Math;
using static global::System.Math;
using System;
using global::System;

namespace Probe
{
    public class Base { }

    public class Qualified : global::Probe.Base { }

    public class PlainQualified : Probe.Base { }

    [System.Serializable]
    public class PlainAttributed { }

    [global::System.Serializable]
    public class AliasAttributed { }

    public class Conversions
    {
        public static implicit operator PlainQualified(Conversions c) => null;

        public static implicit operator global::Probe.PlainQualified(Conversions c) => null;
    }

    public class Bodies
    {
        public object QualifiedNew() => new global::System.Text.StringBuilder();

        public object PlainNew() => new System.Text.StringBuilder();

        // Whitespace is legal on both sides of `::`, and the qualifier is removed all the
        // same (the char scan tolerates runs of whitespace).
        public object SpacedNew() => new global :: System.Text.StringBuilder();

        public object PlainDeclared()
        {
            System.Text.StringBuilder plain = new();
            return plain;
        }

        public object QualifiedDeclared()
        {
            global::System.Text.StringBuilder qualified = new();
            return qualified;
        }

        // An `extern alias` qualifier stays as written (see the boundary note above).
        public object ExternalAliasNew() => new Sql::Data();

        // Control: `global` is a legal identifier and must survive untouched.
        public int global;

        public int ReadGlobal() => global;
    }

    // Single-segment alias shapes: `Root` stands in for a type named without a namespace path —
    // the analyzer publishes the WRITTEN name minus the qualifier and never resolves it, so the
    // binding does not change what is measured here.
    public class Root { }

    public class GlobalShapes
    {
        public object New() => new global::Root();

        public global::Root Ret() => null;

        public global::Root this[int i] => null;

        public Root PlainRet() => null;
    }
}
