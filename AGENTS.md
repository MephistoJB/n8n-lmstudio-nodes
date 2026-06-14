# AGENTS.md

- You find relevant tokens in token.md. Never upload this to git or github
- You run on a Mac-mini Host.
- The applications you are interested in are docker containers, which are administrated by a Komodo instance.
- IMPORTANT: You are only allowed to run docker commands on the host without my explicit approval.
- Whenever you need access to n8n use the n8n MCP and the n8n skill.
    - The n8n MCP is registered globally in Codex as `n8n` at `http://127.0.0.1:5679/mcp`.
    - The n8n MCP runs as service `n8n-mcp` in the Komodo stack named `assistant` on server `Macserver`.
    - The n8n MCP requires `WEBHOOK_SECURITY_MODE=permissive` so it can reach n8n over the private Docker network; cloud metadata endpoints remain blocked.
    - n8n MCP authentication uses the local environment variable `N8N_MCP_AUTH_TOKEN`. Its login-persistent LaunchAgent is `~/Library/LaunchAgents/org.codex.n8n-mcp-token.plist`; never copy the token into this repository.
    - If the n8n MCP token changes, retrieve `AUTH_TOKEN` from the running `n8n-mcp` container through the Komodo MCP and update the local LaunchAgent.
    - The n8n skills from `czlonkowski/n8n-skills` are installed globally under `~/.codex/skills/n8n-*`. Always consult `n8n-mcp-tools-expert` before using n8n MCP tools.    
- Try to act with native docker commands. If necessary, you can  Komodo use the Komodo MCP and the komodo skill.
- IMPORTANT: run type check after every code change (prevents broken types).
- Make minimal changes, don't refactor unrelated code.
- you have also access to other servers via ssh. ask for access when needed. if i give you access, save it here.
- Create separate commits per logical change. Upload to github only when asked by me.
- When unsure, explain both approaches and let me choose.
- When you update the code, update this AGENTS.md and the README.md if necessary to reflect the changes.
- Fill out the next chapters and keep them up to date. You find an example in AGENTS.md.example

## Project

## Stack

## Commands

## Architecture

## Rules

## Workflow

## Out of scope

