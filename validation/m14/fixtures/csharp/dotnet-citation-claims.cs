// CSHARP FIXTURE — the .NET citation claim (task-37 follow-up 2).
//
// The verdict arm measured 706 `externalUnverified` (`ext?`) IMPORTS rows that collapse to seven
// .NET platform/library namespaces. The Lead committed them as the `dotnet-platform-libraries`
// citation vocabulary; a `using` directive naming one now publishes the namespace claim WITH
// `strict-absent` so the arbiter verifies it from the committed list and never displaces a
// name-model answer. The other direction is just as load-bearing: a `System.*` namespace OUTSIDE
// the committed list gets NO marker, so the vocabulary cannot be widened by accident.
using System.Text.Json;
using Newtonsoft.Json;
using System.Xml;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http.Json;
using BenchmarkDotNet.Exporters.Csv;
using BenchmarkDotNet.Exporters.Json;

// NOT in the committed list: these must stay unmarked (byte-identical edge metadata).
using System.Text;
using System;

namespace Acme.Citation
{
    public class UsesImports
    {
        public string Serialize(object value) => System.Text.Json.JsonSerializer.Serialize(value);
    }
}
