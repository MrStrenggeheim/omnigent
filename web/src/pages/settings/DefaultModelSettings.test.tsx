import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DefaultModelSettings } from "./DefaultModelSettings";
import { readDefaultModel } from "@/lib/defaultModelPreferences";
import { useHostModelOptions } from "@/hooks/useHosts";

vi.mock("@/hooks/useHosts", () => ({
  useHosts: () => ({ data: [{ host_id: "host-a", name: "Test host", status: "online" }] }),
  useHostModelOptions: vi.fn(() => ({
    data: [{ id: "model-a", displayName: "Model A" }],
    isFetching: false,
    error: null,
  })),
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);
async function choose(label: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: label }), {
    button: 0,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
it("configures independent model defaults without changing the default agent", async () => {
  localStorage.setItem("omnigent:default-agent-id", "chosen-agent");
  render(<DefaultModelSettings />);
  await choose("Default model", "Model A");
  expect(readDefaultModel("codex-native")).toBe("model-a");
  await choose("Model default harness", "Claude Code");
  expect(screen.getByRole("combobox", { name: "Default model" })).toHaveTextContent(
    "Use last selected model",
  );
  await choose("Default model", "Harness default");
  expect(readDefaultModel("claude-native")).toBe("");
  expect(readDefaultModel("codex-native")).toBe("model-a");
  expect(localStorage.getItem("omnigent:default-agent-id")).toBe("chosen-agent");
  await choose("Default model", "Use last selected model");
  expect(readDefaultModel("claude-native")).toBeUndefined();
  expect(useHostModelOptions).toHaveBeenLastCalledWith("host-a", "claude-native", true, {
    poll: false,
  });
});
it("retains an unavailable configured model while explaining the startup fallback", () => {
  localStorage.setItem(
    "omnigent:default-model-by-harness",
    JSON.stringify({ "codex-native": "retired" }),
  );
  render(<DefaultModelSettings />);
  expect(screen.getByRole("combobox", { name: "Default model" })).toHaveTextContent(
    "unavailable; uses harness default",
  );
  expect(readDefaultModel("codex-native")).toBe("retired");
});
