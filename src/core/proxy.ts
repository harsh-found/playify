import { HlsInspector } from "./hls-inspector";

export class StreamProxy {
  private static BLOCKED_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "[::1]",
  ]);

  /**
   * Proxies stream playlist or media chunks, injecting necessary masqueraded headers,
   * SSRF protection, and optional M3U8 relative URL rewriting.
   */
  static async handleProxyRequest(req: Request): Promise<Response> {
    const urlObj = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const targetUrl = urlObj.searchParams.get("url");

    if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
      return new Response("Missing or invalid target url query parameter", {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    let parsedTarget: URL;
    try {
      parsedTarget = new URL(targetUrl);
      if (this.BLOCKED_HOSTS.has(parsedTarget.hostname.toLowerCase())) {
        return new Response("Disallowed internal target host", {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }
    } catch {
      return new Response("Malformed target url query parameter", {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const customHeaders: Record<string, string> = {
        "User-Agent":
          req.headers.get("x-target-user-agent") ||
          urlObj.searchParams.get("ua") ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "*/*",
      };

      const referer = req.headers.get("x-target-referer") || urlObj.searchParams.get("referer");
      if (referer) {
        customHeaders["Referer"] = referer;
      }

      const origin = req.headers.get("x-target-origin") || urlObj.searchParams.get("origin");
      if (origin) {
        customHeaders["Origin"] = origin;
      }

      const range = req.headers.get("range");
      if (range) {
        customHeaders["Range"] = range;
      }

      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 12000);

      const upstreamResp = await fetch(targetUrl, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers: customHeaders,
        signal: controller.signal,
      });

      // Create response headers with global CORS
      const respHeaders = new Headers(upstreamResp.headers);
      respHeaders.set("Access-Control-Allow-Origin", "*");
      respHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      respHeaders.set("Access-Control-Allow-Headers", "*");
      // Strip hop-by-hop & conflicting encoding headers
      respHeaders.delete("content-encoding");
      respHeaders.delete("content-security-policy");

      const shouldRewrite =
        urlObj.searchParams.get("rewrite") === "true" ||
        urlObj.searchParams.get("rewrite") === "1";

      if (
        shouldRewrite &&
        req.method === "GET" &&
        upstreamResp.ok &&
        (parsedTarget.pathname.endsWith(".m3u8") ||
          (upstreamResp.headers.get("content-type") || "").includes("mpegurl"))
      ) {
        const text = await upstreamResp.text();
        if (text.includes("#EXTM3U")) {
          const rewritten = text
            .split(/\r?\n/)
            .map((line) => {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith("#")) return line;
              const absUrl = HlsInspector.resolveUrl(trimmed, targetUrl);
              const refParam = referer ? `&referer=${encodeURIComponent(referer)}` : "";
              return `${urlObj.origin}/api/proxy?url=${encodeURIComponent(absUrl)}${refParam}&rewrite=true`;
            })
            .join("\n");
          respHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
          return new Response(rewritten, {
            status: upstreamResp.status,
            statusText: upstreamResp.statusText,
            headers: respHeaders,
          });
        }
        return new Response(text, {
          status: upstreamResp.status,
          statusText: upstreamResp.statusText,
          headers: respHeaders,
        });
      }

      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: respHeaders,
      });
    } catch (err: any) {
      return new Response(`Proxy Error: ${err.message || String(err)}`, {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
