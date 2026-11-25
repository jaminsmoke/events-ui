use std::process::{Child, Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread::sleep;
use std::time::Duration;

use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager,
};

// El puerto del core: el mismo que llama la UI empaquetada (`.env.production`).
// Generado por `build.rs` desde `services/core/src/events_core/puerto.json`, la
// única copia del número (la comparten el core, el desktop y los guiones).
include!(concat!(env!("OUT_DIR"), "/puerto_core.rs"));

/// El sidecar empaquetado (F3), en ejecución, y si la app ya está cerrando.
/// Vive en el estado gestionado para poder matarlo al salir y para que el
/// vigilante sepa si debe volver a arrancarlo.
#[derive(Default)]
struct Core {
  hijo: Mutex<Option<Child>>,
  parado: AtomicBool,
  /// El updater va a sustituir los binarios: CloseRequested debe salir de
  /// verdad (no minimizar a la bandeja) si Restart Manager manda WM_CLOSE.
  actualizando: AtomicBool,
}


/// La carpeta del core de esta versión, compartida con la web app: `core/vX.Y.Z`
/// dentro del directorio de datos del usuario (el mismo cálculo que hace
/// `apps/web/bin/eui.mjs`). Un solo core por máquina y por versión.
fn carpeta_del_core() -> Option<std::path::PathBuf> {
  use std::path::PathBuf;

  let version = env!("CARGO_PKG_VERSION");
  let base: Option<PathBuf> = if cfg!(windows) {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("EventsUI"))
  } else if cfg!(target_os = "macos") {
    std::env::var_os("HOME")
      .map(|h| PathBuf::from(h).join("Library").join("Application Support").join("EventsUI"))
  } else {
    std::env::var_os("XDG_DATA_HOME")
      .map(|d| PathBuf::from(d).join("eventsui"))
      .or_else(|| {
        std::env::var_os("HOME")
          .map(|h| PathBuf::from(h).join(".local").join("share").join("eventsui"))
      })
  };
  base.map(|b| b.join("core").join(format!("v{version}")))
}

/// El `events-core` que el instalador deja junto al ejecutable.
fn core_junto_al_ejecutable(nombre: &str) -> Option<std::path::PathBuf> {
  std::env::current_exe()
    .ok()
    .and_then(|exe| exe.parent().map(|dir| dir.join(nombre)))
    .filter(|ruta| ruta.exists())
}

/// Publica el core en la carpeta compartida y devuelve su ruta.
///
/// Si no se puede publicar (permisos, disco), se arranca el de junto al
/// ejecutable: mejor duplicado que sin core.
fn ruta_del_core(nombre: &str) -> Option<std::path::PathBuf> {
  let junto = core_junto_al_ejecutable(nombre);
  let Some(carpeta) = carpeta_del_core() else {
    return junto;
  };
  let destino = carpeta.join(nombre);

  // Sin origen que publicar solo queda lo que ya esté, y solo si tiene algo:
  // un binario de cero bytes no se ejecuta.
  let Some(origen) = junto else {
    return std::fs::metadata(&destino)
      .ok()
      .filter(|meta| meta.len() > 0)
      .map(|_| destino);
  };

  if std::fs::create_dir_all(&carpeta).is_err() {
    return Some(origen);
  }
  match publicar_core(&origen, &destino) {
    Ok(()) => {
      publicar_cli(&carpeta);
      limpiar_versiones_antiguas(&carpeta);
      log::info!("Core en la carpeta compartida: {}", destino.display());
      Some(destino)
    }
    Err(error) => {
      log::warn!(
        "No se pudo publicar el core en la carpeta compartida ({error}); \
         se usa el de junto al ejecutable"
      );
      Some(origen)
    }
  }
}

/// `X.Y.Z` → (X, Y, Z); `None` si el texto no es una versión. Admite la `v`
/// delante: las carpetas se llaman `v0.5.7` y `/health` publica `0.5.7`.
fn version_triple(texto: &str) -> Option<(u64, u64, u64)> {
  let resto = texto.strip_prefix('v').unwrap_or(texto);
  let mut partes = resto.split('.');
  let mayor = partes.next()?.parse().ok()?;
  let menor = partes.next()?.parse().ok()?;
  let parche = partes.next()?.parse().ok()?;
  if partes.next().is_some() {
    return None;
  }
  Some((mayor, menor, parche))
}

