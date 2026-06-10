---
name: lightpick
description: >
  AI video production with the LightPick platform. Use this skill whenever the user
  mentions LightPick, video projects, canvas editing, image/video generation,
  storyboards, or wants to create visual content. Also use when the user asks
  about managing LightPick projects, tokens, or CLI setup.
allowed-tools:
  - Bash
metadata:
  author: lightpick
  version: 1.0.0
  category: video-production
  tags: [video, canvas, generation, storyboard, cli]
---

# LightPick — AI Video Production

LightPick is a canvas-based platform for AI video production. You interact with it through the `lightpick` CLI which syncs in real-time with the web app via CRDT.

Run `lightpick -h` or `lightpick <command> -h` for full option details on any command.

## Quick Start

```bash
# Verify auth
lightpick auth status

# List projects
lightpick projects list --json

# Open canvas with persistent connection (recommended)
lightpick canvas connect --project <id>

# Work with nodes...
lightpick canvas list --project <id> --json
lightpick canvas add --project <id> --type text --label "My Scene" --content "..." --json

# Disconnect when done (auto-exits after 10min idle)
lightpick canvas disconnect --project <id>
```

## Core Concepts

**Projects** contain a **canvas** with **nodes**. Nodes are the building blocks:

| Type | Purpose |
|------|---------|
| `text` | Content — scripts, prompts, style guides |
| `group` | Container — organizes related nodes |
| `image_gen` / `video_gen` | Generation trigger — creates images or videos |
| `image` / `video` | Asset — holds generated media |

Text nodes in a group provide context for generation nodes in the same group.

## Daemon Mode

Always start with `canvas connect` for multi-command sessions. This keeps a persistent WebSocket connection and avoids reconnecting on every command:

```bash
lightpick canvas connect --project <id>
# All subsequent canvas commands use the daemon — zero overhead
lightpick canvas disconnect --project <id>  # or just let it auto-exit
```

## Typical Workflow

1. **Create or select a project**
2. **Connect** to the canvas
3. **Build structure** — groups + text nodes
4. **Generate** — add `image_gen`/`video_gen` nodes or execute existing ones
5. **Review** — list nodes, check statuses
6. **Disconnect**

## References

For detailed information, read these files from the skill directory:

| File | When to read |
|------|-------------|
| [references/setup.md](references/setup.md) | First-time setup, auth issues, environment config |
| [references/canvas.md](references/canvas.md) | Node types, data structures, generation pipeline, grouping patterns |
| [references/commands.md](references/commands.md) | Full command reference with examples |
