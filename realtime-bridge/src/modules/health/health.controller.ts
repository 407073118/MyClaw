import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  /** 返回服务健康状态，供负载均衡与部署探针检查。 */
  @Get()
  getHealth(): { ok: boolean; service: string } {
    console.info("[health] 返回 realtime-bridge 健康状态");
    return { ok: true, service: "realtime-bridge" };
  }
}
