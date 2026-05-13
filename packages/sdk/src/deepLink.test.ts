import assert from "node:assert/strict";
import test from "node:test";
import { parseDeepLinkRequest, stripDeepLinkParams } from "./deepLink.js";

test("?rover_guide=1 alone produces a guide-flag request", () => {
    const result = parseDeepLinkRequest("https://example.com/?rover_guide=1");
    assert.equal(result?.kind, "guide-flag");
    assert.equal(result?.value, "1");
});

test("?rover_guide=false suppresses the guide-flag", () => {
    const result = parseDeepLinkRequest("https://example.com/?rover_guide=false");
    assert.equal(result, null);
});

test("?rover_guide=1 with a prompt annotates the prompt request with guideOverride", () => {
    const result = parseDeepLinkRequest("https://example.com/?rover=show%20me%20signup&rover_guide=1");
    assert.equal(result?.kind, "prompt");
    if (result?.kind === "prompt") {
        assert.equal(result.value, "show me signup");
        assert.equal(result.guideOverride, true);
        assert.match(result.signature, /:guide$/);
    }
});

test("?rover_guide=1 with a shortcut annotates the shortcut request with guideOverride", () => {
    const result = parseDeepLinkRequest("https://example.com/?rover_shortcut=signup_tour&rover_guide=1");
    assert.equal(result?.kind, "shortcut");
    if (result?.kind === "shortcut") {
        assert.equal(result.value, "signup_tour");
        assert.equal(result.guideOverride, true);
    }
});

test("?rover=<prompt> without guide flag has no guideOverride", () => {
    const result = parseDeepLinkRequest("https://example.com/?rover=extract%20pricing");
    assert.equal(result?.kind, "prompt");
    if (result?.kind === "prompt") {
        assert.equal(result.guideOverride, undefined);
    }
});

test("stripDeepLinkParams removes the guide param along with prompt/shortcut", () => {
    const stripped = stripDeepLinkParams("https://example.com/page?rover=hi&rover_guide=1&keep=yes");
    assert.equal(stripped.includes("rover_guide"), false);
    assert.equal(stripped.includes("rover="), false);
    assert.equal(stripped.includes("keep=yes"), true);
});

test("custom guideParam name is honored end-to-end", () => {
    const result = parseDeepLinkRequest(
        "https://example.com/?demo_mode=1",
        { guideParam: "demo_mode" },
    );
    assert.equal(result?.kind, "guide-flag");
    assert.equal(result?.paramName, "demo_mode");
});
