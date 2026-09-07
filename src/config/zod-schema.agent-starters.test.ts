import { describe, expect, it } from "vitest";
import { AgentEntrySchema } from "./zod-schema.agent-runtime.js";

describe("agent chat starters", () => {
  it("accepts up to five bounded label and prompt entries", () => {
    const starters = Array.from({ length: 5 }, (_, index) => ({
      label: `Workflow ${index + 1}`,
      ...(index === 0 ? { prompt: "WORKFLOW_LAUNCH_V1 workflow=one" } : {}),
    }));

    expect(AgentEntrySchema.parse({ id: "pablo", starters }).starters).toEqual(starters);
  });

  it.each([
    { starters: [] },
    {
      starters: Array.from({ length: 6 }, (_, index) => ({
        label: `Workflow ${index + 1}`,
      })),
    },
    { starters: [{ label: "" }] },
    { starters: [{ label: "Workflow", prompt: "" }] },
    { starters: [{ label: "Workflow", extra: true }] },
  ])("rejects invalid starter metadata: $starters", ({ starters }) => {
    expect(AgentEntrySchema.safeParse({ id: "pablo", starters }).success).toBe(false);
  });
});
