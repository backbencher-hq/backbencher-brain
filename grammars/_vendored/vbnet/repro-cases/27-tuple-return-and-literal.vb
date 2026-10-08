Imports System

Module M
    ' VB 2017+ tuple return: a FUNCTION whose return type is a tuple, and a
    ' RETURN whose expression is a comma list. Both halves of the feature.
    ' The TYPE half is expressible in this grammar (tuple_type, added with the
    ' type repairs). The EXPRESSION half is not: `parenthesized_expression` is
    ' seq("(", $._expression, ")") with no comma alternative, so the tuple
    ' literal has no production and the comma becomes an ERROR node.
    Function Split2(s As String) As (Integer, Integer)
        Dim i As Integer = s.IndexOf("x")
        Return (i, s.Length)
    End Function

    Function Swap(a As Integer, b As Integer) As (Integer, Integer)
        Return (b, a)
    End Function

    Sub Consume2()
        Dim p As (Integer, Integer) = Split2("x")
        Dim q = (1, 2)
        Dim r = (p.Item1, p.Item2)
    End Sub
End Module
