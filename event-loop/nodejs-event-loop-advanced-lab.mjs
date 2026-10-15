/**
 * Node.js Event Loop — Advanced Lab
 * =================================
 *
 * Run everything:
 *   node nodejs-event-loop-advanced-lab.mjs
 *
 * List experiments:
 *   node nodejs-event-loop-advanced-lab.mjs --list
 *
 * Run one:
 *   node nodejs-event-loop-advanced-lab.mjs io
 *
 * Run several:
 *   node nodejs-event-loop-advanced-lab.mjs microtasks tcp worker
 *
 * LOGGING:
 * ACTUAL   = execution order within the experiment
 * EXPECTED = guaranteed local ordering where applicable
 * LOOP     = libuv event-loop iteration counter
 * PHASE    = associated phase (not detected dynamically)
 * KIND     = callback type / execution mechanism
 * +ms      = elapsed time within the experiment
 *
 * IMPORTANT:
 * - process.nextTick() is NOT an event-loop phase.
 * - Promise microtasks are NOT an event-loop phase.
 * - EventEmitter.emit() invokes listeners synchronously.
 * - POLL comes before CHECK within an iteration.
 * - I/O callbacks might not be ready in the first iteration.
 * - PHASE is an educational classification, not libuv introspection.
 * - An asterisk (*) means an approximate phase association.
 * - Breakpoints can affect timings and callback ordering.
 *
 * Documentation:
 * https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick
 * https://nodejs.org/api/process.html
 * https://nodejs.org/api/perf_hooks.html
 */

import fs from "node:fs";
import net from "node:net";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { Worker, isMainThread, parentPort, workerData, threadId } from "node:worker_threads";

// ======================================================
// WORKER THREAD ENTRY POINT
// ======================================================

// A Worker loads this same file.
// It has its own JavaScript thread and event loop.

if (!isMainThread && workerData?.eventLoopLabWorker) {
  parentPort.postMessage({
    step: "started",
    threadId,
  });

  const until = performance.now() + workerData.cpuMs;

  while (performance.now() < until) {
    // CPU-intensive work on the worker thread.
  }

  parentPort.postMessage({
    step: "finished",
    threadId,
  });
}

// ======================================================
// SHARED LOGGING
// ======================================================

let experimentStarted = 0;
let sequence = 0;
let previousLoop = null;
let currentExperiment = "";

function checkpoint(phase, kind, label, expected = "--") {
  // Set a VS Code breakpoint here to inspect the call stack.

  const elapsed = (performance.now() - experimentStarted).toFixed(1);
  const actual = String(++sequence).padStart(2, "0");

  const metrics = performance.nodeTiming.uvMetricsInfo;
  const loop = metrics.loopCount;

  if (loop !== previousLoop) {
    const delta = previousLoop === null ? "" : ` (delta ${loop - previousLoop})`;

    console.log(`\n--- libuv LOOP ${loop}${delta} ---`);

    previousLoop = loop;
  }

  console.log(
    `ACTUAL ${actual} | EXPECTED ${String(expected).padEnd(3)} | ` +
      `LOOP ${String(loop).padStart(3)} | ` +
      `PHASE ${phase.padEnd(8)} | ` +
      `KIND ${kind.padEnd(10)} | ` +
      `+${elapsed.padStart(7)}ms | ${label}`,
  );
}

function startExperiment(id, title, lesson) {
  currentExperiment = id;
  sequence = 0;
  previousLoop = null;
  experimentStarted = performance.now();

  console.log(`\n${"=".repeat(96)}`);
  console.log(`EXPERIMENT: ${id} — ${title}`);
  console.log(`LEARN: ${lesson}`);
  console.log(`${"=".repeat(96)}`);
}

// ======================================================
// 1. ES MODULE STARTUP
// ======================================================

// In top-level ESM evaluation, Promise microtasks normally
// execute before the process.nextTick() queue.

