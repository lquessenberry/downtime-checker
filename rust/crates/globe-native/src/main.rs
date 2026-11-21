//! `downtime-globe`: desktop entry point for the Global Status native globe.
//!
//! `downtime-globe --summary` prints the loaded catalog without opening a
//! window (useful on headless CI). `--root DIR` points at a catalog folder;
//! without it the app searches upward from the working directory and the
//! executable, then falls back to the catalogs built into the binary.

use std::path::PathBuf;

fn main() -> eframe::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("downtime-globe {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let root = arg_value(&args, "--root").map(PathBuf::from);
    let data = downtime_globe_native::pins::load(root.as_deref());

    if args.iter().any(|a| a == "--summary") {
        println!("{}", data.summary());
        return Ok(());
    }
    downtime_globe_native::run(data, downtime_globe_native::desktop_options())
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}
