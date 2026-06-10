# Command Reference

Always use `--json` for machine-readable output. Run `lightpick <command> -h` for the latest options.

## auth

```bash
lightpick auth login              # Configure API token (interactive)
lightpick auth status             # Verify connection
lightpick auth logout             # Remove saved token
```

## projects

```bash
lightpick projects list --json
lightpick projects create --name "Name" --description "..." --json
lightpick projects get --id <project-id> --json
lightpick projects delete --id <project-id>
```

## canvas

### Connection management

```bash
lightpick canvas connect --project <id>     # Start daemon (persistent WebSocket)
lightpick canvas disconnect --project <id>  # Stop daemon
```

### Reading

```bash
lightpick canvas list --project <id> --json                  # All nodes
lightpick canvas list --project <id> --type text --json      # Filter by type
lightpick canvas get --project <id> --node <node-id> --json  # Single node
lightpick canvas search --project <id> --query "sunset" --json
lightpick canvas search --project <id> --query "hero" --type image_gen,video_gen --json
```

### Writing

```bash
# Add nodes
lightpick canvas add --project <id> --type text --label "Script" --content "..." --json
lightpick canvas add --project <id> --type group --label "Scene 1" --json
lightpick canvas add --project <id> --type text --label "Prompt" --content "..." --parent <group-id> --json
lightpick canvas add --project <id> --type image_gen --label "Hero Shot" --parent <group-id> --json

# Update
lightpick canvas update --project <id> --node <id> --label "New Label" --content "New content" --json

# Delete
lightpick canvas delete --project <id> --node <id> --json

# Execute generation
lightpick canvas execute --project <id> --node <action-badge-id> --json
```

## tasks

```bash
lightpick tasks status --task-id <id> --json
lightpick tasks wait --task-id <id> --timeout 120 --json
```

## actions

```bash
lightpick action list --json           # List installed actions
lightpick action search --query "..." --json
lightpick action install --id <id>
lightpick action uninstall --id <id>
```

## vars

```bash
lightpick vars list --json
lightpick vars set --key API_KEY --value "..." 
lightpick vars delete --key API_KEY
```
