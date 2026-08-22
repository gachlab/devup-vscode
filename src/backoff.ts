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

/** Delay before the next reconnect attempt, honouring a "the daemon was just
 *  asked to restart" window.
 *
 *  Scheduling nudges at fixed offsets from the command does not work: on a
 *  restart the daemon is still up when they fire — the shell has not finished
 *  `devup down` — so they find a healthy connection, do nothing, and the drop
 *  that follows is left to the unassisted backoff. A window instead covers the
 *  whole restart however long it takes, and expires on its own.
 *
 *  Note the asymmetry: inside the window the backoff is not advanced at all,
 *  so a restart that outlasts it resumes from where it was rather than from a
 *  ceiling it never earned. */
export function reconnectDelay(backoff: Backoff, fastUntil: number, now: number, fastMs = 2_000): number {
  return now < fastUntil ? fastMs : backoff.next();
}
