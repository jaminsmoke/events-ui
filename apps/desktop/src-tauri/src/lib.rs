//! El shell de escritorio: compone los plugins, la ventana y el setup.
//!
//! El ciclo de vida del core vive en `core.rs` (sidecar, puerto, versiones y
//! vigilancia), la bandeja en `bandeja.rs` y la carpeta compartida con su
//! retención en `versiones.rs`. El contrato de `core/vX.Y.Z` está en
//! `docs/core-compartido.md`.

mod bandeja;
mod core;
mod versiones;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Diálogo nativo de carpetas: lo primero que hace la app es que elijas el repo.
    .plugin(tauri_plugin_dialog::init())
    // Avisos del sistema (F3): la UI los pide con la verbosidad del usuario.
    .plugin(tauri_plugin_notification::init())
    // Actualizaciones firmadas del release y reinicio tras instalar.
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(core::Core::default())
    .invoke_handler(tauri::generate_handler![bandeja::preparar_actualizacion])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Sidecar (F3) y bandeja (F3): solo en release. En dev (`tauri dev`) el
      // core lo levanta `scripts/dev.mjs` si no está; arrancarlo aquí
      // pelearía por el puerto. El vigilante arranca el core, espera `/health`
      // y lo resucita si se cae: sin él, un crash dejaba la UI sin API hasta
      // reabrir la app.
      if !cfg!(debug_assertions) {
        let vigilante = app.handle().clone();
        std::thread::spawn(move || core::vigilar(vigilante));
        bandeja::montar(app)?;
      }
      Ok(())
    })
    .on_window_event(|window, evento| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = evento {
        let actualizando = window
          .app_handle()
          .try_state::<core::Core>()
          .is_some_and(|core| core.actualizando());
        if cfg!(debug_assertions) || actualizando {
          // Dev: sin bandeja. Actualización: Restart Manager / exit deben
          // poder matar el proceso; minimizar dejaría el .exe en uso.
          core::matar_sidecar(window.app_handle());
        } else {
          // En release cerrar minimiza a la bandeja: la app y el sidecar
          // siguen vivos para los avisos; «Salir» es la única salida.
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
