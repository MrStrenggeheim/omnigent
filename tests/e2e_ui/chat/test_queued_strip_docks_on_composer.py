"""E2E: the queued/steer strip docks onto the composer stack.

Regression test for the steer bar floating detached above the composer.

A first message is sent (and acked) but no ``session.status`` event ever
follows, so the SPA's local status stays busy and a follow-up typed into the
composer is held in the client-side queue -- rendering the docked queued/steer
strip above the composer (the same no-LLM pattern as ``test_queue_steer.py``).
The strip is designed to tuck behind the composer surface below it: its
negative bottom margin slides its square bottom corners down behind the next
card so the tray reads as attached to the composer (see
``QueuedMessagesStrip``).

Failure mode this catches: an element inserted between the strip and the
composer card that is narrower than the strip (the inset workspace-controls
bar) leaves a band of page background visible below the strip's outer edges,
so the steer bar renders as a detached row floating above the composer
instead of sitting on it.
"""

from __future__ import annotations

import json
import os

from playwright.sync_api import Browser, Route, expect

_MSG1 = "sentinel-steer-dock-msg1 holds the turn open"
_MSG2 = "sentinel-steer-dock-msg2 queued follow-up shown in the steer strip"

# Tolerance for borders / subpixel layout rounding when comparing edges.
_EPSILON = 1.5


def test_queued_strip_attaches_to_composer(
    browser: Browser,
    seeded_session: tuple[str, str],
) -> None:
    """The queued/steer strip must sit ON the composer stack, not float above it.

    The strip's painted bottom reaches the composer card directly; no empty
    workspace shelf or band of page background separates them.

    Failure mode this catches: the strip's negative-margin tuck lands on a
    narrower, inset element between it and the card, so at the strip's outer
    edges a gap of page background shows and the steer bar floats detached
    above the composer.
    """
    base_url, session_id = seeded_session
    context = browser.new_context(
        color_scheme="light",
        record_video_dir=os.environ.get("OMNIGENT_E2E_RECORD_DIR"),
    )
    page = context.new_page()

    # Every message text POSTed to the /events endpoint, in arrival order.
    # Each is acked immediately; no session.status event ever follows, so
    # the session's local status stays busy after msg1 -- which is what
    # makes the follow-up queue client-side instead of send.
    posted: list[str] = []

    def ack_event(route: Route) -> None:
        body = route.request.post_data_json
        posted.append(body["data"]["content"][0]["text"])
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"queued": True, "item_id": "ci_steer_dock"}),
        )

    page.route("**/v1/sessions/*/events", ack_event)
    try:
        page.goto(f"{base_url}/c/{session_id}")
        composer = page.get_by_label("Message the agent")
        expect(composer).to_be_visible(timeout=30_000)
        send = page.get_by_role("button", name="Send", exact=True)

        # msg1 -> POST + acked; the send flips local status to streaming and
        # no idle event ever arrives, so the session stays busy.
        composer.fill(_MSG1)
        send.click()
        deadline_ms = 15_000
        while _MSG1 not in posted and deadline_ms > 0:
            page.wait_for_timeout(100)
            deadline_ms -= 100
        assert _MSG1 in posted, f"msg1 was never POSTed: {posted}"

        # msg2 -> typed while busy -> held in the client-side queue and shown
        # in the docked queued/steer strip above the composer.
        composer.fill(_MSG2)
        send.click()
        strip = page.get_by_test_id("composer-queued-strip")
        expect(strip).to_be_visible(timeout=15_000)
        expect(strip).to_contain_text(_MSG2)
        assert all(text != _MSG2 for text in posted), (
            f"msg2 was POSTed instead of queued -- strip is not the queue: {posted}"
        )

        # The composer stack this strip must dock onto: the card (and the
        # workspace-controls bar above it) inside the same composer form.
        form = page.locator("form.chat-composer-form").filter(
            has=page.get_by_test_id("composer-queued-strip")
        )
        card = form.locator("[data-composer-card]")
        expect(card).to_be_visible()

        # Linger so the docked-strip state -- the layout under test -- is
        # plainly visible in journey recordings before assertions run.
        page.wait_for_timeout(1_500)

        strip_box = strip.bounding_box()
        card_box = card.bounding_box()
        assert strip_box is not None, "queued strip has no bounding box"
        assert card_box is not None, "composer card has no bounding box"
        assert strip_box["y"] < card_box["y"], "queued strip should render above the composer card"

        strip_bottom = strip_box["y"] + strip_box["height"]
        gap = card_box["y"] - strip_bottom

        assert gap <= _EPSILON, (
            f"Queued messages must dock directly onto the composer card; gap={gap:.1f}px"
        )
        assert card_box["x"] <= strip_box["x"]
        assert strip_box["x"] + strip_box["width"] <= card_box["x"] + card_box["width"]
        assert page.locator(".composer-workspace-surface").count() == 0
    finally:
        context.close()
