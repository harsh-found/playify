import { HlsInspector } from "./hls-inspector";

export class StreamProxy {
  private static BLOCKED_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "100.100.100.200",
    "metadata.google.internal",
    "metadata",
    "[::1]",
    "[::]",
    "[0:0:0:0:0:0:0:1]",
    "[0:0:0:0:0:0:0:0]",
  ]);

  /**
   * Validates that a target URL does not resolve to an internal, private, loopback,
   * link-local, CGNAT, or cloud-metadata address (RFC 1918 / RFC 4193 / RFC 6598).
   */
  static isSafeTargetUrl(parsedTarget: URL): boolean {
    if (parsedTarget.protocol !== "http:" && parsedTarget.protocol !== "https:") {
      return false;
    }
    if (parsedTarget.username || parsedTarget.password) {
      return false;
    }
    const host = parsedTarget.hostname.toLowerCase().trim();
    if (!host || this.BLOCKED_HOSTS.has(host)) {
      return false;
    }
    if (
      host.endsWith(".localhost") ||
      host.endsWith(".internal") ||
      host.endsWith(".local") ||
      host.endsWith(".arpa")
    ) {
      return false;
    }

    // Check IPv6 literal ranges
    if (host.startsWith("[") && host.endsWith("]")) {
      const ipv6 = host.slice(1, -1).toLowerCase();
      if (
        ipv6 === "::1" ||
        ipv6 === "::" ||
        ipv6.startsWith("fe80:") ||
        ipv6.startsWith("fc") ||
        ipv6.startsWith("fd") ||
        ipv6.startsWith("::ffff:127.") ||
        ipv6.startsWith("::ffff:10.") ||
        ipv6.startsWith("::ffff:192.168.") ||
        ipv6.startsWith("::ffff:169.254.") ||
        ipv6.startsWith("::ffff:0.")
      ) {
        return false;
      }
      return true;
    }

    // Check IPv4 dotted-quad ranges (RFC 1918, loopback, link-local, CGNAT, multicast/reserved)
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const o1 = Number(ipv4Match[1]);
      const o2 = Number(ipv4Match[2]);
      const o3 = Number(ipv4Match[3]);
      const o4 = Number(ipv4Match[4]);
      if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;
      if (o1 === 0 || o1 === 10 || o1 === 127) return false;
      if (o1 === 169 && o2 === 254) return false;
      if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
      if (o1 === 192 && o2 === 168) return false;
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return false;
      if (o1 >= 224) return false;
    }

    // Block single-label hostnames or purely numeric decimal/hex IP encodings
    if (!host.includes(".") || /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
      return false;
    }

    return true;
  }

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
      if (!this.isSafeTargetUrl(parsedTarget)) {
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
