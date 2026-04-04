import { readBody } from "h3";

import { proxyCloudApi } from "../../lib/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/mcp/items", {
    forwardAuth: true,
    method: "POST",
    body: await readBody(event)
  });
});
