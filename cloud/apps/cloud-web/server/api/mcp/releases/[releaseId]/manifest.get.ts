import { createError, getRouterParam } from "h3";

import { proxyCloudApi } from "../../../../lib/cloud-api";

export default defineEventHandler(async (event) => {
  const releaseId = getRouterParam(event, "releaseId");

  if (!releaseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "release_id_required"
    });
  }

  return proxyCloudApi(event, `/api/mcp/releases/${releaseId}/manifest`, {
    forwardAuth: true
  });
});
