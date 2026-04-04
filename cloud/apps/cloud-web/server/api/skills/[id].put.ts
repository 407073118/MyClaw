import { createError, getRouterParam, readBody } from "h3";

import { proxyCloudApi } from "../../lib/cloud-api";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: "skill_id_required"
    });
  }

  return proxyCloudApi(event, `/api/skills/${id}`, {
    forwardAuth: true,
    method: "PUT",
    body: await readBody(event)
  });
});
