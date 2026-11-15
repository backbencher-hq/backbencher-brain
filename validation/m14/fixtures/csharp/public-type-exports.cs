// CS3 / csharp — `exports`: which declarations reach the assembly's export surface.
//
// Every shape here is a real accessibility modifier on a real top-level or nested
// type, and the file is deliberately built so that a rule which reads the wrong
// node, the wrong nesting level, or the wrong default produces a DIFFERENT set.
// Pins were authored from re-probed emission (the lane's stated method); the rule
// is stated in src/ast/real-csharp-analyzer.ts at the `exports` emission site.
//
// FILE ORDER IS LOAD-BEARING, and the first version of this fixture got it wrong
// in a way that read as an analyzer defect. A FILE-SCOPED namespace applies to
// every declaration that FOLLOWS it in the file, so writing the "global scope"
// cases after `namespace Probe.Scoped;` put all of them inside that namespace:
// the analyzer emitted 10 edges and none of them used the `global` source, which
// looked like the global-scope branch was dead. It was not — the fixture had
// never produced a global-scope declaration. So the global cases come FIRST, which
// is also the only order C# permits (a file-scoped namespace may not follow a type
// declaration).
//
// The cases, and what each one convicts:
//
//   PublicAtGlobalScope         top-level `public` with NO namespace. There is no
//                               owner symbol, so the edge takes the lane's
//                               file-scope source `global` — the same source CS-B1
//                               uses for a top-level `calls` edge.
//   PublicInBlockNamespace      the positive control. `public` + top level + a
//                               block namespace -> one exports edge, source = the
//                               namespace symbol.
//   PublicInFileScopedNamespace the same fact written the OTHER way C# spells a
//                               namespace. `namespace N;` puts the type
//                               declarations as SIBLINGS of the namespace node, so
//                               the owner comes from the side variable rather than
//                               from a tree ancestor. Both forms must agree.
//   InternalTopLevel            NOT exported. This is the case dotnet/roslyn is
//                               made of: 303 of 333 top-level types there are
//                               `internal` and ZERO are `public`, so a rule that
//                               treated "top-level type" as "exported" would publish
//                               302 fabricated edges on that corpus.
//   NoModifierTopLevel          NOT exported. C#'s default accessibility for a
//                               top-level type declaration is `internal`; requiring
//                               the literal `public` gets this right without needing
//                               a default, and requiring "not private" would not.
//   FileScopedType              NOT exported. `file` is C# 11 file-only visibility;
//                               `extractVisibility` maps it to `private` (CS-B4).
//   PrivateTopLevel             NOT exported.
//   NestedPublic                NOT exported. THE REGRESSION CASE: an earlier
//                               version of the rule was
//                               `ownerKind === Namespace ? ownerName : "global"`,
//                               which accepted this shape and published it as a
//                               global-scope export. Measured on aspnetcore: 24
//                               fabricated rows against 275 real ones.
//   NestedInternalInPublicType  NOT exported; control that a nested type is judged
//                               on its own modifier, not on its container's.
//   PublicEnum / PublicStruct /
//   PublicInterface /
//   PublicDelegate /
//   PublicRecord /
//   PublicRecordStruct           the other type kinds, including both record forms,
//                               so a fix that narrowed the kind set cannot pass.
//   PublicTopLevelMethod        NOT exported. Public MEMBERS ride `contains` and
//                               `brain_symbol.visibility`; the R3 population was
//                               counted at 1,986 edges on aspnetcore against R1's
//                               275 and rejected as `contains` with a modifier
//                               attached.
//   PublicMethodInInternalType  NOT exported. A public member of an internal type
//                               is not on the assembly's surface, and this convicts
//                               a rule that reads member modifiers without asking
//                               who owns them.
public class PublicAtGlobalScope
{
}

internal class InternalTopLevel
{
}

class NoModifierTopLevel
{
}

file class FileScopedType
{
}

private class PrivateTopLevel
{
}

namespace Probe.Block
{
    public class PublicInBlockNamespace
    {
        public void PublicMethod() { }
    }
}

namespace Probe.Scoped;

public sealed class PublicInFileScopedNamespace
{
}

public class Container
{
    public class NestedPublic
    {
    }

    internal class NestedInternalInPublicType
    {
    }

    public void PublicTopLevelMethod() { }

    internal void InternalMethod() { }
}

internal class InternalContainer
{
    public void PublicMethodInInternalType() { }
}

public enum PublicEnum
{
    One,
}

public struct PublicStruct
{
}

public interface PublicInterface
{
}

public delegate int PublicDelegate(int value);

public record PublicRecord(int X);

public readonly record struct PublicRecordStruct(int Y);
