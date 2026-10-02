Class C
    Declare Function GetForegroundWindow Lib "user32.dll" () As IntPtr
    Declare Sub MessageBox Lib "user32" Alias "MessageBoxA" (ByVal text As String) As Integer
End Class
