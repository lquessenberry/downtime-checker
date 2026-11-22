use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::exit;

use rustle::{builtin_grove, Grove};

fn main() {
    let mut args = env::args().skip(1);
    let cmd = args.next().unwrap_or_else(|| "list".into());
    match cmd.as_str() {
        "list" => {
            let grove = load(args.next());
            for leaf in grove.all() {
                println!("{}\t{}\t{}", leaf.id, leaf.bundle, leaf.label);
            }
            println!("{} leaves", grove.len());
        }
        "get" => {
            let id = args.next().unwrap_or_else(|| die("-- get needs an id"));
            let grove = load(None);
            match grove.get(&id) {
                Some(leaf) => println!("{}", leaf.json()),
                None => die(&format!("no leaf `{id}`")),
            }
        }
        "context" => {
            let lat: f64 = args
                .next()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| die("context LAT LON"));
            let lon: f64 = args
                .next()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| die("context LAT LON"));
            let grove = load(None);
            println!("{}", grove.context(lat, lon).json());
        }
        "lint" => {
            let path = args
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("crates/rustle/leaves/core.leaf.txt"));
            let text = fs::read_to_string(&path).unwrap_or_else(|err| die(&err.to_string()));
            match Grove::from_text(&text) {
                Ok(grove) => println!("ok\t{} leaves\t{}", grove.len(), path.display()),
                Err(err) => die(&err.to_string()),
            }
        }
        "-h" | "--help" | "help" => {
            println!(
                "rustle list [file.leaf.txt]\n\
                 rustle get ID\n\
                 rustle context LAT LON\n\
                 rustle lint [file.leaf.txt]"
            );
        }
        other => die(&format!("unknown command `{other}`")),
    }
}

fn load(path: Option<String>) -> Grove {
    match path {
        Some(path) => {
            let text = fs::read_to_string(&path).unwrap_or_else(|err| die(&err.to_string()));
            Grove::from_text(&text).unwrap_or_else(|err| die(&err.to_string()))
        }
        None => builtin_grove(),
    }
}

fn die(message: &str) -> ! {
    eprintln!("{message}");
    exit(1);
}