async function esm() {
  await new Promise((resolve) => {
    checkpoint("—", "SYNC", "Start of experiment", "01");

    process.nextTick(() => {
      checkpoint("—", "NEXT_TICK", "Top-level nextTick", "05");

      process.nextTick(() => {
        checkpoint("—", "NEXT_TICK", "Nested nextTick", "06");
      });
    });

    queueMicrotask(() => {
      checkpoint("—", "MICROTASK", "queueMicrotask (top-level)", "03");
    });

    Promise.resolve().then(() => {
      checkpoint("—", "MICROTASK", "Promise.then (top-level)", "04");
    });

    checkpoint("—", "SYNC", "End of synchronous code", "02");

    // Wait until the queues have drained.
    setImmediate(resolve);
  });
}

// ======================================================
// 2. NEXT TICK AND MICROTASK QUEUES
// ======================================================

// Demonstrates the checkpoint after a timer callback.
// A nextTick scheduled inside a Promise microtask executes
// after the current microtask queue is processed.

async function microtasks() {
  await new Promise((resolve) => {
    setTimeout(() => {
      checkpoint("TIMERS", "CALLBACK", "Timer callback ENTER", "01");

      process.nextTick(() => {
        checkpoint("—", "NEXT_TICK", "First nextTick", "03");

        process.nextTick(() => {
          checkpoint("—", "NEXT_TICK", "Nested nextTick", "04");
        });
      });

      queueMicrotask(() => {
        checkpoint("—", "MICROTASK", "queueMicrotask inside timer", "05");
      });

      Promise.resolve().then(() => {
        checkpoint("—", "MICROTASK", "Promise.then inside timer", "06");

        process.nextTick(() => {
          checkpoint("—", "NEXT_TICK", "nextTick queued INSIDE a microtask", "07");
        });
      });

      checkpoint("TIMERS", "SYNC", "Timer callback RETURNING", "02");

      setImmediate(resolve);
    }, 0);
  });
}

// ======================================================
// 3. EVENT EMITTER — SYNCHRONOUS EXECUTION
// ======================================================

// EventEmitter.emit() invokes listeners immediately.
// EventEmitter itself doesn't schedule them through the loop.

async function emitter() {
  const events = new EventEmitter();

  events.on("data", () => {
    checkpoint("—", "EVENT_SYNC", "Listener A starts (inside emit)", "02");

    process.nextTick(() => {
      checkpoint("—", "NEXT_TICK", "nextTick from listener A", "06");
    });

    checkpoint("—", "EVENT_SYNC", "Listener A ends", "03");
  });

  events.on("data", () => {
    checkpoint("—", "EVENT_SYNC", "Listener B executes synchronously", "04");
  });

  await new Promise((resolve) => {
    setTimeout(() => {
      checkpoint("TIMERS", "CALLBACK", "Before emitter.emit('data')", "01");

      events.emit("data");

      checkpoint("TIMERS", "CALLBACK", "After emitter.emit('data')", "05");

      setImmediate(resolve);
    }, 0);
  });
}

// ======================================================
// 4. setTimeout(0) VS setImmediate()
// ======================================================

// At the same scheduling level their relative ordering
// is timing-dependent.

async function immediate() {
  await new Promise((resolve) => {
    let remaining = 3;

    const done = () => {
      if (--remaining === 0) {
        resolve();
      }
    };

    checkpoint("—", "SYNC", "Schedule top-level timer and immediate");

    setTimeout(() => {
      checkpoint("TIMERS", "CALLBACK", "Top-level setTimeout(0) — order varies");

      setImmediate(() => {
        checkpoint("CHECK", "CALLBACK", "setImmediate created inside timer");

        done();
      });

      done();
    }, 0);

    setImmediate(() => {
      checkpoint("CHECK", "CALLBACK", "Top-level setImmediate — order varies");

      done();
    });
  });
}

// ======================================================
// 5. FILESYSTEM I/O — POLL AND CHECK
// ======================================================

// Demonstrates that setImmediate scheduled inside I/O
// normally runs before setTimeout(0) scheduled there.

