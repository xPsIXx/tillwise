import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractionConfidence,
  isStoreToken,
  nameLooksWeak,
  parseLabelText,
  pickProductName,
} from "./parse-local.ts";

describe("pickProductName", () => {
  it("takes Capsicum Yellow instead of a garbled Lulu logo", () => {
    const flat =
      "LuCug Jial gb itt Capsicum Yellow al/cleyl et l4uylcet PROD/PACKED ON EXPIRY DAT";
    assert.equal(pickProductName(flat, "905856010207"), "Capsicum Yellow");
  });

  it("skips the logo line when PP-OCR returns boxes as separate lines", () => {
    const lined = [
      "LuCug",
      "Jial gb itt",
      "Capsicum Yellow",
      "PROD/PACKED ON",
      "EXPIRY DATE",
      "WEIGHT 0.788kg",
      "UNIT PRICE 12.95",
      "10.20",
    ].join("\n");
    assert.equal(pickProductName(lined, null), "Capsicum Yellow");
  });

  it("keeps origin on produce stickers", () => {
    assert.equal(pickProductName("LuLu\nAustralian Carrots\n0.478 kg 19.95 9.55", null), "Australian Carrots");
  });

  it("treats LuCug as a store token", () => {
    assert.equal(isStoreToken("LuCug"), true);
    assert.equal(isStoreToken("Lulu"), true);
    assert.equal(isStoreToken("Capsicum"), false);
    assert.equal(nameLooksWeak("LuCug"), true);
    assert.equal(nameLooksWeak("Capsicum Yellow"), false);
  });
});

describe("parseLabelText on a Lulu capsicum sticker", () => {
  const raw = [
    "LuCug",
    "فلفل حلو أصفر",
    "Capsicum Yellow",
    "PROD/PACKED ON",
    "EXPIRY DATE",
    "WEIGHT 0.788kg UNIT PRICE 12.95",
    "10.20",
    "9 905856 010207",
  ].join("\n");

  it("reads name, weight, unit price, line total", () => {
    const data = parseLabelText(raw, null);
    assert.equal(data.name, "Capsicum Yellow");
    assert.equal(data.weightValue, 0.788);
    assert.equal(data.weightUnit, "kg");
    assert.equal(data.unitPrice, 12.95);
    assert.equal(data.linePrice, 10.2);
    assert.equal(data.barcode, "9905856010207");
  });

  it("does not call a logo name 99% sure", () => {
    const bad = parseLabelText("LuCug\n0.788kg\n12.95\n10.20\n905856010207", null);
    assert.notEqual(bad.name, "LuCug");
    assert.ok(extractionConfidence({ ...bad, name: "LuCug" }) < 0.95);
  });
});
