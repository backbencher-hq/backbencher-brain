Attribute VB_Name = "LoopsAndSelect"
Option Explicit

Public Sub Iterate(ByVal values As Variant, Optional ByRef limit As Long = 3, ParamArray rest() As Variant)
    Dim item As Variant
    For i = 1 To limit
        values = values + i
    Next i
    For Each item In rest
        Select Case item
            Case 1
                Call Consume(item)
            Case Else
                Exit For
        End Select
    Next item
End Sub
