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
    let mut static_dir = None;
    let mut bind = env::var("GSA_BIND").unwrap_or_else(|_| "127.0.0.1".into());
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
            "--static" | "--globe" => static_dir = args.next().map(PathBuf::from),
            "--bind" => bind = args.next().unwrap_or_else(|| "127.0.0.1".into()),
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
                    "downtime-server [--root DIR] [--static DIR] [--bind ADDR] [--port N] [--workers N] [--no-lookup]\n\n\
                     Tokio multi-thread server. Serves /api/blast, /api/leaves (Rustle), catalog scan.\n\
                     Default static dir is globalstatus/ when present, else visualizer/public.\n\
                     PORT, WORKERS, and GSA_BIND are also read."
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
    let ip: std::net::IpAddr = bind.parse().unwrap_or_else(|_| {
        eprintln!("--bind needs an IP");
        exit(1);
    });
    let addr = SocketAddr::from((ip, port));
    let listener = match TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("Could not listen on {addr}: {err}");
            exit(1);
        }
    };
    let bound = listener.local_addr().unwrap_or(addr);
    let globe = root.join("globalstatus");
    let visualizer = root.join("visualizer").join("public");
    let static_dir = static_dir.unwrap_or_else(|| {
        if globe.join("index.html").is_file() {
            globe
        } else {
            visualizer
        }
    });
    let config = ServerConfig {
        root: root.clone(),
        static_dir: static_dir.clone(),
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
            println!("Global Status (Rust, tokio multi-thread)  http://{bound}");
            println!("static {}", static_dir.display());
            println!("{workers} scan workers");
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