async function io() {
  await new Promise((resolve, reject) => {
    checkpoint("—", "SYNC", "Start fs.readFile (returns without waiting)");

    fs.readFile(new URL(import.meta.url), (error, bytes) => {
      if (error) {
        reject(error);
        return;
      }

      checkpoint("POLL*", "I/O", `fs.readFile finished (${bytes.length} bytes)`);

      process.nextTick(() => {
        checkpoint("—", "NEXT_TICK", "nextTick scheduled inside I/O");
      });

      queueMicrotask(() => {
        checkpoint("—", "MICROTASK", "microtask scheduled inside I/O");
      });

      let remaining = 2;

      const done = () => {
        if (--remaining === 0) {
          resolve();
        }
      };

      setTimeout(() => {
        checkpoint("TIMERS", "CALLBACK", "setTimeout(0) created in I/O");

        done();
      }, 0);

      setImmediate(() => {
        checkpoint("CHECK", "CALLBACK", "setImmediate created in I/O");

        done();
      });

      checkpoint("POLL*", "SYNC", "I/O callback returns");
    });

    checkpoint("—", "SYNC", "Synchronous code continues after readFile");
  });
}

// ======================================================
// 6. TCP SERVER AND SOCKET CLOSE EVENTS
// ======================================================

// Covers:
// - Server listening via process.nextTick()
// - TCP connection callbacks
// - Abrupt socket closing
// - Server close via process.nextTick()

async function tcp() {
  await new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      checkpoint("POLL*", "EVENT", "Server accepted a TCP connection");

      socket.on("error", reject);

      socket.on("close", () => {
        checkpoint("CLOSE*", "EVENT", "Accepted socket close after destroy()");
      });

      socket.destroy();
    });

    server.on("error", reject);

    server.on("close", () => {
      checkpoint("—", "NEXT_TICK", "Server close event (net.js: emitCloseNT)");

      resolve();
    });

    checkpoint("—", "SYNC", "Call server.listen(0, 127.0.0.1)");

    server.listen(0, "127.0.0.1", () => {
      checkpoint("—", "NEXT_TICK", "Server listening (net.js: emitListeningNT)");

      const client = net.createConnection({
        host: "127.0.0.1",
        port: server.address().port,
      });

      client.on("connect", () => {
        checkpoint("POLL*", "EVENT", "Client TCP connect event");
      });

      client.on("error", reject);

      client.on("close", () => {
        checkpoint("CLOSE*", "EVENT", "Client socket close event");

        server.close();
      });
    });
  });
}

// ======================================================
// 7. BLOCKING THE EVENT LOOP
// ======================================================

// Shows that CPU-bound JavaScript prevents other
// callbacks from executing, including ready timers.

async function blocking() {
  await new Promise((resolve) => {
    let count = 0;
    const scheduledAt = performance.now();

    const interval = setInterval(() => {
      ++count;

      checkpoint(
        "TIMERS",
        "CALLBACK",
        `Interval #${count}; elapsed since schedule: ` + `${(performance.now() - scheduledAt).toFixed(1)}ms`,
      );

      if (count === 4) {
        clearInterval(interval);

        checkpoint("TIMERS", "SYNC", "Interval cleared");

        resolve();
      }
    }, 40);

    setTimeout(() => {
      checkpoint("TIMERS", "CALLBACK", "Start blocking main thread for 130ms");

      const until = performance.now() + 130;

      while (performance.now() < until) {
        // Main JavaScript thread blocked.
      }

      checkpoint("TIMERS", "SYNC", "Finished blocking (same callback + LOOP)");
    }, 15);
  });
}

// ======================================================
// 8. ASYNC/AWAIT
// ======================================================

// Async functions execute synchronously until the first
// await, then resume through Promise microtasks.

async function asyncAwait() {
  checkpoint("—", "SYNC", "Before calling an async function", "01");

  const task = (async () => {
    checkpoint("—", "SYNC", "Async function starts synchronously", "02");

    await Promise.resolve("already fulfilled");

    checkpoint("—", "MICROTASK", "After await Promise.resolve() (no loop required)");

    await delay(25);

    checkpoint("—", "MICROTASK", "After await delay(25): timer resolved Promise");

    return "done";
  })();

  checkpoint("—", "SYNC", "Async function returned a Promise", "03");

  const result = await task;

  checkpoint("—", "MICROTASK", `Caller resumed after await task: ${result}`);
}

