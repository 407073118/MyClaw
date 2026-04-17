/**
 * 轻量 `ws` 类型声明。
 *
 * 项目只使用了 asr-client.ts 里的最小子集：
 * 构造函数、readyState 常量、on(event, handler)、send、close。
 * 不依赖 @types/ws，避免额外开发依赖。
 */
declare module "ws" {
  export class WebSocket {
    static readonly OPEN: 1;
    static readonly CONNECTING: 0;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;

    readonly readyState: 0 | 1 | 2 | 3;

    constructor(
      address: string,
      protocols?: string | string[],
      options?: { rejectUnauthorized?: boolean; [key: string]: unknown },
    );

    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: Buffer) => void): this;
    on(event: "close", listener: (code?: number, reason?: Buffer) => void): this;
    on(event: "error", listener: (err: Error) => void): this;

    send(data: string | Buffer | ArrayBuffer | Uint8Array): void;
    close(code?: number, reason?: string): void;
  }

  export default WebSocket;
}
