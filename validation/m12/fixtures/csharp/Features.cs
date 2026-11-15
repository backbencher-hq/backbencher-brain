using System;
using System.Collections.Generic;
using System.Linq;

namespace Example.Features;

[Flags]
public enum Status
{
    None = 0,
    Active = 1,
    Inactive = 2,
}

public record Point(int X, int Y)
{
    public double Distance(Point other)
    {
        var dx = X - other.X;
        var dy = Y - other.Y;
        return Math.Sqrt(dx * dx + dy * dy);
    }
}

public record struct Vector2(float X, float Y);

public interface IShape
{
    string Describe();
}

public abstract class BaseShape
{
    public string Name { get; set; } = "shape";
}

public class Shape : BaseShape, IShape, IComparable<Shape>
{
    public string Display => Name.ToUpper();

    public string this[int index] => Name[index].ToString();

    public event EventHandler<EventArgs>? Changed;

    public string Describe()
    {
        return Name;
    }

    public int CompareTo(Shape? other)
    {
        return string.Compare(Name, other?.Name, StringComparison.Ordinal);
    }

    public static Shape operator +(Shape a, Shape b)
    {
        return new Shape { Name = a.Name + b.Name };
    }

    public static implicit operator string(Shape s)
    {
        return s.Name;
    }
}

public delegate bool Filter(Shape s);

public static class ShapeExtensions
{
    public static IEnumerable<Shape> WhereLarge(this IEnumerable<Shape> source, Filter filter)
    {
        return source.Where(filter);
    }
}

public class PrimaryCtor(string name)
{
    public string Greet()
    {
        return "Hello " + name;
    }
}
