/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  AVATAR_FILE_MAX_BYTES,
  getSiliconPersonAvatarBackground,
  isSupportedAvatarMimeType,
  readAvatarFileAsDataUrl,
  resolveSiliconPersonAvatarInitials,
} from "../src/renderer/utils/silicon-person-avatar";

describe("silicon person avatar utilities", () => {
  it("builds deterministic gradient avatars instead of flat color blocks", () => {
    const adaBackground = getSiliconPersonAvatarBackground({ id: "sp-ada", name: "Ada" });
    const adaBackgroundAgain = getSiliconPersonAvatarBackground({ id: "sp-ada", name: "Ada" });
    const linBackground = getSiliconPersonAvatarBackground({ id: "sp-lin", name: "Lin" });

    expect(adaBackground).toBe(adaBackgroundAgain);
    expect(adaBackground).not.toBe(linBackground);
    expect(adaBackground).toContain("linear-gradient");
    expect(adaBackground).toContain("radial-gradient");
  });

  it("resolves readable initials for English and Chinese names", () => {
    expect(resolveSiliconPersonAvatarInitials("Ada Lovelace")).toBe("AL");
    expect(resolveSiliconPersonAvatarInitials("林")).toBe("林");
    expect(resolveSiliconPersonAvatarInitials("")).toBe("?");
  });

  it("accepts common local image mime types", () => {
    expect(isSupportedAvatarMimeType("image/png")).toBe(true);
    expect(isSupportedAvatarMimeType("image/jpeg")).toBe(true);
    expect(isSupportedAvatarMimeType("image/webp")).toBe(true);
    expect(isSupportedAvatarMimeType("text/plain")).toBe(false);
  });

  it("reads a local avatar image as a data url", async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "ada.png", { type: "image/png" });

    await expect(readAvatarFileAsDataUrl(file)).resolves.toMatch(/^data:image\/png;base64,/);
  });

  it("rejects oversized local avatar images before storing them", async () => {
    const oversized = new File([new Uint8Array(AVATAR_FILE_MAX_BYTES + 1)], "huge.png", { type: "image/png" });

    await expect(readAvatarFileAsDataUrl(oversized)).rejects.toThrow("头像图片不能超过");
  });
});
