import { readBody } from "h3";

import { proxyCloudApi } from "../lib/cloud-api";

/** 中文说明：代理创建项目请求，保持项目维护页面只依赖 Cloud Web 的 BFF。 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  console.info("[cloud-web-projects] 代理创建项目", {
    code: body?.code,
    repositoryCount: body?.repositories?.length ?? 0,
    apiCount: body?.apis?.length ?? 0
  });

  return proxyCloudApi(event, "/api/projects", {
    forwardAuth: true,
    method: "POST",
    body
  });
});
