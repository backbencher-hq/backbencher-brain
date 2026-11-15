using System;
using System.Collections.Generic;

namespace Example.Negative;

public class Negative
{
    private int counter;

    public void LocalsAreNotSymbols()
    {
        int localA = 1;
        var localB = "text";
        int localC = localA + 2;
        Console.WriteLine(localB + localC);
    }

    public void ParamsAreNotSymbols(string input, int count)
    {
        counter = count;
        Console.WriteLine(input);
    }

    public void BuiltinsAreFiltered()
    {
        Console.WriteLine("noise");
        Console.Write("more");
        string s = "x";
        string t = s.ToString();
        bool eq = t.Equals("x");
        int h = t.GetHashCode();
        Type ty = t.GetType();
    }

    public void LambdaParamsAreNotSymbols()
    {
        var list = new List<int> { 1, 2, 3 };
        var doubled = list.Select(x => x * 2);
        Console.WriteLine(doubled.Count());
    }

    public void AccessorsAreNotScopes()
    {
        var c = new Counter { Value = 3 };
        int v = c.Value;
        Console.WriteLine(v);
    }

    public class Counter
    {
        public int Value { get; set; }
    }

    public void TargetTypedNew()
    {
        List<int> numbers = new();
        numbers.Add(1);
        Console.WriteLine(numbers.Count);
    }
}
