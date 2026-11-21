//! SSE server the existing globe can use without changes.
//!
//! Routes match `visualizer/server.mjs`: `/api/catalog`, `/api/state`,
//! `/api/events`, `/api/scan`, and `/api/stop`. Static files come from
//! `visualizer/public` so http://127.0.0.1:4173 still opens the HUD.

#![deny(unsafe_code)]

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::exit;

use downtime_native::find_root;
use downtime_server::{serve, ServerConfig};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let mut root = None;
    let mut port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(4173u16);
    let mut workers = env::var("WORKERS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(24usize);
    let mut lookup = env::var("DOWNTIME_NO_LOOKUP").is_err();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => root = args.next().map(PathBuf::from),
            "--port" => {
                port = args
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_else(|| {
                        eprintln!("--port needs a number");
                        exit(1);
                    });
            }
            "--workers" => {
                workers = args
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_else(|| {
                        eprintln!("--workers needs a number");
                        exit(1);
                    });
            }
            "--no-lookup" => lookup = false,
            "-h" | "--help" => {
                println!(
                    "downtime-server [--root DIR] [--port N] [--workers N] [--no-lookup]\n\n\
                     Serves the globe in visualizer/public and the same /api routes as server.mjs.\n\
                     PORT and WORKERS environment variables are also read."
                );
                return;
            }
            other => {
                eprintln!("Unknown argument {other}");
                exit(1);
            }
        }
    }
    let root = match root {
        Some(path) => path,
        None => find_root(&env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            .unwrap_or_else(|| {
                eprintln!("Cannot find the catalog. Pass --root.");
                exit(1);
            }),
    };
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("Could not listen on {addr}: {err}");
            exit(1);
        }
    };
    let bound = listener.local_addr().unwrap_or(addr);
    let config = ServerConfig {
        root: root.clone(),
        static_dir: root.join("visualizer").join("public"),
        workers,
        lookup,
    };
    match downtime_native::load_catalog_dir(&root) {
        Ok(loaded) => {
            let rows: usize = loaded
                .searches
                .iter()
                .filter(|search| search.group == "global")
                .map(|search| search.count)
                .sum();
            let weather = loaded
                .searches
                .iter()
                .find(|search| search.id == "weather")
                .map(|search| search.count);
            println!("Downtime visualizer (Rust)  http://{bound}");
            println!("{rows} catalog rows across searches");
            if let Some(count) = weather {
                println!("Weather search: {count} places");
            }
        }
        Err(err) => {
            eprintln!("{err}");
            exit(1);
        }
    }
    if let Err(err) = serve(listener, config).await {
        eprintln!("{err}");
        exit(1);
    }
}
