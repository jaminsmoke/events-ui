use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread::sleep;
use std::time::Duration;

use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager,
};

/// El puerto del core: el mismo que llama la UI empaquetada (`.env.production`).
const PUERTO_CORE: u16 = 18765;

/// El sidecar empaquetado (F3), en ejecución, y si la app ya está cerrando.
/// Vive en el estado gestionado para poder matarlo al salir y para que el
/// vigilante sepa si debe volver a arrancarlo.
#[derive(Default)]
struct Core {
  hijo: Mutex<Option<Child>>,
  parado: AtomicBool,
}

/// Arranca el sidecar si no hay uno vivo. `true` si el hijo quedó en marcha.
fn arrancar(app: &AppHandle) -> bool {
  let core = app.state::<Core>();
  let mut guard = core.hijo.lock().unwrap();
  // Si ya se está cerrando (o alguien arrancó otro hijo), no se siembra un
  // huérfano: `matar_sidecar` toma este mismo lock para llevárselo.
  if core.parado.load(Ordering::Relaxed) || guard.is_some() {
    return false;
  }

  let nombre = if cfg!(windows) {
    "events-core.exe"
  } else {
    "events-core"
  };
  // El binario viaja como `externalBin` y el instalador lo deja junto al
  // ejecutable, así que su ruta es "el mismo directorio que yo".
  let ruta = std::env::current_exe()
    .ok()
    .and_then(|exe| exe.parent().map(|dir| dir.join(nombre)));
  let hijo = ruta.and_then(|ruta| {
    // Sin `current_dir` hereda el del lanzador (un acceso directo puede
    // dejarlo en `System32`): el registro y el `/health` del core acabarían
    // apuntando a carpetas impredecibles. Junto al ejecutable es estable.
    let mut comando = Command::new(&ruta);
    if let Some(carpeta) = ruta.parent() {
      comando.current_dir(carpeta);
    }
    comando
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .spawn()
      .ok()
  });
  match hijo {
    Some(hijo) => {
      log::info!("Sidecar events-core arrancado (PID {})", hijo.id());
      *guard = Some(hijo);
      true
    }
    None => {
      log::error!(
        "No se pudo arrancar el sidecar events-core junto al ejecutable: \
         la UI no tendrá API hasta que el core esté en 127.0.0.1:{PUERTO_CORE}"
      );
      false
    }
  }
}

/// ¿Responde `/health` el core de `127.0.0.1`? Un GET mínimo escrito a mano:
/// no hay cliente HTTP aquí y no merece arrastrar una dependencia entera.
fn salud_ok() -> bool {
  use std::io::{Read, Write};
  use std::net::TcpStream;

  let Ok(direccion) = format!("127.0.0.1:{PUERTO_CORE}").parse() else {
    return false;
  };
  let Ok(mut flujo) = TcpStream::connect_timeout(&direccion, Duration::from_millis(500)) else {
    return false;
  };
  let _ = flujo.set_read_timeout(Some(Duration::from_millis(800)));
  if flujo
    .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
    .is_err()
  {
    return false;
  }
  let mut respuesta = String::new();
  let _ = flujo.read_to_string(&mut respuesta);
  respuesta.starts_with("HTTP/1.1 200") || respuesta.starts_with("HTTP/1.0 200")
}

/// Recoge el hijo si ya terminó y dice si sigue vivo.
fn sigue_vivo(app: &AppHandle) -> bool {
  let core = app.state::<Core>();
  let mut guard = core.hijo.lock().unwrap();
  match guard.as_mut() {
    Some(hijo) => match hijo.try_wait() {
      Ok(None) => true,
      Ok(Some(codigo)) => {
        log::warn!("El sidecar terminó (código {codigo:?}); se reintenta");
        *guard = None;
        false
      }
      Err(error) => {
        log::warn!("No se pudo consultar el sidecar: {error}");
        *guard = None;
        false
      }
    },
    None => false,
  }
}

/// Vigila el core mientras viva la app: espera `/health` al arrancar y lo
/// vuelve a arrancar si se cae. Si el puerto ya lo atiende otro core (una
/// sesión anterior, la app en dev) se usa ese y no se arranca otro encima.
fn vigilar(app: AppHandle) {
  let mut espera = Duration::from_millis(500);
  loop {
    if app.state::<Core>().parado.load(Ordering::Relaxed) {
      return;
    }

    if !sigue_vivo(&app) && !salud_ok() {
      if !arrancar(&app) {
        // Sin binario o sin permiso: se reintenta, cada vez más espaciado.
        sleep(espera);
        espera = (espera * 2).min(Duration::from_secs(10));
        continue;
      }
      espera = Duration::from_millis(500);
    }

    // Al arrancar tarda en abrir el puerto: se le dan hasta diez segundos.
    let mut listo = false;
    for _ in 0..40 {
      if app.state::<Core>().parado.load(Ordering::Relaxed) {
        return;
      }
      if salud_ok() {
        listo = true;
        break;
      }
      sleep(Duration::from_millis(250));
    }
    if !listo {
      log::warn!("El core no responde en /health; se vuelve a intentar");
    }
    sleep(Duration::from_secs(2));
  }
}

/// Mata el sidecar si vive. Un hijo ya muerto devuelve error y se ignora;
/// el `take` ya lo sacó del estado, así que llamarlo dos veces es no-op.
fn matar_sidecar(app: &AppHandle) {
  if let Some(core) = app.try_state::<Core>() {
    // Antes de matarlo: que el vigilante no lo resucite mientras cerramos.
    core.parado.store(true, Ordering::Relaxed);
    if let Some(mut hijo) = core.hijo.lock().unwrap().take() {
      let _ = hijo.kill();
      let _ = hijo.wait();
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
    .manage(Core::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Sidecar (F3): solo en release. En dev (`tauri dev`) el core lo levanta
      // `scripts/dev.mjs` si no está; arrancarlo aquí pelearía por el 18765.
      if !cfg!(debug_assertions) {
        // El vigilante arranca el core, espera `/health` y lo resucita si se
        // cae: sin él, un crash dejaba la UI sin API hasta reabrir la app.
        let vigilante = app.handle().clone();
        std::thread::spawn(move || vigilar(vigilante));

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
