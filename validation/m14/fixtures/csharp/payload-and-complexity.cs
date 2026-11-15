// PINS csharp relationship kinds + #419-D evidence tiers + payloads
// (completeness sections B/C/D): contains, extends, implements, instantiates,
// calls, uses, overrides, references/imports, per-symbol complexity, and
// qualified_calls. A regression that drops any kind, tier, or payload fails
// this fixture (csharp #264 managed-OO wave).
using System;
using System.Collections.Generic;
namespace Acme.Domain;

public interface IShape
{
    double Area { get; }
    string Describe();
}

public abstract class Shape : IShape
{
    public string Name { get; set; } = "";
    public virtual double Area => 0;
    public virtual string Describe() => $"shape {Name}";
}

public sealed class Circle : Shape
{
    public double Radius { get; set; }
    public override double Area => Math.PI * Radius * Radius;
    public override string Describe()
    {
        var msg = $"circle r={Radius}, area={Area}";
        Console.WriteLine(msg);
        return this.Name + ":" + msg;
    }

    // SCD1 write-gate fixture (M37 #599 pre-wave): both statements are
    // assignment-LHS writes on this.Name — no uses edge may originate from
    // Reset; Describe's this.Name READ stays expected above.
    public void Reset()
    {
        this.Name = "";
        this.Name += "!";
    }
}

public class CircleComparer : IComparer<Circle>
{
    public int Compare(Circle a, Circle b) => a.Area.CompareTo(b.Area);
}

// CSD2 pin: switch EXPRESSION arms are decision points (re-review 2026-09-04
// — arms were never counted, Pick returned complexity 1 for 3 arms).
public class Classifier
{
    public int Pick(int x)
    {
        return x switch
        {
            1 => 10,
            2 => 20,
            _ => 0,
        };
    }
}

public static class Factory
{
    public static IShape MakeCircle(double r)
    {
        var c = new Circle { Radius = r };
        c.Describe();
        return c;
    }
}
// F6 coverage (2026-09-02): namespace/struct/record/enum declarations, delegates,
// constructors/destructors, operator + conversion operators, fields, events,
// indexers, generics (type_parameter_list/type_parameter), explicit interface
// implementation, constructor_initializer, attributes, tuples, generic
// constraints, primary constructor base, bracketed parameter list — declared
// handled_verified, now exercised.
namespace F6.Domain;

[Flags]
public enum F6Mode
{
    None = 0,
    Fast = 1,
    Slow = 2
}

public struct F6Point
{
    public int X;
    public int Y;

    public F6Point(int x, int y)
    {
        X = x;
        Y = y;
    }

    public static F6Point operator +(F6Point a, F6Point b) => new(a.X + b.X, a.Y + b.Y);

    public static implicit operator int(F6Point p) => p.X;

    public int this[int i] => i == 0 ? X : Y;
}

public record F6Receipt(string Sku, int Qty);

public delegate int F6Compute(int seed);

public class F6Tank<T> : IDisposable where T : class, new()
{
    private readonly List<T> _items = new();
    public event EventHandler? Overflow;

    ~F6Tank()
    {
        _items.Clear();
    }

    public F6Tank(IEnumerable<T> seed) : this()
    {
        _items.AddRange(seed);
        // CSD11 pin: assignment-form target-typed new() — the declared type
        // lives on the field symbol, not a declarator. Emits instantiates via
        // the member-type pre-pass map (was a silent no-edge asymmetry:
        // explicit `new List<T>()` here emitted, `new()` did not).
        _cache = new();
    }

    private Dictionary<string, T> _cache = new();

    (string Name, int Rank) Lookup(T item) => (item?.ToString() ?? "?", 1);

    // CSD4 pin: null-conditional MEMBER READ (`_items?.Count`) emits uses via
    // member_binding_expression — was invisible before the re-review fix.
    public int SafeCount() => _items?.Count ?? 0;

    void IF6Handler.Handle(F6Point p, params object[] rest)
    {
        if (p.X > 0 && p.Y > 0 || p.X == int.MinValue)
        {
            Overflow?.Invoke(this, EventArgs.Empty);
        }
    }

    public void Dispose() { }
}

public struct F6Handle : IDisposable
{
    // CSD12 pin: structs can NEVER inherit in C# — every base of a struct is
    // an interface regardless of I-naming. Emits implements, never extends.
    public void Dispose() { }
}

public interface IF6Handler
{
    void Handle(F6Point p, params object[] rest);
}

public class F6Derived : F6Receipt("seed", 1)
{
    public F6Derived() { }
}

// F6: block-form namespace_declaration (file-scoped `namespace X;` parses as
// file_scoped_namespace_declaration, probed separately).
namespace F6Block
{
    public class F6Evented
    {
        // F6: event_declaration (add/remove accessors — field-like events parse
        // as event_field_declaration).
        public event EventHandler F6Overflow
        {
            add { }
            remove { }
        }
    }

    // F6: primary_constructor_base_type — record with primary ctor inheriting
    // another record with base args.
    public record F6Audited(string Sku, int Qty) : F6Receipt(Sku, Qty);
}
