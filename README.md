# n8n-nodes-lmstudio

An [n8n](https://n8n.io) community node for [LM Studio](https://lmstudio.ai) — run local LLMs with optional JSON schema for structured outputs.

## Features

- **Dynamic model selector** — fetches available models from your LM Studio server, shows loaded/unloaded state and quantization info
- **Structured JSON output** — provide a JSON schema and get validated, parsed responses
- **Usable as a tool** — can be used as a tool node in n8n AI agent workflows

## Installation

### In n8n (recommended)

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

| Field    | Description                                    | Default                |
|----------|------------------------------------------------|------------------------|
| Host URL | LM Studio server URL with protocol and port    | `http://localhost:1234` |
| API Key  | Optional API key (leave empty if not required)  |                        |

The credential tests connectivity by hitting your server's `/api/v0/models` endpoint.

### Node: LM Studio Simple Message

| Parameter       | Description                                              |
|-----------------|----------------------------------------------------------|
| Model           | Select from available LLM/VLM models on your server      |
| Message         | The user message to send                                 |
| JSON Schema     | Optional JSON schema for structured output               |
| Temperature     | Controls randomness (0–2, default 0.3)                   |
| Max Tokens      | Maximum tokens to generate (empty = model default)       |
| Timeout         | Request timeout in seconds (0 = no timeout)              |

## Development

```bash
npm install
npm run build
npm run dev          # start n8n with hot reload
npm run lint         # check for errors
npm test             # run unit tests
npm run test:integration  # run integration tests (requires LM Studio)
```

Integration tests require a running LM Studio server:

```bash
LM_STUDIO_URL=http://localhost:1234 npm run test:integration
```

## Automated npm Publishing

The repository now includes [release.yml](/Users/johnsmacminiserver/Documents/Programmierung/n8n-lmstudio-nodes/.github/workflows/release.yml:1) for npm Trusted Publishing via GitHub Actions OIDC.

What it does:

- runs on pushes to `master`
- installs dependencies, lints, builds, and tests
- bumps the patch version automatically
- publishes with `npm publish --provenance --access public`
- commits the updated `package.json` and `package-lock.json`
- creates and pushes a matching git tag

What you still need to configure on npm:

1. Open the package settings for `@mephistojb/n8n-nodes-lmstudio` on npm.
2. Add a Trusted Publisher for GitHub Actions.
3. Use these values:
   - Organization or user: `MephistoJB`
   - Repository: `n8n-lmstudio-nodes`
   - Workflow filename: `release.yml`
   - Allowed action: `npm publish`

Trusted Publishing reference:

- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)

## Acknowledgments

This project was developed with assistance from [Claude](https://claude.ai), Anthropic's AI assistant.

## License

[MIT](LICENSE.md)
