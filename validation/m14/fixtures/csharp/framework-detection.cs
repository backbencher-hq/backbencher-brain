// CONV-CS-2 (#751): framework detection — three simultaneous marker families:
// ASP.NET Core (using root + Controller base + [HttpGet]), Entity Framework
// Core (using root + DbContext base), xUnit (using root + [Fact]). The primary
// pick is deterministic (fixed priority), and absent families must never be
// fabricated (forbidFrameworks in the expectation guards over-matching).
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

public class HomeController : Controller
{
    [HttpGet("/")]
    public string Index() { return "hi"; }
}

public class AppDb : DbContext
{
    public string Name = "";
}

public class HomeTests
{
    [Fact]
    public void IndexWorks() { }
}
