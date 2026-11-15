// C923 (#923): the member-level interface-implementation contract.
//
// Every member here exists to pin one half of the contract or one of its refusals:
//   IMPLICIT  a member that satisfies an interface declared in this file        -> edge
//   EXPLICIT  the interface is WRITTEN in the declaration                       -> edge, always
//   CHAIN     through an interface's own base list (IThingEx : IThing)          -> edge
//   HIDDEN    a base class already fills the slot                               -> NO edge
//   UNRELATED a same-named member of a type that implements nothing             -> NO edge
//   EXTERNAL  a base-list interface the file never declares                     -> NO edge
//   HELPER    a member no interface declares                                    -> NO edge
using System;

namespace C923
{
    public interface IThing
    {
        string GetName();
        int Count { get; }
        void Reset();
        event EventHandler Changed;
    }

    public interface IThingEx : IThing
    {
        void Extra();
    }

    // Declared ABOVE the interfaces it implements, so the contract pass cannot be order-dependent.
    public class ImplicitEarlier : IThing
    {
        public string GetName() => "n";
        public int Count => 1;
        public void Reset() { }
        public event EventHandler Changed;
    }

    // An interface the file never declares: the implicit form must publish NOTHING for it (its
    // member set is unknowable here), while the explicit form must publish anyway.
    public class ExternalContract : IExternalThing
    {
        public void Run() { }
    }

    public class Implicit : IThingEx
    {
        public string GetName() => "n";
        public int Count => 1;
        public void Reset() { }
        public event EventHandler Changed;
        public void Extra() { }
        public void Helper() { }
    }

    // The interface chain: `GetName` is satisfied through IThingEx : IThing.
    public class Chain : IThingEx
    {
        public string GetName() => "n";
        public void Extra() { }
    }

    // A base class already implements the slot; the derived `new` member does NOT claim it.
    public class Middle : IThing
    {
        public string GetName() => "m";
        public int Count => 1;
        public void Reset() { }
        public event EventHandler Changed;
    }

    public class Hidden : Middle
    {
        public new string GetName() => "h";
    }

    // Same member NAME, no interface implemented, while IThing is declared in this very file:
    // name matching alone must never license an edge.
    public class Unrelated
    {
        public string GetName() => "u";
        public void Reset() { }
    }

    public class Explicit : IThing, IExternalThing
    {
        string IThing.GetName() => "n";
        int IThing.Count => 1;
        void IThing.Reset() { }
        // The accessor form is the only explicit-event form C# allows.
        event EventHandler IThing.Changed { add { } remove { } }
        int IExternalThing.Run() => 0;
    }

    // A base class whose member is NOT an interface member: the `override` edge is the ordinary
    // base-override contract (Base.Label -> Base.Label), never an interface edge.
    public abstract class Base
    {
        public abstract string Label();
    }

    public class OverridesBase : Base
    {
        public override string Label() => "l";
    }
}
