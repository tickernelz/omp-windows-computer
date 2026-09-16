
import { WindowsWorker } from "../../lib/worker-client.ts";

const w = new WindowsWorker();
await w.ensureReady();

const res = await w.call("input.type", { text: "hello" });
console.log("input.type result:", res);

w.dispose();
