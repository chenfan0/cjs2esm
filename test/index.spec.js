import path from "node:path";
import fs from "node:fs";

import { describe, it, expect } from "vitest";
import { transformCjsToEsm } from "../src";

const dirname = import.meta.dirname;

describe("cjs -> esm", () => {
  it("static-one-identifier", () => {
    const cjsPath = path.resolve(dirname, "./cjs/static-one-identifier.js");
    expect(transformCjsToEsm(cjsPath)).matchSnapshot();
  });

  it("static-multi-identifier", () => {
    const cjsPath = path.resolve(dirname, "./cjs/static-multi-identifier.js");
    expect(transformCjsToEsm(cjsPath)).toMatchSnapshot();
  });

  it('static-object-pattern', () => {
    const cjsPath = path.resolve(dirname, './cjs/static-object-pattern.js')
    expect(transformCjsToEsm(cjsPath)).toMatchSnapshot()
  })

  it('static-require-path-complete', () => {
    const cjsPath = path.resolve(dirname, './cjs/static-require-path-complete.js')
    expect(transformCjsToEsm(cjsPath)).toMatchSnapshot()
  })

});
