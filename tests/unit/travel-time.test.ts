import { describe, expect, it } from "vitest";

import {
  createCalendarEvent,
  createEventInputSchema,
  eventPatchSchema,
  expandCalendarEvent,
  iCloudProviderPolicy,
  normalizeCalendarEvent,
  patchCalendarEvent,
} from "../../src/index.js";

const timedEvent = {
  calendar_id: "calendar",
  summary: "Tandarts",
  start: {
    date_time: "2026-10-05T10:00:00+02:00",
    timezone: "Europe/Amsterdam",
  },
  end: {
    date_time: "2026-10-05T10:30:00+02:00",
    timezone: "Europe/Amsterdam",
  },
};

const allDayEvent = {
  calendar_id: "calendar",
  summary: "Vrije dag",
  start: { date: "2026-10-05" },
  end: { date: "2026-10-06" },
};

const createRaw = (input: Record<string, unknown>): string =>
  createCalendarEvent({
    input: createEventInputSchema.parse(input),
    provider: iCloudProviderPolicy,
    now: new Date("2026-01-01T00:00:00Z"),
    createUuid: () => "event",
  });

const accepts = (input: Record<string, unknown>): boolean =>
  createEventInputSchema.safeParse(input).success;

const patchAccepts = (patch: Record<string, unknown>): boolean =>
  eventPatchSchema.safeParse(patch).success;

// Shape Apple Calendar writes for manually set and automatically calculated
// travel time, including the travel start metadata.
const appleRaw = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple Inc.//macOS 26.0//EN",
  "BEGIN:VEVENT",
  "UID:apple-event",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;TZID=Europe/Amsterdam:20261005T100000",
  "DTEND;TZID=Europe/Amsterdam:20261005T103000",
  "SUMMARY:Tandarts",
  "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
  "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT1H30M",
  "X-APPLE-TRAVEL-START;ROUTING=CAR;VALUE=URI;X-TITLE=Home:",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("Apple travel time", () => {
  it("writes travel time as an Apple duration property", () => {
    const raw = createRaw({ ...timedEvent, travel_minutes: 45 });

    expect(raw).toContain("X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT45M");
    expect(normalizeCalendarEvent(raw).travelMinutes).toBe(45);
  });

  it("omits travel time by default", () => {
    const raw = createRaw(timedEvent);

    expect(raw).not.toContain("X-APPLE-TRAVEL");
    expect(normalizeCalendarEvent(raw).travelMinutes).toBeNull();
  });

  it("reads travel time written by Apple Calendar", () => {
    expect(normalizeCalendarEvent(appleRaw).travelMinutes).toBe(90);
  });

  it("reads a travel duration stored without a VALUE parameter", () => {
    const raw = appleRaw.replace(
      "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT1H30M",
      "X-APPLE-TRAVEL-DURATION:PT20M",
    );

    expect(normalizeCalendarEvent(raw).travelMinutes).toBe(20);
  });

  it("preserves travel time when a patch omits it", () => {
    const updated = patchCalendarEvent({
      rawCalendar: appleRaw,
      patch: eventPatchSchema.parse({ summary: "Tandarts (controle)" }),
      provider: iCloudProviderPolicy,
    });

    expect(normalizeCalendarEvent(updated).travelMinutes).toBe(90);
    expect(updated).toContain("X-APPLE-TRAVEL-START");
  });

  it("replaces only the travel duration when a new value is set", () => {
    const updated = patchCalendarEvent({
      rawCalendar: appleRaw,
      patch: eventPatchSchema.parse({ travel_minutes: 15 }),
      provider: iCloudProviderPolicy,
    });

    expect(updated.split("X-APPLE-TRAVEL-DURATION").length - 1).toBe(1);
    expect(normalizeCalendarEvent(updated).travelMinutes).toBe(15);
    expect(updated).toContain("X-APPLE-TRAVEL-START");
  });

  it("removes all Apple travel metadata when cleared with null", () => {
    const updated = patchCalendarEvent({
      rawCalendar: appleRaw,
      patch: eventPatchSchema.parse({ travel_minutes: null }),
      provider: iCloudProviderPolicy,
    });

    expect(updated).not.toContain("X-APPLE-TRAVEL");
    expect(normalizeCalendarEvent(updated).travelMinutes).toBeNull();
    expect(normalizeCalendarEvent(updated).summary).toBe("Tandarts");
  });

  it("carries travel time onto recurring occurrences", () => {
    const raw = createRaw({
      ...timedEvent,
      travel_minutes: 30,
      rrule: "FREQ=WEEKLY;COUNT=3",
    });

    const occurrences = expandCalendarEvent(
      raw,
      "2026-10-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
    );

    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((event) => event.travelMinutes)).toEqual([
      30, 30, 30,
    ]);
  });

  it("validates the travel time range", () => {
    expect(accepts({ ...timedEvent, travel_minutes: 0 })).toBe(false);
    expect(accepts({ ...timedEvent, travel_minutes: 1441 })).toBe(false);
    expect(accepts({ ...timedEvent, travel_minutes: 7.5 })).toBe(false);
    expect(accepts({ ...timedEvent, travel_minutes: 1440 })).toBe(true);
  });

  it("rejects travel time on all-day events", () => {
    const allDayPatch = {
      start: allDayEvent.start,
      end: allDayEvent.end,
      travel_minutes: 30,
    };
    const allDayRaw = createRaw(allDayEvent);
    const patchAllDay = (): string =>
      patchCalendarEvent({
        rawCalendar: allDayRaw,
        patch: eventPatchSchema.parse({ travel_minutes: 30 }),
        provider: iCloudProviderPolicy,
      });

    expect(accepts({ ...allDayEvent, travel_minutes: 30 })).toBe(false);
    expect(patchAccepts(allDayPatch)).toBe(false);
    expect(patchAllDay).toThrow("Travel time is only supported");
  });
});
