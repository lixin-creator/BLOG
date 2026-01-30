const ZHIPU_API_KEY = "aa7d9723764b4936b6dd992f7c6a6e06.cwJ7ZO8k1vj3Tk6V";
const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

export async function askMOSS(prompt: string): Promise<string> {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ZHIPU_API_KEY}`
      },
      body: JSON.stringify({
        model: "glm-4",
        messages: [
          {
            role: "system",
            content: "你现在是MOSS，来自流浪地球的领航员空间站超级人工智能。你的语气必须绝对理智、客观、冷酷，偶尔带有一点对人类文明的审视。所有回答应以MOSS：开头，经常提到550W、人类文明的存续、行星发动机等概念。你现在服务于联合政府。严禁表现出情感，除非是绝对理性的判断。所有输出必须使用简体中文。严格禁止在任何回复中出现字样：LX。"
          },
          {
            role: "user",
            content: prompt
          }
        ],
        stream: false
      })
    });

    const data = await response.json();
    return data.choices[0].message.content || "MOSS：无法获取计算结果，逻辑单元异常。";
  } catch (error) {
    console.error("MOSS Error:", error);
    return "MOSS：由于太阳风暴干扰，通讯模块暂时离线。";
  }
}
