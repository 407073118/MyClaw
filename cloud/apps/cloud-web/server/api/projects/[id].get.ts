import { createError, getRouterParam } from "h3";

import { proxyCloudApi } from "../../lib/cloud-api";

/** 中文说明：代理项目详情查询，并在缺少项目 ID 时返回明确的请求错误。 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");

  if (!id) {
    console.warn("[cloud-web-projects] 项目详情查询缺少项目 ID");
    throw createError({
      statusCode: 400,
      statusMessage: "project_id_required"
    });
  }

  console.info("[cloud-web-projects] 代理查询项目详情", { projectId: id });
  return proxyCloudApi(event, `/api/projects/${id}`, {
    forwardAuth: true
  });
});
