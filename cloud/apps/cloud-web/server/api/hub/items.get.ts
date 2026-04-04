import { getQuery } from "h3";

import { proxyCloudApi } from "../../lib/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/hub/items", {
    forwardAuth: true,
    query: getQuery(event)
  });
});
