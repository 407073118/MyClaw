import { createRuntimeApp } from "./server";

const port = Number(process.env.RUNTIME_PORT ?? 43110);
const stateFilePath = process.env.RUNTIME_STATE_FILE_PATH;

createRuntimeApp({ port, stateFilePath })
  .then((app) => {
    console.log(`runtime listening on ${app.baseUrl}`);
  })
  .catch((error) => {
    console.error("runtime failed to start", error);
    process.exitCode = 1;
  });
