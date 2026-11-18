use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager,
};

/// El sidecar empaquetado (F3), en ejecución. Vive en el estado gestionado
/// para poder matarlo al salir: `Salir` de la bandeja lo mata y cierra la
/// app; cerrar la ventana solo la oculta (ver `on_window_event`).
type Sidecar = Mutex<Option<Child>>;

/// Mata el sidecar si vive. Un hijo ya muerto devuelve error y se ignora;
/// el `take` ya lo sacó del estado, así que llamarlo dos veces es no-op.
fn matar_sidecar(app: &tauri::AppHandle) {
  if let Some(sidecar) = app.try_state::<Sidecar>() {
    if let Some(mut hijo) = sidecar.lock().unwrap().take() {
      let _ = hijo.kill();
    }
  }
}

/// Vuelve a mostrar la ventana principal y le da el foco (desde la bandeja).
fn mostrar_ventana(app: &tauri::AppHandle) {
  if let Some(ventana) = app.get_webview_window("main") {
    let _ = ventana.show();
    let _ = ventana.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Diálogo nativo de carpetas: lo primero que hace la app es que elijas el repo.
    .plugin(tauri_plugin_dialog::init())
    // Avisos del sistema (F3): la UI los pide con la verbosidad del usuario.
    .plugin(tauri_plugin_notification::init())
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
      // `scripts/dev.mjs` si no está; arrancar otro aquí pelearía por el 18765.
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
             la UI no tendrá API hasta que el core esté en 127.0.0.1:18765"
          ),
        }

        // Bandeja (F3): el icono vive siempre en release, con «Abrir» y
        // «Salir». Clic izquierdo restaura la ventana; el menú va con el
        // derecho (sin él, el clic izquierdo abriría el menú).
        let abrir = MenuItem::with_id(app, "abrir", "Abrir", true, None::<&str>)?;
        let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&abrir, &salir])?;
        let mut bandeja = TrayIconBuilder::with_id("bandeja");
        if let Some(icono) = app.default_window_icon() {
          bandeja = bandeja.icon(icono.clone());
        }
        bandeja
          .menu(&menu)
          .tooltip("Events UI — sigue en segundo plano")
          .show_menu_on_left_click(false)
          .on_menu_event(|app, evento| match evento.id.as_ref() {
            "abrir" => mostrar_ventana(app),
            // La única salida real: mata el sidecar y cierra la app.
            "salir" => {
              matar_sidecar(app);
              app.exit(0);
            }
            _ => {}
          })
          .on_tray_icon_event(|tray, evento| {
            if let TrayIconEvent::Click {
              button: MouseButton::Left,
              button_state: MouseButtonState::Up,
              ..
            } = evento
            {
              mostrar_ventana(tray.app_handle());
            }
          })
          .build(app)?;
      }
      Ok(())
    })
    .on_window_event(|window, evento| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = evento {
        if cfg!(debug_assertions) {
          // En dev no hay bandeja: cerrar cierra (el sidecar en dev lo
          // levanta dev.mjs y lo apaga él).
          matar_sidecar(window.app_handle());
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
