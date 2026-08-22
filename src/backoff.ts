/** Reconnect backoff — no vscode dependency, so it can be unit-tested.
 *
 *  A flat retry is the wrong shape for a daemon that is simply not running:
 *  the socket path does not exist, every attempt fails instantly, and the
 *  extension spends the afternoon opening sockets against nothing. devup
 *  itself backs off (2s → 4s → 8s) when restarting a crashed service, so the
 *  project already holds this opinion. */
export class Backoff {
  private attempt = 0;

  constructor(
    private readonly baseMs = 3_000,
    private readonly ceilingMs = 30_000,
  ) {}

  /** Delay for the next attempt, doubling each time up to the ceiling. */
  next(): number {
    const delay = Math.min(this.baseMs * 2 ** this.attempt, this.ceilingMs);
    this.attempt++;
    return delay;
  }

  /** Back to the base delay. Call once a connection has demonstrably worked,
   *  so the *next* outage starts from 3 s again rather than from wherever the
   *  last one climbed to. It does not shorten the outage in progress: by the
   *  time a daemon returns, the pending delay may already be the ceiling, so
   *  detection takes up to 30 s — `devup: Refresh services` retries at once
   *  for anyone unwilling to wait. */
  reset(): void {
    this.attempt = 0;
  }
}
