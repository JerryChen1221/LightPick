# Setup & Authentication

## Installation

```bash
npm install -g @lightpick/cli
lightpick --version
```

## Authentication

### For humans (browser OAuth)

```bash
lightpick auth login
```

Opens browser → click "Authorize" → done. Token saved to `~/.lightpick/config.json`.

### For agents / CI (environment variable)

```bash
export LIGHTPICK_API_KEY=clsh_...
export LIGHTPICK_API_URL=https://your-instance.com  # optional, defaults to http://localhost:8788
```

Create a token in the LightPick web app: avatar → Settings → API Tokens → Create.

### Verify

```bash
lightpick auth status
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LIGHTPICK_API_KEY` | API token (`clsh_...`) — overrides config file | from `~/.lightpick/config.json` |
| `LIGHTPICK_API_URL` | Server URL | `http://localhost:8788` |

## Troubleshooting

| Error | Fix |
|-------|-----|
| `No API key configured` | `lightpick auth login` or set `LIGHTPICK_API_KEY` |
| `API error 401` | Token invalid or expired — create a new one |
| `Cannot reach server` | Check `LIGHTPICK_API_URL` / server running |
| `ECONNREFUSED` | Server not running or wrong URL |
