// CSHARP ONTOLOGY FIXTURE — one exported NAME, two exported DECLARATIONS.
//
// The shape is C#'s arity rule and nothing exotic: a generic type and its non-generic
// namesake are TWO DIFFERENT TYPES, and that is precisely why `class X : X<int>` compiles.
// The grammar agrees — a generic declaration's `name` FIELD is the BARE identifier with
// `type_parameter_list` as a SIBLING (verified: script/m14/tmp/cs-ont-08-shapes-probe.ts),
// so the arity is a fact in the tree.
//
// Measured on real code, not invented (`script/m14/tmp/cs-ont-09-name-identity.ts`, 800
// aspnetcore `src` files, 1,456 type declarations, 90 of them carrying a
// `type_parameter_list`): 10 declarations repeat a name in one owner with a DIFFERENT
// arity — 1.25% of files. Named corpus cases:
//
//   src/Components/Components/src/OwningComponentBase.cs
//     17:  public abstract class OwningComponentBase : ComponentBase, ...
//    105:  public abstract class OwningComponentBase<TService> : OwningComponentBase, ...
//   src/Components/Components/src/RenderFragment.cs
//     13:  public delegate TResult RenderFragment<TValue>(TValue value);
//     21:  public delegate void RenderFragment();
//   src/Components/Endpoints/src/FormMapping/Converters/CollectionConverter.cs
//     20:  public class CollectionConverter<TCollection> : ...
//     24:  public class CollectionConverter<TCollection, TCollectionPolicy, TBuffer, TElement> : ...
//
// WHAT IS AND IS NOT FIXED. This fixture pins ONE of the two consequences, the one that
// is contained inside this lane:
//
//   FIXED   `exportLineByName` was keyed by NAME, so the second declaration's line
//           overwrote the first's and BOTH `exports` edges were stamped with it — one edge
//           pointing a consumer at a declaration it is not about. Each edge now carries
//           the line of its OWN declaration. The two expect rows below name the SAME target
//           on two DIFFERENT lines, and the pre-fix analyzer cannot satisfy both.
//
//   REPORTED, NOT FIXED  the analyzer publishes ONE symbol name for two distinct C# types,
//           which also makes two `contains` rows and two `exports` rows share a
//           (source, target) pair. Fixing the NAME moves `contains` — a COMPARED label
//           whose oracle lives in the master-owned differential — so it is filed, not
//           landed. See docs/analyzers/real-csharp-analyzer.md.

namespace Acme.Arity
{
    /// <summary>Non-generic. Exported as `Acme.Arity.Reporter` from THIS line.</summary>
    public class Reporter
    {
        public void Report() { }
    }

    /// <summary>
    /// A different C# type, distinguished only by arity. Exported under the same
    /// published name, from THIS line.
    /// </summary>
    public class Reporter<TChannel>
    {
        public void Send() { }
    }

    /// <summary>A delegate and its generic namesake — the same collision, another kind.</summary>
    public delegate void Handler();

    /// <summary>The generic one.</summary>
    public delegate void Handler<TArg>(TArg arg);

    /// <summary>
    /// `partial` is NOT arity. Two declarations of the same type at the same arity are
    /// ONE exported type, so the export set holds it ONCE — the export list is the
    /// assembly's importable-unit SET, and two entries for one unit is a duplicate
    /// provider (the M49 invariant's own words). Measured: 10 such repeats in 800
    /// aspnetcore `src` files.
    /// </summary>
    public partial class Split { public void A() { } }

    public partial class Split { public void B() { } }

    /// <summary>
    /// The control for the pair above: a `partial` split that CROSSES arity. `SplitGeneric`
    /// and `SplitGeneric&lt;T&gt;` are two types however many times each is written, so both
    /// are exported — dedupe on (name, arity), never on name alone. This is the row that
    /// catches a "fix" that dedupes by name and so loses a declaration.
    /// </summary>
    public partial class SplitGeneric { public void A() { } }

    public partial class SplitGeneric<T> { public void B() { } }
}