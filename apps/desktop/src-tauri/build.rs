// Build del desktop: genera la constante del puerto del core y llama a Tauri.
//
// El puerto tiene una sola copia, `services/core/src/events_core/puerto.json`,
// que también leen el core (Python) y los guiones. Aquí se convierte en una
// `const` de Rust en `OUT_DIR`, para que `lib.rs` la use como siempre.

use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let manifest = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let fuente = Path::new(&manifest).join("../../../services/core/src/events_core/puerto.json");
    println!("cargo:rerun-if-changed={}", fuente.display());

    let texto = fs::read_to_string(&fuente)
        .unwrap_or_else(|error| panic!("no se pudo leer {}: {error}", fuente.display()));
    let puerto = leer_puerto(&texto);

    let destino = Path::new(&env::var("OUT_DIR").expect("OUT_DIR")).join("puerto_core.rs");
    fs::write(&destino, format!("const PUERTO_CORE: u16 = {puerto};\n"))
        .unwrap_or_else(|error| panic!("no se pudo escribir {}: {error}", destino.display()));

    tauri_build::build()
}

// `{"core": N}` sin meter un parser JSON en el build: se busca la clave y
// se leen sus dígitos. Un fichero raro falla aquí, no en tiempo de ejecución.
fn leer_puerto(texto: &str) -> u16 {
    let clave = texto
        .find("\"core\"")
        .expect("puerto.json no tiene la clave `core`");
    let resto = &texto[clave + "\"core\"".len()..];
    let dos_puntos = resto
        .find(':')
        .expect("puerto.json: falta `:` después de `core`");
    let digitos: String = resto[dos_puntos + 1..]
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digitos
        .parse()
        .unwrap_or_else(|_| panic!("puerto.json: `core` no es un número: {digitos:?}"))
}
