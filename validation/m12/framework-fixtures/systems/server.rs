use actix_web::{web, App, HttpServer, HttpResponse};
use rayon::prelude::*;

async fn index() -> HttpResponse {
    HttpResponse::Ok().body("hi")
}

fn sum_parallel(v: &[i64]) -> i64 {
    v.par_iter().sum()
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| App::new().route("/", web::get().to(index)))
        .bind("127.0.0.1:8080")?
        .run()
        .await
}
