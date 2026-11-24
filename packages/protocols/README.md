# @jaminsmokedevs/protocols

Las puertas del flujo de [Events UI](https://github.com/jaminsmoke/events-ui):
el esquema de `.EUI/protocolos.json`, la política de partida y un `eui-guard`
que delega en el CLI.

## Qué trae

- `protocolos.json`: las puertas de la v1, todas puestas. Se copia a
  `.EUI/protocolos.json` del repo.
- `schema.json`: el JSON Schema del archivo, para validarlo o autocompletarlo.
- `eui-guard`: ejecuta `eui guard` y devuelve su código de salida.

## Cómo se adopta

```sh
npm install --save-dev @jaminsmokedevs/protocols
mkdir -p .EUI
cp node_modules/@jaminsmokedevs/protocols/protocolos.json .EUI/protocolos.json
```

En `.gitignore`, para versionar solo la política:

```gitignore
.EUI/*
!.EUI/protocolos.json
```

Y en el pre-commit, o en el pre-herramienta del agente:

```sh
npx eui-guard --repo .
```

`eui-guard` necesita el CLI `eui` en el PATH (`@events-ui/webapp`).

## Qué no hace

El paquete no puede impedir que alguien escriba con su editor: la guarda
detecta y el hook del host decide. Lo que sí cierra son las herramientas del
MCP, y eso lo aplica el core.
