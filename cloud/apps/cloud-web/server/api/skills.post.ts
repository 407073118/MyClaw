import { readBody } from "h3";

import { proxyCloudApi } from "../lib/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/skills", {
    forwardAuth: true,
    method: "POST",
    body: await readBody(event)
  });
});
