import { describe, it, expect } from "vitest";
import { transformCjsToEsm } from "../src";


const trimSpaces = (str) => {
  return str.split("\n").map((line) => line.trim()).join("\n").trim();
}


describe("cjs -> esm", () => {
  it("one identifier", () => {
    const cjs = 'const fs = require("node:fs");'
    const esm = 'import fs from "node:fs";'
    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm));
  });

  it("multi identifier", () => {
    const cjs = `
      let name, 
        fs = require("node:fs"), 
        { resolve, relative: rel } = require('node:path'),
        { test } = require('./static-object-pattern');
   `
    const esm = `
      import fs from "node:fs";
      import { resolve, relative as rel } from "node:path";
      import { test } from "./static-object-pattern";
      let name;
    `
    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm));
  });

  it('object pattern', () => {
    const cjs = `const { readFile, readFileSync: rfs } = require("node:fs");`
    const esm = `import { readFile, readFileSync as rfs } from "node:fs";`
    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm))
  })

  it('one identifier member expression', () => {
    const cjs = `
      const a  = require("../routers/proxy-router").a;
      const B = require("../routers/proxy-router").b;
    `
    const esm = `
      import { a } from "../routers/proxy-router";
      import { b as B } from "../routers/proxy-router";
    `
    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm))
  })
  
  it('multi identifier member expression', () => {
    const cjs = `
      let age,
        { readFileSync } = require('node:fs').readFileSync,
        { readFile: rf } = require('node:fs').readFile;
    `
    const esm = `
      import { readFileSync } from "node:fs";
      import { readFile as rf } from "node:fs";
      let age;
    `
    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm))
  })

  it('will polyfill __dirname __filename', () => {
    const cjsWith__dirname = `
      console.log(__dirname);
    `
    const esmWith__dirname = `
      import { fileURLToPath } from "node:url";
      import { dirname } from "node:path";
      const __dirname = dirname(fileURLToPath(import.meta.url));
      console.log(__dirname);
    `
    expect(trimSpaces(transformCjsToEsm(cjsWith__dirname))).toBe(trimSpaces(esmWith__dirname))

    const cjsWith__filename = `
      console.log(__filename);
    `
    const esmWith__filename = `
      import { fileURLToPath } from "node:url";
      const __filename = fileURLToPath(import.meta.url);
      console.log(__filename);
    `
    expect(trimSpaces(transformCjsToEsm(cjsWith__filename))).toBe(trimSpaces(esmWith__filename))

    const cjsWith__dirname__filename = `
      console.log(__dirname, __filename);
    `
    const esmWith__dirname__filename = `
      import { fileURLToPath } from "node:url";
      import { dirname } from "node:path";
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const __filename = fileURLToPath(import.meta.url);
      console.log(__dirname, __filename);
    `
    expect(trimSpaces(transformCjsToEsm(cjsWith__dirname__filename))).toBe(trimSpaces(esmWith__dirname__filename))

    const cjs = `
      const fileURLToPath = ""
      const dirname = ""
      console.log(__dirname, __filename);
    `
    const esm = `
      import { fileURLToPath as $$fileURLToPath } from "node:url";
      import { dirname as $$dirname } from "node:path";
      const __dirname = $$dirname($$fileURLToPath(import.meta.url));
      const __filename = $$fileURLToPath(import.meta.url);
      const fileURLToPath = "";
      const dirname = "";
      console.log(__dirname, __filename);
    `

    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm))
  })

  it("", () => {
    const cjs = `const pkgA = require("packageA")({ name: 1 })`
    const esm = `
      import pkgAFactory from "packageA";
      const pkgA = pkgAFactory({ 
        name: 1 
      });
    `

    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm))
  })

  it.skip('dynamic will skip translate', () => {
    const cjs = `
      const requirePath = "../routers/proxy-router";
      const path = require(requirePath)
      function foo() {
        require("path")
      }
      if (true) {
        require("path");
      }
    `
    const esm = `
      const requirePath = "../routers/proxy-router";
        /* [dynamic require] */
      const path = require(requirePath);
      function foo() {
        /* [dynamic require] */
        require("path");
      }
      if (true) {
        /* [dynamic require] */
        require("path");
      }
    `
    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm))
  })

  it.only("", () => {
    const cjs = `
      const age = ""
      const a = ""
      const b = "11"
      module.exports = {
        age,
        a: b
      }
    `
    const esm = `
      const age = "";
      const a = ""
      const b = "11"

      export { age, b as a  };
      export default {
        age
      };
    `

    expect(trimSpaces(transformCjsToEsm(cjs))).toBe(trimSpaces(esm))
  })


});
