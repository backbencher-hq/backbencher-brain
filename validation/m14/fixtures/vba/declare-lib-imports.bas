Attribute VB_Name = "ExternalApi"

Declare Function GetTickCount Lib "kernel32" () As Long
Declare PtrSafe Function MessageBox Lib "user32" Alias "MessageBoxA" (ByVal hWnd As Long, ByVal lpText As String) As Long
Declare Sub Sleep Lib "kernel32" (ByVal dwMilliseconds As Long)
Private Declare Sub OutputDebugString Lib "kernel32" Alias "OutputDebugStringA" (ByVal lpOutputString As String)

Public Sub Wait()
    Sleep 10
    Dim started As Long
    started = GetTickCount()
End Sub
