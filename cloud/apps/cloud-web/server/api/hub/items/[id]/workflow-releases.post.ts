import { createError, getRouterParam, readFormData } from "h3";

import { proxyCloudApi } from "../../../../lib/cloud-api";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: "hub_item_id_required"
    });
  }

  return proxyCloudApi(event, `/api/hub/items/${id}/workflow-releases`, {
    forwardAuth: true,
    method: "POST",
    body: await readFormData(event)
  });
});
