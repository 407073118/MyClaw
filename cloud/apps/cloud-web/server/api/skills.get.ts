import { getQuery } from "h3";

import { proxyCloudApi } from "../lib/cloud-api";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  return proxyCloudApi(event, "/api/skills", {
    forwardAuth: true,
    query
  });
});
