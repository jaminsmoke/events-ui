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
    "/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Connections */
        get: operations["get_connections_connections_get"];
        put?: never;
        /** Post Connection */
        post: operations["post_connection_connections_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections/{connection_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove Connection */
        delete: operations["remove_connection_connections__connection_id__delete"];
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
         * @description Ideas y conexiones tal como estaban en la misma lectura de SQLite.
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
        /** Connection */
        Connection: {
            /** Parent Uid */
            parent_uid: string;
            /** Child Uid */
            child_uid: string;
            /**
             * Kind
             * @default child
             * @enum {string}
             */
            kind: "child" | "related" | "supersedes";
            /** Id */
            id: number;
            /** Created At */
            created_at: string;
        };
        /** ConnectionCreate */
        ConnectionCreate: {
            /** Parent Uid */
            parent_uid: string;
            /** Child Uid */
            child_uid: string;
            /**
             * Kind
             * @default child
             * @enum {string}
             */
            kind: "child" | "related" | "supersedes";
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
            /** Dedupe Key */
            dedupe_key?: string | null;
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
            status: "draft" | "proposed" | "accepted" | "rejected" | "superseded";
            /** Tags */
            tags?: string[];
            /** Uid */
            uid: string;
            /** Created At */
            created_at: string;
            /** Updated At */
            updated_at: string;
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
             * @enum {string}
             */
            kind: "idea" | "adr" | "note";
            /**
             * Status
             * @default draft
             * @enum {string}
             */
            status: "draft" | "proposed" | "accepted" | "rejected" | "superseded";
            /** Tags */
            tags?: string[];
        };
        /**
         * IdeaUpdate
         * @description Campos ausentes no se tocan; `null` explícito tampoco los borra.
         *
         *     Los del descarte viajan junto al `status: rejected`/`superseded`: el
         *     motivo y quién lo dictamina se guardan en `idea_rejected` al entrar en
         *     `descartadas`.
         */
        IdeaUpdate: {
            /** Title */
            title?: string | null;
            /** Description */
            description?: string | null;
            /** Content */
            content?: string | null;
            /** Kind */
            kind?: ("idea" | "adr" | "note") | null;
            /** Status */
            status?: ("draft" | "proposed" | "accepted" | "rejected" | "superseded") | null;
            /** Tags */
            tags?: string[] | null;
            /** Rejected Description */
            rejected_description?: string | null;
            /** Rejected By */
            rejected_by?: ("usuario" | "agente" | "sistema") | null;
            /** Superseded By Uid */
            superseded_by_uid?: string | null;
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
            status: "draft" | "proposed" | "accepted" | "rejected" | "superseded";
            /** Rejected At */
            rejected_at?: string | null;
            /**
             * Rejected Description
             * @default
             */
            rejected_description: string;
        };
        /** MapSnapshot */
        MapSnapshot: {
            /** Ideas */
            ideas: components["schemas"]["MapIdea"][];
            /** Connections */
            connections: components["schemas"]["Connection"][];
        };
        /**
         * ProyeccionRepo
         * @description F2: el estado del repo en una lectura, con su identidad.
         *
         *     No es SQL libre desde la UI (ADR 0001, decisión 8): es una proyección
         *     fija y versionada. `repo` es la carpeta resuelta; `branch`/`commit` vienen
         *     de git cuando hay repo git y son `None` si no.
         */
        ProyeccionRepo: {
            /** Repo */
            repo: string;
            /** Branch */
            branch?: string | null;
            /** Commit */
            commit?: string | null;
            /** Ideas */
            ideas: number;
            /** Connections */
            connections: number;
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
            /** Connections */
            connections: number;
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
                status?: ("draft" | "proposed" | "accepted" | "rejected" | "superseded") | null;
                kind?: ("idea" | "adr" | "note") | null;
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
    get_connections_connections_get: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
                /** @description Solo las que cuelgan de esta idea */
                parent_uid?: string | null;
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
                    "application/json": components["schemas"]["Connection"][];
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
    post_connection_connections_post: {
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
                "application/json": components["schemas"]["ConnectionCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Connection"];
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
    remove_connection_connections__connection_id__delete: {
        parameters: {
            query: {
                /** @description Carpeta del repo: ruta absoluta o nombre en el lab */
                repo: string;
            };
            header?: never;
            path: {
                connection_id: number;
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
            /** @description No existe la conexión */
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
