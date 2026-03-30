import type { ApprovalPolicy } from "@myclaw-desktop/shared";

export class ApprovalPolicyService {
  constructor(private readonly policy: ApprovalPolicy) {}

  getCurrent(): ApprovalPolicy {
    return this.policy;
  }
}

