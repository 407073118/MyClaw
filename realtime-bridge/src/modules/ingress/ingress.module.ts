import { Module } from "@nestjs/common";

import { PrismaModule } from "../../infra/prisma/prisma.module";
import { IngressController } from "./ingress.controller";
import { IngressService } from "./ingress.service";

@Module({
  imports: [PrismaModule],
  controllers: [IngressController],
  providers: [IngressService],
  exports: [IngressService],
})
export class IngressModule {}