// ======================================================
// 9. NEXT-TICK STARVATION
// ======================================================

// Recursive nextTick callbacks can prevent the event
// loop from servicing timers and I/O.
//
// This example is intentionally finite.

async function starvation() {
  await new Promise((resolve) => {
    const countLimit = 35_000;
    const start = performance.now();

    let count = 0;

    setTimeout(() => {
      checkpoint(
        "TIMERS",
        "CALLBACK",
        `setTimeout(0) finally ran after ` + `${(performance.now() - start).toFixed(1)}ms`,
      );

      resolve();
    }, 0);

    function repeat() {
      count++;

      if (count === 1) {
        checkpoint("—", "NEXT_TICK", `Start recursive nextTick (${countLimit} callbacks)`);
      }

      if (count === countLimit) {
        checkpoint("—", "NEXT_TICK", "Last nextTick; event loop may proceed now");

        return;
      }

      process.nextTick(repeat);
    }

    process.nextTick(repeat);

    checkpoint("—", "SYNC", "Timer queued but nextTicks also queued");
  });
}

// ======================================================
// 10. LIBUV THREAD POOL
// ======================================================

// crypto.pbkdf2 uses libuv's worker pool.
// The Promise continuations execute on the main JS thread.
//
// Default UV_THREADPOOL_SIZE is typically 4.

async function pool() {
  const pbkdf2 = promisify(crypto.pbkdf2);

  checkpoint(
    "—",
    "SYNC",
    `Queue 5 crypto.pbkdf2 jobs ` + `(UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? "default"})`,
  );

  const jobs = Array.from({ length: 5 }, (_, index) =>
    pbkdf2("password", "salt", 90_000, 32, "sha256").then(() => {
      checkpoint("—", "MICROTASK", `crypto.pbkdf2 job ${index + 1} completed ` + "(worker-pool operation)");
    }),
  );

  jobs.push(
    new Promise((resolve, reject) => {
      fs.stat(new URL(import.meta.url), (err, stat) => {
        if (err) {
          reject(err);
          return;
        }

        checkpoint("POLL*", "I/O", `fs.stat callback; size ${stat.size} bytes`);

        resolve();
      });
    }),
  );

  jobs.push(
    new Promise((resolve) => {
      setImmediate(() => {
        checkpoint("CHECK", "CALLBACK", "Main thread still processes setImmediate while jobs run");

        resolve();
      });
    }),
  );

  await Promise.all(jobs);

  checkpoint("—", "MICROTASK", "All thread-pool operations completed");
}

// ======================================================
// 11. WORKER THREADS
// ======================================================

// The worker performs CPU-heavy JavaScript.
// Meanwhile, the main thread continues executing timers.

