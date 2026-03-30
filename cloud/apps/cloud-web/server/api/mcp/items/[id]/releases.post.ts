import { createError, getRouterParam, readBody } from "h3";

import { proxyCloudApi } from "../../../../utils/cloud-api";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: "mcp_item_id_required"
    });
  }

  return proxyCloudApi(event, `/api/mcp/items/${id}/releases`, {
    forwardAuth: true,
    method: "POST",
    body: await readBody(event)
  });
});
