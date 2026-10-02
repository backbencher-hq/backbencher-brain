Imports System.Collections.Generic

Class C
    Function F(Period As Double) As Double
        Return (Period - Factor) / Period
    End Function
    Sub G()
        Dim d As Double = 1.0#
        Dim e As Decimal = 1.0@
        Dim f As Single = 1.0!
        Dim g As Double = 1.0F
        Dim h As Double = 1.0R
        Dim i As Integer = 5%
        Dim j As Long = 5&
    End Sub
End Class
