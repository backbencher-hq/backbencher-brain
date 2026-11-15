Attribute VB_Name = "ControlFlow"
Option Explicit

Private WithEvents worker As Worker

Public Sub Process(ByVal items As Variant)
    Dim item As Variant
    With Application
        .Run "Refresh"
    End With
    For Each item In items
        If item > 0 Then
            Debug.Print item
        End If
    Next item
    On Error GoTo Handler
    ReDim Preserve items(1 To 3)
Handler:
    worker = Nothing
End Sub
