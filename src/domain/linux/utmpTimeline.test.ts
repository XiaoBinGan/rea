import { describe, expect, it } from "vitest";

import { UTMP_TYPES, type UtmpRecord } from "./utmp.js";
import { buildUtmpTimeline } from "./utmpTimeline.js";

const record = (overrides: Partial<UtmpRecord> = {}): UtmpRecord => ({
  fileOffset: 0,
  type: UTMP_TYPES.USER_PROCESS,
  typeName: "USER_PROCESS",
  pid: 1,
  line: "pts/0",
  id: "ts0",
  user: "analyst",
  host: "10.0.0.7",
  exitTermination: 0,
  exitCode: 0,
  session: 1,
  timestampSeconds: 1_700_000_000,
  timestampMicroseconds: 0,
  addressV6: [0, 0, 0, 0],
  undecodedFields: [],
  ...overrides,
});

describe("utmp timeline correlation", () => {
  it("ties a wtmp close to the utmp session that opened it", () => {
    const timeline = buildUtmpTimeline([
      {
        source: "utmp",
        label: "snapshot",
        records: [record({ fileOffset: 0 })],
      },
      {
        source: "wtmp",
        label: "accounting",
        records: [
          record({
            fileOffset: 384,
            type: UTMP_TYPES.DEAD_PROCESS,
            typeName: "DEAD_PROCESS",
            timestampSeconds: 1_700_000_600,
          }),
        ],
      },
    ]);
    expect(timeline.sessions).toHaveLength(1);
    expect(timeline.sessions[0]?.opened?.file).toBe("snapshot");
    expect(timeline.sessions[0]?.closed?.file).toBe("accounting");
  });

  it("keeps records that share every visible field as separate entries", () => {
    // Same user, terminal and timestamp, different files: nothing in the record
    // says they are one event, so correlation must not collapse them.
    const shared = { user: "analyst", line: "pts/0", timestampSeconds: 5 };
    const timeline = buildUtmpTimeline([
      {
        source: "btmp",
        label: "failed",
        records: [record({ ...shared, fileOffset: 0 })],
      },
      {
        source: "wtmp",
        label: "ok",
        records: [record({ ...shared, fileOffset: 0 })],
      },
    ]);
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries.map(({ id }) => id).sort()).toEqual([
      "failed:0",
      "ok:0",
    ]);
  });

  it("never lets a failed login open or close a session", () => {
    const timeline = buildUtmpTimeline([
      {
        source: "btmp",
        label: "failed",
        records: [
          record({ fileOffset: 0 }),
          record({
            fileOffset: 384,
            type: UTMP_TYPES.DEAD_PROCESS,
            typeName: "DEAD_PROCESS",
          }),
        ],
      },
    ]);
    expect(timeline.sessions).toEqual([]);
    expect(timeline.issues).toEqual([]);
  });
});

describe("utmp timeline ordering and diagnostics", () => {
  it("closes two sessions on one terminal in reverse order", () => {
    const timeline = buildUtmpTimeline([
      {
        source: "wtmp",
        label: "accounting",
        records: [
          record({ fileOffset: 0, timestampSeconds: 10, pid: 1 }),
          record({ fileOffset: 384, timestampSeconds: 20, pid: 2 }),
          record({
            fileOffset: 768,
            type: UTMP_TYPES.DEAD_PROCESS,
            typeName: "DEAD_PROCESS",
            timestampSeconds: 30,
            pid: 2,
          }),
          record({
            fileOffset: 1_152,
            type: UTMP_TYPES.DEAD_PROCESS,
            typeName: "DEAD_PROCESS",
            timestampSeconds: 40,
            pid: 1,
          }),
        ],
      },
    ]);
    expect(timeline.sessions.map(({ opened }) => opened?.fileOffset)).toEqual([
      0, 384,
    ]);
    // The later open closes first.
    expect(timeline.sessions[0]?.closed?.fileOffset).toBe(1_152);
    expect(timeline.sessions[1]?.closed?.fileOffset).toBe(768);
  });

  it("reports a close with no open session", () => {
    const timeline = buildUtmpTimeline([
      {
        source: "wtmp",
        label: "accounting",
        records: [
          record({
            fileOffset: 0,
            type: UTMP_TYPES.DEAD_PROCESS,
            typeName: "DEAD_PROCESS",
            user: "ghost",
            line: "tty9",
          }),
        ],
      },
    ]);
    expect(timeline.sessions).toEqual([]);
    expect(timeline.issues).toEqual([
      {
        kind: "unmatched_close",
        entry: "accounting:0",
        user: "ghost",
        line: "tty9",
      },
    ]);
  });

  it("orders the timeline by timestamp and then by file and offset", () => {
    const timeline = buildUtmpTimeline([
      {
        source: "wtmp",
        label: "b",
        records: [
          record({ fileOffset: 0, timestampSeconds: 20 }),
          record({ fileOffset: 384, timestampSeconds: 10 }),
        ],
      },
      {
        source: "utmp",
        label: "a",
        records: [record({ fileOffset: 0, timestampSeconds: 10 })],
      },
    ]);
    expect(timeline.entries.map(({ id }) => id)).toEqual([
      "a:0",
      "b:384",
      "b:0",
    ]);
  });

  it("reports a duplicate entry id instead of dropping the record silently", () => {
    const timeline = buildUtmpTimeline([
      { source: "utmp", label: "same", records: [record({ fileOffset: 0 })] },
      { source: "wtmp", label: "same", records: [record({ fileOffset: 0 })] },
    ]);
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.issues).toEqual([
      { kind: "duplicate_entry_id", id: "same:0" },
    ]);
  });
});
