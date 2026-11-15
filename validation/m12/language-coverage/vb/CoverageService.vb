' Minimal VB.NET fixture for the M12 language-coverage gate.
'
' `vb` is the language whose grammar had to be vendored and repaired because no
' VB.NET grammar is published on npm (see grammars/tree-sitter-vbnet/PIN.md), and
' validation/m12/fixtures/ had no vb/ directory. A class with a method and an
' interface: the declarations a regex "generic" pass cannot see, which is what the
' language used to be analysed by.

Public Class CoverageService
    Public Function Add(ByVal a As Integer, ByVal b As Integer) As Integer
        Return a + b
    End Function
End Class

Public Interface ICoverage
    Sub Deposit(ByVal amount As Integer)
End Interface
