/** Offering the debugging walkthrough — once, and at a moment when it means
 *  something.
 *
 *  A walkthrough that nobody opens is a document nobody reads. The Welcome page
 *  is only visited on purpose, and the Marketplace README is read once, before
 *  installing, when none of this matters yet. So the extension offers it — but
 *  the rules of a good nudge are narrow, and they are all here rather than
 *  spread through `activate()`. */

export interface TourOffer {
  /** Whether to show the offer now. */
  show: boolean;
  /** Whether to record that it has been offered, so it never comes back. */
  remember: boolean;
}

export interface TourInput {
  /** Has it been offered before, in any window? */
  alreadyOffered: boolean;
  /** Is the daemon connected? Offering while nothing is running would point at
   *  a walkthrough whose first step is "start the stack" — true, but it reads
   *  as noise from an extension that has nothing to show yet. */
  connected: boolean;
}

export function considerTour(input: TourInput): TourOffer {
  if (input.alreadyOffered) return { show: false, remember: false };
  if (!input.connected) return { show: false, remember: false };
  // Remembered on the way out, not on the way back: whether the user says yes,
  // says no, or dismisses the notification without answering, this has had its
  // one turn. Anything else is nagging.
  return { show: true, remember: true };
}

/** Key under which the offer is remembered. Global, not per workspace: the
 *  feature is the same everywhere, and being asked again in each repo is
 *  exactly the behaviour this is meant to avoid. */
export const TOUR_OFFERED_KEY = 'devup.debugTourOffered';
