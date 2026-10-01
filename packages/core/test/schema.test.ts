import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schema/vehicle-definition.schema.json" with { type: "json" };
import { init } from "../src/index.js";

describe("JSON schema", () => {
  it("accepts the core default definition", async () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    const cp = await init();
    const d = cp.defaultDefinition();
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an unknown chassis field", () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    expect(validate({ chassis: { weight: 5 } })).toBe(false);
  });
});
