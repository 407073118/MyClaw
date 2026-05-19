import { createError, getRouterParam, readBody } from "h3";

import { proxyCloudApi } from "../../../lib/cloud-api";

/** 中文说明：代理替换项目配置请求，统一从 Cloud Web 转发到 Cloud API。 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");

  if (!id) {
    console.warn("[cloud-web-projects] 替换项目配置缺少项目 ID");
    throw createError({
      statusCode: 400,
      statusMessage: "project_id_required"
    });
  }

  const body = await readBody(event);
  console.info("[cloud-web-projects] 代理替换项目配置", {
    projectId: id,
    updatedBy: body?.updatedBy,
    repositoryCount: body?.repositories?.length ?? 0,
    apiCount: body?.apis?.length ?? 0
  });

  return proxyCloudApi(event, `/api/projects/${id}/config`, {
    forwardAuth: true,
    method: "PUT",
    body
  });
});
