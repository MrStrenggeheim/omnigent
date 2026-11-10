"""Browser-only pointer contracts for the composer configuration tooltip."""

import pytest
from playwright.sync_api import Page, expect

from tests.browser_ui.chat.session_contract import model_option

# Tooltip surface properties the host chip shares with the model pill.
_SURFACE_STYLE = """el => {
  const s = getComputedStyle(el);
  return [s.backgroundColor, s.color, s.fontSize, s.padding, s.borderRadius, s.boxShadow];
}"""


@pytest.mark.parametrize("turns", [0, 1], ids=["new-session", "existing-session"])
def test_pill_uses_one_tooltip_and_suppresses_it_while_picker_is_open(
    page: Page, chat_session_contract, turns: int
) -> None:
    chat_session_contract.seed_transcript(turns)
    chat_session_contract.set_catalog(
        harness="claude-native",
        models=[
            {
                "id": "sonnet",
                "model": "system.ai.claude-sonnet-5",
                "displayName": "Sonnet 5",
                "isDefault": True,
                "source": {
                    "kind": "databricks",
                    "label": "Workspace",
                    "name": "oss",
                    "host": "ws.example.com",
                },
            }
        ],
        selected_model="sonnet",
    )
    page.goto(chat_session_contract.url)
    if turns:
        expect(page.get_by_text("Request 1", exact=False)).to_be_visible()

    pill = page.get_by_test_id("composer-config-gear")
    expect(pill).to_be_visible()
    tooltip = page.get_by_test_id("composer-config-gear-tooltip")
    picker = page.get_by_test_id("composer-agent-menu")

    pill.hover()
    page.wait_for_timeout(100)
    pill.click()
    expect(picker).to_be_visible()
    page.wait_for_timeout(1_000)
    expect(picker).to_be_visible()
    expect(page.locator('[data-slot="tooltip-content"]')).to_have_count(0)

    page.keyboard.press("Escape")
    expect(picker).not_to_be_visible()
    expect(tooltip).not_to_be_visible()

    page.mouse.move(0, 0)
    pill.hover()
    expect(tooltip).to_be_visible()
    expect(page.locator('[data-slot="tooltip-content"]')).to_have_count(1)
    expect(tooltip).to_contain_text("Harness: Claude")
    expect(tooltip).to_contain_text("Model: Default")
    expect(tooltip).to_contain_text("Connection: Databricks · oss")

    pill.click()
    expect(picker).to_be_visible()
    expect(tooltip).not_to_be_visible()
    expect(page.locator('[data-slot="tooltip-content"]')).to_have_count(0)

    page.keyboard.press("Escape")
    expect(picker).not_to_be_visible()
    expect(tooltip).not_to_be_visible()

    page.mouse.move(0, 0)
    pill.hover()
    expect(tooltip).to_be_visible()


def test_host_chip_tooltip_names_the_host_and_matches_the_pill(
    page: Page, chat_session_contract
) -> None:
    # A configurable harness keeps the pill enabled so it can be hovered.
    chat_session_contract.set_catalog(
        harness="claude-native",
        models=[model_option("sonnet", is_default=True)],
        selected_model="sonnet",
    )
    page.goto(chat_session_contract.url)

    host = page.get_by_test_id("composer-host-select")
    expect(host).to_be_visible()
    assert host.get_attribute("title") is None
    host_tooltip = page.get_by_test_id("composer-host-tooltip")
    menu = page.get_by_test_id("composer-host-menu")

    host.hover()
    expect(host_tooltip).to_be_visible()
    expect(host_tooltip).to_contain_text("Host: Browser host")
    expect(host_tooltip).to_contain_text("Status: Connected")
    expect(page.locator('[data-slot="tooltip-content"]')).to_have_count(1)
    host_style = host_tooltip.evaluate(_SURFACE_STYLE)

    host.click()
    expect(menu).to_be_visible()
    expect(host_tooltip).not_to_be_visible()
    page.keyboard.press("Escape")
    expect(menu).not_to_be_visible()
    expect(host_tooltip).not_to_be_visible()

    page.mouse.move(0, 0)
    page.get_by_test_id("composer-config-gear").hover()
    pill_tooltip = page.get_by_test_id("composer-config-gear-tooltip")
    expect(pill_tooltip).to_be_visible()
    assert pill_tooltip.evaluate(_SURFACE_STYLE) == host_style


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_button_tooltips_share_white_surface_and_centered_gap(
    page: Page, chat_session_contract, theme: str
) -> None:
    page.emulate_media(color_scheme=theme)
    page.add_init_script(f"localStorage.setItem('web-theme', '{theme}')")
    chat_session_contract.set_catalog(
        harness="claude-native",
        models=[model_option("sonnet", is_default=True)],
        selected_model="sonnet",
    )
    page.goto(chat_session_contract.url)
    composer = page.get_by_label("Message the agent")
    expect(composer).to_be_visible()
    composer.fill("Keep this draft unsent.")
    triggers = [
        page.get_by_test_id("composer-config-gear"),
        page.get_by_test_id("composer-host-select"),
        page.get_by_role("button", name="Send", exact=True),
    ]
    styles = []
    for trigger in triggers:
        page.mouse.move(0, 0)
        trigger.hover()
        tooltip = page.locator('[data-slot="tooltip-content"]').filter(visible=True)
        expect(tooltip).to_have_count(1)
        expect(tooltip).to_have_css("background-color", "rgb(255, 255, 255)")
        assert trigger.get_attribute("title") is None
        expect(tooltip).to_have_attribute("data-align", "center")
        assert tooltip.get_attribute("data-side") in {"top", "bottom"}
        # Wait for the tooltip's opening scale animation before measuring its box.
        expect(tooltip).to_have_css("transform", "none")
        anchor = trigger.bounding_box()
        box = tooltip.bounding_box()
        assert anchor is not None and box is not None
        assert abs((anchor["x"] + anchor["width"] / 2) - (box["x"] + box["width"] / 2)) <= 1
        gap = (
            anchor["y"] - box["y"] - box["height"]
            if tooltip.get_attribute("data-side") == "top"
            else box["y"] - anchor["y"] - anchor["height"]
        )
        assert abs(gap - 8) <= 1, {"anchor": anchor, "tooltip": box}
        styles.append(tooltip.evaluate(_SURFACE_STYLE))
    assert styles[0] == styles[1] == styles[2]
    assert not chat_session_contract.event_posts
