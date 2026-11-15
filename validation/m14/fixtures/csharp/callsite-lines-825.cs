// M59.A7 (#825) — the csharp lane's line round fixture.
//
// Every edge below is pinned to the line where its TARGET is written, and the
// pre-fix shape is forbidden in the expectation file. The four traps this lane
// actually has (all measured with script/m14/tmp/cs-line-shapes.ts, never
// assumed) are laid out here deliberately:
//
//   * a declaration's NAME is not always on its FIRST line — an attribute
//     (`[System.Obsolete]`), a wrapped signature (`public void` / `Fill()`), and
//     a multi-declarator field all put it later, so `contains` is stamped from
//     the name node and not from the declaration's start;
//   * an invocation node starts at its RECEIVER, so `this.helper` / `.Strip()`
//     must stamp the callee leaf;
//   * a `constructor_initializer` starts at its `:` and its `base`/`this` keyword
//     is an anonymous child, so a wrapped initializer must stamp the keyword;
//   * a target-typed `new()` names NO type at the call site — the target is
//     written in the DECLARATION, and for the assignment form it is written on
//     the member's declaration, a different line and a different subtree.

using System.Collections.Generic;
using Config = System.Text.Json.JsonSerializerOptions;

namespace Pin
{
    public interface IShape
    {
        int Area { get; }
    }

    public class Base
    {
        public virtual void Greet() { }
    }

    public class Item { }

    public class Helper
    {
        public void Strip() { }
    }

    [System.Obsolete("pin")]
    public class Widget
        : Base,
          IShape
    {
        private List<Item> _items;

        private Helper helper;

        private const int Limit = 3;

        [System.Obsolete("pin")]
        private int _stale;

        private int _a, _b;

        [System.Obsolete("pin")]
        public Widget()
        {
            _items = new();
        }

        public Widget(int x)
            :
                base()
        { }

        ~Widget()
        {
        }

        public int this[int i] => 0;

        public int Area => 0;

        [System.Obsolete("pin")]
        public override void Greet()
        {
            _items = new();
        }

        public void
            Fill()
        {
            var first = new
                Item();
            var bag = new List<Item>();
            List<Item> other
                = new();
            this.helper
                .Strip();
            var count = this._items
                .Count;
            return
                Limit;
        }
    }

    // A WRAPPED qualified name: the grammar allows whitespace between the `.`
    // and the next identifier, so the name STARTS on one line and its last
    // segment is WRITTEN on the next. Both halves matter — the target is the
    // canonical name (never the layout, which carried a newline before this
    // round) and the claimed line is the leaf's own, not the name's first line.
    using System
        .Text;

    public class Wrapped
        : System.
            IDisposable
    {
        public void Dispose() { }
    }

    public class WrappedChild
        : Pin.
            Base
    {
    }
}
