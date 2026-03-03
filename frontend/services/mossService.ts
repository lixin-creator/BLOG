const API_BASE = import.meta.env.VITE_API_BASE || "/api";

const createAuthHeaders = (base?: HeadersInit) => {
  const headers = new Headers(base || {});
  if (typeof window === "undefined") return headers;
  try {
    const raw = window.localStorage.getItem("lx_current_user");
    if (!raw) return headers;
    const user = JSON.parse(raw);
    const username = String(user?.username || "").trim();
    const password = String(user?.password || "");
    if (!username || !password) return headers;
    headers.set("X-Auth-Username", username);
    headers.set("X-Auth-Password", password);
  } catch (_error) {
    // ignore invalid local cache
  }
  return headers;
};

export async function askMOSS(prompt: string): Promise<string> {
  try {
    const response = await fetch(`${API_BASE}/ai/moss`, {
      method: "POST",
      credentials: "include",
      headers: createAuthHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      if (response.status === 401) {
        return "MOSS：请先登录后再建立通讯链路。";
      }
      throw new Error(`MOSS failed: ${response.status}`);
    }

    const data = await response.json();
    return data?.text || "MOSS：无法获取计算结果，逻辑单元异常。";
  } catch (error) {
    console.error("MOSS Error:", error);
    return "MOSS：由于太阳风暴干扰，通讯模块暂时离线。";
  }
}
