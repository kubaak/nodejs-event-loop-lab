import fs from "node:fs";
import net from "node:net";
import { performance } from "node:perf_hooks";

const started = performance.now();
let sequence = 0;

function log(expected, label) {
  const elapsed = (performance.now() - started).toFixed(1);
  const actual = String(++sequence).padStart(2, "0");

  console.log(`ACTUAL ${actual} | EXPECTED ${expected.padEnd(3)} | +${elapsed.padStart(7)}ms | ${label}`);
}

// Set a breakpoint here to inspect the call stack.
function checkpoint(expected, label) {
  log(expected, label);
}

// ======================================================
// 1. SYNCHRONOUS EXECUTION
// ======================================================

checkpoint("01", "SYNC: script started"); // #01 — Executes immediately.

process.nextTick(() => {
  checkpoint("05", "NEXT TICK: top-level"); // #05 — After ESM microtasks.

  process.nextTick(() => {
    checkpoint("06", "NEXT TICK: nested"); // #06 — After parent nextTick.
  });
});

queueMicrotask(() => {
  checkpoint("03", "MICROTASK: queueMicrotask"); // #03 — First microtask.
});

Promise.resolve().then(() => {
  checkpoint("04", "MICROTASK: Promise.then"); // #04 — Second microtask.
});

// ======================================================
// 2. TIMERS PHASE
// ======================================================

setTimeout(() => {
  checkpoint("~07", "TIMERS: setTimeout(0)"); // #07? — May execute before or after immediate.

  process.nextTick(() => {
    checkpoint("~08", "NEXT TICK: inside timer"); // #08? — After timer callback.
  });

  Promise.resolve().then(() => {
    checkpoint("~09", "MICROTASK: inside timer"); // #09? — After nextTick.
  });

  setImmediate(() => {
    checkpoint("~12", "CHECK: setImmediate created in timer"); // #12? — Later check phase.
  });
}, 0);

// ======================================================
// 3. CHECK PHASE
// ======================================================

setImmediate(() => {
  checkpoint("~10", "CHECK: top-level setImmediate"); // #10? — Order relative to timer varies.
});

// ======================================================
// 4. POLL PHASE - FILESYSTEM I/O
// ======================================================

fs.readFile(new URL(import.meta.url), () => {
  checkpoint("~13", "POLL: fs.readFile callback"); // #13? — Filesystem I/O completed.

  process.nextTick(() => {
    checkpoint("~14", "NEXT TICK: inside I/O"); // #14? — After I/O callback.
  });

  queueMicrotask(() => {
    checkpoint("~15", "MICROTASK: inside I/O"); // #15? — After nextTick.
  });

  setTimeout(() => {
    checkpoint("~17", "TIMERS: setTimeout created in I/O"); // #17? — Later timers phase.
  }, 0);

  setImmediate(() => {
    checkpoint("~16", "CHECK: setImmediate created in I/O"); // #16? — Normally before I/O timer.
  });
});

// ======================================================
// 5. CLOSE CALLBACKS PHASE
// ======================================================

const server = net.createServer();

server.listen(0, "127.0.0.1", () => {
  checkpoint("~11", "I/O: server listening"); // #11? — Listening callback.

  server.close();
});

server.on("close", () => {
  checkpoint("~18", "CLOSE CALLBACKS: server closed"); // #18? — Server closed.
});

// ======================================================
// 6. BLOCKING THE EVENT LOOP
// ======================================================

setTimeout(() => {
  checkpoint("~19", "BLOCKING: start 100ms CPU work"); // #19? — After at least 30ms.

  const until = performance.now() + 100;

  while (performance.now() < until) {
    // Main JS thread intentionally blocked.
  }

  checkpoint("~20", "BLOCKING: finished CPU work"); // #20? — 100ms later.
}, 30);

// ======================================================
// 7. INTERVAL AND CLEANUP
// ======================================================

let ticks = 0;

const interval = setInterval(() => {
  const tick = ++ticks;

  checkpoint(`~${20 + tick}`, `TIMERS: interval tick ${tick}`); // #21–23? — Timer callbacks, potentially delayed.

  if (ticks === 3) {
    clearInterval(interval);
    checkpoint("~24", "TIMERS: interval cleared"); // #24? — Stop repeating.
  }
}, 50);

checkpoint("02", "SYNC: script finished"); // #02 — Last synchronous statement.
