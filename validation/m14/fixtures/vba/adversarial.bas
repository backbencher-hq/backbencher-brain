Attribute VB_Name = "Adversarial"
Option Explicit

Public Type Point
    X As Long
    Y As Long
End Type

Public Enum Color
    Red = 1
    Blue = 2
End Enum

Public Event Changed(ByVal value As Long)
Public Declare PtrSafe Function GetTickCount Lib "kernel32" () As Long
Implements IWorker

Public Property Get CurrentColor() As Color
    CurrentColor = Blue
End Property

Public Property Let CurrentColor(ByVal value As Color)
    RaiseEvent Changed(value)
End Property

Public Sub Execute(ByVal point As Point)
    Dim color As Color
    color = Red
    Call Work(point.X)
End Sub
