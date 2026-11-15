// csharp — the PARAMETER-honesty pair, found by the R7 wave (M60.R7 register,
// symbol-sentinel-register.json, csharp lane) rather than by reading the analyzer.
//
// Two shapes in one place, both about a name-bearing field holding something that
// is not a name:
//
//   1. `params T[] name` — the ONE shape tree-sitter-c-sharp does not wrap in a
//      `parameter` node. The `params` token, the array_type and the identifier are
//      DIRECT children of the parameter_list (tree measured with
//      script/m14/tmp/cs-params-modifier.ts), so the analyzer's named-`parameter`
//      loop dropped every varargs parameter — from the published payload AND from
//      the overload signature. Silent loss, not a wrong value.
//
//   2. a parameter whose type cannot be resolved. The register's csharp entry was
//      `pType = … || this.extractTypeString(p) || "unknown"`: the literal `unknown`
//      in a TYPE field is a fabricated value (R7), and `extractTypeString`'s
//      last-resort scan can return the parameter's OWN NAME on a damaged list
//      (`void M(int a, b)` -> type `"b"`), which is the same class one step worse —
//      a name where a type belongs. Both are absences now.
//
//   3. a `params` parameter with NO name: the grammar's recovery still inserts an
//      empty `identifier` child (tree measured with
//      script/m14/tmp/cs-param-noname-tree.ts), so reading its text published
//      `{ name: "" }` — the same class again, in the fix's own new code. An empty
//      name is an absence.
//
// The WELL-FORMED methods are the control: `params object[] rest` must publish
// `rest` with type `object[]`, so the fix cannot degenerate into "drop varargs".

namespace ParamPin
{
    public class Probe
    {
        public void Well(int a, string b, object c) { }

        public void ParamsArray(params object[] rest) { }

        public void ParamsAfterPlain(int a, params string[] rest) { }

        public void ParamsBuiltin(params int[] nums) { }

        // The control that separates the two array shapes: an ORDINARY array
        // parameter is wrapped in a `parameter` node and was published all along,
        // so the fix may not become "drop array-typed parameters", and neither may
        // a mutant simulate the varargs loss by dropping every array type without
        // being wider than the defect it stands for (disclosed in the mutant).
        public void ArrayParam(int[] data) { }

        public void NamelessParams(params int[]) { }

        public void MissingLastType(int a, b) { }

        public void MissingFirstType(a, int b) { }
    }
}
