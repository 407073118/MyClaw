import { Controller, Get, Header, Headers, Inject, Param, UnauthorizedException } from "@nestjs/common";

import { AdminService } from "./admin.service";
import { renderAdminConsolePage } from "./admin-console.page";

@Controller("admin")
export class AdminController {
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {}

  /** 返回实时桥接管理台页面，便于运维人员直接查询链路状态。 */
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  getAdminConsole(): string {
    console.info("[admin] 开始返回实时桥接管理台页面");
    return renderAdminConsolePage();
  }

  /** 查询消息链路时间线，使用内部管理 Token 保护。 */
  @Get("messages/:messageId/timeline")
  async getMessageTimeline(
    @Param("messageId") messageId: string,
    @Headers("x-myclaw-admin-token") token?: string,
  ): Promise<{ events: Array<{ eventType: string; message: string; createdAt: Date }> }> {
    this.assertAdminToken(token);
    const timeline = await this.adminService.getMessageTimeline(messageId);
    console.info("[admin] 消息链路时间线接口返回成功", { messageId });
    return timeline;
  }

  /** 查询用户在线设备，使用内部管理 Token 保护。 */
  @Get("users/:userId/online-device")
  async getUserOnlineDevice(
    @Param("userId") userId: string,
    @Headers("x-myclaw-admin-token") token?: string,
  ): Promise<{ userId: string; desktopDeviceId?: string }> {
    this.assertAdminToken(token);
    const result = await this.adminService.getUserOnlineDevice(userId);
    console.info("[admin] 用户在线设备接口返回成功", { userId });
    return result;
  }

  /** 查询发送人绑定，使用内部管理 Token 保护。 */
  @Get("bindings/sender/:senderStaffId")
  async getSenderBinding(
    @Param("senderStaffId") senderStaffId: string,
    @Headers("x-myclaw-admin-token") token?: string,
  ): Promise<unknown> {
    this.assertAdminToken(token);
    const result = await this.adminService.getSenderBinding(senderStaffId);
    console.info("[admin] 发送人绑定接口返回成功", { senderStaffId });
    return result;
  }

  /** 校验内部管理 Token，拒绝未授权排障查询。 */
  private assertAdminToken(token?: string): void {
    const expectedToken = process.env.MYCLAW_ADMIN_TOKEN;
    if (!expectedToken) {
      console.warn("[admin] 管理接口 Token 未配置，拒绝管理请求");
      throw new UnauthorizedException("admin token is not configured");
    }
    if (!token || token !== expectedToken) {
      console.warn("[admin] 拒绝未授权管理接口请求");
      throw new UnauthorizedException("invalid admin token");
    }
    console.info("[admin] 管理接口 Token 校验成功");
  }
}
