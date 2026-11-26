//! La bandeja del sistema: el icono de release, «Abrir»/«Salir» y la salida
//! cuando el updater va a sustituir los binarios.

use tauri::{
  AppHandle, Manager,
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::core::{Core, matar_sidecar};

/// Monta la bandeja de release: el icono vive siempre, con «Abrir» y «Salir».
/// Clic izquierdo restaura la ventana; el menú va con el derecho.
pub(crate) fn montar(app: &mut tauri::App) -> tauri::Result<()> {
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
  Ok(())
}

/// Vuelve a mostrar la ventana principal y le da el foco (desde la bandeja).
fn mostrar_ventana(app: &AppHandle) {
  if let Some(ventana) = app.get_webview_window("main") {
    let _ = ventana.show();
    let _ = ventana.set_focus();
  }
}

/// Antes de `downloadAndInstall`: para el vigilante y el sidecar, quita la
/// bandeja y marca actualización. El plugin en Windows hace `exit(0)` tras
/// lanzar el NSIS; el PREINSTALL espera a que no quede el proceso.
#[tauri::command]
pub(crate) fn preparar_actualizacion(app: AppHandle) {
  if let Some(core) = app.try_state::<Core>() {
    core.marcar_actualizando();
  }
  matar_sidecar(&app);
  let _ = app.remove_tray_by_id("bandeja");
}
