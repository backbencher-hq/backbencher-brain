// csharp/record-struct-kind — the KIND of a record declaration.
//
// The pinned tree-sitter-c_sharp grammar spells BOTH `record class Foo` and
// `record struct Foo` as ONE node type, `record_declaration`, and the two differ by an
// UNNAMED TOKEN child (`*class("class")` versus `*struct("struct")`). Enumerating the
// pinned wasm yields 533 node types and no `record_struct_declaration`, so a rule that
// keys on the node TYPE cannot tell them apart — measured before this fixture existed:
// `public record struct RS(double X, double Y);` parsed with 0 errors and published
// kind=class. This fixture is the pin for the token rule, and it carries the controls
// that stop the fix from becoming "everything with `record` in it is a struct".
namespace Probe;

public record class RecClass(string Name);

public record struct RecStruct(double X, double Y);

public readonly record struct RecBody
{
    public int F { get; init; }
}

public record struct RecGeneric<T>(T Value) where T : struct;

public struct PlainStruct { public int P; }

public class PlainClass { public int C; }

public interface IThing { }
