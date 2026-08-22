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

  /** Back to the base delay — call on a successful connect, so a daemon that
   *  restarts after an hour down is picked up in 3 s rather than 30. */
  reset(): void {
    this.attempt = 0;
  }
}