/// `vX.Y.Z` (el nombre de la carpeta del core) → triple; sin `v`, no lo es.
fn version_de_carpeta(nombre: &str) -> Option<(u64, u64, u64)> {
  version_triple(nombre.strip_prefix('v')?)
}

/// Borra las versiones antiguas del core: se queda la que se está usando, la
/// inmediatamente anterior y cualquiera posterior (puede ser la de otro cliente
/// más nuevo). Best-effort: un binario en ejecución no se puede borrar y se
/// queda, que es justo lo que conviene.
fn limpiar_versiones_antiguas(carpeta: &std::path::Path) {
  let Some(raiz) = carpeta.parent() else {
    return;
  };
  let Some(actual) = carpeta
    .file_name()
    .and_then(|nombre| nombre.to_str())
    .and_then(version_de_carpeta)
  else {
    return;
  };
  let Ok(entradas) = std::fs::read_dir(raiz) else {
    return;
  };
  let mut anteriores: Vec<(String, (u64, u64, u64))> = entradas
    .flatten()
    .filter(|entrada| entrada.path().is_dir())
    .filter_map(|entrada| {
      let nombre = entrada.file_name().to_string_lossy().into_owned();
      version_de_carpeta(&nombre).map(|version| (nombre, version))
    })
    .filter(|(_, version)| *version < actual)
    .collect();
  anteriores.sort_by_key(|(_, version)| std::cmp::Reverse(*version));

  for (nombre, _) in anteriores.into_iter().skip(1) {
    match std::fs::remove_dir_all(raiz.join(&nombre)) {
      Ok(()) => log::info!("Core antiguo borrado: {nombre}"),
      Err(error) => log::warn!("No se pudo borrar el core antiguo {nombre} ({error})"),
    }
  }
}

/// Publica también el `eui` del instalador en la carpeta compartida: es el CLI
/// que ejecuta la web app, y tenerlo aquí evita que se baje su propio binario.
/// Es best-effort: sin él, la web descarga el suyo y todo sigue funcionando.
fn publicar_cli(carpeta: &std::path::Path) {
  let nombre = if cfg!(windows) { "eui.exe" } else { "eui" };
  let Some(origen) = core_junto_al_ejecutable(nombre) else {
    return;
  };
  if let Err(error) = publicar_core(&origen, &carpeta.join(nombre)) {
    log::warn!("No se pudo publicar el CLI en la carpeta compartida ({error})");
  }
}

