Attribute VB_Name = "Representative"
Option Explicit

Public Const MaxCount As Long = 3
Private count As Long

Public Sub Main()
    Dim item As Widget
    Set item = New Widget
    item.Run count
    Call LogMessage(item.Name)
End Sub

Public Function Add(ByVal left As Long, ByVal right As Long) As Long
    Add = left + right
End Function

Private Sub LogMessage(ByVal value As String)
    Debug.Print value
End Sub
