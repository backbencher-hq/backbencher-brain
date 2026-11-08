// PINS the csharp wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
// Uniform wave convention: class Greeter with method Greet, exercised in Main.

using System;
using System.Collections.Generic;

namespace WaveTest
{
    /// <summary>A greeter that reports the number of items it stores.</summary>
    public class Greeter
    {
        private readonly List<string> _items;

        public Greeter(List<string> items)
        {
            _items = items;
        }

        /// <summary>Returns the greeting for the stored items.</summary>
        public string Greet()
        {
            return "hello " + _items.Count;
        }
    }

    public static class Program
    {
        public static void Main()
        {
            var greeter = new Greeter(new List<string> { "a", "b" });
            Console.WriteLine(greeter.Greet());
        }
    }
}
