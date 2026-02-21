import { check } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  available: boolean;
  version: string;
  body: string;
}

let cachedUpdate: Awaited<ReturnType<typeof check>> | null = null;

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const update = await check();
    if (update) {
      cachedUpdate = update;
      return {
        available: true,
        version: update.version,
        body: update.body ?? "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function installUpdate(): Promise<void> {
  if (!cachedUpdate) {
    const update = await check();
    if (!update) throw new Error("No update available");
    cachedUpdate = update;
  }
  await cachedUpdate.downloadAndInstall();
}
