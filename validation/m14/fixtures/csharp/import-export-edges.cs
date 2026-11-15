// CSHARP ONTOLOGY FIXTURE — `imports` and `exports`, the two types this lane lacked.
//
// Shape is chosen so that every decision the implementation makes is OBSERVABLE, and
// so that the four shapes that share ONE grammar node (`using X;`, `using static X;`,
// `using A = X;`, `global using ...;`) can be told apart by the edge alone. A fixture
// where the forms are indistinguishable is a fixture the pre-change analyzer would also
// have passed, which is the failure mode every pin below is written against.
//
// Line numbers are asserted: `imports` and `exports` are the two types whose rows had no
// line channel at all before this, and a declaration edge with a wrong line points a
// consumer at the wrong declaration.
//
// The forbid rows are load-bearing in the other direction: they pin that the ALIAS is
// never the dependency, that `internal` and `file`-scoped types are not exports, and that
// a NESTED type is not a top-level export (its unit is its enclosing type, not the
// assembly).

using System;
using System.Collections.Generic;
using static System.Math;
using Alias = System.Text;
using global::System.IO;

global using System.Threading;
global using static System.Environment;
global using GlobalAlias = System.Text.RegularExpressions;

extern alias LegacyLib;

namespace Acme.Surface
{
    /// <summary>Public and top-level: part of the assembly's surface.</summary>
    public class PublicType
    {
        public void Visible() { }

        /// <summary>Nested inside a type, so its unit is PublicType — not the assembly.</summary>
        public class NestedPublic { }
    }

    /// <summary>Internal is NOT the assembly's surface — the C# visibility rule.</summary>
    internal class InternalType
    {
        public void Hidden() { }
    }

    public interface IPublicContract { }

    internal interface IInternalContract { }

    public enum PublicEnum { First }

    internal enum InternalEnum { Second }
}

/// <summary>
/// A file-scoped namespace must select the SAME export set as the block form. It also
/// OWNS every declaration after it, so the two classes below really are
/// `Acme.FileScoped.*` — that is C#'s rule and the published names have to agree with it.
/// </summary>
namespace Acme.FileScoped;

public class FileScopedPublic { }

internal class FileScopedInternal { }

file class FileLocalType { }

/// <summary>
/// The nested-namespace shape. C# REJECTS it (CS0105 — a namespace declaration writes its
/// own full name and cannot nest), but tree-sitter accepts it, and before this round the
/// analyzer published TWO spellings of one type: the namespace symbol read `Acme.Inner`
/// while the type's own qualified name read `Outer.Inner.Doubled`. The `exports` edge is
/// what made it visible — a consumer had two names for one assembly export and no way to
/// know which a `using` would resolve. Corpus frequency of the shape is 0 in 4,000 roslyn
/// and 0 in 1,552 xunit files, so this fixture is the only instrument that holds it.
/// </summary>
namespace Acme.Outer
{
    namespace Acme.Inner
    {
        public class Doubled { }
    }
}