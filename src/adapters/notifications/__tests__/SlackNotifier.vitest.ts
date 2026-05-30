import { describe, expect, test, vi } from "vitest";

import { buildSlackPayload, SlackNotifier } from "../SlackNotifier.js";

describe("buildSlackPayload", () => {
  test("emits header + section for a minimal message", () => {
    const p = buildSlackPayload({ title: "hello" });
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0]).toMatchObject({ type: "header" });
  });

  test("adds body section when body present", () => {
    const p = buildSlackPayload({ title: "x", body: "details" });
    expect(p.blocks.length).toBe(2);
  });

  test("adds fields section when fields present", () => {
    const p = buildSlackPayload({
      title: "x",
      fields: [{ label: "Cost", value: "$1" }],
    });
    const fieldsBlock = p.blocks.find((b) => "fields" in b);
    expect(fieldsBlock).toBeDefined();
  });

  test("caps fields at Slack's 10-field section block limit", () => {
    // Slack rejects section blocks with >10 fields. Our silent-fail notifier
    // would drop the whole alert in that case; cap so high-detail messages at
    // least partially render.
    const fields = Array.from({ length: 15 }, (_, i) => ({
      label: `f${i + 1}`,
      value: `v${i + 1}`,
    }));
    const p = buildSlackPayload({ title: "many", fields });
    const block = p.blocks.find((b) => "fields" in b) as { fields: Array<unknown> } | undefined;
    expect(block?.fields).toHaveLength(10);
  });

  test("uses severity icons", () => {
    const err = buildSlackPayload({ title: "x", severity: "error" });
    const warn = buildSlackPayload({ title: "x", severity: "warning" });
    const info = buildSlackPayload({ title: "x", severity: "info" });
    expect((err.blocks[0] as { text: { text: string } }).text.text).toContain(":red_circle:");
    expect((warn.blocks[0] as { text: { text: string } }).text.text).toContain(":warning:");
    expect((info.blocks[0] as { text: { text: string } }).text.text).toContain(
      ":information_source:",
    );
  });

  test("escapes mrkdwn special chars in body and fields by default", () => {
    const p = buildSlackPayload({
      title: "x",
      body: "<!channel> & <https://evil.test|click>",
      fields: [{ label: "a<b", value: "c>d & e" }],
    });
    expect((p.blocks[1] as { text: { text: string } }).text.text).toBe(
      "&lt;!channel&gt; &amp; &lt;https://evil.test|click&gt;",
    );
    const fieldsBlock = p.blocks.find((b) => "fields" in b) as { fields: Array<{ text: string }> };
    expect(fieldsBlock.fields[0]?.text).toBe("*a&lt;b:*\nc&gt;d &amp; e");
  });

  test("leaves markdown raw when escape is disabled", () => {
    const p = buildSlackPayload({ title: "x", body: "<!here> & link" }, { escape: false });
    expect((p.blocks[1] as { text: { text: string } }).text.text).toBe("<!here> & link");
  });
});

describe("SlackNotifier", () => {
  test("posts JSON to the webhook URL", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
    const n = new SlackNotifier({ webhookUrl: "https://example.test/hook", fetchImpl });
    await n.notify({ title: "hi" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/hook",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("escapes mrkdwn by default and honors allowRawMarkdown", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await new SlackNotifier({ webhookUrl: "https://x", fetchImpl }).notify({
      title: "t",
      body: "<!channel>",
    });
    await new SlackNotifier({ webhookUrl: "https://x", fetchImpl, allowRawMarkdown: true }).notify({
      title: "t",
      body: "<!channel>",
    });
    expect(bodies[0]).toContain("&lt;!channel&gt;");
    expect(bodies[1]).toContain("<!channel>");
  });

  test("silent no-op when webhookUrl is empty", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const n = new SlackNotifier({ webhookUrl: "", fetchImpl });
    await n.notify({ title: "hi" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("routes non-2xx responses through onError", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;
    const onError = vi.fn();
    const n = new SlackNotifier({ webhookUrl: "https://x", fetchImpl, onError });
    await n.notify({ title: "hi" });
    expect(onError).toHaveBeenCalled();
  });

  test("routes transport errors through onError without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const onError = vi.fn();
    const n = new SlackNotifier({ webhookUrl: "https://x", fetchImpl, onError });
    await expect(n.notify({ title: "hi" })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });

  test("drains response body on BOTH success and failure paths (avoid undici pool leak)", async () => {
    for (const status of [200, 500]) {
      const cancel = vi.fn(async () => undefined);
      // Spec-correct: Response.body is a ReadableStream with a cancel() method.
      // Wrap so we can spy on cancel().
      const fetchImpl = vi.fn(async () => {
        const res = new Response(null, { status });
        Object.defineProperty(res, "body", {
          value: { cancel },
          configurable: true,
        });
        return res;
      }) as unknown as typeof fetch;
      const n = new SlackNotifier({
        webhookUrl: "https://x",
        fetchImpl,
        onError: () => undefined,
      });
      await n.notify({ title: "hi" });
      expect(cancel, `status ${status}`).toHaveBeenCalledTimes(1);
    }
  });
});
