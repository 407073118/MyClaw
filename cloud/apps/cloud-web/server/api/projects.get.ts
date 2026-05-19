import { getQuery } from "h3";

import { proxyCloudApi } from "../lib/cloud-api";

/** 中文说明：代理项目列表查询，确保 Cloud Web 只通过 BFF 访问后端项目维护接口。 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  console.info("[cloud-web-projects] 代理查询项目列表", { query });

  return proxyCloudApi(event, "/api/projects", {
    forwardAuth: true,
    query
  });
});
