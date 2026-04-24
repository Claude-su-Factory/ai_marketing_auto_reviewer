import { describe, it, expect } from "vitest";
import { classifyMetaError } from "./monitor.js";

describe("classifyMetaError", () => {
  it("identifies externally-modified (404) errors", () => {
    const err = { response: { status: 404 } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("identifies externally-modified (403) errors", () => {
    const err = { response: { status: 403 } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("identifies via Meta error.code 100 (not-found) and 803 (does not exist)", () => {
    expect(classifyMetaError({ response: { data: { error: { code: 100 } } } })).toBe("externally_modified");
    expect(classifyMetaError({ response: { data: { error: { code: 803 } } } })).toBe("externally_modified");
  });
  it("identifies SDK FacebookRequestError with top-level status 404", () => {
    // facebook-nodejs-business-sdk flattens HTTP status to err.status, extracts body into err.response.
    const err = { status: 404, response: { code: 100, message: "(#100) Object does not exist" } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("identifies SDK FacebookRequestError with top-level status 403", () => {
    const err = { status: 403, response: { code: 200, message: "forbidden" } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("identifies SDK FacebookRequestError with response.code 803", () => {
    const err = { status: 400, response: { code: 803, message: "Some of the aliases you requested do not exist" } };
    expect(classifyMetaError(err)).toBe("externally_modified");
  });
  it("returns 'transient' for anything else", () => {
    expect(classifyMetaError(new Error("network fail"))).toBe("transient");
    expect(classifyMetaError({ response: { status: 500 } })).toBe("transient");
    expect(classifyMetaError({ status: 500, response: { code: 1, message: "internal" } })).toBe("transient");
  });
});
