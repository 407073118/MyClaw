import { proxyCloudApi } from "../../utils/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/mcp/items", {
    forwardAuth: true
  });
});
