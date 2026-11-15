pub mod network {
    pub fn connect(host: &str, port: u16) -> bool {
        let ok = do_connect(host, port).await;
        ok
    }
    async fn do_connect(host: &str, port: u16) -> bool {
        std::net::TcpStream::connect(format!("{host}:{port}")).await.is_ok()
    }
}
