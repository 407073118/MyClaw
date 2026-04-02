import { createRuntimeApp } from "./server";
import { LiveMCPorterAdapter } from "./services/live-mcporter-adapter";

const port = Number(process.env.RUNTIME_PORT ?? 43110);
const stateFilePath = process.env.RUNTIME_STATE_FILE_PATH;

createRuntimeApp({ port, stateFilePath, mcpAdapter: new LiveMCPorterAdapter() })
  .then((app) => {
    console.log(`runtime listening on ${app.baseUrl}`);
  })
  .catch((error) => {
    console.error("runtime failed to start", error);
    process.exitCode = 1;
  });
