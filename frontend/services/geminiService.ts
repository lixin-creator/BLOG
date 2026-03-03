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

export async function generateExcerpt(title: string, content: string): Promise<string> {
  try {
    const response = await fetch(`${API_BASE}/ai/excerpt`, {
      method: "POST",
      credentials: "include",
      headers: createAuthHeaders({
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json"
      }),
      body: JSON.stringify({ title, content })
    });

    if (!response.ok) {
      throw new Error(`Excerpt failed: ${response.status}`);
    }

    const data = await response.json();
    return data?.excerpt || "正在扫描频率... 暂无摘要。";
  } catch (error) {
    console.error("AI Error:", error);
    return "矩阵未能生成摘要。";
  }
}

export async function suggestTags(_content: string): Promise<string[]> {
  return ["常规", "技术"];
}
