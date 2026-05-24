import pino, { type Logger } from "pino";
import { getEnv } from "../env";

let cached: Logger | undefined;

function build(): Logger {
  const env = getEnv();
  const isProd = env.NODE_ENV === "production";

  return pino({
    level: env.LOG_LEVEL,
    base: { app: "aso-audit-agent" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
        "headers.cookie",
        "apiKey",
        "*.apiKey",
        "secret",
        "*.secret",
      ],
      remove: true,
    },
    transport: isProd
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            singleLine: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname,app",
          },
        },
  });
}

export function getLogger(): Logger {
  if (!cached) cached = build();
  return cached;
}

export function withCorrelation(correlationId: string): Logger {
  return getLogger().child({ correlationId });
}
