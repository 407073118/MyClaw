import { readFormData } from "h3";

import { proxyCloudApi } from "../../utils/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/mcp/items", {
    forwardAuth: true,
    method: "POST",
    body: await readFormData(event)
  });
});
