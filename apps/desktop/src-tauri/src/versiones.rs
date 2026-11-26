//! La carpeta compartida del core y la retención de versiones.
//!
//! Contrato en `docs/core-compartido.md`: `core/vX.Y.Z` dentro del directorio
//! de datos del usuario, y se conservan la versión en uso, la inmediatamente
//! anterior y cualquier posterior. El envoltorio web
//! (`apps/web/bin/compartido.mjs`) aplica la misma tabla.

/// La carpeta del core de esta versión, compartida con la web app:
/// `core/vX.Y.Z` dentro del directorio de datos del usuario. Un solo core por
/// máquina y por versión.
pub(crate) fn carpeta_del_core() -> Option<std::path::PathBuf> {
  use std::path::PathBuf;

  let version = env!("CARGO_PKG_VERSION");
  let base: Option<PathBuf> = if cfg!(windows) {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("EventsUI"))
  } else if cfg!(target_os = "macos") {
    std::env::var_os("HOME").map(|h| {
      PathBuf::from(h)
        .join("Library")
        .join("Application Support")
        .join("EventsUI")
    })
  } else {
    std::env::var_os("XDG_DATA_HOME")
      .map(|d| PathBuf::from(d).join("eventsui"))
      .or_else(|| {
        std::env::var_os("HOME").map(|h| {
          PathBuf::from(h)
            .join(".local")
            .join("share")
            .join("eventsui")
        })
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
pub(crate) fn ruta_del_core(nombre: &str) -> Option<std::path::PathBuf> {
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
pub(crate) fn version_triple(texto: &str) -> Option<(u64, u64, u64)> {
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
pub(crate) fn version_de_carpeta(nombre: &str) -> Option<(u64, u64, u64)> {
  version_triple(nombre.strip_prefix('v')?)
}

/// Las carpetas de versión que se borran, en orden ascendente.
///
/// Contrato de `docs/core-compartido.md`: se queda la versión en uso, la
/// inmediatamente anterior y cualquiera posterior (puede ser la de otro
/// cliente más nuevo). Lo que no sea `vX.Y.Z` no cuenta.
fn versiones_a_borrar(nombres: &[&str], actual: &str) -> Vec<String> {
  let Some(actual) = version_de_carpeta(actual) else {
    return Vec::new();
  };
  let mut anteriores: Vec<(String, (u64, u64, u64))> = nombres
    .iter()
    .filter_map(|nombre| version_de_carpeta(nombre).map(|version| ((*nombre).to_owned(), version)))
    .filter(|(_, version)| *version < actual)
    .collect();
  anteriores.sort_by_key(|(_, version)| *version);
  // La última de las anteriores es la que se conserva.
  anteriores.pop();
  anteriores.into_iter().map(|(nombre, _)| nombre).collect()
}

/// Borra las versiones antiguas del core: se queda la que se está usando, la
/// inmediatamente anterior y cualquiera posterior. Best-effort: un binario en
/// ejecución no se puede borrar y se queda, que es justo lo que conviene.
fn limpiar_versiones_antiguas(carpeta: &std::path::Path) {
  let Some(raiz) = carpeta.parent() else {
    return;
  };
  let Some(actual) = carpeta.file_name().and_then(|nombre| nombre.to_str()) else {
    return;
  };
  let Ok(entradas) = std::fs::read_dir(raiz) else {
    return;
  };
  let nombres: Vec<String> = entradas
    .flatten()
    .filter(|entrada| entrada.path().is_dir())
    .map(|entrada| entrada.file_name().to_string_lossy().into_owned())
    .collect();
  let referencias: Vec<&str> = nombres.iter().map(String::as_str).collect();

  for nombre in versiones_a_borrar(&referencias, actual) {
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
    destino
      .file_name()
      .and_then(|n| n.to_str())
      .unwrap_or("core"),
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

#[cfg(test)]
mod pruebas {
  use super::*;

  #[test]
  fn la_retencion_es_la_actual_mas_la_anterior_y_las_posteriores() {
    let nombres = [
      "v0.5.4",
      "v0.5.5",
      "v0.5.6",
      "v0.5.7",
      "v0.6.0",
      "basura",
      "v0.5.7-rc1",
    ];
    // Con 0.5.7 en uso: se borra 0.5.4 y 0.5.5; se quedan 0.5.6 (anterior) y
    // 0.6.0 (posterior, puede ser de otro cliente más nuevo).
    assert_eq!(
      versiones_a_borrar(&nombres, "v0.5.7"),
      vec!["v0.5.4".to_owned(), "v0.5.5".to_owned()]
    );
  }

  #[test]
  fn una_carpeta_que_no_es_version_no_cuenta() {
    assert!(versiones_a_borrar(&["basura", "v0.4", "v0.5.7"], "v0.5.7").is_empty());
    assert!(versiones_a_borrar(&["v0.5.7"], "no-es-version").is_empty());
  }

  #[test]
  fn las_versiones_se_leen_con_y_sin_v() {
    assert_eq!(version_triple("0.5.7"), Some((0, 5, 7)));
    assert_eq!(version_triple("v0.5.7"), Some((0, 5, 7)));
    assert_eq!(version_de_carpeta("v0.5.7"), Some((0, 5, 7)));
    assert_eq!(version_de_carpeta("0.5.7"), None);
  }
}
