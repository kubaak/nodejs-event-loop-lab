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
// Debugger pauses can change asynchronous execution order.
function checkpoint(expected, label) {
  log(expected, label);
}

// ======================================================
// 1. SYNCHRONOUS EXECUTION
// ======================================================

checkpoint("01", "SYNC: script started"); // #01 — First synchronous statement.

process.nextTick(() => {
  checkpoint("05", "NEXT TICK: top-level"); // #05 — After top-level ESM microtasks.

  process.nextTick(() => {
    checkpoint("06", "NEXT TICK: nested"); // #06 — Next-tick queue drains recursively.
  });
});

queueMicrotask(() => {
  checkpoint("03", "MICROTASK: queueMicrotask"); // #03 — First queued ESM microtask.
});

Promise.resolve().then(() => {
  checkpoint("04", "MICROTASK: Promise.then"); // #04 — Second queued ESM microtask.
});

// ======================================================
// 2. TIMERS PHASE
// ======================================================

setTimeout(() => {
  checkpoint("~09", "TIMERS: setTimeout(0)"); // #09 — Timer eligible after minimum delay.

  process.nextTick(() => {
    checkpoint("~10", "NEXT TICK: inside timer"); // #10 — Runs after timer callback returns.
  });

  Promise.resolve().then(() => {
    checkpoint("~11", "MICROTASK: inside timer"); // #11 — Runs after the timer's nextTick.
  });

  setImmediate(() => {
    checkpoint("~13", "CHECK: setImmediate created in timer"); // #13 — Executes in a later Check phase.
  });
}, 0);

// ======================================================
// 3. CHECK PHASE
// ======================================================

setImmediate(() => {
  checkpoint("~12", "CHECK: top-level setImmediate"); // #12 — Check phase; may precede top-level timer.
});

// ======================================================
// 4. POLL PHASE - FILESYSTEM I/O
// ======================================================

fs.readFile(new URL(import.meta.url), () => {
  checkpoint("~14", "POLL: fs.readFile callback"); // #14 — I/O completion callback; may run in a later loop iteration.

  process.nextTick(() => {
    checkpoint("~15", "NEXT TICK: inside I/O"); // #15 — Runs after the I/O callback returns.
  });

  queueMicrotask(() => {
    checkpoint("~16", "MICROTASK: inside I/O"); // #16 — Runs after nextTick queue drains.
  });

  setTimeout(() => {
    checkpoint("~18", "TIMERS: setTimeout created in I/O"); // #18 — Timer eligible in a later iteration.
  }, 0);

  setImmediate(() => {
    checkpoint("~17", "CHECK: setImmediate created in I/O"); // #17 — Runs in Check, normally before the I/O timer.
  });
});

// ======================================================
// 5. SERVER EVENTS - NEXT-TICK SCHEDULING
// ======================================================

const server = net.createServer();

server.listen(0, "127.0.0.1", () => {
  checkpoint("~07", "NEXT TICK: server listening"); // #07 — net.js schedules emitListeningNT via nextTick.

  server.close();
});

server.on("close", () => {
  checkpoint("~08", "NEXT TICK: server closed"); // #08 — With no connections, net.js schedules emitCloseNT via nextTick.
});

// ======================================================
// 6. BLOCKING THE EVENT LOOP
// ======================================================

setTimeout(() => {
  checkpoint("~19", "BLOCKING: start 100ms CPU work"); // #19 — Timer becomes eligible after at least 30ms.

  const until = performance.now() + 100;

  while (performance.now() < until) {
    // Blocks the main JS thread.
    // No timers, I/O callbacks, or microtasks can execute here.
  }

  checkpoint("~20", "BLOCKING: finished CPU work"); // #20 — Synchronous CPU work completes ~100ms later.
}, 30);

// ======================================================
// 7. INTERVAL AND CLEANUP
// ======================================================

let ticks = 0;

const interval = setInterval(() => {
  const tick = ++ticks;

  checkpoint(`~${20 + tick}`, `TIMERS: interval tick ${tick}`); // #21–23 — Interval callbacks; can be delayed by blocking work.

  if (ticks === 3) {
    clearInterval(interval);
    checkpoint("~24", "TIMERS: interval cleared"); // #24 — Clears interval synchronously during tick 3.
  }
}, 50);

checkpoint("02", "SYNC: script finished"); // #02 — Last synchronous statement.
