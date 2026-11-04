/**
 * Structured JSON logs, one object per line on stdout (errors on stderr).
 * Callers pass only non-sensitive fields: never a token, a cookie, a query
 * string or a request body. `errorFields` keeps just the error's name/message.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
};

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export function createLogger(
  level: LogLevel,
  write: (line: string, isError: boolean) => void = (line, isError) => {
    (isError ? process.stderr : process.stdout).write(`${line}\n`);
  },
  now: () => number = Date.now,
): Logger {
  const emit =
    (name: Exclude<LogLevel, "silent">) =>
    (msg: string, fields: LogFields = {}) => {
      if (ORDER[name] < ORDER[level]) {
        return;
      }
      write(
        JSON.stringify({
          level: name,
          time: new Date(now()).toISOString(),
          msg,
          ...fields,
        }),
        name === "error",
      );
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

export const silentLogger: Logger = createLogger("silent");

/** Name and (truncated) message of an unknown error, nothing else. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message.slice(0, 300) };
  }
  return { errorName: "NonError" };
}