async function worker() {
  await new Promise((resolve, reject) => {
    checkpoint("—", "SYNC", `Spawn CPU worker; main threadId=${threadId}`);

    const w = new Worker(new URL(import.meta.url), {
      workerData: {
        eventLoopLabWorker: true,
        cpuMs: 240,
      },
    });

    let heartbeat = 0;

    const interval = setInterval(() => {
      heartbeat++;

      checkpoint("TIMERS", "CALLBACK", `Main-thread heartbeat #${heartbeat} (worker busy)`);
    }, 40);

    w.on("message", (message) => {
      checkpoint("?", "MESSAGE", `Worker thread ${message.threadId}: ${message.step}`);
    });

    w.on("error", (error) => {
      clearInterval(interval);
      reject(error);
    });

    w.on("exit", (code) => {
      clearInterval(interval);

      checkpoint("?", "EVENT", `Worker exited code=${code}; main heartbeats=${heartbeat}`);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });
}

// ======================================================
// 12. UNREF'D TIMERS
// ======================================================

// An unref'd timer doesn't keep a process alive.
// Use a child process so the other experiments don't
// interfere with this behavior.

async function unref() {
  const childProgram = [
    'setTimeout(() => console.log("UNREF_TIMER_FIRED"), 900).unref();',
    'console.log("CHILD_STARTED_AND_EXITING");',
  ].join("\n");

  checkpoint("—", "SYNC", "Spawn a separate Node process with a 900ms unref timer");

  const childStart = performance.now();

  const { stdout } = await promisify(execFile)(process.execPath, ["-e", childProgram], { timeout: 4000 });

  const duration = performance.now() - childStart;
  const sawTimer = stdout.includes("UNREF_TIMER_FIRED");

  checkpoint("?", "CHILD", `Child exited in ${duration.toFixed(1)}ms; ` + `stdout=${JSON.stringify(stdout.trim())}`);

  checkpoint(
    "—",
    "SYNC",
    sawTimer
      ? "Unexpected: child timer fired (inspect system load)"
      : "Unref timer did NOT keep the child process alive",
  );
}

// ======================================================
// 13. COMMONJS VS ES MODULES
// ======================================================

// Compare startup ordering in separate fresh processes.
//
// CommonJS:
// SYNC -> NEXT_TICK -> MICROTASK -> PROMISE
//
// ESM:
// SYNC -> MICROTASK -> PROMISE -> NEXT_TICK

async function moduleModes() {
  const code = [
    'console.log("SYNC");',
    'process.nextTick(() => console.log("NEXT_TICK"));',
    'queueMicrotask(() => console.log("MICROTASK"));',
    'Promise.resolve().then(() => console.log("PROMISE"));',
  ].join("\n");

  for (const [label, args] of [
    ["CJS", ["-e", code]],
    ["ESM", ["--input-type=module", "-e", code]],
  ]) {
    const { stdout } = await promisify(execFile)(process.execPath, args, { timeout: 4000 });

    checkpoint("?", "CHILD", `${label} startup order: ` + stdout.trim().split(/\r?\n/).join(" -> "));
  }
}

// ======================================================
// 14. ABORT SIGNAL AND TIMER CANCELLATION
// ======================================================

// AbortSignal listeners execute synchronously when
// abort() is called.
//
// An awaiting async function resumes through a microtask
// after the timer Promise rejects.

async function cancellation() {
  const abort = new AbortController();

  abort.signal.addEventListener("abort", () => {
    checkpoint("TIMERS", "EVENT_SYNC", "AbortSignal event listener ran synchronously");
  });

  checkpoint("—", "SYNC", "Start delay(200ms) with AbortSignal");

  const pending = delay(200, "resolved", {
    signal: abort.signal,
  });

  setTimeout(() => {
    checkpoint("TIMERS", "CALLBACK", "Cancel pending delay after ~25ms");

    abort.abort();

    checkpoint("TIMERS", "SYNC", "Returned from abort() synchronously");
  }, 25);

  try {
    await pending;

    checkpoint("—", "MICROTASK", "Unexpected: cancelled timer resolved");
  } catch (error) {
    checkpoint("—", "MICROTASK", `Await resumed with ${error.name}`);
  }
}

// ======================================================
// 15. PROCESS LIFECYCLE
// ======================================================

// beforeExit can schedule more asynchronous work.
// exit is synchronous-only.
//
// Run in a child process to avoid affecting other labs.

async function lifecycle() {
  const childProgram = [
    "let n = 0;",
    'process.on("beforeExit", () => {',
    "  console.log(`beforeExit #${++n}`);",
    '  if (n === 1) setImmediate(() => console.log("setImmediate from beforeExit"));',
    "});",
    'process.on("exit", () => console.log("exit (synchronous-only)"));',
    'console.log("end of script");',
  ].join("\n");

  checkpoint("—", "SYNC", "Spawn child to demonstrate beforeExit / exit lifecycle");

  const { stdout } = await promisify(execFile)(process.execPath, ["-e", childProgram], { timeout: 4000 });

  for (const line of stdout.trim().split(/\r?\n/)) {
    checkpoint("?", "CHILD", line);
  }
}

// ======================================================
// EXPERIMENT REGISTRY
// ======================================================

const experiments = [
  {
    id: "esm",
    title: "ES module startup queues",
    lesson: "ESM microtasks versus process.nextTick",
    run: esm,
  },
  {
    id: "microtasks",
    title: "Microtasks at a timer callback boundary",
    lesson: "nextTick, nested nextTick and Promise scheduling",
    run: microtasks,
  },
  {
    id: "emitter",
    title: "EventEmitter callbacks are synchronous",
    lesson: "Event listeners versus queued asynchronous callbacks",
    run: emitter,
  },
  {
    id: "immediate",
    title: "setTimeout(0) versus setImmediate",
    lesson: "Top-level timing-dependent scheduling",
    run: immediate,
  },
  {
    id: "io",
    title: "Filesystem I/O (Poll -> Check)",
    lesson: "Why a setImmediate inside I/O beats a timer",
    run: io,
  },
  {
    id: "tcp",
    title: "TCP server, sockets and close events",
    lesson: "nextTick listening/close versus abrupt socket close",
    run: tcp,
  },
  {
    id: "blocking",
    title: "Blocking the event loop",
    lesson: "Why CPU-bound JavaScript delays timers",
    run: blocking,
  },
  {
    id: "async-await",
    title: "Async/await and timers/promises",
    lesson: "Await continuations are microtasks",
    run: asyncAwait,
  },
  {
    id: "starvation",
    title: "Bounded nextTick starvation",
    lesson: "Recursive nextTick postpones the timer",
    run: starvation,
  },
  {
    id: "pool",
    title: "libuv thread-pool work",
    lesson: "Crypto/filesystem work versus main-thread callbacks",
    run: pool,
  },
  {
    id: "worker",
    title: "Worker Threads",
    lesson: "CPU work outside main JS thread; main timers continue",
    run: worker,
  },
  {
    id: "module-modes",
    title: "CommonJS versus ES module queues",
    lesson: "Compare CJS and ESM startup order in fresh processes",
    run: moduleModes,
  },
  {
    id: "cancellation",
    title: "AbortSignal and timer promises",
    lesson: "Synchronous abort events; rejected await resumes in microtasks",
    run: cancellation,
  },
  {
    id: "unref",
    title: "Unref'd handles",
    lesson: "An unref'd timeout does not keep Node running",
    run: unref,
  },
  {
    id: "lifecycle",
    title: "beforeExit and exit",
    lesson: "Scheduling work during beforeExit extends process lifetime",
    run: lifecycle,
  },
];

// ======================================================
// MAIN RUNNER
// ======================================================

async function main() {
  if (!performance.nodeTiming.uvMetricsInfo) {
    throw new Error("Requires Node.js >=22.8 or >=20.18 for uvMetricsInfo.loopCount");
  }

  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.includes("--list")) {
    console.log("Node.js Event Loop Advanced Lab\n");
    console.log("Usage: node nodejs-event-loop-advanced-lab.mjs [all | id ...]\n");
    console.log("With no arguments, all experiments run in sequence.\n");

    for (const e of experiments) {
      console.log(`  ${e.id.padEnd(12)} ${e.title}`);
    }

    console.log("\nThese are educational demonstrations, not fixed timing guarantees.");

    return;
  }

  const chosen =
    args.length === 0 || args.includes("all")
      ? experiments
      : args.map((id) => {
          const found = experiments.find((e) => e.id === id);

          if (!found) {
            throw new Error(`Unknown lab '${id}'. Use --list to see lab names.`);
          }

          return found;
        });

  console.log(`Node.js ${process.version} | ` + `${process.platform} | pid=${process.pid}`);

  console.log("PHASE = associated scheduling source, " + "not dynamically observed current phase.");

  console.log("* denotes an approximate phase association; " + "? means not asserted.\n");

  for (const e of chosen) {
    startExperiment(e.id, e.title, e.lesson);

    await e.run();

    console.log(`\nFinished ${currentExperiment}: ` + `${sequence} checkpoints\n`);
  }

  console.log("ALL SELECTED LABS FINISHED. " + "Try running individual labs again under F5/F11.");
}

if (isMainThread) {
  await main();
}
