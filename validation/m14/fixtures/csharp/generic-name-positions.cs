// csharp/generic-name-positions — a TYPE EXPRESSION is not a NAME, and the lane must
// publish the same names for both spellings of one type.
//
// WHAT THIS PINS. Three positions in this analyzer turn a written type into a published
// name, and until this round each of them had a spelling that published an EXPRESSION where
// the position publishes a NAME — or published nothing at all. Every row below is written
// TWICE, once plain and once qualified, so the expected spelling is read off the twin
// rather than asserted by hand. That is the discipline `csharp/qualified-type-spelling`
// established and this fixture continues it.
//
//   D1  THE DECLARED-TYPE GRAPH LOSES A QUALIFIED GENERIC'S ARGUMENTS.
//       tree-sitter-c-sharp spells `System.Collections.Generic.Dictionary<string, Widget>`
//       as `qualified_name [ …, generic_name [ identifier, type_argument_list ] ]`, so a
//       leaf-only walk reaches the identifier and never the argument list hanging off the
//       same `generic_name`. The plain twin `Dictionary<string, Widget>` is one node and
//       took the branch that DOES walk the arguments. One type, two spellings, two
//       different dependency sets — and the qualified one dropped the arguments, which R9's
//       own header calls "the real dependency". Measured: the trees and all ten spellings in
//       script/m14/tmp/cs-deep-8-declared-type-rootcause.ts and -11-qualified-generic-probe.ts;
//       frequency 39 occurrences in 12 of 1,500 roslyn files against 3,033 plain ones —
//       real AND rare, which is the combination that survives every depth draw.
//
//   D2  A GENERIC ATTRIBUTE PUBLISHED NO DECORATOR AT ALL.
//       `[Marker<int>]` published `decorators: []` because the attribute-name predicate
//       named three node types and a generic attribute's name child is a fourth
//       (`generic_name`). And the twin that WAS named, `[System.Marker<int>]`, published the
//       whole spelling `"System.Marker<int>"` — the same expression-where-a-name defect as D1,
//       in a position C2a had already swept. Frequency: 1 in 1,500 roslyn files, 13 in 1,500
//       aspnetcore files — `[JSMarshalAs<JSType.Number>]`, `[TestRenderMode<…>]`, production
//       code (script/m14/tmp/cs-deep-12-frequencies.ts).
//
//   D3  A `using` ALIAS NAMED A TYPE EXPRESSION.
//       `using M = Dictionary<string, Widget>;` published `Dictionary<string,Widget>` as the
//       module and the `references` target, and with a TUPLE argument it published the
//       element NAMES too. A module is the thing a file imports FROM; it must be a name.
//       The arguments are not lost by the strip — R9's rule says the argument is the real
//       dependency — so each is published as its own `references` edge beside the module.
//
// THE CONTROLS ARE THE POINT. Every fix here is "remove the type arguments", and a fix that
// removed too much would pass the same assertions, so each control is a spelling that must
// KEEP its shape: a plain namespace path keeps every segment (`System.Text`, not `Text`); a
// qualified attribute keeps its full path (`System.Marker`, not `Marker`); a plain generic
// attribute publishes its base (`Marker`); the declared-type graph keeps publishing the base
// AND the argument of a plain generic, and still keeps the dotted path of a qualified
// NON-generic type out of the graph (a qualified name publishes its LEAF — R9's rule);
// `int`/`string` stay silent everywhere they are a predefined type; a bound type parameter
// stays silent; a tuple element's NAME is never published as a type.

using System.Text;
using PlainPath = System.Text;
using PlainMap = Dictionary<string, Widget>;
using QualifiedMap = System.Collections.Generic.Dictionary<string, Widget>;
using PlainTuple = ImmutableDictionary<(Widget w, int n), Widget>;
using ArrayAlias = System.Int32[];

namespace Probe
{
    [Marker] public class PlainAttributed { }
    [Marker<Widget>] public class GenericAttributed { }
    [System.Marker] public class QualifiedAttributed { }
    [System.Marker<Widget>] public class QualifiedGenericAttributed { }
    [global::Marker<Widget, Gadget>] public class AliasGenericAttributed { }
    [Marker<Widget>] [Gadget<int>] public class TwoGenericAttributed { }

    public class Widget { }
    public class Gadget { }

    public class PlainHolder
    {
        public Dictionary<string, Widget> Map;
    }

    public class QualifiedHolder
    {
        public System.Collections.Generic.Dictionary<string, Widget> Map;
        public System.Collections.Generic.Dictionary<Widget, Gadget> Pair;
        public System.Collections.Generic.List<System.Collections.Generic.List<Widget>> Nested;
        public System.Collections.Generic.Dictionary<string, (Widget w, int n)> Tupled;
        public System.Collections.Generic.Dictionary Map;          // no arguments: the control
        public System.Text.StringBuilder Builder;                 // qualified, NOT generic
    }

    public class Signatures
    {
        public void Takes(System.Collections.Generic.Dictionary<string, Widget> map) { }
        public System.Collections.Generic.Dictionary<string, Widget> Returns() => null;
        public System.Collections.Generic.Dictionary<string, Widget> Property { get; set; }
    }

    public class Generic<T>
    {
        public System.Collections.Generic.List<T> BoundArgument;
    }
}
