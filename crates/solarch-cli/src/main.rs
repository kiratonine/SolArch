#![forbid(unsafe_code)]
mod command;

fn main() {
    if let Err(error) = command::run(std::env::args_os().skip(1).collect()) {
        eprintln!("solarch: {error}");
        std::process::exit(1);
    }
}
