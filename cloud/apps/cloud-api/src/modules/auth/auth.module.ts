import { Module } from "@nestjs/common";

import { CasInternalAuthProvider } from "./cas-internal-auth.provider";
import { DatabaseModule } from "../database/database.module";
import { AuthController } from "./auth.controller";
import { AUTH_SESSION_REPOSITORY } from "./auth-session.repository";
import { AuthService } from "./auth.service";
import { INTERNAL_AUTH_PROVIDER } from "./internal-auth-provider";
import { MockInternalAuthProvider } from "./mock-internal-auth.provider";
import { PrismaAuthSessionRepository } from "./prisma-auth-session.repository";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    CasInternalAuthProvider,
    MockInternalAuthProvider,
    PrismaAuthSessionRepository,
    {
      provide: INTERNAL_AUTH_PROVIDER,
      useFactory: (
        casProvider: CasInternalAuthProvider,
        mockProvider: MockInternalAuthProvider
      ) => {
        const mode = process.env.INTERNAL_AUTH_MODE?.trim().toLowerCase();
        if (mode === "mock") {
          return mockProvider;
        }

        if (mode === "cas" || mode === "http") {
          return casProvider;
        }

        return process.env.CAS_VALIDATE_USER_URL?.trim() ||
          process.env.INTERNAL_AUTH_VALIDATE_URL?.trim()
          ? casProvider
          : mockProvider;
      },
      inject: [CasInternalAuthProvider, MockInternalAuthProvider]
    },
    {
      provide: AUTH_SESSION_REPOSITORY,
      useExisting: PrismaAuthSessionRepository
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
