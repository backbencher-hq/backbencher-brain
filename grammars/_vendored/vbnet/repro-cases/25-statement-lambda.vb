Class C
    Sub S()
        Task.Run(Sub()
            Foo()
        End Sub)
        Task.Run(Sub()
        End Sub)
        Dim f = Function() As Integer
            Return 1
        End Function
        Dim g = Sub(x As Integer)
            Bar(x)
        End Sub
        Dim h = Sub() 1
    End Sub
End Class
