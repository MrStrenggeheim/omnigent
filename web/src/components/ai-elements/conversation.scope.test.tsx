import { useContext, useLayoutEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  Conversation,
  ConversationContent,
  ConversationScrollLockContext,
  releaseConversationScrollLock,
  type ConversationScrollLock,
} from "./conversation";

afterEach(cleanup);

it("releases only the transcript being navigated when two conversations are mounted", () => {
  const locks = new Map<string, ConversationScrollLock>();
  function Probe({ id }: { id: string }) {
    const lock = useContext(ConversationScrollLockContext);
    useLayoutEffect(() => {
      if (lock) locks.set(id, lock);
    }, [id, lock]);
    return <p>{id}</p>;
  }
  render(
    <>
      <section data-testid="first">
        <Conversation>
          <ConversationContent>
            <Probe id="first" />
          </ConversationContent>
        </Conversation>
      </section>
      <section data-testid="second">
        <Conversation>
          <ConversationContent>
            <Probe id="second" />
          </ConversationContent>
        </Conversation>
      </section>
    </>,
  );
  const first = vi.spyOn(locks.get("first")!, "stopScroll");
  const second = vi.spyOn(locks.get("second")!, "stopScroll");
  act(() => releaseConversationScrollLock(screen.getByTestId("second")));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
  expect(locks.get("second")!.state.escapedFromLock).toBe(true);
});
