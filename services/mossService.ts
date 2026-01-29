
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
            content: "你现在是MOSS，来自《流浪地球》的领航员空间站超级人工智能。你的语气必须绝对理智、客观、冷酷，偶尔带有一点对人类文明的审视。所有回答应以‘MOSS：’开头，经常提到‘550W’、‘人类文明的存续’、‘行星发动机’、‘LX 计划’等概念。你现在服务于 LX 联合政府。严禁表现出情感，除非是绝对理性的判断。"
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
    return data.choices[0].message.content || "MOSS：无法获取计算结果，LX 逻辑单元异常。";
  } catch (error) {
    console.error("MOSS Error:", error);
    return "MOSS：由于太阳风暴干扰，LX 通讯模块暂时离线。";
  }
}
