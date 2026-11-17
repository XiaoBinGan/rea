import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { UTMP_TYPES, type UtmpRecord, type UtmpSource } from "./utmp.js";

/**
 * One timeline over several login-accounting files.
 *
 * Correlation links records; it never merges them. Two records that share a
 * user, terminal or timestamp stay two entries, because the accounting files do
 * not say those records are the same event — a failed login and a successful one
 * on the same terminal can share every visible field.
 */

export interface UtmpSourceFile {
  readonly source: UtmpSource;
  /** Caller-supplied identity for the file, kept on every entry it produces. */
  readonly label: string;
  readonly records: readonly UtmpRecord[];
}

export interface UtmpTimelineEntry {
  /** Stable within one timeline: the file label plus the record's file offset. */
  readonly id: string;
  readonly file: string;
  readonly source: UtmpSource;
  readonly fileOffset: number;
  readonly record: UtmpRecord;
}

export interface UtmpSession {
  /** The record that opened the session, when one is present. */
  readonly opened: UtmpTimelineEntry | null;
  /** The record that closed it, when one is present. */
  readonly closed: UtmpTimelineEntry | null;
  readonly user: string;
  readonly line: string;
}

export type UtmpTimelineIssue =
  | {
      readonly kind: "unmatched_close";
      readonly entry: string;
      readonly user: string;
      readonly line: string;
    }
  | { readonly kind: "duplicate_entry_id"; readonly id: string };

export interface UtmpTimeline {
  readonly entries: readonly UtmpTimelineEntry[];
  readonly sessions: readonly UtmpSession[];
  readonly issues: readonly UtmpTimelineIssue[];
}

const entryId = (label: string, fileOffset: number): string =>
  `${label}:${fileOffset}`;

/** A failed-login file never opens a session, whatever the record type says. */
const opensSession = (source: UtmpSource, record: UtmpRecord): boolean =>
  source !== "btmp" && record.type === UTMP_TYPES.USER_PROCESS;

const closesSession = (source: UtmpSource, record: UtmpRecord): boolean =>
  source !== "btmp" && record.type === UTMP_TYPES.DEAD_PROCESS;

/**
 * Order entries by the record's own timestamp, then by file label and offset so
 * a timeline is deterministic when timestamps tie.
 */
const byTime = (left: UtmpTimelineEntry, right: UtmpTimelineEntry): number => {
  const seconds = left.record.timestampSeconds - right.record.timestampSeconds;
  if (seconds !== 0) return seconds;
  const micro =
    left.record.timestampMicroseconds - right.record.timestampMicroseconds;
  if (micro !== 0) return micro;
  const file = compareUnicodeCodePoints(left.file, right.file);
  return file !== 0 ? file : left.fileOffset - right.fileOffset;
};

/**
 * Build one timeline across the supplied files.
 *
 * A close matches the most recent still-open session with the same user and
 * terminal, across files, so a `utmp` session and the `wtmp` record that ended it
 * are one session. Type alone never matches: `btmp` records are failed logins and
 * never open or close a session.
 */
export const buildUtmpTimeline = (
  files: readonly UtmpSourceFile[],
): UtmpTimeline => {
  const issues: UtmpTimelineIssue[] = [];
  const seen = new Set<string>();
  const entries: UtmpTimelineEntry[] = [];
  for (const file of files) {
    for (const record of file.records) {
      const id = entryId(file.label, record.fileOffset);
      if (seen.has(id)) {
        issues.push({ kind: "duplicate_entry_id", id });
        continue;
      }
      seen.add(id);
      entries.push({
        id,
        file: file.label,
        source: file.source,
        fileOffset: record.fileOffset,
        record,
      });
    }
  }
  entries.sort(byTime);

  const sessions: UtmpSession[] = [];
  const open: UtmpTimelineEntry[] = [];
  for (const entry of entries) {
    if (opensSession(entry.source, entry.record)) {
      open.push(entry);
      sessions.push({
        opened: entry,
        closed: null,
        user: entry.record.user,
        line: entry.record.line,
      });
      continue;
    }
    if (!closesSession(entry.source, entry.record)) continue;
    // Match on the terminal and the user the session was opened with, newest
    // first, so two sessions on one terminal close in reverse order.
    let index = -1;
    for (let candidate = open.length - 1; candidate >= 0; candidate -= 1) {
      const entryOpen = open[candidate]!;
      if (
        entryOpen.record.line === entry.record.line &&
        entryOpen.record.user === entry.record.user
      ) {
        index = candidate;
        break;
      }
    }
    if (index === -1) {
      issues.push({
        kind: "unmatched_close",
        entry: entry.id,
        user: entry.record.user,
        line: entry.record.line,
      });
      continue;
    }
    const matched = open.splice(index, 1)[0]!;
    const session = sessions.find(
      (candidate) => candidate.opened?.id === matched.id,
    );
    if (session !== undefined)
      sessions[sessions.indexOf(session)] = { ...session, closed: entry };
  }

  return { entries, sessions, issues };
};
