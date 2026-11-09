"""Accent changes reach real chat surfaces without reintroducing response cards."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import Page, Route, expect

from tests.e2e_ui.chat.test_initial_history_loading import _seed_message


@pytest.mark.parametrize(
    "dark,mobile", [(False, False), (True, True)], ids=["desktop", "phone-dark"]
)
def test_chat_uses_selected_accent_and_flat_surfaces(
    page: Page,
    seeded_session: tuple[str, str],
    request: pytest.FixtureRequest,
    dark: bool,
    mobile: bool,
) -> None:
    base, session_id = seeded_session
    with httpx.Client(base_url=base, timeout=15) as client:
        _seed_message(
            client,
            session_id,
            response_id="design-user",
            role="user",
            text="Make the Explorer simpler and use our accent color consistently.",
        )
        _seed_message(
            client,
            session_id,
            response_id="design-answer",
            role="assistant",
            text=(
                "## A calmer workspace\n\nThe Explorer shares one toolbar. "
                "Buttons, selection and focus states use the same accent.\n\n"
                "```css\n:root {\n  --brand-accent: var(--primary);\n}\n```\n\n"
                "- One shared Explorer toolbar\n"
                "- Theme-aware Share and Send buttons\n\nReady for review."
            ),
        )

    # Expose sharing chrome in this single-user fixture; do not grant or mutate permissions.
    def show_share(route: Route) -> None:
        response = route.fetch()
        body = response.json()
        body["single_user"] = False
        route.fulfill(response=response, json=body)

    page.route("**/v1/info", show_share)
    if mobile:
        page.set_viewport_size({"width": 390, "height": 844})
    else:
        page.set_viewport_size({"width": 1440, "height": 960})
    page.emulate_media(color_scheme="dark" if dark else "light")
    config = {
        "basePalette": "github",
        "accent": "#0f8b83",
        "darkAccent": "#36c7bc",
        "tint": "#ffffff",
        "darkTint": "#14191b",
        "contrast": 50,
        "translucentSidebar": False,
    }
    page.add_init_script(
        f"""localStorage.setItem('omnigent:ui-theme-palette', JSON.stringify('custom'));
        localStorage.setItem('omnigent:custom-theme', JSON.stringify({json.dumps(config)}));"""
    )
    page.goto(f"{base}/c/{session_id}")
    assistant = page.locator('[data-testid="message-bubble"][data-role="assistant"]').first
    expect(assistant.get_by_role("heading", name="A calmer workspace")).to_be_visible(
        timeout=30_000
    )
    styles = page.evaluate("""() => {
      const root = getComputedStyle(document.documentElement);
      const normalized = (name) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      const assistant = document.querySelector(
        '[data-testid="message-bubble"][data-role="assistant"]');
      return { primary: normalized('--primary'), brand: normalized('--brand-accent'),
        ring: normalized('--ring'), sidebarPrimary: normalized('--sidebar-primary'),
        assistantBackground: getComputedStyle(assistant.firstElementChild).backgroundColor,
        semantic: ['--success','--warning','--destructive'].map(
          name => root.getPropertyValue(name).trim()) };
    }""")
    assert styles["brand"] == styles["ring"] == styles["sidebarPrimary"] == styles["primary"]
    assert styles["assistantBackground"] == "rgba(0, 0, 0, 0)"
    if not mobile:
        share = page.get_by_role("button", name="Share session", exact=True)
        expect(share).to_be_visible()
        assert (
            share.evaluate("element => getComputedStyle(element).backgroundColor")
            == styles["primary"]
        )
    # Typing keeps the composer's neutral frame instead of adding an accent outline.
    composer = page.locator("[data-composer-card]").last
    before_frame = composer.evaluate(
        """element => {
          const s=getComputedStyle(element);
          return [s.borderColor,s.outlineStyle,s.outlineWidth];
        }"""
    )
    composer.locator("textarea").fill("Focus should keep a quiet frame")
    after_frame = composer.evaluate(
        """element => {
          const s=getComputedStyle(element);
          return [s.borderColor,s.outlineStyle,s.outlineWidth];
        }"""
    )
    assert after_frame == before_frame
    output = Path(request.config.getoption("output"))
    page.screenshot(
        path=str(output / f"flat-chat-{'phone-dark' if mobile else 'desktop'}.png"),
        animations="disabled",
    )
    # Changing the accent preserves semantic status colors and changes decorative color.
    page.evaluate(
        """() => {
          const config=JSON.parse(localStorage.getItem('omnigent:custom-theme'));
          config.accent='#7c3aed'; config.darkAccent='#c4a0ff';
          localStorage.setItem('omnigent:custom-theme',JSON.stringify(config));
        }"""
    )
    page.reload()
    expect(assistant.get_by_role("heading", name="A calmer workspace")).to_be_visible(
        timeout=30_000
    )
    after = page.evaluate(
        """() => {
          const root=getComputedStyle(document.documentElement);
          return {primary:root.getPropertyValue('--primary').trim(),
            semantic:['--success','--warning','--destructive'].map(
              name=>root.getPropertyValue(name).trim())};
        }"""
    )
    assert after["semantic"] == styles["semantic"]
    assert after["primary"]
