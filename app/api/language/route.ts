// Native form fallback for the first click before React has attached its handlers.
export async function POST(request: Request) {
  const url = new URL(request.url), origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") return new Response(null,{status:403});
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded") return new Response(null,{status:415});
  if (Number(request.headers.get("Content-Length") || 0) > 256) return new Response(null,{status:413});
  const raw = await request.text();
  if (raw.length > 256) return new Response(null,{status:413});
  const fields = new URLSearchParams(raw), locale = fields.get("locale");
  if (locale !== "en" && locale !== "ru") return new Response(null,{status:400});
  const page = fields.get("page") || "/";
  const location = page === "/kinogo-extension" || /^\/room\/[a-z0-9]{12}$/.test(page) ? page : "/";
  return new Response(null,{status:303,headers:{
    Location:location,"Cache-Control":"no-store",
    "Set-Cookie":`tt-lang=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${url.protocol === "https:" ? "; Secure" : ""}`,
  }});
}
