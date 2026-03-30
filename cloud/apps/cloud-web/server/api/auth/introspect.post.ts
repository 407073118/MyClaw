import { readBody } from "h3";

import { proxyCloudApi } from "../../utils/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/auth/introspect", {
    method: "POST",
    forwardAuth: true,
    body: await readBody(event)
  });
});
