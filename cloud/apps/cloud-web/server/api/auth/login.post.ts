import { readBody } from "h3";

import { proxyCloudApi } from "../../lib/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/auth/login", {
    method: "POST",
    body: await readBody(event)
  });
});
