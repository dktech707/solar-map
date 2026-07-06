'use strict';

/**
 * Shared server plumbing: the error envelope, numeric parsing/validation, an
 * in-memory TTL cache and a simple upstream rate guard. Kept dependency-free.
 */

/** Consistent error envelope: { error: { code, message } }. */
function errorBody(code, message) {
  return { error: { code, message } };
}

/**
 * Parse a required query value into a finite, optionally bounded number.
 * @returns {{ ok: true, value: number } | { ok: false }}
 */
function parseNumber(raw, bounds = {}) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: false };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false };
  if (bounds.min !== undefined && value < bounds.min) return { ok: false };
  if (bounds.max !== undefined && value > bounds.max) return { ok: false };
  return { ok: true, value };
}

/**
 * Resolve an optional numeric query value: absent -> fallback; present and in
 * range -> that value; present but invalid/out-of-range -> not ok (a 400).
 * @returns {{ ok: true, value: number } | { ok: false }}
 */
function resolveOptional(raw, bounds, fallback) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: fallback };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false };
  if (bounds.min !== undefined && value < bounds.min) return { ok: false };
  if (bounds.max !== undefined && value > bounds.max) return { ok: false };
  return { ok: true, value };
}

/** Tiny in-memory cache with a fixed TTL per entry. */
class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

/** Allows at most one acquisition per `minIntervalMs` (global, per instance). */
class RateGuard {
  constructor(minIntervalMs) {
    this.minIntervalMs = minIntervalMs;
    this.last = 0;
  }

  tryAcquire() {
    const now = Date.now();
    if (now - this.last < this.minIntervalMs) return false;
    this.last = now;
    return true;
  }
}

/**
 * Spaces upstream calls to at most one per `minIntervalMs`. When a call arrives
 * too soon it waits for the remaining time (capped at `maxWaitMs`) instead of
 * rejecting, so a normal recalculate is not rate-limited. Only when a waiter is
 * already queued (or the wait would exceed the cap) does `acquire()` reject.
 */
class UpstreamSpacer {
  constructor(minIntervalMs, maxWaitMs) {
    this.minIntervalMs = minIntervalMs;
    this.maxWaitMs = maxWaitMs;
    this.last = 0;
    this.waiting = false;
  }

  /** Resolves when it is OK to send; rejects (Error) if overloaded. */
  async acquire() {
    const elapsed = Date.now() - this.last;
    if (elapsed >= this.minIntervalMs) {
      this.last = Date.now();
      return;
    }
    const wait = this.minIntervalMs - elapsed;
    if (this.waiting || wait > this.maxWaitMs) {
      throw new Error('OVERLOADED');
    }
    this.waiting = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, wait));
    } finally {
      this.waiting = false;
    }
    this.last = Date.now();
  }
}

module.exports = {
  errorBody,
  parseNumber,
  resolveOptional,
  TtlCache,
  RateGuard,
  UpstreamSpacer,
};
