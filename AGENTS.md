# AGENTS.md — drop-metadata-steamgriddb

SteamGridDB artwork and metadata provider plugin for Drop (#206).

## Toolchain

- Node >= 22, npm 10+
- `npm ci`, `npm run build`, `npm test`, `npm run typecheck`

## Contract

Built on [`@droposs/plugin-sdk`](https://github.com/Heretek-Games/drop-plugin-sdk)
(plugin API v2). The SDK is consumed from the public npm registry
(`@droposs/plugin-sdk@^0.4.0`), so fresh clones and CI installs need no sibling
checkout.

## Configuration

The SteamGridDB API key is read from plugin storage (`ctx.storage`, key
`config`, field `apiKey`) and falls back to the `STEAMGRIDDB_API_KEY`
environment variable. Keys are never logged.
