import fs from "node:fs";
import net from "node:net";
import { performance } from "node:perf_hooks";

if (!performance.nodeTiming.uvMetricsInfo) {
  throw new Error("Node.js 20.18+ or 22.8+ is required.");
}

const started = performance.now();
let sequence = 0;
let previousLoop = null;

function checkpoint(expected, phase, kind, label) {
  const elapsed = (performance.now() - started).toFixed(1);
  const actual = String(++sequence).padStart(2, "0");
  const loop = performance.nodeTiming.uvMetricsInfo.loopCount;

  if (loop !== previousLoop) {
    const delta = previousLoop === null ? "" : ` (delta ${loop - previousLoop})`;

    console.log(`\n--- LOOP ${loop}${delta} ---`);
    previousLoop = loop;
  }

  console.log(
    `ACTUAL ${actual} | ` +
      `EXPECTED ${expected.padEnd(3)} | ` +
      `LOOP ${String(loop).padStart(3)} | ` +
      `PHASE ${phase.padEnd(7)} | ` +
      `KIND ${kind.padEnd(10)} | ` +
      `+${elapsed.padStart(7)}ms | ${label}`,
  );
}

// PHASE:
//   TIMERS  — setTimeout / setInterval callbacks
//   POLL    — I/O callbacks
//   CHECK   — setImmediate callbacks
//   —       — Not executing as a libuv phase callback
//
// KIND:
//   SYNC, NEXT_TICK, MICROTASK, CALLBACK
//
// PHASE labels are inferred from the scheduling API.
// They are NOT dynamically read from libuv.
//
// EXPECTED numbers marked ~ are illustrative.

// ======================================================
// 1. SYNCHRONOUS EXECUTION
// ======================================================

checkpoint("01", "—", "SYNC", "Script started"); // #01

process.nextTick(() => {
  checkpoint("05", "—", "NEXT_TICK", "Top-level nextTick"); // #05

  process.nextTick(() => {
    checkpoint("06", "—", "NEXT_TICK", "Nested nextTick"); // #06
  });
});

queueMicrotask(() => {
  checkpoint("03", "—", "MICROTASK", "queueMicrotask (top-level)"); // #03
});

Promise.resolve().then(() => {
  checkpoint("04", "—", "MICROTASK", "Promise.then (top-level)"); // #04
});

// ======================================================
// 2. TIMERS PHASE
// ======================================================

setTimeout(() => {
  checkpoint("~09", "TIMERS", "CALLBACK", "setTimeout(0)"); // #09?

  process.nextTick(() => {
    checkpoint("~10", "—", "NEXT_TICK", "After TIMERS callback"); // #10?
  });

  Promise.resolve().then(() => {
    checkpoint("~11", "—", "MICROTASK", "After TIMERS callback"); // #11?
  });

  setImmediate(() => {
    checkpoint("~13", "CHECK", "CALLBACK", "setImmediate created in TIMERS"); // #13?
  });
}, 0);

// ======================================================
// 3. CHECK PHASE
// ======================================================

setImmediate(() => {
  checkpoint("~12", "CHECK", "CALLBACK", "Top-level setImmediate"); // #12?
});

// ======================================================
// 4. POLL PHASE - FILESYSTEM I/O
// ======================================================

fs.readFile(new URL(import.meta.url), (error) => {
  if (error) throw error;

  checkpoint("~14", "POLL", "CALLBACK", "fs.readFile completed"); // #14?

  process.nextTick(() => {
    checkpoint("~15", "—", "NEXT_TICK", "After POLL callback"); // #15?
  });

  queueMicrotask(() => {
    checkpoint("~16", "—", "MICROTASK", "After POLL callback"); // #16?
  });

  setTimeout(() => {
    checkpoint("~18", "TIMERS", "CALLBACK", "setTimeout created in POLL"); // #18?
  }, 0);

  setImmediate(() => {
    checkpoint("~17", "CHECK", "CALLBACK", "setImmediate created in POLL"); // #17?
  });
});

// ======================================================
// 5. SERVER EVENTS - NEXT-TICK QUEUE
// ======================================================

const server = net.createServer();

server.listen(0, "127.0.0.1", () => {
  checkpoint("~07", "—", "NEXT_TICK", "TCP server listening"); // #07?
  // net.js schedules emitListeningNT with process.nextTick().

  server.close();
});

server.on("close", () => {
  checkpoint("~08", "—", "NEXT_TICK", "TCP server closed"); // #08?
  // net.js schedules emitCloseNT with process.nextTick()
  // when there are no active connections.
  // This is NOT an example of the CLOSE CALLBACKS phase.
});

// ======================================================
// 6. BLOCKING THE EVENT LOOP
// ======================================================

setTimeout(() => {
  checkpoint("~19", "TIMERS", "CALLBACK", "Start 100ms CPU work"); // #19?

  const until = performance.now() + 100;

  while (performance.now() < until) {
    // Synchronous blocking work.
    // No other JS callbacks can execute.
  }

  checkpoint("~20", "TIMERS", "CALLBACK", "Finished CPU work"); // #20?
  // Same callback, same event-loop iteration.
}, 30);

// ======================================================
// 7. INTERVAL AND CLEANUP
// ======================================================

let ticks = 0;

const interval = setInterval(() => {
  const tick = ++ticks;

  checkpoint(`~${20 + tick}`, "TIMERS", "CALLBACK", `setInterval tick ${tick}`); // #21–23?

  if (tick === 3) {
    clearInterval(interval);

    checkpoint("~24", "TIMERS", "SYNC", "Interval cleared"); // #24
  }
}, 50);

checkpoint("02", "—", "SYNC", "Script finished"); // #02
