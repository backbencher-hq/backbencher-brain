' PINS the vb wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
' Uniform wave convention: class Greeter with function Greet, exercised in Main.

Imports System
Imports System.Collections.Generic

''' <summary>A greeter that reports the number of items it stores.</summary>
Public Class Greeter
    Private ReadOnly _items As List(Of String)

    Public Sub New(items As List(Of String))
        _items = items
    End Sub

    ''' <summary>Returns the greeting for the stored items.</summary>
    Public Function Greet() As String
        Return "hello " & _items.Count.ToString()
    End Function
End Class

Module Program
    Sub Main()
        Dim greeter As New Greeter(New List(Of String) From {"a", "b"})
        Console.WriteLine(greeter.Greet())
    End Sub
End Module
