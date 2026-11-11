import { spawn } from "node:child_process";

const commands = [
  ["api", ["src/server.js"]],
  ["worker", ["src/workers/worker.js"]],
];

const children = new Map();
let stopping = false;
let exitCode = 0;
let forceStopTimer;

function stopAll(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  }
  forceStopTimer = setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 25_000);
  forceStopTimer.unref();
}

process.on("SIGTERM", () => stopAll("SIGTERM"));
process.on("SIGINT", () => stopAll("SIGINT"));

for (const [name, args] of commands) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  children.set(name, child);

  child.on("error", (error) => {
    console.error(`[supervisor] Could not start ${name}:`, error);
    exitCode = 1;
    stopAll();
  });

  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `[supervisor] ${name} exited (${signal || code}); stopping the other process.`
      );
      exitCode = code ?? 1;
      stopAll();
    }
    if ([...children.values()].every((item) => item.exitCode !== null)) {
      clearTimeout(forceStopTimer);
      process.exitCode = exitCode;
    }
  });
}
