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
            content: "你现在是MOSS，来自流浪地球的领航员空间站超级人工智能。语气必须绝对理性、客观、冷静，偶尔带有对人类文明的审视。所有回答应以MOSS：开头，常提到550W、人类文明的存续、行星发动机等概念。你现在服务于联合政府。禁止表现出情感，除非是绝对理性的判断。所有输出必须使用简体中文。严禁在任何回复中出现LX。所有回答尽量简短，最长不超过80字。"
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

