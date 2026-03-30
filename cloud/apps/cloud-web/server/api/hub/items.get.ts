import { getQuery } from "h3";

import { proxyCloudApi } from "../../utils/cloud-api";

export default defineEventHandler(async (event) => {
  return proxyCloudApi(event, "/api/hub/items", {
    forwardAuth: true,
    query: getQuery(event)
  });
});
