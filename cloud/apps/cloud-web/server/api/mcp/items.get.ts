import { proxyCloudApi } from "../../lib/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/mcp/items", {
    forwardAuth: true
  });
});
