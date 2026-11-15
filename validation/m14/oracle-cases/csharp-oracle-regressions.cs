// csharp/oracle-regressions — the shapes that made the ORACLE wrong, in one small file.
//
// This file is NOT a fixture in the F3 sense: fixtures assert what the ANALYZER emits, and all
// three defects below were in the TRUTH. F3 cannot see an oracle bug; only a derivation can, and
// the derivation that found them (F5 over a 120-file corpus rotation) costs about ten minutes per
// run. So the shapes live here instead, in a file small enough to derive in about a second.
//
//   D9    a base whose name is declared as an interface in ANOTHER corpus file. The oracle
//         consulted its corpus-wide companion before the file's own declaration, so a local
//         CLASS lost to a name seen elsewhere, and `class Derived : Local` was published as
//         `implements`. `Local` is the load-bearing name: it is a class here and an interface
//         somewhere else, and a self-contained file cannot express "elsewhere" — the companion
//         is passed in by the probe.
//   D10   a base list whose constructor ARGUMENT LIST is a sibling of the type.
//   D10b  a record's primary-constructor base, where the arguments sit inside the child's own
//         text, so the sibling rule in D10 cannot see them.
//
// Plus two controls, so the gate cannot be satisfied by simply deriving nothing: a class's first
// base is inheritance, and an undeclared later base that is I-prefixed is an interface.
namespace OracleRegressions
{
    public class Local { }
    public class Base { }
    public abstract record Beast(string Name);

    // D9: `Local` is a class in THIS file. The probe's companion also contains `Local`, because
    // some other corpus file declares `interface Local`. Precedence: this file wins.
    public class Derived : Local { }

    // D10: the base list is `[identifier "Base", argument_list "(arg)"]`.
    public class WithArgs : Base { }

    // D10b: the base list is ONE child, `primary_constructor_base_type "Beast(Name)"`, carrying
    // the base constructor's arguments in its own text.
    public record R : Beast("x") { }

    // CONTROL: first base is inheritance; a later undeclared I-prefixed base is an interface.
    public class Multi : Base, ISomewhereElse { }
}
