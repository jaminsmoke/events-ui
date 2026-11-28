//! El core del desktop: publicar y arrancar el sidecar, decidir quién ocupa el
//! puerto y vigilar `/health` mientras viva la app.

use std::process::{Child, Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::sleep;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::versiones::{ruta_del_core, version_triple};

// El puerto del core: el mismo que llama la UI empaquetada (`.env.production`).
// Generado por `build.rs` desde `shared/core/src/events_core/puerto.json`, la
// única copia del número (la comparten el core, el desktop y los guiones).
include!(concat!(env!("OUT_DIR"), "/puerto_core.rs"));

/// El sidecar empaquetado (F3), en ejecución, y si la app ya está cerrando.
/// Vive en el estado gestionado para poder matarlo al salir y para que el
/// vigilante sepa si debe volver a arrancarlo.
#[derive(Default)]
pub(crate) struct Core {
  hijo: Mutex<Option<Child>>,
  parado: AtomicBool,
  /// El updater va a sustituir los binarios: CloseRequested debe salir de
  /// verdad (no minimizar a la bandeja) si Restart Manager manda WM_CLOSE.
  actualizando: AtomicBool,
}

impl Core {
  /// ¿El updater está sustituyendo los binarios?
  pub(crate) fn actualizando(&self) -> bool {
    self.actualizando.load(Ordering::Relaxed)
  }

  /// Marca que la app se va a cerrar para actualizarse.
  pub(crate) fn marcar_actualizando(&self) {
    self.actualizando.store(true, Ordering::Relaxed);
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
        log::error!("El core {version} no soltó el puerto {PUERTO_CORE}: no se arranca otro");
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
  let estado = cabecera
    .lines()
    .next()?
    .split_whitespace()
    .nth(1)?
    .parse()
    .ok()?;
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
  direcciones
    .any(|direccion| TcpStream::connect_timeout(&direccion, Duration::from_millis(300)).is_ok())
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
  if let Some((estado, cuerpo)) = salud_del_core(puerto)
    && estado == 200
    && let Some(version) = version_en_cuerpo(&cuerpo)
  {
    if version == nuestra {
      return Ocupante::Nuestra;
    }
    if es_anterior(&version, nuestra) {
      return Ocupante::Anterior(version);
    }
    return Ocupante::Ajena(format!("un core {version}, más nuevo que este ({nuestra})"));
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
pub(crate) fn vigilar(app: AppHandle) {
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
pub(crate) fn matar_sidecar(app: &AppHandle) {
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

/// Las pruebas del ocupante usan puertos propios (nunca el del core de la
/// máquina) y `node` como core de mentira. Sin `node`, el caso no se monta.
#[cfg(test)]
mod pruebas_ocupante {
  use super::*;

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
    assert!(matches!(
      ocupante_del_puerto(P2, "0.5.7"),
      Ocupante::Nuestra
    ));
    assert!(
      puerto_ocupado(P2),
      "un core de nuestra versión no se cierra"
    );
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
    assert!(matches!(
      ocupante_del_puerto(P5, "0.5.7"),
      Ocupante::Ajena(_)
    ));
    assert!(puerto_ocupado(P5), "lo que no es un core no se toca");
  }

  #[test]
  fn el_orden_de_versiones_decide_si_se_cierra() {
    // `/health` publica la versión sin `v`: esto es lo que decide cerrar o no.
    assert!(es_anterior("0.5.6", "0.5.7"));
    assert!(es_anterior("0.9.9", "0.10.0"));
    assert!(!es_anterior("0.5.7", "0.5.7"));
    assert!(!es_anterior("0.6.0", "0.5.7"));
    assert!(!es_anterior("no-es-version", "0.5.7"));
  }
}
