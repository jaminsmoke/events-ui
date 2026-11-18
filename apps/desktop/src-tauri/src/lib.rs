use std::process::{Child, Command, Stdio};

use tauri::Manager;
use std::sync::Mutex;

/// El sidecar empaquetado (F3), en ejecución. Vive en el estado gestionado
/// para poder matarlo al cerrar la ventana: sin esto, el core quedaría
/// huérfano escuchando en 8765 tras cada cierre de la app.
type Sidecar = Mutex<Option<Child>>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Diálogo nativo de carpetas: lo primero que hace la app es que elijas el repo.
    .plugin(tauri_plugin_dialog::init())
    .manage(Sidecar::new(None))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Sidecar (F3): solo en release. En dev (`tauri dev`) el core lo levanta
      // `scripts/dev.mjs` si no está; arrancar otro aquí pelearía por el 8765.
      // El binario viaja como `externalBin` y el instalador lo deja junto al
      // ejecutable, así que su ruta es "el mismo directorio que yo".
      if !cfg!(debug_assertions) {
        let nombre = if cfg!(windows) {
          "events-core.exe"
        } else {
          "events-core"
        };
        let ruta = std::env::current_exe()
          .ok()
          .and_then(|exe| exe.parent().map(|dir| dir.join(nombre)));
        match ruta.and_then(|ruta| {
          Command::new(ruta)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()
        }) {
          Some(hijo) => {
            log::info!("Sidecar events-core arrancado (PID {})", hijo.id());
            *app.state::<Sidecar>().lock().unwrap() = Some(hijo);
          }
          None => log::error!(
            "No se pudo arrancar el sidecar events-core junto al ejecutable: \
             la UI no tendrá API hasta que el core esté en 127.0.0.1:8765"
          ),
        }
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      // Al cerrar, el sidecar muere con la app. `kill` en un hijo ya muerto
      // es un error que se ignora: el `take` ya lo sacó del estado.
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        if let Some(sidecar) = window.try_state::<Sidecar>() {
          if let Some(mut hijo) = sidecar.lock().unwrap().take() {
            let _ = hijo.kill();
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
