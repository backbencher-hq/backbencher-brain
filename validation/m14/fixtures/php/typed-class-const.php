<?php declare(strict_types=1);

/**
 * validation/m14/fixtures/php/typed-class-const.php
 *
 * PHP 8.3 TYPED CLASS CONSTANTS — `const Dep X = 1;` — in the R9 declared-type graph.
 *
 * WHY THIS POSITION NEEDED A FIXTURE RATHER THAN A RULING. `phpDeclaredTypeRefs`
 * carried typed class constants on its "BOUNDARIES, DISCLOSED" list for months: a
 * source comment saying the position was deliberately unwritten. The M60 master
 * review found two things wrong with that, one procedural and one substantive.
 *
 * PROCEDURAL: the disclosure was UNRULED. The spec claims `const_declaration` is
 * `handled_verified` and carries no decision naming typed class constants, so the
 * position was documented in a code comment and absent from the adjudication set —
 * an unexamined claim wearing a disclosure's clothes. php has 33 design decisions
 * and this was in none of them.
 *
 * SUBSTANTIVE: it was never a boundary. Probe-verified against the pinned wasm, the
 * grammar carries the type as an ordinary `type` field on the declaration:
 *
 *     const_declaration
 *       const
 *       named_type      <- the dependency
 *         name
 *       const_element
 *         name          <- the constant's own name
 *
 * That is a sibling of the position `property_declaration.type` already handled, in
 * the same `declaration_list`, naming the same kind of thing. A class writing
 * `const Dep X` depends on `Dep` exactly as it does writing `private Dep $f`, and
 * R9's rule is that a declaration which WRITES a type name depends on the type it
 * names. Ruling the position out would have manufactured a gap in order to avoid
 * writing the case — so it is HANDLED, attributed exactly like a property.
 *
 * WHY THE CORPORA COULD NOT CONFIRM IT, MEASURED NOT GUESSED. Both pinned corpora
 * were walked for `const_declaration` nodes carrying a `type` field:
 *
 *     4,463 files · 243 const_declarations · 81 of them TYPED
 *
 * and every one of those 81 is a `primitive_type` — `private const string
 * PAGE_HEADER`, `public const int VERSION`. Primitives are silent BY DESIGN (the
 * grammar tags them, so `string` is not a dependency on a userland symbol), which is
 * why the position is genuinely exercised 81 times. But a NAMED type — the case that
 * actually produces an edge — occurs ZERO times. So the absence of `const Dep`
 * references in the corpus looked identical to correct behaviour, and the full-extent
 * differential read 100% either way. That is the lane's recurring lesson applied to
 * itself: 100% coverage is a statement about the corpus, not about the language, and
 * this is the same shape as the grouped-`use` defect that 4,139 files and 95,231
 * edges reported clean while missing the construct entirely.
 *
 * So the fixture is the ONLY evidence this position works, which is exactly why it
 * carries a reverting mutant (`php/typed-class-const-dropped`). A pin with no mutant
 * is a comment.
 */

namespace Fixture\TypedConst;

class Dep {}
class Other {}
class First {}
class Second {}
class Opt {}

class Constants
{
    // THE POSITION: a named type written on the constant.
    public const Dep DEPENDENCY = 1;

    // wrappers descend — each member of a written type is a dependency, exactly as
    // for a property. `?Opt` is one member; `First|Second` is TWO.
    public const ?Opt NULLABLE = null;
    public const First|Second UNION = 1;
    // a qualified name publishes its LEAF, which is what every other php edge keys
    // on: `\App\Lib\Dep` -> `Dep`.
    public const \App\Lib\Dep QUALIFIED = 1;

    // a relative type resolves to the ENCLOSING CLASS, not to a symbol in the file.
    public const self SELF_REFERENCE = 1;

    // THE TWO THAT MUST STAY SILENT. A primitive is tagged by the grammar and is not
    // a dependency on anything; the second is a constant with NO type at all, which is
    // the overwhelming majority of real code (243 const_declarations in the corpora,
    // and 81 of those typed, so 162 are untyped).
    public const string PRIMITIVE = 'a';
    public const int PRIMITIVE_INT = 1;
    public const UNTYPED = 'b';
}

/** Interfaces and traits declare constants in the same shape. */
interface Contract
{
    public const Dep CONTRACT_DEP = 1;
}

trait Shared
{
    public const Dep SHARED_DEP = 1;
}

/**
 * A FILE-SCOPE typed constant has no enclosing type, and a `references` edge still
 * needs a source. It is attributed to `global` — the same file-scope owner the read
 * rules use when neither a callable nor a class encloses the position (the trait-use
 * precedent, PHP-O1) — rather than dropped, because a written dependency is not less
 * real for having no owner symbol.
 */
const Dep FILE_SCOPE_DEP = 1;

/** An untyped file-scope constant, which must stay silent. */
const FILE_SCOPE_PLAIN = 'c';
