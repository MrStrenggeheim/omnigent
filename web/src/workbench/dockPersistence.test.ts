import { describe, expect, it } from "vitest";
import { addDockView, createDockLayout, resizeDockSplit, type DockView } from "./dockLayout";
import {
  composeDockLayout,
  createDockPersistence,
  navigateDockConversation,
  parseDockPersistence,
} from "./dockPersistence";

const conversation = (id: string): DockView => ({
  id: `conversation:${id}`,
  kind: "conversation",
  title: id,
  resource: { conversationId: id },
});
const explorer: DockView = {
  id: "explorer",
  kind: "explorer",
  title: "Explorer",
  resource: { path: "/original", hostId: "host-a" },
};

describe("automatic conversation layout migration", () => {
  it.each([null, "A"])(
    "migrates the legacy shared arrangement for owner %s without losing saved B or pins",
    (activeConversationId) => {
      const shared = resizeDockSplit(
        addDockView(createDockLayout([conversation("A")]), explorer, { edge: "right" }),
        [],
        0.65,
      );
      const b = createDockLayout([conversation("B")]);
      const pins = createDockLayout([{ ...explorer, id: "pinned" }]);
      const legacy = {
        ...createDockPersistence(),
        automaticChatLayouts: undefined,
        shared,
        chats: [{ conversationId: "B", layout: b }],
        pins,
        activeConversationId,
      };
      const migrated = parseDockPersistence(JSON.stringify(legacy))!;
      expect(migrated.activeConversationId).toBe("A");
      expect(migrated.chats.find((chat) => chat.conversationId === "A")?.layout).toEqual(shared);
      expect(migrated.chats.find((chat) => chat.conversationId === "B")?.layout).toEqual(b);
      expect(migrated.pins).toEqual(pins);
      expect(migrated.shared).toEqual(shared);
      expect(parseDockPersistence(JSON.stringify(migrated))).toEqual(migrated);
      expect(
        composeDockLayout(navigateDockConversation(migrated, "B")).views.map((view) => view.id),
      ).toEqual(["conversation:B", "pinned"]);
    },
  );

  it("keeps an explicitly saved active arrangement and also preserves an unsaved shared owner", () => {
    const shared = createDockLayout([conversation("A"), explorer]);
    const b = createDockLayout([conversation("B")]);
    const legacy = {
      ...createDockPersistence(),
      automaticChatLayouts: undefined,
      shared,
      chats: [{ conversationId: "B", layout: b }],
      activeConversationId: "B",
    };
    const migrated = parseDockPersistence(JSON.stringify(legacy))!;
    expect(migrated.activeConversationId).toBe("B");
    expect(composeDockLayout(migrated)).toEqual(b);
    expect(composeDockLayout(navigateDockConversation(migrated, "A"))).toEqual(shared);
  });

  it("never replaces an explicit owner snapshot with a legacy shared arrangement", () => {
    const shared = createDockLayout([conversation("A"), explorer]);
    const saved = createDockLayout([conversation("A")]);
    const legacy = {
      ...createDockPersistence(),
      automaticChatLayouts: undefined,
      shared,
      chats: [{ conversationId: "A", layout: saved }],
      activeConversationId: "A",
    };
    const migrated = parseDockPersistence(JSON.stringify(legacy))!;
    expect(composeDockLayout(migrated)).toEqual(saved);
    expect(migrated.shared).toEqual(shared);
  });
});
