import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionChecked = false;
let hasPermission = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return hasPermission;
  try {
    hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      const result = await requestPermission();
      hasPermission = result === "granted";
    }
  } catch {
    hasPermission = false;
  }
  permissionChecked = true;
  return hasPermission;
}

export async function notifyRunComplete(
  pipelineName: string,
  status: string,
): Promise<void> {
  if (document.hasFocus()) return;
  if (!(await ensurePermission())) return;

  const statusEmoji = status === "success" ? "✓" : status === "failed" ? "✗" : "■";
  sendNotification({
    title: `Pipeline ${status}`,
    body: `${statusEmoji} ${pipelineName} — ${status}`,
  });
}

export async function notifyApprovalNeeded(nodeName: string): Promise<void> {
  if (document.hasFocus()) return;
  if (!(await ensurePermission())) return;

  sendNotification({
    title: "Approval Required",
    body: `Pipeline is waiting for approval: ${nodeName}`,
  });
}
