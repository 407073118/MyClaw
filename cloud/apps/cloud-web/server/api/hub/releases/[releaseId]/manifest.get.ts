import { createError, getRouterParam } from "h3";

import { proxyCloudApi } from "../../../../utils/cloud-api";

export default defineEventHandler(async (event) => {
  const releaseId = getRouterParam(event, "releaseId");

  if (!releaseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "hub_release_id_required"
    });
  }

  return proxyCloudApi(event, `/api/hub/releases/${releaseId}/manifest`, {
    forwardAuth: true
  });
});
