Class C
    Sub S()
        Using netstatProc As New Process() With {
            .StartInfo = New ProcessStartInfo() With {
                .FileName = "cmd.exe",
                .CreateNoWindow = True
            }
        }
            netstatProc.Start()
        End Using
    End Sub
    Private x As New List(Of String)
    Private y As New Dictionary(Of String, Integer)
    Private z As New DateTime(2020, 1, 1)
    Private w As New Size(2) With { .X = 1 }
End Class
