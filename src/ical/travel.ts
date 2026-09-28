import ICAL from "ical.js";

// Apple Calendar stores travel time as a non-standard duration property on the
// VEVENT, e.g. `X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT30M`. Automatically
// calculated travel time additionally carries `X-APPLE-TRAVEL-START` (and, for
// return trips, `X-APPLE-TRAVEL-RETURN*`) properties.
const travelDurationProperty = "x-apple-travel-duration";
const travelPropertyPrefix = "x-apple-travel-";

const durationFromValue = (value: unknown): ICAL.Duration | null => {
  if (value instanceof ICAL.Duration) {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    try {
      return ICAL.Duration.fromString(value);
    } catch {
      return null;
    }
  }
  return null;
};

export const readTravelMinutes = (event: ICAL.Component): number | null => {
  const property = event.getFirstProperty(travelDurationProperty);
  if (property === null) {
    return null;
  }
  const duration = durationFromValue(property.getFirstValue());
  if (duration === null) {
    return null;
  }
  const seconds = duration.toSeconds();
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const minutes = Math.round(seconds / 60);
  return minutes > 0 ? minutes : null;
};

export const isAllDayEvent = (event: ICAL.Component): boolean => {
  const start = event.getFirstPropertyValue("dtstart");
  return start instanceof ICAL.Time && start.isDate;
};

export const setTravelMinutes = (
  event: ICAL.Component,
  minutes: number | null,
): void => {
  if (minutes === null) {
    // Clearing travel time also drops Apple's automatic travel metadata, so
    // Calendar does not recalculate and re-add it from a stored start location.
    // getAllProperties() returns the live internal array, so iterate a copy.
    for (const property of [...event.getAllProperties()]) {
      if (property.name.startsWith(travelPropertyPrefix)) {
        event.removeProperty(property);
      }
    }
    return;
  }
  event.removeAllProperties(travelDurationProperty);
  const property = new ICAL.Property(travelDurationProperty);
  property.resetType("duration");
  property.setValue(ICAL.Duration.fromSeconds(minutes * 60));
  event.addProperty(property);
};
