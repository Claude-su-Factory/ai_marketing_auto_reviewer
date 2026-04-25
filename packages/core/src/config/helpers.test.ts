import { describe, it, expect } from "vitest";
import {
  requireMeta,
  requireAnthropicKey,
  requireGoogleAiKey,
  requireVoyageKey,
  requireStripeConfig,
} from "./helpers.js";
import { makeTestConfig } from "./testing.js";

describe("config helpers", () => {
  it("requireMeta returns meta when present", () => {
    expect(requireMeta(makeTestConfig()).access_token).toBe("test-meta-token");
  });

  it("requireMeta throws when meta omitted", () => {
    expect(() => requireMeta(makeTestConfig({}, ["platforms.meta"]))).toThrow(/platforms\.meta/);
  });

  it("requireAnthropicKey returns key", () => {
    expect(requireAnthropicKey(makeTestConfig())).toBe("test-anthropic-key");
  });

  it("requireAnthropicKey throws when omitted", () => {
    expect(() => requireAnthropicKey(makeTestConfig({}, ["ai.anthropic"]))).toThrow(
      /ai\.anthropic\.api_key/
    );
  });

  it("requireGoogleAiKey returns key", () => {
    expect(requireGoogleAiKey(makeTestConfig())).toBe("test-google-key");
  });

  it("requireGoogleAiKey throws when omitted", () => {
    expect(() => requireGoogleAiKey(makeTestConfig({}, ["ai.google"]))).toThrow(
      /ai\.google\.api_key/
    );
  });

  it("requireVoyageKey returns key", () => {
    expect(requireVoyageKey(makeTestConfig())).toBe("test-voyage-key");
  });

  it("requireVoyageKey throws when omitted", () => {
    expect(() => requireVoyageKey(makeTestConfig({}, ["ai.voyage"]))).toThrow(
      /ai\.voyage\.api_key/
    );
  });

  it("requireStripeConfig returns stripe when present", () => {
    expect(requireStripeConfig(makeTestConfig()).secret_key).toBe("sk_test_xxx");
  });

  it("requireStripeConfig throws when billing omitted", () => {
    expect(() => requireStripeConfig(makeTestConfig({}, ["billing"]))).toThrow(/billing\.stripe/);
  });
});
