import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { projectsCommand } from "./commands/projects";
import { canvasCommand } from "./commands/canvas";
import { tasksCommand } from "./commands/tasks";
import { actionsCommand } from "./commands/actions";
import { varsCommand } from "./commands/vars";
import { roomCommand } from "./commands/room";

const program = new Command();

program
  .name("lightpick")
  .description(`LightPick CLI — AI video production from your terminal

Setup:
  1. Create an API token at your LightPick Settings page (avatar → Settings → API Tokens)
  2. lightpick auth login            # paste your clsh_... token
  3. lightpick auth status            # verify connection

Environment variables (override config file):
  LIGHTPICK_API_KEY     API token (clsh_...)
  LIGHTPICK_API_URL     Server URL (default: http://localhost:8788)

Config file: ~/.lightpick/config.json`)
  .version("0.1.0");

program.addCommand(authCommand);
program.addCommand(projectsCommand);
program.addCommand(canvasCommand);
program.addCommand(tasksCommand);
program.addCommand(actionsCommand);
program.addCommand(varsCommand);
program.addCommand(roomCommand);

program.parse();
