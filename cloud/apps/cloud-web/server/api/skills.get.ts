import { proxyCloudApi } from "../utils/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/skills", {
    forwardAuth: true
  });
});
