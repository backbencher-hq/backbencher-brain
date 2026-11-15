Attribute VB_Name = "MemberAccess"
Option Explicit

Public Sub ReadAndWrite(ByVal item As Widget)
    Dim value As String
    value = item.Name
    item.Name = value
End Sub
