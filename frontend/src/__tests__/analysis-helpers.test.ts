import { dayLabel, formatAgo, groupByDay } from "@/lib/analysis";
import { isTabRoute } from "@/lib/navigation";

describe("analysis presentation helpers", () => {
  const now = new Date(2026, 8, 30, 15, 0, 0);

  it("labels today, yesterday and older days", () => {
    expect(dayLabel(new Date(2026, 8, 30, 9).toISOString(), now)).toMatchObject({ today: true });
    // Month/day order follows the runtime locale ("SEP 30" in en-US, "30 SEPT" in en-GB).
    const today = dayLabel(new Date(2026, 8, 30, 9).toISOString(), now).text;
    expect(today).toMatch(/SEP/);
    expect(today).toMatch(/30/);
    expect(dayLabel(new Date(2026, 8, 29, 23).toISOString(), now)).toEqual({ text: "YESTERDAY", today: false });
    expect(dayLabel(new Date(2026, 8, 20, 12).toISOString(), now).today).toBe(false);
  });

  it("groups consecutive items by calendar day", () => {
    const at = (d: number, h: number) => ({ created_at: new Date(2026, 8, d, h).toISOString() });
    const groups = groupByDay([at(30, 14), at(30, 9), at(29, 20), at(27, 8)]);
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 1]);
  });

  it("formats compact ages", () => {
    const t = now.getTime();
    expect(formatAgo(new Date(t - 20_000).toISOString(), t)).toBe("now");
    expect(formatAgo(new Date(t - 5 * 60_000).toISOString(), t)).toBe("5m ago");
    expect(formatAgo(new Date(t - 3 * 3_600_000).toISOString(), t)).toBe("3h ago");
    expect(formatAgo(new Date(t - 2 * 86_400_000).toISOString(), t)).toBe("2d ago");
  });

  it("knows which routes show the tab bar", () => {
    expect(isTabRoute("/app")).toBe(true);
    expect(isTabRoute("/app/analyses/")).toBe(true);
    expect(isTabRoute("/app/analyses/123")).toBe(false);
    expect(isTabRoute("/app/analyze")).toBe(false);
  });
});
