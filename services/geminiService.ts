const ZHIPU_API_KEY = import.meta.env.VITE_ZHIPU_API_KEY as string | undefined;
const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

export async function generateExcerpt(title: string, content: string): Promise<string> {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
        "Authorization": `Bearer ${ZHIPU_API_KEY ?? ""}`
      },
      body: JSON.stringify({
        model: "glm-4",
        messages: [
          {
            role: "system",
            content: "你是摘要生成器。输出中文摘要，风格为赛博朋克，长度不超过50字。"
          },
          {
            role: "user",
            content: `请为这篇名为“${title}”的博客文章生成摘要：\n\n${content}`
          }
        ],
        stream: false
      })
    });

    const buffer = await response.arrayBuffer();
    const utf8Text = new TextDecoder("utf-8").decode(buffer);
    let data: any = null;
    try {
      data = JSON.parse(utf8Text);
    } catch {
      try {
        const gbkText = new TextDecoder("gbk").decode(buffer);
        data = JSON.parse(gbkText);
      } catch {
        data = null;
      }
    }

    if (!data) {
      throw new Error("Invalid JSON response");
    }

    return data?.choices?.[0]?.message?.content || "正在扫描频率... 暂无摘要。";
  } catch (error) {
    console.error("AI Error:", error);
    return "矩阵未能生成摘要。";
  }
}

export async function suggestTags(content: string): Promise<string[]> {
  return ["常规", "技术"];
}
