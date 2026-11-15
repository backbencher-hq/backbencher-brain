// CS-R1 (csharp review): bare-identifier value reads + the small fixes.
// Top-level statements run first (C# requires them before type
// declarations); their calls attribute to global (CS-B1) and their
// locals bind in the file frame.
using System;
using System.Linq;

System.Console.WriteLine("top");
int topmark = 41;
System.Console.WriteLine(topmark + 1);

class Widget
{
    static int Max = 100;
    int count;
    const int Step = 2;
    static int p = 1;
    static int q = 2;
    static int x = 3;
    static int v = 4;
    static int w = 5;
    static int a = 6;
    static int b = 7;
    static int y = 8;
    static int topmark = 9;

    int Get()
    {
        return Max + count + Step;
    }

    int Shadowed(int Max)
    {
        return Max;
    }

    bool Check(object o)
    {
        if (o is Point p)
        {
            return true;
        }
        return false;
    }

    int Arm(object o)
    {
        return o switch
        {
            Point q => q.X,
            _ => 0
        };
    }

    void Flow(int[] xs)
    {
        foreach (var x in xs) { Take(x); }
        var q = from y in xs select y;
        Func<int, int> f = (p) => p + Max;
        Action g = () => Take(Max);
        Take(f(1));
    }

    void Guards(string s)
    {
        if (int.TryParse(s, out int v)) { Take(v); }
        int w;
        if (int.TryParse(s, out w)) { Take(w); }
        (int a, int b) = (1, 2);
        (w, v) = (a, b);
        Take(a + b + w + v);
    }

    void Errors()
    {
        try { Work(); }
        catch { Done(); }
    }

    void ErrorsTyped()
    {
        try { Work(); }
        catch (Exception e) { Fail(e); }
    }

    string NameOf()
    {
        return nameof(Max);
    }

    void Errors()
    {
        try { Work(); }
        catch { Done(); }
    }

    void ErrorsTyped()
    {
        try { Work(); }
        catch (Exception e) { Fail(e); }
    }
}

class Holder
{
    static int Limit = 10;
    int bound = Limit;
}

enum Level { Low = 10, High = 20 }

class Tiers
{
    static int Plain = 30;
    int Pick(bool flag)
    {
        return flag ? Level.Low : Level.High;
    }

    int Sized()
    {
        int[] arr = new int[Plain];
        return arr[0];
    }
}

class WithProps
{
    int value;
    int _v;
    int P { get { return value; } set { _v = value; } }
}

class Point
{
    public int X;
    public int Y;
    public void Deconstruct(out int x, out int y) { x = X; y = Y; }
}

class P
{
    public int X;
}

class Shapes
{
    static int X = 1;
    static int Y = 2;
    static int G = 3;

    P Make(P p)
    {
        var q = p with { X = 10 };
        var a = new { Y = 20, Z = G };
        return q;
    }

    bool Sub(Point pt)
    {
        return pt is { X: 1, Y: var y } && y > 0;
    }

    bool Pos(object o)
    {
        return o is Point(1, int y) && y > 0;
    }

    Point Build()
    {
        return new Point { X = G, Y = 2 };
    }
}

class Base
{
    protected static int Shared = 1;
}

class Derived : Base
{
    int M() { return Shared; }
    class Inner
    {
        int N() { return Shared; }
    }
}

[MyAttr(Size = 3, Other)]
class Annotated
{
    const int Other = 20;
    const int Size = 10;
}

file class Hidden
{
    public void M() { }
}
