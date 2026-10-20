import path from "node:path";
import { randomInt, randomBytes, timingSafeEqual } from "node:crypto";
import { PAIRING_WINDOW_MS, MAX_PAIRING_TRIES, isSafeId } from "./constants.mjs";
import { mkdir, readJson, removeFile, sha256, writeJson } from "./fsutil.mjs";
import { fail, isObject } from "./validate.mjs";

function equalHash(input, hash) {
  return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash) &&
    timingSafeEqual(Buffer.from(sha256(input), "hex"), Buffer.from(hash, "hex"));
}
export function createPairing(configDir, now = () => new Date()) {
  const windowFile = path.join(configDir, "pairing.json");
  const deviceFile = path.join(configDir, "device.json");
  return {
    async openWindow() {
      await mkdir(configDir);
      const code = String(randomInt(1000000)).padStart(6, "0");
      const expiresAt = new Date(new Date(now()).getTime() + PAIRING_WINDOW_MS).toISOString();
      await writeJson(windowFile, { codeSha256: sha256(code), expiresAt, tries: 0 });
      return { code, expiresAt };
    },
    async device() { return readJson(deviceFile, null); },
    async pair(body) {
      if (!isObject(body) || typeof body.code !== "string" || !isSafeId(body.label)) fail(400, "invalid-pair");
      const window = await readJson(windowFile, null);
      if (!window || Date.parse(window.expiresAt) <= new Date(now()).getTime()) {
        if (window) await removeFile(windowFile);
        fail(403, "no-pairing");
      }
      if (!/^\d{6}$/.test(body.code) || !equalHash(body.code, window.codeSha256)) {
        window.tries++;
        if (window.tries >= MAX_PAIRING_TRIES) await removeFile(windowFile);
        else await writeJson(windowFile, window);
        fail(403, "wrong-code");
      }
      const token = randomBytes(32).toString("base64url");
      // Consume before installing a token: a crash must never make a code reusable.
      await removeFile(windowFile);
      await writeJson(deviceFile, { tokenSha256: sha256(token), pairedAt: new Date(now()).toISOString(),
        label: body.label, firstPushPending: true });
      return { token };
    },
    async unpair() {
      await removeFile(deviceFile);
      await removeFile(windowFile);
    },
    async checkToken(header) {
      if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return false;
      const device = await this.device();
      return device !== null && equalHash(header.slice(7), device.tokenSha256);
    },
    async completeFirstPush(tokenSha256) {
      const device = await this.device();
      // Recovery must not clear a newer pairing made while the service was stopped.
      if (device?.tokenSha256 === tokenSha256 && device.firstPushPending) {
        await writeJson(deviceFile, { ...device, firstPushPending: false });
      }
    },
  };
}
