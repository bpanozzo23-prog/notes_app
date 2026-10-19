const labels = { idle: "Saved", pending: "Saving…", saving: "Saving…", error: "Not saved" };

export function saveStatusLabel(status) {
  return labels[status];
}
