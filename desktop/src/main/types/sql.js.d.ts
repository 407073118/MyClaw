/**
 * sql.js 类型声明 (最小子集，覆盖 SqliteCheckpointer 所需的 API)
 *
 * sql.js 官方没有发布 @types 包，这里仅声明项目实际用到的接口。
 */
declare module "sql.js" {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export type SqlJsInitOptions = {
    locateFile?: (file: string) => string;
  };

  export default function initSqlJs(options?: SqlJsInitOptions): Promise<SqlJsStatic>;
}
