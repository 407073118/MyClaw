import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let logDir: string | null = null;
let minLevel: LogLevel = "info";

/**
 * Initialize the logger with a directory for log files.
 * Call once at startup.
 */
export function initLogger(myClawDir: string, level: LogLevel = "info"): void {
  logDir = join(myClawDir, "logs");
  minLevel = level;
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

function getLogFilePath(): string | null {
  if (!logDir) return null;
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return join(logDir, `myclaw-${date}.log`);
}

function formatMessage(level: LogLevel, module: string, message: string, context?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}${contextStr}`;
}

function writeLog(level: LogLevel, module: string, message: string, context?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;

  const formatted = formatMessage(level, module, message, context);

  // Always write to console
  switch (level) {
    case "debug": console.debug(formatted); break;
    case "info": console.info(formatted); break;
    case "warn": console.warn(formatted); break;
    case "error": console.error(formatted); break;
  }

  // Write to file
  const filePath = getLogFilePath();
  if (filePath) {
    try {
      appendFileSync(filePath, formatted + "\n", "utf8");
    } catch {
      // Silently ignore file write errors
    }
  }
}

/**
 * Create a scoped logger for a specific module.
 */
export function createLogger(module: string) {
  return {
    debug: (message: string, context?: Record<string, unknown>) => writeLog("debug", module, message, context),
    info: (message: string, context?: Record<string, unknown>) => writeLog("info", module, message, context),
    warn: (message: string, context?: Record<string, unknown>) => writeLog("warn", module, message, context),
    error: (message: string, context?: Record<string, unknown>) => writeLog("error", module, message, context),
  };
}

export type Logger = ReturnType<typeof createLogger>;
