---
name: setup
description: Set up LightPick CLI authentication and verify connection
---

# LightPick Setup

Follow these steps to set up the LightPick CLI:

## 1. Check if CLI is installed

```bash
which lightpick || echo "Not installed. Run: npm install -g @lightpick/cli"
```

## 2. Configure your API token

Get your API token from the LightPick dashboard at **Settings > API Tokens**, then:

```bash
export LIGHTPICK_API_KEY=clsh_your_token_here
```

Or save it permanently:

```bash
lightpick auth login
```

## 3. Verify

```bash
lightpick auth status
```

You should see your authentication status and project count.

## 4. Test

```bash
lightpick projects list --json
```

If you see your projects, you're all set!
