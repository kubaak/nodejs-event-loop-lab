const start = performance.now();
let step = 0;

function log(message) {
  const elapsed = (performance.now() - start).toFixed(0);
  console.log(`${String(++step).padStart(2, "0")} | +${elapsed.padStart(4)}ms | ${message}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shared synchronization state
let synchronizing = false;
let refreshRequested = false;
let refreshWaiters = [];
let refreshCount = 0;

// Resolves every Promise waiting for synchronization to finish.
function finishRequests() {
  log(`finishRequests(): ${refreshWaiters.length} waiters`);

  const waiters = refreshWaiters;
  refreshWaiters = [];

  for (const [index, resolve] of waiters.entries()) {
    log(`Calling resolve() for waiter ${index + 1}`);
    resolve(); // BREAKPOINT 5
  }
}

// Simulates fetching a snapshot over HTTP.
async function refresh() {
  if (synchronizing) {
    log("refresh(): already synchronizing, returning");
    return;
  }

  synchronizing = true;
  refreshRequested = false;
  const id = ++refreshCount;

  log(`refresh #${id}: started (synchronous)`); // BREAKPOINT 2

  try {
    log(`refresh #${id}: before await delay(1000)`);

    await delay(1000); // BREAKPOINT 3

    log(`refresh #${id}: resumed after await`);
    log(`refresh #${id}: writing simulated snapshot`);
  } finally {
    synchronizing = false;

    if (refreshRequested) {
      log(`refresh #${id}: another refresh was requested`);
      void refresh();
    } else {
      log(`refresh #${id}: synchronization complete`);
      finishRequests();
    }
  }
}

// Same deferred-Promise pattern as ScreenHost.
function requestRefresh(name) {
  log(`${name}: requestRefresh() entered`);

  return new Promise((resolve) => {
    log(`${name}: Promise executor started`); // BREAKPOINT 1

    refreshWaiters.push(resolve);
    log(`${name}: stored resolve() — Promise still pending`);

    if (synchronizing) {
      refreshRequested = true;
      log(`${name}: refresh running, requested follow-up`);
    } else {
      log(`${name}: calling refresh()`);
      void refresh();
      log(`${name}: control returned from refresh()`);
    }

    log(`${name}: Promise executor finished`);
  });
}

async function caller(name) {
  log(`${name}: BEFORE await requestRefresh()`);

  await requestRefresh(name); // BREAKPOINT 4

  log(`${name}: AFTER await — Promise resolved`); // BREAKPOINT 6
}

async function main() {
  log("MAIN: starting");

  const a = caller("A");

  // B requests a refresh while A's refresh is in progress.
  await delay(200);
  const b = caller("B");

  // C also joins the pending waiters.
  await delay(200);
  const c = caller("C");

  log("MAIN: waiting for A, B, C");
  await Promise.all([a, b, c]);

  log("MAIN: all callers completed");
}

await main();
