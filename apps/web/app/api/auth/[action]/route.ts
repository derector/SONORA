import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const ALLOWED_ACTIONS = new Set(["register", "login", "verify", "refresh", "logout"]);

type RouteContext = {
  params: Promise<{ action: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { action } = await context.params;

  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown authentication action." }, { status: 404 });
  }
  if (!API_ORIGIN) {
    return NextResponse.json({ error: "Authentication service is not configured." }, { status: 503 });
  }

  try {
    const headers = new Headers({ Accept: "application/json" });
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);

    // The browser stores this cookie on the SONORA web origin. Forward only
    // the refresh cookie to the API, never the browser's unrelated cookies.
    const refreshToken = request.cookies.get("sonora_refresh")?.value;
    if (refreshToken) headers.set("Cookie", `sonora_refresh=${refreshToken}`);

    // Logout still needs its short-lived access token for the API's sign-out.
    const authorization = request.headers.get("authorization");
    if (authorization) headers.set("Authorization", authorization);

    const body = action === "refresh" ? undefined : await request.text();
    const upstream = await fetch(`${API_ORIGIN}/api/v1/auth/${action}`, {
      method: "POST",
      headers,
      body: body || undefined,
      cache: "no-store",
      redirect: "error"
    });

    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store"
    });

    // Re-scope the API's host-only HttpOnly cookie to the first-party web
    // origin and this proxy path. Keep Secure, HttpOnly, SameSite and expiry.
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) {
      const firstPartyCookie = setCookie.replace(
        /;\\s*Path=\\/api\\/v1\\/auth(?=;|$)/i,
        "; Path=/api/auth"
      );
      responseHeaders.append("Set-Cookie", firstPartyCookie);
    }

    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: responseHeaders
    });
  } catch {
    return NextResponse.json(
      { error: "Authentication service is temporarily unavailable." },
      { status: 502 }
    );
  }
}