/// Deja `origen` en `destino` sin que quede nunca un binario a medio escribir.
///
/// - Si `destino` ya está completo (mismo tamaño que el origen), no se toca.
/// - Si existe pero truncado, se borra y se vuelve a copiar.
/// - La copia va a `<nombre>.<pid>.parcial` y se renombra al final: hasta ese
///   renombrado el binario no existe con su nombre definitivo, así que un
///   corte a mitad no deja nada ejecutable.
fn publicar_core(origen: &std::path::Path, destino: &std::path::Path) -> Result<(), String> {
  let esperado = std::fs::metadata(origen)
    .map_err(|error| format!("no se pudo leer {origen:?}: {error}"))?
    .len();

  match std::fs::metadata(destino) {
    Ok(meta) if meta.len() == esperado => return Ok(()),
    // Truncado: resto de una copia interrumpida.
    Ok(_) => {
      std::fs::remove_file(destino)
        .map_err(|error| format!("no se pudo borrar el core truncado: {error}"))?;
    }
    Err(_) => {}
  }

  let parcial = destino.with_file_name(format!(
    "{}.{}.parcial",
    destino.file_name().and_then(|n| n.to_str()).unwrap_or("core"),
    std::process::id()
  ));
  let copiados = std::fs::copy(origen, &parcial).map_err(|error| {
    let _ = std::fs::remove_file(&parcial);
    format!("no se pudo copiar el core: {error}")
  })?;
  if copiados != esperado {
    let _ = std::fs::remove_file(&parcial);
    return Err(format!("copia incompleta ({copiados} de {esperado} bytes)"));
  }
  // El contenido se baja a disco antes de renombrar: el renombrado da el
  // fichero por bueno, y un corte de luz justo después lo dejaría vacío.
  if let Ok(fichero) = std::fs::OpenOptions::new().write(true).open(&parcial) {
    let _ = fichero.sync_all();
  }
  match std::fs::rename(&parcial, destino) {
    Ok(()) => Ok(()),
    Err(error) => {
      let _ = std::fs::remove_file(&parcial);
      // Otra instancia pudo publicarlo entre medias: si ya está completo, vale.
      match std::fs::metadata(destino) {
        Ok(meta) if meta.len() == esperado => Ok(()),
        _ => Err(format!("no se pudo publicar el core: {error}")),
      }
    }
  }
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

  // El puerto manda: si ya hay un core de esta versión (lo pudo arrancar la web
  // app), se usa ese; si el que está es de una versión anterior, es un huérfano
  // que bloquea el arranque y se cierra; cualquier otra cosa no se toca.
  match ocupante_del_puerto(PUERTO_CORE, env!("CARGO_PKG_VERSION")) {
    Ocupante::Nuestra => {
      log::info!(
        "Core {} ya en marcha en 127.0.0.1:{PUERTO_CORE}: se reutiliza",
        env!("CARGO_PKG_VERSION")
      );
      return true;
    }
    Ocupante::Anterior(version) => {
      if !cerrar_core_anterior(PUERTO_CORE, &version) {
        log::error!(
          "El core {version} no soltó el puerto {PUERTO_CORE}: no se arranca otro"
        );
        return false;
      }
    }
    Ocupante::Ajena(motivo) => {
      log::error!("El puerto {PUERTO_CORE} lo ocupa otra cosa ({motivo}): no se toca");
      return false;
    }
    Ocupante::Nada => {}
  }

  let nombre = if cfg!(windows) {
    "events-core.exe"
  } else {
    "events-core"
  };
  let ruta = ruta_del_core(nombre);
  let hijo = ruta.and_then(|ruta| {
    // Sin `current_dir` hereda el del lanzador (un acceso directo puede
    // dejarlo en `System32`): el registro y el `/health` del core acabarían
    // apuntando a carpetas impredecibles. Junto al ejecutable es estable.
    let mut comando = Command::new(&ruta);
    if let Some(carpeta) = ruta.parent() {
      comando.current_dir(carpeta);
    }
    // El sidecar se empaqueta con subsistema GUI (`--windowed`), así que no
    // abre consola. La bandera se queda como cinturón por si se compila como
    // consola: sin ella, cada arranque abriría una ventana y, al cerrarla,
    // el vigilante relanzaría el core en bucle.
    #[cfg(windows)]
    {
      const CREATE_NO_WINDOW: u32 = 0x0800_0000;
      comando.creation_flags(CREATE_NO_WINDOW);
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

/// Estado y cuerpo de `/health` del core en `puerto`. Un GET mínimo escrito
/// a mano: no hay cliente HTTP aquí y no merece arrastrar una dependencia.
fn salud_del_core(puerto: u16) -> Option<(u16, String)> {
  use std::io::{Read, Write};
  use std::net::TcpStream;

  let direccion = format!("127.0.0.1:{puerto}").parse().ok()?;
  let mut flujo = TcpStream::connect_timeout(&direccion, Duration::from_millis(500)).ok()?;
  let _ = flujo.set_read_timeout(Some(Duration::from_millis(800)));
  // HTTP/1.0: la respuesta llega entera y sin `chunked`, que aquí se lee como
  // texto y se parte por la línea en blanco.
  flujo
    .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
    .ok()?;
  let mut respuesta = String::new();
  let _ = flujo.read_to_string(&mut respuesta);
  let (cabecera, cuerpo) = respuesta.split_once("\r\n\r\n")?;
  let estado = cabecera.lines().next()?.split_whitespace().nth(1)?.parse().ok()?;
  Some((estado, cuerpo.to_owned()))
}

/// ¿Responde `/health` el core de `puerto`?
fn salud_ok(puerto: u16) -> bool {
  matches!(salud_del_core(puerto), Some((200, _)))
}

/// La `version` del cuerpo de `/health`, si es un core de Events UI.
fn version_en_cuerpo(cuerpo: &str) -> Option<String> {
  let datos: serde_json::Value = serde_json::from_str(cuerpo).ok()?;
  datos.get("version")?.as_str().map(str::to_owned)
}

/// `a` es una versión anterior a `b`; con nombres raros, falso.
fn es_anterior(a: &str, b: &str) -> bool {
  match (version_triple(a), version_triple(b)) {
    (Some(antes), Some(despues)) => antes < despues,
    _ => false,
  }
}

/// ¿Hay alguien escuchando en `puerto`?
fn puerto_ocupado(puerto: u16) -> bool {
  use std::net::{TcpStream, ToSocketAddrs};

  let Ok(mut direcciones) = format!("127.0.0.1:{puerto}").to_socket_addrs() else {
    return false;
  };
  direcciones.any(|direccion| {
    TcpStream::connect_timeout(&direccion, Duration::from_millis(300)).is_ok()
  })
}

/// Quién tiene el puerto del core.
#[derive(Debug)]
enum Ocupante {
  /// Nadie escucha.
  Nada,
  /// Un core de esta misma versión: es el compartido, se usa.
  Nuestra,
  /// Un core de una versión anterior que quedó vivo: se cierra.
  Anterior(String),
  /// Otra cosa: no se toca.
  Ajena(String),
}

fn ocupante_del_puerto(puerto: u16, nuestra: &str) -> Ocupante {
  if let Some((estado, cuerpo)) = salud_del_core(puerto) {
    if estado == 200 && let Some(version) = version_en_cuerpo(&cuerpo) {
      if version == nuestra {
        return Ocupante::Nuestra;
      }
      if es_anterior(&version, nuestra) {
        return Ocupante::Anterior(version);
      }
      return Ocupante::Ajena(format!("un core {version}, más nuevo que este ({nuestra})"));
    }
    return Ocupante::Ajena(format!("algo que no es un core (HTTP {estado})"));
  }
  if puerto_ocupado(puerto) {
    return Ocupante::Ajena("algo escucha y no contesta /health".to_owned());
  }
  Ocupante::Nada
}

/// PID del proceso que escucha en `puerto` (Windows: `netstat`).
#[cfg(windows)]
fn pid_que_escucha(puerto: u16) -> Option<u32> {
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let salida = Command::new("netstat")
    .args(["-ano", "-p", "TCP"])
    .creation_flags(CREATE_NO_WINDOW)
    .stdin(Stdio::null())
    .stderr(Stdio::null())
    .output()
    .ok()?;
  let texto = String::from_utf8_lossy(&salida.stdout);
  texto.lines().find_map(|linea| {
    let campos: Vec<&str> = linea.split_whitespace().collect();
    if campos.len() < 5 || !campos[3].eq_ignore_ascii_case("LISTENING") {
      return None;
    }
    if !campos[1].ends_with(&format!(":{puerto}")) {
      return None;
    }
    campos[4].parse().ok()
  })
}

/// Cierra el core huérfano de una versión anterior y espera a que suelte el
/// puerto. Solo se llama con un core de Events UI de otra versión: un core de
/// la nuestra es el compartido y no se toca.
fn cerrar_core_anterior(puerto: u16, version: &str) -> bool {
  #[cfg(windows)]
  {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Some(pid) = pid_que_escucha(puerto) else {
      return false;
    };
    log::warn!(
      "Core {version} huérfano en 127.0.0.1:{puerto} (PID {pid}): se cierra para arrancar {}",
      env!("CARGO_PKG_VERSION")
    );
    // `/T` lleva también al hijo real del onefile de PyInstaller.
    let _ = Command::new("taskkill")
      .args(["/F", "/T", "/PID", &pid.to_string()])
      .creation_flags(CREATE_NO_WINDOW)
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
    for _ in 0..30 {
      if !puerto_ocupado(puerto) {
        return true;
      }
      std::thread::sleep(Duration::from_millis(100));
    }
    !puerto_ocupado(puerto)
  }
  #[cfg(not(windows))]
  {
    let _ = (puerto, version);
    false
  }
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

    if !sigue_vivo(&app) && !salud_ok(PUERTO_CORE) {
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
      if salud_ok(PUERTO_CORE) {
        listo = true;
        break;
      }
      sleep(Duration::from_millis(250));
    }
    if !listo {
      log::warn!("El core no responde en /health; se descarta el hijo y se reintenta");
      descartar_hijo(&app);
      sleep(espera);
      espera = (espera * 2).min(Duration::from_secs(10));
      continue;
    }
    espera = Duration::from_millis(500);
    sleep(Duration::from_secs(2));
  }
}

/// Saca al hijo del estado y lo mata, sin marcar la app como parada.
/// Sirve cuando el proceso vive pero no responde a `/health`: si no se
/// descarta, el vigilante lo daría por vivo eternamente y no reintentaría.
fn descartar_hijo(app: &AppHandle) {
  let core = app.state::<Core>();
  if let Some(mut hijo) = core.hijo.lock().unwrap().take() {
    let _ = hijo.kill();
    let _ = hijo.wait();
  }
}

/// Mata el sidecar si vive. Un hijo ya muerto devuelve error y se ignora;
/// el `take` ya lo sacó del estado, así que llamarlo dos veces es no-op.
fn matar_sidecar(app: &AppHandle) {
  let mut arrancado = None;
  if let Some(core) = app.try_state::<Core>() {
    // Antes de matarlo: que el vigilante no lo resucite mientras cerramos.
    core.parado.store(true, Ordering::Relaxed);
    if let Some(mut hijo) = core.hijo.lock().unwrap().take() {
      arrancado = Some(hijo.id());
      let _ = hijo.kill();
      let _ = hijo.wait();
    }
  }
  // Solo el árbol que arrancamos nosotros. El core es de la máquina y puede
  // estar sirviendo a la web app: matar por nombre se llevaría ese otro. El
  // `/T` cubre al hijo real del onefile, que `Child::kill` no siempre alcanza.
  #[cfg(windows)]
  if let Some(pid) = arrancado {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = Command::new("taskkill")
      .args(["/F", "/T", "/PID", &pid.to_string()])
      .creation_flags(CREATE_NO_WINDOW)
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }
}

/// Para el core, quita la bandeja y marca actualización: el proceso debe poder
/// morir (exit del updater o WM_CLOSE del Restart Manager) sin quedarse oculto.
fn preparar_salida_actualizacion(app: &AppHandle) {
  if let Some(core) = app.try_state::<Core>() {
    core.actualizando.store(true, Ordering::Relaxed);
  }
  matar_sidecar(app);
  let _ = app.remove_tray_by_id("bandeja");
}

/// Vuelve a mostrar la ventana principal y le da el foco (desde la bandeja).
fn mostrar_ventana(app: &tauri::AppHandle) {
  if let Some(ventana) = app.get_webview_window("main") {
    let _ = ventana.show();
    let _ = ventana.set_focus();
  }
}

/// Antes de `downloadAndInstall`: para el vigilante y el sidecar, quita la
/// bandeja y marca actualización. El plugin en Windows hace `exit(0)` tras
/// lanzar el NSIS; el PREINSTALL espera a que no quede el proceso.
#[tauri::command]
fn preparar_actualizacion(app: AppHandle) {
  preparar_salida_actualizacion(&app);
}

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
    .manage(Core::default())
    .invoke_handler(tauri::generate_handler![preparar_actualizacion])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Sidecar (F3): solo en release. En dev (`tauri dev`) el core lo levanta
      // `scripts/dev.mjs` si no está; arrancarlo aquí pelearía por el puerto.
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
        let actualizando = window
          .app_handle()
          .try_state::<Core>()
          .is_some_and(|core| core.actualizando.load(Ordering::Relaxed));
        if cfg!(debug_assertions) || actualizando {
          // Dev: sin bandeja. Actualización: Restart Manager / exit deben
          // poder matar el proceso; minimizar dejaría el .exe en uso.
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

/// Las pruebas del ocupante usan puertos propios (nunca el del core de la
/// máquina) y `node` como core de mentira. Sin `node`, el caso no se monta.
#[cfg(test)]
mod pruebas_ocupante {
  use super::*;
  use std::process::{Child, Command, Stdio};

  const P1: u16 = 65301;
  const P2: u16 = 65302;
  // El cierre de un core ajeno solo está implementado en Windows (`netstat` +
  // `taskkill`); su prueba vive con él.
  #[cfg(windows)]
  const P3: u16 = 65303;
  const P4: u16 = 65304;
  const P5: u16 = 65305;

  fn hay_node() -> bool {
    Command::new("node")
      .arg("--version")
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status()
      .is_ok_and(|estado| estado.success())
  }

  /// Un core de mentira que se lleva por delante al soltarlo, aunque la prueba
  /// falle a mitad y el puerto no quede ocupado para la siguiente.
  struct CoreFalso(Child);

  impl Drop for CoreFalso {
    fn drop(&mut self) {
      let _ = self.0.kill();
      let _ = self.0.wait();
    }
  }

  /// `CoreFalso` espera al hijo en su `Drop`, que es justo lo que pide el
  /// lint; no ve el `impl Drop` y avisa igualmente.
  #[allow(clippy::zombie_processes)]
  fn lanzar_node(guion: &str, puerto: u16) -> CoreFalso {
    let hijo = Command::new("node")
      .args(["-e", guion])
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .spawn()
      .expect("no se pudo arrancar node");
    let falso = CoreFalso(hijo);
    for _ in 0..40 {
      if puerto_ocupado(puerto) {
        return falso;
      }
      std::thread::sleep(Duration::from_millis(50));
    }
    drop(falso);
    panic!("el servidor de prueba no arrancó en {puerto}");
  }

  fn fingir_core(puerto: u16, version: &str) -> CoreFalso {
    let guion = format!(
      "const c=JSON.stringify({{status:'ok',version:'{version}'}});\
       require('node:http').createServer((q,r)=>{{r.writeHead(200,\
       {{'content-type':'application/json','content-length':Buffer.byteLength(c)}});r.end(c)}})\
       .listen({puerto},'127.0.0.1')"
    );
    lanzar_node(&guion, puerto)
  }

  #[test]
  fn sin_nadie_escuchando_no_hay_ocupante() {
    assert!(!puerto_ocupado(P1));
    assert!(matches!(ocupante_del_puerto(P1, "0.5.7"), Ocupante::Nada));
  }

  #[test]
  fn la_misma_version_se_reutiliza() {
    if !hay_node() {
      return;
    }
    let _core = fingir_core(P2, "0.5.7");
    assert!(matches!(ocupante_del_puerto(P2, "0.5.7"), Ocupante::Nuestra));
    assert!(puerto_ocupado(P2), "un core de nuestra versión no se cierra");
  }

  #[cfg(windows)]
  #[test]
  fn el_core_de_una_version_anterior_se_cierra_y_suelta_el_puerto() {
    if !hay_node() {
      return;
    }
    let viejo = fingir_core(P3, "0.5.6");
    match ocupante_del_puerto(P3, "0.5.7") {
      Ocupante::Anterior(version) => assert_eq!(version, "0.5.6"),
      otro => panic!("esperaba Anterior, salió {otro:?}"),
    }
    assert!(cerrar_core_anterior(P3, "0.5.6"));
    assert!(!puerto_ocupado(P3), "el puerto debería quedar libre");
    drop(viejo);
    assert!(matches!(ocupante_del_puerto(P3, "0.5.7"), Ocupante::Nada));
  }

  #[test]
  fn un_core_mas_nuevo_no_se_toca() {
    if !hay_node() {
      return;
    }
    let _nuevo = fingir_core(P4, "0.6.0");
    match ocupante_del_puerto(P4, "0.5.7") {
      Ocupante::Ajena(motivo) => assert!(motivo.contains("más nuevo"), "{motivo}"),
      otro => panic!("esperaba Ajena, salió {otro:?}"),
    }
    assert!(puerto_ocupado(P4), "un core más nuevo no se cierra");
  }

  #[test]
  fn lo_que_no_es_un_core_no_se_toca() {
    if !hay_node() {
      return;
    }
    let guion = "require('node:http').createServer((q,r)=>{r.writeHead(404);r.end('no')})\
       .listen(65305,'127.0.0.1')";
    let _otro = lanzar_node(guion, P5);
    assert!(matches!(ocupante_del_puerto(P5, "0.5.7"), Ocupante::Ajena(_)));
    assert!(puerto_ocupado(P5), "lo que no es un core no se toca");
  }

  #[test]
  fn las_versiones_se_leen_con_y_sin_v() {
    assert_eq!(version_triple("0.5.7"), Some((0, 5, 7)));
    assert_eq!(version_triple("v0.5.7"), Some((0, 5, 7)));
    assert_eq!(version_de_carpeta("v0.5.7"), Some((0, 5, 7)));
    assert_eq!(version_de_carpeta("0.5.7"), None);
    // `/health` publica la versión sin `v`: esto es lo que decide cerrar o no.
    assert!(es_anterior("0.5.6", "0.5.7"));
    assert!(es_anterior("0.9.9", "0.10.0"));
    assert!(!es_anterior("0.5.7", "0.5.7"));
    assert!(!es_anterior("0.6.0", "0.5.7"));
    assert!(!es_anterior("no-es-version", "0.5.7"));
  }
}
