// Match *.ts.net over HTTP(S), including the service's :8443 and a trailing DNS dot.
// Installed on the context before any navigation, so new pages are covered too.
export async function guardTailnet(context) {
  const unexpected = [];
  await context.route(/^https?:\/\/[^/]+\.ts\.net\.?(?::\d+)?\//i, async (route) => {
    const request = route.request();
    unexpected.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.abort();
  });
  return () => {
    if (unexpected.length) throw new Error(`Unexpected request to Tailscale: ${unexpected.join(", ")}`);
  };
}
