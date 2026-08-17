/**
 * Logger tối giản bọc quanh `console`.
 *
 * Cố tình không dùng pino: ở quy mô này nó chỉ thêm một dependency transport /
 * pretty-print mà không đổi lại được gì.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const configuredLevel = () => {
  const fromEnv = process.env.LOG_LEVEL;
  if (fromEnv && fromEnv in LEVELS) return LEVELS[fromEnv];
  return process.env.NODE_ENV === "test" ? LEVELS.silent : LEVELS.info;
};

const emit = (level, consoleMethod, args) => {
  if (LEVELS[level] < configuredLevel()) return;

  const [first, ...rest] = args;
  const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()}`;

  if (typeof first === "string") {
    consoleMethod(`${prefix} ${first}`, ...rest);
  } else {
    consoleMethod(prefix, ...args);
  }
};

export const logger = {
  debug: (...args) => emit("debug", console.debug, args),
  info: (...args) => emit("info", console.info, args),
  warn: (...args) => emit("warn", console.warn, args),
  error: (...args) => emit("error", console.error, args),

  /** Logger con gắn kèm request id, dùng trong error middleware. */
  child: (requestId) => ({
    debug: (msg, ...rest) => emit("debug", console.debug, [`(${requestId}) ${msg}`, ...rest]),
    info: (msg, ...rest) => emit("info", console.info, [`(${requestId}) ${msg}`, ...rest]),
    warn: (msg, ...rest) => emit("warn", console.warn, [`(${requestId}) ${msg}`, ...rest]),
    error: (msg, ...rest) => emit("error", console.error, [`(${requestId}) ${msg}`, ...rest]),
  }),
};

export default logger;
