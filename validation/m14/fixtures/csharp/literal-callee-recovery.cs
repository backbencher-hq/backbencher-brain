// csharp — the LITERAL-CALLEE fabrication, found by the M59.A7 (#825) depth draw
// rather than by reading the analyzer.
//
// On powershell's
// src/System.Management.Automation/engine/remoting/common/RunspaceConnectionInfo.cs
// the 900-file draw reported exactly one unexplained edge:
//   calls StartSSHProcess -> false (line 2331)
// where line 2331 is `startInfo.UseShellExecute = false;`. The cause is the
// grammar's ERROR recovery (measured with script/m14/tmp/cs-u2331-probe.ts): a
// boolean literal and a `return …(...)` ten lines later are parsed as ONE
// invocation_expression — `false` + ERROR + argument_list — so the node that
// carries the callee is a `boolean_literal`, and the analyzer's target hygiene
// (a keyword set + an identifier SHAPE check + a builtin set) cannot see that:
// `false` is a well-formed identifier as far as a string check goes.
//
// The trigger is one missing semicolon, which makes this reproducible in a
// fixture instead of only on a corpus file:
//   void Damaged()   — `… = false` with NO semicolon, then `return …(...)`.
// The LEGAL method right below is the same code WITH the semicolon: it must
// still emit its calls, so the fix cannot be "drop calls near error nodes".
//
// The rule now enforced is structural — a call's callee must be a NAME node
// (identifier or generic_name), never a literal or any other node type — which
// is the same rule the pre-existing keyword-list rejection encodes for the
// legal `if (...)` case.

class LiteralCallee
{
    void Damaged(string filePath)
    {
        var startInfo = new System.Diagnostics.ProcessStartInfo();
        startInfo.WorkingDirectory = System.IO.Path.GetDirectoryName(filePath);
        startInfo.CreateNoWindow = true;
        startInfo.UseShellExecute = false
        return StartSSHProcessImpl(startInfo, out a, out b, out c);
    }

    void Legal(string filePath)
    {
        var startInfo = new System.Diagnostics.ProcessStartInfo();
        startInfo.WorkingDirectory = System.IO.Path.GetDirectoryName(filePath);
        startInfo.CreateNoWindow = true;
        startInfo.UseShellExecute = false;
        return StartSSHProcessImpl(startInfo, out a, out b, out c);
    }
}
