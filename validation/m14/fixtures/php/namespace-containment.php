<?php
// M60 NAMESPACE CONTAINMENT fixture.
//
// Three namespace forms, because the grammar spells them differently and the
// round's first implementation only reached one of them:
//
//   semicolon  `namespace A;`  -> `namespace_definition` ends at the `;` and the
//               declarations are SIBLINGS at program level.
//   braced     `namespace A { }` -> the declarations are children of a
//               `compound_statement` inside the `namespace_definition`.
//   repeated   several blocks in one file; a semicolon form's scope runs to the
//               next `namespace` declaration or to end of file.
//
// The contract pinned here:
//   1. every top-level declaration in a namespace is CONTAINED by it
//      (`contains App\One -> A`), at 1.0 / structural;
//   2. member containment is unchanged — a class still owns its methods, so the
//      two levels coexist rather than one replacing the other;
//   3. a declaration's owner is the namespace ONLY at top level; a member keeps
//      its class (forbidRelationships below pins that a method is never
//      re-parented to the namespace);
//   4. `include`/`require` stays FILE-scoped even inside a namespace. That is
//      what `php/include-paths` pins for the un-namespaced case, and this file is
//      the namespaced case: an include path resolves against the file's
//      directory, and the namespace in force has no part in it. Before the fix
//      this was only accidentally true, because the semicolon form never
//      resolved `ns` at all.
namespace App\One;

use App\Two\B;

const ONE = 1;

class A
{
    public function am(): void
    {
        require __DIR__ . '/one-helper.php';
    }
}

function fa(): void
{
}

interface IOne
{
}

trait TOne
{
}

enum EOne: string
{
    case First = 'f';
}

namespace App\Two {
    class B
    {
    }

    interface ITwo
    {
    }
}

namespace App\Three;

class C
{
}