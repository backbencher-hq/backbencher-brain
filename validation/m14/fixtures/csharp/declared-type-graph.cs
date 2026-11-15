// validation/m14/fixtures/csharp/declared-type-graph.cs — the R9 declared-type
// reference graph: every position that WRITES a type name, and every shape a written
// type can take.
//
// The positions are the contract's list (the M60 R9 register): field / variable
// declaration, parameter, return type, property, indexer, event, delegate. The shapes
// are the ones where a naive walk gets the NAME wrong rather than missing it:
// generic (base AND argument — the argument is the real dependency), qualified
// (leaf published, not the whole path), array / nullable / pointer / ref wrappers,
// tuple elements, and the two spellings that must NOT become names: a predefined type
// (`int`, `string`) and `var` (an implicit type, whose node is a plain `identifier`).

namespace Fixture.DeclaredTypes
{
    public class Dep { }
    public class Other { }
    public interface IShape { }

    // A member whose type is its own class: the family emits the self-edge (rust's
    // `Selfish` precedent), so this pins that it is not silently dropped.
    public class Node
    {
        private Node _next;
    }

    public class Holder<T>
    {
        // field: the base class of a bare, a wrapped and a qualified name
        private Dep _bare;
        private Dep[] _array;
        private Dep? _nullable;
        private System.Text.StringBuilder _qualified;
        private List<Dep> _generic;
        private Dictionary<string, Dep> _genericTwo;
        private (Dep First, int Count) _tuple;
        private unsafe Dep* _pointer;
        private ref Dep _byRef;

        // the two that must stay silent
        private int _count;
        private string _label;

        // a type PARAMETER bound by an enclosing generic declaration is not a
        // dependency: this depends on List, not on T (rust's R13 rule). The method's own
        // `T`/`U` is a different binding, so neither may leak into the other.
        private List<T> _genericBound;

        // property and indexer
        public Dep Property { get; set; }
        public Other this[int index] { get { return null; } }

        // event
        public event Action<Dep> Changed;

        // delegate: return type and parameter types
        public delegate Dep Factory(Dep seed);

        // method: return type and parameter types, plus locals
        public Dep Build(Dep first, List<Other> rest, int count)
        {
            Dep local = first;
            var implicitLocal = first;
            List<Other> localGeneric = rest;
            List<T> localBound = null;
            return local;
        }

        // A method with its OWN type parameter: `U` here is a different binding from
        // the class's `T`, so neither may be attributed as the other's.
        public Other Generic<U>(U value)
        {
            List<U> bound = null;
            return null;
        }
    }
}
