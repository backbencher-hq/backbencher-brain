// csharp — the R1 (no regex) round's fixture: using ALIASES and OPERATOR identity.
//
// Two surviving regexes in this analyzer carried the claim "no AST path". Probed
// (`script/m14/tmp/cs-operator-grammar-probe.ts`, `script/m14/tmp/cs-using-tree-probe.ts`),
// the claim was false on both, and each regex was also wrong in a way text cannot fix:
//
//   * `/using\s+([\w.]+)\s*=/` cannot tell the alias from the target, because in
//     `using A = B.C;` and `using A = Plain;` the two positions hold the SAME
//     shape. Position is the only discriminator, and the grammar already has it:
//     the alias is the `name` FIELD and the target is the first named child after
//     the anonymous `=`. Measured defect this fixes
//     (`script/m14/tmp/cs-using-alias-probe.ts`): `using Alias = Plain;` published
//     `module: "Alias"` — the alias as the module, with the real target `Plain`
//     named NOWHERE in the payload.
//
//   * `/\boperator\s+(checked\s+)?([^\s(]+)/` stops at the first `(`, so a target
//     written with a space before the parenthesis was TRUNCATED (`implicit C` for
//     `implicit operator C<T>(...)`). The grammar carries the operator token as an
//     anonymous child with the FIELD `operator` (with `checked` as a sibling), and
//     the conversion target in the FIELD `type`.
//
// The CONTROLS matter here: a plain `using Json;` and a plain `using System.Text;`
// must not be read as aliases, and every ordinary operator name must keep the exact
// spelling the pre-R1 fixtures already pin (`operator +`, `operator ==`,
// `implicit int`) — otherwise this "improvement" renamed symbols the whole lane's
// expectations depend on.

using System.Text;
using Json;
using Alias = Plain;
using Config = System.Text.Json.JsonSerializerOptions;
using static System.Math;

namespace R1Pin
{
    public class Plain { }

    public class Box<T> { }

    public class Nick : Plain
    {
        public static implicit operator int(Nick n) => 0;

        // The IDENTITY COLLISION the dead convMatch branch created: these two are
        // distinct C# members on ONE type, and before the R1 round both published
        // as `operator int` (the regex expected `operator implicit …`, the wrong
        // token order, so it never matched real C# and every conversion operator
        // fell through to the generic operator fallback).
        public static explicit operator int(Nick n) => 0;

        public static explicit operator Box<Plain>(Nick n) => new Box<Plain>();

        public static Nick operator +(Nick a, Nick b) => a;

        public static Nick operator checked +(Nick a, Nick b) => a;

        public static bool operator true(Nick n) => true;

        public static bool operator false(Nick n) => false;

        public static bool operator ==(Nick a, Nick b) => true;

        public static bool operator !=(Nick a, Nick b) => false;
    }

    // The truncation shape: whitespace around the generic brackets AND before the
    // parameter list. The name must be the canonical `implicit Box<Plain>`, and the
    // trailing name must not contain layout.
    public class Spaced
    {
        public static implicit operator Box < Plain > (Spaced s) => new Box<Plain>();
    }
}
