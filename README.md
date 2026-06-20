# @mephistojb/n8n-nodes-lmstudio

An [n8n](https://n8n.io) community node for [LM Studio](https://lmstudio.ai) that covers both chat and local model management.

## Features

- **One node, multiple operations**: `Send Message`, `List Models`, `List Loaded Models`, `Load Model`, and `Unload Model`
- **LM Studio auth support**: credentials forward the bearer token during connectivity checks, model listing, and execution requests
- **Model management**: inspect loaded and unloaded models, load them with custom settings, and unload active instances
- **Advanced request controls**: optional LM Studio API settings are hidden behind `Advanced` collections
- **Structured JSON output**: OpenAI-compatible chat mode supports JSON schema output
- **Native LM Studio API support**: use `/api/v1/chat` when you need LM Studio-specific fields such as `context_length`
- **Vision and OCR input**: native chat mode can attach an image binary property for LM Studio vision models

## Installation

### In n8n

1. Go to **Settings > Community Nodes**
2. Select **Install a community node**
3. Enter `@mephistojb/n8n-nodes-lmstudio`
4. Agree to the risks and click **Install**

### Manual

```bash
npm install @mephistojb/n8n-nodes-lmstudio
```

## Configuration

### Credential: LM Studio API

| Field | Description | Default |
| --- | --- | --- |
| Host URL | LM Studio server URL including protocol and port | `http://localhost:1234` |
| API Key | Optional API token from the LM Studio Developer server settings | empty |

The credential test checks `GET /api/v1/models` and includes the bearer token when one is configured.

## Node Operations

### Send Message

Default mode uses the OpenAI-compatible `POST /v1/chat/completions` endpoint to preserve structured output support.

Base inputs:

| Field | Description |
| --- | --- |
| Model Name or ID | Chat-capable model to use |
| Message | User prompt |
| JSON Schema | Optional structured-output schema |

Advanced options include:

- `API Mode`
- `System Prompt`
- `Image Binary Property`
- `Context Length`
- `Temperature`
- `Top P`
- `Top K`
- `Min P`
- `Repeat Penalty`
- `Max Output Tokens`
- `Reasoning`
- `Seed`
- `Store Chat`
- `Previous Response ID`
- `Timeout`
- `Raw Advanced JSON`

When `API Mode` is `Native API V1`, you can set `Image Binary Property` to send an image from the current n8n item as a `data_url` to LM Studio's native `/api/v1/chat` endpoint. This is the recommended path for OCR and vision prompts.

`Raw Advanced JSON` is merged into the outgoing request body so you can pass additional LM Studio API fields without waiting for a node update.

### List Models

Returns one n8n item per model with metadata such as:

- loaded state
- loaded instances
- quantization
- max context length
- selected variant
- raw LM Studio response object

### Load Model

Uses `POST /api/v1/models/load`.

Advanced options include:

- `Context Length`
- `Eval Batch Size`
- `Flash Attention`
- `Offload KV Cache to GPU`
- `Number of Experts`
- `TTL Seconds`
- `Raw Advanced JSON`

### Unload Model

Uses `POST /api/v1/models/unload` and lets you pick from the currently loaded instance IDs.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm test -- --runInBand
LM_STUDIO_URL=http://localhost:1234 npm run test:integration -- --runInBand
```

## Automated npm Publishing

The repository includes [release.yml](/Users/johnsmacminiserver/Documents/Programmierung/n8n-lmstudio-nodes/.github/workflows/release.yml:1) for npm Trusted Publishing via GitHub Actions OIDC.
The GitHub Actions workflows use `actions/setup-node@v6` with Node.js `24`.

Behavior:

- every push to `master` runs typecheck, lint, build, and tests
- the workflow bumps the package version automatically
- the new version is published to npm with provenance
- `package.json`, `package-lock.json`, and a git tag are pushed back automatically

The release workflow on `master` expects npm Trusted Publishing to be configured for `@mephistojb/n8n-nodes-lmstudio` with this GitHub repository and `.github/workflows/release.yml`.

## Notes on LM Studio Compatibility

- The node prefers LM Studio's native REST API at `/api/v1/*` for model management.
- Chat supports both `/api/v1/chat` and `/v1/chat/completions`.
- A fallback to `/api/v0/models` remains for older LM Studio installations when model listing is needed.

## License

[MIT](LICENSE.md)
