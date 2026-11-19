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
         *     porque la app no lo crea.
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
    "/ideas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Ideas */
        get: operations["get_ideas_ideas_get"];
        put?: never;
        /** Post Idea */
        post: operations["post_idea_ideas_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ideas/{uid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Idea */
        get: operations["get_idea_ideas__uid__get"];
        put?: never;
        post?: never;
        /** Remove Idea */
        delete: operations["remove_idea_ideas__uid__delete"];
        options?: never;
        head?: never;
        /** Patch Idea */
        patch: operations["patch_idea_ideas__uid__patch"];
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
         * @description Reinicio de laboratorio: el almacén queda vacío (ideas, cola, fichas
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
         * @description Las ideas del mapa tal como estaban en una misma lectura de SQLite.
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
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
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
         * @description Una fase de la idea (0021), con su propio estado y fecha de entrada.
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
            /** Db Path */
            db_path: string;
            /** Db Exists */
            db_exists: boolean;
            /** Journal Mode */
            journal_mode?: string | null;
            /** Data Version */
            data_version?: number | null;
        };
        /** Idea */
        Idea: {
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
             * @default idea
             * @enum {string}
             */
            kind: "idea" | "adr" | "note";
            /**
             * Status
             * @default draft
             * @enum {string}
             */
            status: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "rejected" | "superseded";
            /** Tags */
            tags?: string[];
            /** Depende De */
            depende_de?: string[];
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
            /** Fases */
            fases?: components["schemas"]["Fase"][];
        };
        /** IdeaCreate */
        IdeaCreate: {
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
             * @default idea
             * @constant
             */
            kind: "idea";
            /**
             * Status
             * @default draft
             * @enum {string}
             */
            status: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "rejected" | "superseded";
            /** Tags */
            tags?: string[];
            /** Depende De */
            depende_de?: string[];
        };
        /**
         * IdeaUpdate
         * @description Campos ausentes no se tocan; `null` explícito tampoco los borra.
         *
         *     Los del descarte viajan junto al `status: rejected`/`superseded`: el
         *     motivo y quién lo dictamina se guardan en `rejected_node` al entrar en
         *     `descartadas`. Los de roadmap, verificación y revisión aprobada viajan
         *     igual junto a su `status` y se guardan en su detalle.
         */
        IdeaUpdate: {
            /** Title */
            title?: string | null;
            /** Description */
            description?: string | null;
            /** Content */
            content?: string | null;
            /** Kind */
            kind?: "idea" | null;
            /** Status */
            status?: ("draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "rejected" | "superseded") | null;
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
        /** MapIdea */
        MapIdea: {
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
            status: "draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "rejected" | "superseded";
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
        /** MapSnapshot */
        MapSnapshot: {
            /** Ideas */
            ideas: components["schemas"]["MapIdea"][];
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
         *     fija y versionada. `repo` es la carpeta resuelta; `branch`/`commit` vienen
         *     de git cuando hay repo git y son `None` si no.
         */
        ProyeccionRepo: {
            /** Repo */
            repo: string;
            /** Laboratorio */
            laboratorio: boolean;
            /** Branch */
            branch?: string | null;
            /** Commit */
            commit?: string | null;
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
         * @description Firma del almacén para el refresco en vivo (`PRAGMA data_version`).
         */
        Revision: {
            /** Instance */
            instance: string;
            /** Data Version */
            data_version: number;
            /** Ideas */
            ideas: number;
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
    get_ideas_ideas_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                status?: ("draft" | "proposed" | "roadmap" | "verificacion" | "revision_aprobada" | "rejected" | "superseded") | null;
                kind?: "idea" | null;
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
                    "application/json": components["schemas"]["Idea"][];
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
            /** @description No existe el repo o la idea */
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
    post_idea_ideas_post: {
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
                "application/json": components["schemas"]["IdeaCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Idea"];
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
            /** @description No existe el repo o la idea */
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
    get_idea_ideas__uid__get: {
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
                    "application/json": components["schemas"]["Idea"];
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
            /** @description No existe el repo o la idea */
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
    remove_idea_ideas__uid__delete: {
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
            /** @description No existe el repo o la idea */
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
    patch_idea_ideas__uid__patch: {
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
                "application/json": components["schemas"]["IdeaUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Idea"];
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
            /** @description No existe el repo o la idea */
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
            /** @description No existe el repo o la idea */
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
            /** @description No existe el repo o la idea */
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
            /** @description No existe el repo o la idea */
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
            /** @description No existe el repo o la idea */
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
                /** @description Solo este origen: `idea`, `externo`, … */
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
            /** @description No existe el repo o la idea */
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
            /** @description No existe el repo o la idea */
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
            /** @description No existe el repo o la idea */
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
            /** @description No existe el repo o la idea */
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
}
