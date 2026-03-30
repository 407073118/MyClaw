import { readBody } from "h3";

import { proxyCloudApi } from "../../utils/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/auth/login", {
    method: "POST",
    body: await readBody(event)
  });
});
