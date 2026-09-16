import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { WindowsWorker } from "./worker-client.ts";
import { createWinComputerTool } from "./tool.ts";
import { createWinComputerCommand } from "./command.ts";

export default function activate(pi: ExtensionAPI): void {
  const worker = new WindowsWorker();

  const tool = createWinComputerTool(worker);
  pi.registerTool(tool);

  const cmd = createWinComputerCommand(worker);
  pi.registerCommand(cmd.name, {
    description: cmd.description,
    getArgumentCompletions: cmd.getArgumentCompletions,
    handler: cmd.handler
  });

  pi.on("session_shutdown", () => {
    worker.dispose();
  });
}
