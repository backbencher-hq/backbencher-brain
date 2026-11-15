using System;

namespace App;

public static class MathUtil
{
    public static int Add(int a, int b) => a + b;

    public static int Clamp(int value, int min, int max)
    {
        return Math.Max(min, Math.Min(max, value));
    }
}
