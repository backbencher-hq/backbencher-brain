Attribute VB_Name = "WaveTest"
' PINS the vba wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
' Uniform wave convention: type Greeter with function Greet, exercised in GreetAll.

Option Explicit

''' <summary>A list of greeting subjects.</summary>
Public Type Greeter
    Items As Variant
End Type

''' <summary>Returns the greeting for a greeter.</summary>
Public Function Greet(ByRef greeter As Greeter) As String
    Greet = "hello " & (UBound(greeter.Items) - LBound(greeter.Items) + 1)
End Function

''' <summary>Exercises Greet from a second procedure.</summary>
Public Sub GreetAll()
    Dim greeter As Greeter
    greeter.Items = Array("a", "b")
    Debug.Print Greet(greeter)
End Sub
