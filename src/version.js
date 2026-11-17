// Only the version, not the whole package.json: a default import ships every script and
// dependency line in the app bundle, so a change to any of them re-published the app and
// offered the phone an update that changed nothing (2026-11-16).
import { version } from "../package.json";

export const SCHEMA_VERSION = 6;
export const APP_VERSION = version;
