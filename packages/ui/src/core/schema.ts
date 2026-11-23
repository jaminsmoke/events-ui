// GENERADO desde el OpenAPI del core (openapi.json). No editar a mano:
// tras cambiar la API, regenera con `corepack pnpm gen:api`.
// Los tipos que consume la UI se derivan de aquí en `./api.ts`.
export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health
         * @description Estado del core y de la BD de eventos.
         *
         *     `degraded` cuando el fichero no existe todavía: es normal la primera vez,
         *     porque la app no lo crea. Publica además la `version` (el CLI comprueba que
         *     habla con el binario que espera) y la `repo` por defecto de la
         *     configuración compartida, que es la que ven los clientes de fuera.
         *
         *     Un almacén que migró un core posterior no se publica como `ok`: esta ruta
         *     abre en solo lectura, así que no migra, pero nombra el caso con un 409 y el
         *     mismo mensaje que `ensure_repo`.
         */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/repos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Repos
         * @description Repos investigados que ya tienen `.EUI/EUI_DATABASE.sqlite`.
         */
        get: operations["get_repos_repos_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Items */
        get: operations["get_items_items_get"];
        put?: never;
        /** Post Item */
        post: operations["post_item_items_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/items/{uid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Item */
        get: operations["get_item_items__uid__get"];
        put?: never;
        post?: never;
        /** Remove Item */
        delete: operations["remove_item_items__uid__delete"];
        options?: never;
        head?: never;
        /** Patch Item */
        patch: operations["patch_item_items__uid__patch"];
        trace?: never;
    };
    "/reiniciar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Reiniciar
         * @description Reinicio de laboratorio: el almacén queda vacío (ítems, cola, fichas
         *     y eventos). Solo lo llama el lanzador de pruebas del desktop
         *     (`puedeProbar`): no es parte del CRUD de producto.
         */
        post: operations["post_reiniciar_reiniciar_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/protocolos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Protocolos
         * @description Las uniones permitidas entre carriles (`protocolo_flujo`).
         *
         *     La UI las lee para no ofrecer flujos prohibidos; la que impone de verdad
         *     es el PATCH, que responde 400 cuando la unión no está listada. Es
         *     configuración del almacén: el reinicio de laboratorio no la toca.
         */
        get: operations["get_protocolos_protocolos_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mapa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Map
         * @description Los ítems del mapa tal como estaban en una misma lectura de SQLite.
         */
        get: operations["get_map_mapa_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/revision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Revision
         * @description Sondeo de cambio: la UI lo pide cada par de segundos, sin traerse el mapa.
         */
        get: operations["get_revision_revision_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/eventos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Eventos
         * @description Tail por cursor: backfill histórico con `id > desde`.
         */
        get: operations["get_eventos_eventos_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/eventos/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stream Eventos
         * @description SSE en vivo: primero el backfill hasta el último y luego lo que llegue.
         *
         *     Sin `Last-Event-ID` se empieza desde el principio (backfill histórico);
         *     con él, se reanuda tras ese id —el mismo cursor del tail, sin huecos.
         */
        get: operations["stream_eventos_eventos_stream_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/eventos/compactar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Compactar
         * @description Recorta el log a la política de retención; el resto se conserva.
         */
        post: operations["post_compactar_eventos_compactar_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Log
         * @description Las últimas entradas del registro de la app (la más nueva primero),
         *     opcionalmente por nivel y por etiqueta (`origen`: `core`, `seed`, …).
         */
        get: operations["get_log_log_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/log/purgar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Purgar Log
         * @description Aplica ya la retención del registro (también pasa sola al escribir).
         */
        post: operations["post_purgar_log_log_purgar_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/proyecciones/repo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Proyeccion Repo
         * @description Primera proyección: estado del repo con su identidad (rama/commit).
         */
        get: operations["get_proyeccion_repo_proyecciones_repo_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/git/inicializar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Git Inicializar
         * @description `git init` en la carpeta del repo; devuelve la proyección actualizada.
         */
        post: operations["post_git_inicializar_git_inicializar_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/git/eliminar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Git Eliminar
         * @description Borra el `.git` propio y nada más; devuelve la proyección actualizada.
         */
        post: operations["post_git_eliminar_git_eliminar_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/git/commits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Git Commits
         * @description Los últimos commits de la rama actual, para el nodo Commits del mapa.
         */
        get: operations["get_git_commits_git_commits_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/git/commit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Git Commit
         * @description Un commit local con todo lo pendiente; devuelve la proyección al día.
         */
        post: operations["post_git_commit_git_commit_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/git/ignorar-almacen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Git Ignorar Almacen
         * @description Añade `.EUI/` al `.gitignore` de la raíz; devuelve la proyección al día.
         */
        post: operations["post_git_ignorar_almacen_git_ignorar_almacen_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/arbol": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Arbol
         * @description Los hijos de cada carpeta pedida; la raíz (`""`) siempre lista.
         *
         *     Se piden solo los niveles desplegados, así que un repo grande no cuesta más
         *     que uno pequeño: nunca se recorre el árbol entero. Sin `rutas` se devuelve
         *     solo la raíz, que es lo que el pane enseña plegado.
         */
        get: operations["get_arbol_arbol_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/archivo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Archivo
         * @description El texto de un archivo del repo para el visor, acotado a 512 KiB.
         *
         *     Un binario responde 415 y no se inventa una decodificación: el visor puede
         *     enseñar el aviso sin intentar pintar bytes. La ruta no sale de la raíz.
         */
        get: operations["get_archivo_archivo_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/archivo-bytes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Archivo Bytes
         * @description Los bytes de una imagen del repo para pintarla en el visor.
         *
         *     Solo se sirve `image/*`, hasta 12 MiB, y la ruta no sale de la raíz. El
         *     tipo viaja en `Content-Type` y `nosniff` evita que el navegador lo adivine.
         */
        get: operations["get_archivo_bytes_archivo_bytes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Config
         * @description La configuración que ve el core.
         *
         *     Tolera un fichero roto (valores por defecto): quien quiera el detalle del
         *     problema lo mira con `eui doctor`, que sí lo reporta.
         */
        get: operations["get_config_config_get"];
        /**
         * Put Config
         * @description Cambia la raíz y/o el puerto; la clave ausente no se toca.
         *
         *     La UI lo llama al abrir una carpeta para que el CLI y el MCP sepan cuál es
         *     la raíz por defecto; `repo: null` la limpia.
         */
        put: operations["put_config_config_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documentos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Documentos
         * @description Lista los documentos absorbidos que todavía no se han deshecho.
         */
        get: operations["get_documentos_documentos_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documentos/markdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Documento
         * @description Genera la vista Markdown actual sin leer el fichero original.
         */
        get: operations["get_documento_documentos_markdown_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migracion/aplicar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Aplicar
         * @description Aplica el plan entero o nada.
         *
         *     El contrato comprueba la forma (destinos de la v2, fases pendientes, un
         *     origen con hash por item); `revisar` vuelve a mirar el disco (origen dentro
         *     del repo, `sha256` al día, ciclos y duplicados) y el core escribe el lote
         *     en una transacción. La huella canónica del plan hace idempotente el envío.
         */
        post: operations["post_aplicar_migracion_aplicar_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/migracion/lotes/{lote}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete Lote
         * @description Deshace un lote: borra solo sus items si nadie las tocó después.
         *
         *     Un 409 enumera todos los conflictos (carril distinto de `proposed`,
         *     `updated_at` posterior a `creada_at`, o una ficha ajena que la usa como
         *     sustituta) y no borra nada; un 404 es un lote que no existe.
         */
        delete: operations["delete_lote_migracion_lotes__lote__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * Archivo
         * @description Un archivo de texto del repo, acotado para el visor.
         *
         *     `texto` viene en UTF-8 tolerante (los bytes inválidos se sustituyen) y
         *     nunca supera los 512 KiB; `bytes` es el tamaño real en disco y `truncado`
         *     avisa de que solo se leyó el principio. `ruta` sale canónica, relativa a
         *     la raíz y con barras normales.
         */
        Archivo: {
            /** Ruta */
            ruta: string;
            /** Texto */
            texto: string;
            /** Bytes */
            bytes: number;
            /**
             * Truncado
             * @default false
             */
            truncado: boolean;
        };
        /**
         * ArchivoFase
         * @description Un archivo que cambió durante una fase o un requisito (0028, 0029).
         *
         *     `estado` es el cambio entre las dos fotos del árbol; `renombrado` es un
         *     archivo que se movió, y `desde` dice de dónde. `contenido` es el parche de
         *     Git (o el texto del archivo nuevo); `None` cuando no hay Git, no hay
         *     commits o el contenido no cabe: la ruta y el estado ya informan.
         */
        ArchivoFase: {
            /** Ruta */
            ruta: string;
            /**
             * Estado
             * @enum {string}
             */
            estado: "nuevo" | "modificado" | "borrado" | "renombrado";
            /** Desde */
            desde?: string | null;
            /** Contenido */
            contenido?: string | null;
        };
        /**
         * CambioGit
         * @description Un archivo con cambios sin commit, en el formato de `git status`.
         *
         *     `origen` solo llega en renombrados y copias: dice de dónde salió el
         *     archivo, sin la flecha que Git mete en la ruta.
         */
        CambioGit: {
            /** Estado */
            estado: string;
            /** Ruta */
            ruta: string;
            /** Origen */
            origen?: string | null;
        };
        /**
         * CommitGit
         * @description Un commit del historial de la rama, resumido para el Mapa de Git.
         *
         *     `hash` es el abreviado que enseña Git: basta para identificar el commit y
         *     cabe en la fila. `fecha` es la de autoría en ISO 8601; la UI la acorta al
         *     pintarla.
         */
        CommitGit: {
            /** Hash */
            hash: string;
            /** Asunto */
            asunto: string;
            /** Autor */
            autor: string;
            /** Fecha */
            fecha: string;
        };
        /**
         * CommitPeticion
         * @description Lo que hace falta para commitear desde el panel: solo el mensaje.
         *
         *     No hay `add` selectivo ni remoto: se commitea todo lo que `git status`
         *     ve, y push queda fuera hasta que exista la integración con remoto. El
         *     límite es el de un asunto de commit; un cuerpo largo no lo pide el mapa.
         */
        CommitPeticion: {
            /** Mensaje */
            mensaje: string;
        };
        /**
         * Config
         * @description Configuración compartida con los clientes de fuera (CLI, MCP).
         *
         *     `repo` es la raíz por defecto ya resuelta (absoluta) y `port`, dónde escucha
         *     el core: con esos dos datos un proceso de fuera sabe a quién preguntar y
         *     sobre qué carpeta, sin leer el `localStorage` del webview.
         */
        Config: {
            /** Repo */
            repo?: string | null;
            /**
             * Port
             * @default 18765
             */
            port: number;
        };
        /**
         * ConfigEntrada
         * @description Cambios de configuración: la clave ausente no se toca; `null` limpia.
         */
        ConfigEntrada: {
            /** Repo */
            repo?: string | null;
            /** Port */
            port?: number | null;
        };
        /**
         * DocumentoAbsorbido
         * @description Un documento cuyo Markdown ya solo vive en Events UI.
         *
         *     `copia` es la copia de seguridad dentro de `.EUI/migracion/<lote>/`; el
         *     visor no la lee, pero sirve para saber dónde está el original restaurable.
         */
        DocumentoAbsorbido: {
            /** Ruta */
            ruta: string;
            /** Lote */
            lote: string;
            /** Absorbido At */
            absorbido_at: string;
            /** Items */
            items: number;
            /** Copia */
            copia?: string | null;
        };
        /**
         * DocumentoMarkdown
         * @description La vista Markdown generada desde los ítems de un documento absorbido.
         */
        DocumentoMarkdown: {
            /** Ruta */
            ruta: string;
            /** Texto */
            texto: string;
        };
        /**
         * EntradaLog
         * @description Una línea del registro operativo (`GET /log`): de la app, no del repo.
         */
        EntradaLog: {
            /** Id */
            id: number;
            /** Ts */
            ts: string;
            /**
             * Nivel
             * @enum {string}
             */
            nivel: "info" | "aviso" | "error";
            /** Origen */
            origen: string;
            /** Mensaje */
            mensaje: string;
        };
        /**
         * ErrorDetail
         * @description Lo que devuelven los exception handlers de abajo: `{"detail": ...}`.
         *
         *     Declarado a propósito: sin esto, el OpenAPI solo publicaba el 200 y el
         *     422 de validación, y el cliente TS tenía que adivinar (con un cast) que
         *     el 400/404 trae `detail` como texto.
         */
        ErrorDetail: {
            /** Detail */
            detail: string;
        };
        /**
         * Evento
         * @description El sobre del evento (F1): lo estable; `payload` es JSON libre.
         */
        Evento: {
            /** Id */
            id: number;
            /** Ts */
            ts: string;
            /** Type */
            type: string;
            /** Payload */
            payload: {
                [key: string]: unknown;
            } | string;
            /**
             * Origen
             * @default externo
             */
            origen: string;
            /**
             * Nivel
             * @default info
             * @enum {string}
             */
            nivel: "info" | "aviso" | "error";
            /** Dedupe Key */
            dedupe_key?: string | null;
        };
        /**
         * EventosCompactados
         * @description Respuesta de `POST /eventos/compactar`: qué se recortó del log.
         *
         *     `por_edad`/`por_conteo` son neutros a propósito: el mismo par de claves
         *     sirve para el registro y no hay que adivinar el género del sustantivo.
         */
        EventosCompactados: {
            /** Repo */
            repo: string;
            /** Por Edad */
            por_edad: number;
            /** Por Conteo */
            por_conteo: number;
            /** Vacuum */
            vacuum: boolean;
        };
        /**
         * Fase
         * @description Una fase del ítem (0021), con su propio estado y fecha de entrada.
         */
        Fase: {
            /** Orden */
            orden: number;
            /** Titulo */
            titulo: string;
            /**
             * Estado
             * @default pendiente
             * @enum {string}
             */
            estado: "pendiente" | "completada" | "fallida" | "rechazada";
            /**
             * Nota
             * @default
             */
            nota: string;
            /** Entered At */
            entered_at: string;
            /** Requisitos */
            requisitos?: components["schemas"]["Requisito"][];
            /** Archivos */
            archivos?: components["schemas"]["ArchivoFase"][];
        };
        /**
         * FaseEntrada
         * @description Una fase en el PATCH: `entered_at` lo pone el core (y se conserva si el
         *     estado no cambia). Sin `orden`, se añade al final.
         */
        FaseEntrada: {
            /** Orden */
            orden?: number | null;
            /** Titulo */
            titulo: string;
            /**
             * Estado
             * @default pendiente
             * @enum {string}
             */
            estado: "pendiente" | "completada" | "fallida" | "rechazada";
            /**
             * Nota
             * @default
             */
            nota: string;
            /** Requisitos */
            requisitos?: components["schemas"]["RequisitoEntrada"][] | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /**
         * Health
         * @description Respuesta de `/health`: `journal_mode`/`data_version` solo si hay BD.
         */
        Health: {
            /**
             * Status
             * @enum {string}
             */
            status: "ok" | "degraded";
            /** Version */
            version: string;
            /** Repo */
            repo?: string | null;
            /** Db Path */
            db_path: string;
            /** Db Exists */
            db_exists: boolean;
            /** Journal Mode */
            journal_mode?: string | null;
            /** Data Version */
            data_version?: number | null;
        };
        /** MapSnapshot */
        MapSnapshot: {
            /** Ideas */
            ideas: components["schemas"]["MapWorkItem"][];
        };
        /** MapWorkItem */
        MapWorkItem: {
            /** Uid */
            uid: string;
            /** Title */
            title: string;
            /** Description */
            description: string;
            /**
             * Status
             * @enum {string}
             */
            status: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "historial" | "rejected" | "superseded";
            /** Depende De */
            depende_de?: string[];
            /** Rejected At */
            rejected_at?: string | null;
            /**
             * Rejected Description
             * @default
             */
            rejected_description: string;
            /** Fases */
            fases?: components["schemas"]["Fase"][];
        };
        /**
         * MigracionAplicada
         * @description Respuesta de `POST /migracion/aplicar`.
         *
         *     `repetido` avisa de que la misma huella ya tenía lote: no se creó nada y
         *     `creadas` repite lo del primer apply.
         */
        MigracionAplicada: {
            /** Repo */
            repo: string;
            /** Lote */
            lote: string;
            /** Plan Sha256 */
            plan_sha256: string;
            /** Repetido */
            repetido: boolean;
            /** Ideas */
            ideas: number;
            /** Creadas */
            creadas?: components["schemas"]["MigracionCreada"][];
        };
        /**
         * MigracionCreada
         * @description Una item creada por el lote: su `ref` del plan y el `uid` que recibió.
         */
        MigracionCreada: {
            /** Ref */
            ref: string;
            /** Uid */
            uid: string;
        };
        /**
         * MigracionDeshecha
         * @description Respuesta de `DELETE /migracion/lotes/{lote}`.
         *
         *     `ausentes` son los ítems que ya no estaban (el usuario las borró a mano);
         *     el resto se borró y el lote desaparece.
         */
        MigracionDeshecha: {
            /** Repo */
            repo: string;
            /** Lote */
            lote: string;
            /** Plan Sha256 */
            plan_sha256: string;
            /** Borradas */
            borradas: number;
            /** Ausentes */
            ausentes: number;
        };
        /**
         * NivelArbol
         * @description Una carpeta del árbol ya listada; la raíz del repo es `ruta` vacía.
         *
         *     `recortado` avisa de que la carpeta tiene más entradas de las que caben en
         *     la respuesta: se enseña el principio en vez de callar el resto.
         */
        NivelArbol: {
            /** Ruta */
            ruta: string;
            /** Hijos */
            hijos?: components["schemas"]["NodoArbol"][];
            /**
             * Recortado
             * @default false
             */
            recortado: boolean;
        };
        /**
         * NodoArbol
         * @description Una entrada del árbol de archivos: carpeta o archivo, con su ruta.
         *
         *     `ruta` es relativa a la raíz del repo y con barras normales, que es lo que
         *     el pane usa para pedir el nivel siguiente.
         */
        NodoArbol: {
            /** Nombre */
            nombre: string;
            /** Ruta */
            ruta: string;
            /**
             * Tipo
             * @enum {string}
             */
            tipo: "carpeta" | "archivo";
        };
        /**
         * PlanDocumento
         * @description Clasificación de un Markdown del plan: allowlist o referencia.
         */
        PlanDocumento: {
            /** Ruta */
            ruta: string;
            /**
             * Clase
             * @enum {string}
             */
            clase: "mapa" | "referencia" | "parcial";
            /** Motivo */
            motivo: string;
            /**
             * Destino
             * @enum {string}
             */
            destino: "mapa" | "referencia";
            /** Rangos */
            rangos?: components["schemas"]["PlanRango"][] | null;
        };
        /**
         * PlanFase
         * @description Una fase del plan: entra pendiente y con al menos un requisito.
         */
        PlanFase: {
            /** Titulo */
            titulo: string;
            /**
             * Nota
             * @default
             */
            nota: string;
            /**
             * Estado
             * @default pendiente
             * @constant
             */
            estado: "pendiente";
            /** Requisitos */
            requisitos: components["schemas"]["PlanRequisito"][];
        };
        /**
         * PlanIdea
         * @description Un ítem propuesto: `ref` es local al plan, no un uid del almacén.
         */
        PlanIdea: {
            /** Ref */
            ref: string;
            /** Title */
            title: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Content
             * @default
             */
            content: string;
            /**
             * Kind
             * @default work_item
             * @enum {string}
             */
            kind: "work_item" | "idea";
            /**
             * Status
             * @default proposed
             * @enum {string}
             */
            status: "proposed" | "draft" | "historial" | "rejected";
            /** Fecha */
            fecha?: string | null;
            /** Motivo */
            motivo?: string | null;
            /** Tags */
            tags?: string[];
            /** Depende De */
            depende_de?: string[];
            /** Fases */
            fases?: components["schemas"]["PlanFase"][];
            origen: components["schemas"]["PlanOrigen"];
        };
        /**
         * PlanMigracion
         * @description El plan completo que se aplica como un lote.
         *
         *     La versión 2 añade destinos, fechas y motivo; la 3 el manifiesto
         *     `documentos` (allowlist del mapa). La 1 se conserva para los planes que
         *     solo crean items en `proposed`.
         */
        PlanMigracion: {
            /**
             * Version
             * @enum {integer}
             */
            version: 1 | 2 | 3;
            /** Ideas */
            ideas: components["schemas"]["PlanIdea"][];
            /** Documentos */
            documentos?: components["schemas"]["PlanDocumento"][] | null;
        };
        /**
         * PlanOrigen
         * @description De dónde sale un ítem del plan: el Markdown del scan.
         */
        PlanOrigen: {
            /** Ruta */
            ruta: string;
            /** Desde Linea */
            desde_linea: number;
            /** Hasta Linea */
            hasta_linea: number;
            /** Sha256 */
            sha256: string;
        };
        /**
         * PlanRango
         * @description Un tramo 1-based de un documento parcial.
         */
        PlanRango: {
            /** Desde */
            desde: number;
            /** Hasta */
            hasta: number;
        };
        /**
         * PlanRequisito
         * @description Un requisito de una fase migrada: nace sin marcar.
         */
        PlanRequisito: {
            /** Titulo */
            titulo: string;
            /**
             * Hecho
             * @default false
             * @constant
             */
            hecho: false;
        };
        /**
         * Protocolo
         * @description Una unión permitida por el protocolo de flujo (`protocolo_flujo`).
         *
         *     Los grupos son los carriles que se mueven (`superseded` comparte grupo con
         *     `rejected`: la ficha lo distingue, el carril no), así que no aparecen
         *     como origen ni destino propios.
         */
        Protocolo: {
            /**
             * Origen
             * @enum {string}
             */
            origen: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "rejected";
            /**
             * Destino
             * @enum {string}
             */
            destino: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "rejected";
            /**
             * Exige Fases
             * @default false
             */
            exige_fases: boolean;
            /**
             * Exige Fases Listas
             * @default false
             */
            exige_fases_listas: boolean;
            /**
             * Exige Fases Completas
             * @default false
             */
            exige_fases_completas: boolean;
        };
        /**
         * ProyeccionRepo
         * @description F2: el estado del repo en una lectura, con su identidad.
         *
         *     No es SQL libre desde la UI: es una proyección
         *     fija y versionada. `repo` es la carpeta resuelta. `git` dice si esa carpeta
         *     pertenece a un work tree Git —también con un `git init` sin commits— y
         *     `git_root` es la raíz de ese work tree. `branch`/`commit` son `None` si no
         *     hay Git; el commit también falta mientras el repo no tenga ninguno.
         */
        ProyeccionRepo: {
            /** Repo */
            repo: string;
            /** Laboratorio */
            laboratorio: boolean;
            /** Git */
            git: boolean;
            /** Git Root */
            git_root?: string | null;
            /** Branch */
            branch?: string | null;
            /** Commit */
            commit?: string | null;
            /**
             * Git Cambios
             * @default []
             */
            git_cambios: components["schemas"]["CambioGit"][];
            /** Eui Ignorado */
            eui_ignorado?: boolean | null;
            /** Ideas */
            ideas: number;
            /** Events */
            events: number;
            /** Por Estado */
            por_estado: {
                [key: string]: number;
            };
            /** Ultima Actividad */
            ultima_actividad?: string | null;
        };
        /**
         * RegistroPurgado
         * @description Respuesta de `POST /log/purgar`: qué se llevó la retención.
         *
         *     Mismas claves neutras que `EventosCompactados`: `por_edad`/`por_conteo`.
         */
        RegistroPurgado: {
            /** Por Edad */
            por_edad: number;
            /** Por Conteo */
            por_conteo: number;
        };
        /**
         * Reinicio
         * @description Respuesta de `POST /reiniciar` (LAB): cuántas filas se vaciaron.
         */
        Reinicio: {
            /** Repo */
            repo: string;
            /** Ideas Eliminadas */
            ideas_eliminadas: number;
            /** Eventos Eliminados */
            eventos_eliminados: number;
        };
        /**
         * Repo
         * @description Una carpeta del laboratorio ya sembrada, tal como la ofrece `GET /repos`.
         */
        Repo: {
            /** Repo */
            repo: string;
            /** Db Path */
            db_path: string;
        };
        /**
         * Requisito
         * @description Un requisito de una fase (0025): su criterio de hecho, binario.
         */
        Requisito: {
            /** Orden */
            orden: number;
            /** Titulo */
            titulo: string;
            /**
             * Hecho
             * @default false
             */
            hecho: boolean;
            /** Done At */
            done_at?: string | null;
            /** Archivos */
            archivos?: components["schemas"]["ArchivoFase"][];
        };
        /**
         * RequisitoEntrada
         * @description Un requisito en el PATCH; sin `orden`, se añade al final.
         *
         *     Si la fase no trae `requisitos`, se conservan los que tenía; una lista
         *     vacía los retira.
         */
        RequisitoEntrada: {
            /** Orden */
            orden?: number | null;
            /** Titulo */
            titulo: string;
            /**
             * Hecho
             * @default false
             */
            hecho: boolean;
        };
        /**
         * Revision
         * @description Firma del almacén para el refresco en vivo.
         *
         *     `data_version` es `PRAGMA data_version` y es por conexión: un vigilante
         *     nuevo vuelve a empezar su cuenta. `ultimo_evento` sale del propio almacén
         *     (`max(id)` del log), así que un evento nuevo mueve la firma aunque no se
         *     toque ningún ítem.
         */
        Revision: {
            /** Instance */
            instance: string;
            /** Data Version */
            data_version: number;
            /** Ideas */
            ideas: number;
            /** Ultimo Evento */
            ultimo_evento: number;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /** WorkItem */
        WorkItem: {
            /** Title */
            title: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Content
             * @default
             */
            content: string;
            /**
             * Kind
             * @default work_item
             * @enum {string}
             */
            kind: "work_item" | "idea" | "adr" | "note";
            /**
             * Status
             * @default draft
             * @enum {string}
             */
            status: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "historial" | "rejected" | "superseded";
            /** Tags */
            tags?: string[];
            /** Depende De */
            depende_de?: string[];
            /** Fases */
            fases?: components["schemas"]["Fase"][];
            /** Uid */
            uid: string;
            /** Created At */
            created_at: string;
            /** Updated At */
            updated_at: string;
            /** Roadmap Started At */
            roadmap_started_at?: string | null;
            /** Roadmap Completed At */
            roadmap_completed_at?: string | null;
            /**
             * Roadmap Resultado
             * @default
             */
            roadmap_resultado: string;
            /**
             * Roadmap Referencia
             * @default
             */
            roadmap_referencia: string;
            /** Verificacion Started At */
            verificacion_started_at?: string | null;
            /**
             * Verificacion Intentos
             * @default 0
             */
            verificacion_intentos: number;
            /**
             * Verificacion Ultimo Resultado
             * @default
             */
            verificacion_ultimo_resultado: string;
            /**
             * Verificacion Comentario
             * @default
             */
            verificacion_comentario: string;
            /** Revision Approved At */
            revision_approved_at?: string | null;
            /**
             * Revision Approved By
             * @default usuario
             * @enum {string}
             */
            revision_approved_by: "usuario" | "agente" | "sistema";
            /**
             * Revision Nota
             * @default
             */
            revision_nota: string;
            /** Rejected At */
            rejected_at?: string | null;
            /**
             * Rejected Description
             * @default
             */
            rejected_description: string;
            /**
             * Rejected By
             * @default usuario
             * @enum {string}
             */
            rejected_by: "usuario" | "agente" | "sistema";
            /** Superseded By Uid */
            superseded_by_uid?: string | null;
        };
        /** WorkItemCreate */
        WorkItemCreate: {
            /** Title */
            title: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Content
             * @default
             */
            content: string;
            /**
             * Kind
             * @default work_item
             * @constant
             */
            kind: "work_item";
            /**
             * Status
             * @default draft
             * @enum {string}
             */
            status: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "historial" | "rejected" | "superseded";
            /** Tags */
            tags?: string[];
            /** Depende De */
            depende_de?: string[];
            /** Fases */
            fases?: components["schemas"]["FaseEntrada"][] | null;
        };
        /**
         * WorkItemResumen
         * @description Una fila del listado: el ítem sin su Markdown ni el desglose de fases.
         *
         *     `/items` es la pantalla de una lista, no la ficha: con 500 ítems y Markdown
         *     absorbido cada fila arrastraba su cuerpo entero. El detalle sigue en
         *     `/items/{uid}` y `?incluir=contenido` devuelve el listado de antes.
         */
        WorkItemResumen: {
            /** Uid */
            uid: string;
            /** Title */
            title: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Kind
             * @default work_item
             * @enum {string}
             */
            kind: "work_item" | "idea" | "adr" | "note";
            /**
             * Status
             * @enum {string}
             */
            status: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "historial" | "rejected" | "superseded";
            /** Tags */
            tags?: string[];
            /** Depende De */
            depende_de?: string[];
            /** Created At */
            created_at: string;
            /** Updated At */
            updated_at: string;
            /**
             * Fases Hechas
             * @default 0
             */
            fases_hechas: number;
            /**
             * Fases Total
             * @default 0
             */
            fases_total: number;
            /**
             * Requisitos Hechos
             * @default 0
             */
            requisitos_hechos: number;
            /**
             * Requisitos Total
             * @default 0
             */
            requisitos_total: number;
        };
        /**
         * WorkItemUpdate
         * @description Campos ausentes no se tocan; `null` explícito tampoco los borra.
         *
         *     Los del descarte viajan junto al `status: rejected`/`superseded`: el
         *     motivo y quién lo dictamina se guardan en `rejected_node` al entrar en
         *     `descartadas`. Los de roadmap, verificación y revisión aprobada viajan
         *     igual junto a su `status` y se guardan en su detalle.
         */
        WorkItemUpdate: {
            /** Title */
            title?: string | null;
            /** Description */
            description?: string | null;
            /** Content */
            content?: string | null;
            /** Kind */
            kind?: "work_item" | null;
            /** Status */
            status?: ("draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "historial" | "rejected" | "superseded") | null;
            /** Tags */
            tags?: string[] | null;
            /** Depende De */
            depende_de?: string[] | null;
            /** Rejected Description */
            rejected_description?: string | null;
            /** Rejected By */
            rejected_by?: ("usuario" | "agente" | "sistema") | null;
            /** Superseded By Uid */
            superseded_by_uid?: string | null;
            /** Roadmap Resultado */
            roadmap_resultado?: string | null;
            /** Roadmap Referencia */
            roadmap_referencia?: string | null;
            /** Verificacion Resultado */
            verificacion_resultado?: string | null;
            /** Verificacion Comentario */
            verificacion_comentario?: string | null;
            /** Approved By */
            approved_by?: ("usuario" | "agente" | "sistema") | null;
            /** Revision Nota */
            revision_nota?: string | null;
            /** Fases */
            fases?: components["schemas"]["FaseEntrada"][] | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    get_repos_repos_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Repo"][];
                };
            };
        };
    };
    get_items_items_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                status?: ("draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "historial" | "rejected" | "superseded") | null;
                kind?: ("work_item" | "idea" | "adr" | "note") | null;
                incluir?: "contenido" | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkItemResumen"][] | components["schemas"]["WorkItem"][];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_item_items_post: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkItemCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkItem"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_item_items__uid__get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path: {
                uid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkItem"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_item_items__uid__delete: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path: {
                uid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    patch_item_items__uid__patch: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path: {
                uid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkItemUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkItem"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_reiniciar_reiniciar_post: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Reinicio"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_protocolos_protocolos_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Protocolo"][];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_map_mapa_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapSnapshot"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_revision_revision_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Revision"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_eventos_eventos_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                /** @description Cursor: solo eventos con id mayor */
                desde?: number;
                limite?: number;
                /** @description Solo este origen: `item`, `externo`, … */
                origen?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Evento"][];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    stream_eventos_eventos_stream_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_compactar_eventos_compactar_post: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                /** @description Edad máxima en días */
                dias?: number;
                /** @description Máximo de eventos a conservar */
                max_eventos?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventosCompactados"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_log_log_get: {
        parameters: {
            query?: {
                limite?: number;
                nivel?: ("info" | "aviso" | "error") | null;
                origen?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntradaLog"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_purgar_log_log_purgar_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RegistroPurgado"];
                };
            };
        };
    };
    get_proyeccion_repo_proyecciones_repo_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProyeccionRepo"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_git_inicializar_git_inicializar_post: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProyeccionRepo"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_git_eliminar_git_eliminar_post: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProyeccionRepo"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_git_commits_git_commits_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                /** @description Máximo de commits */
                limite?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommitGit"][];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_git_commit_git_commit_post: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CommitPeticion"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProyeccionRepo"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_git_ignorar_almacen_git_ignorar_almacen_post: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProyeccionRepo"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_arbol_arbol_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                /** @description Carpetas a listar, relativas a la raíz del repo */
                rutas?: string[] | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NivelArbol"][];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_archivo_archivo_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                /** @description Ruta del archivo, relativa a la raíz del repo */
                ruta: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Archivo"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description El archivo no es texto legible */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_archivo_bytes_archivo_bytes_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                /** @description Ruta de la imagen, relativa a la raíz del repo */
                ruta: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description La imagen supera el tope */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description El archivo no es una imagen */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_config_config_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Config"];
                };
            };
        };
    };
    put_config_config_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfigEntrada"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Config"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_documentos_documentos_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentoAbsorbido"][];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_documento_documentos_markdown_get: {
        parameters: {
            query: {
                ruta: string;
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentoMarkdown"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description El documento no tiene ítems absorbidos */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_aplicar_migracion_aplicar_post: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanMigracion"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MigracionAplicada"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_lote_migracion_lotes__lote__delete: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path: {
                lote: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MigracionDeshecha"];
                };
            };
            /** @description Petición inválida */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description No existe el repo o el ítem */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorDetail"];
                };
            };
            /** @description El lote ya no está como lo dejó el apply */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
