"""Browser geometry for the left navigation's shared content insets."""

import json
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect


@pytest.mark.parametrize("width", [1280, 390], ids=["desktop", "phone"])
def test_sidebar_keeps_balanced_content_insets(
    page: Page,
    chat_session_contract,
    width: int,
    browser_name: str,
    request: pytest.FixtureRequest,
) -> None:
    page.set_viewport_size({"width": width, "height": 844})
    chat_session_contract.seed_transcript(1)
    page.goto(chat_session_contract.url)
    sidebar = page.get_by_role("complementary", name="Conversations", include_hidden=True)
    if width < 768:
        page.get_by_role("button", name="Open sidebar", exact=True).click()
    expect(sidebar).to_be_visible()
    expect(sidebar).to_have_attribute("aria-hidden", "false")
    expect(sidebar).to_have_css("translate", "0px")
    nav = sidebar.locator("nav").first
    expect(nav).to_be_visible()
    metrics = sidebar.evaluate(
        """el => {
            const metrics = node => {
                const box = node.getBoundingClientRect();
                const css = getComputedStyle(node);
                return {x:box.x,width:box.width,paddingLeft:css.paddingLeft,
                    paddingRight:css.paddingRight,gap:css.gap,display:css.display,
                    boxSizing:css.boxSizing,overflowX:css.overflowX};
            };
            const ancestors=[];
            for(let node=el;node;node=node.parentElement) {
                const box=node.getBoundingClientRect(),css=getComputedStyle(node);
                ancestors.push({tag:node.tagName,cls:node.className,x:box.x,width:box.width,
                    scrollLeft:node.scrollLeft,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,
                    transform:css.transform,translate:css.translate,overflowX:css.overflowX});
            }
            return {windowScrollX:window.scrollX,ancestors,aside:metrics(el),
                nav:metrics(el.querySelector('nav')),
                header:metrics(el.querySelector('.sidebar-header-row')),
                links:[...el.querySelectorAll('nav a')].slice(0,5).map(metrics)};
        }"""
    )
    output = Path(request.config.getoption("output"))
    output.mkdir(parents=True, exist_ok=True)
    (output / f"sidebar-{browser_name}-{width}.json").write_text(json.dumps(metrics, indent=2))
    page.screenshot(
        path=str(output / f"sidebar-{browser_name}-{width}.png"), animations="disabled"
    )
    assert metrics["nav"]["paddingLeft"] == metrics["nav"]["paddingRight"] == "8px", metrics
    assert metrics["nav"]["x"] >= metrics["aside"]["x"], metrics
    assert abs(metrics["aside"]["x"]) <= 0.5, metrics
    assert all(
        item["scrollLeft"] == 0 for item in metrics["ancestors"] if item["tag"] in {"HTML", "BODY"}
    ), metrics
