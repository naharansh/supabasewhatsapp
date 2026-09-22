import { describe, expect, it } from "vitest";
import { triggerMatches } from "./engine";
import type { Automation } from "@/types";

function automationWith(trigger_type: Automation["trigger_type"], trigger_config: Record<string, unknown>): Automation {
  return {
    id: "auto-1",
    user_id: "user-1",
    name: "Test",
    description: "",
    trigger_type,
    trigger_config,
    is_active: true,
    execution_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as Automation;
}

describe("triggerMatches", () => {
  it("fires tag_added automation only when the configured tag was added", () => {
    const auto = automationWith("tag_added", { tag_id: "tag-vip" });
    expect(triggerMatches(auto, { tag_id: "tag-vip" })).toBe(true);
    expect(triggerMatches(auto, { tag_id: "tag-other" })).toBe(false);
    expect(triggerMatches(auto, {})).toBe(false);
    expect(triggerMatches(auto, undefined)).toBe(false);
  });

  it("does not fire tag_added automation when no tag is configured", () => {
    const auto = automationWith("tag_added", {});
    expect(triggerMatches(auto, { tag_id: "anything" })).toBe(false);
  });

  it("keeps non-tag triggers fire-by-default semantics", () => {
    for (const trigger_type of [
      "new_message_received",
      "first_inbound_message",
      "new_contact_created",
      "conversation_assigned",
      "time_based",
    ] as const) {
      expect(triggerMatches(automationWith(trigger_type, {}), {})).toBe(true);
    }
  });

  it("still evaluates keyword_match correctly", () => {
    const contains = automationWith("keyword_match", {
      keywords: ["hello"],
      match_type: "contains",
    });
    expect(triggerMatches(contains, { message_text: "say hello back" })).toBe(true);
    expect(triggerMatches(contains, { message_text: "hi there" })).toBe(false);
    expect(triggerMatches(contains, {})).toBe(false);
  });
});