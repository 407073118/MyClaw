import { createError, getRouterParam } from "h3";

import { proxyCloudApi } from "../../../utils/cloud-api";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: "hub_item_id_required"
    });
  }

  return proxyCloudApi(event, `/api/hub/items/${id}`, {
    forwardAuth: true
  });
});
