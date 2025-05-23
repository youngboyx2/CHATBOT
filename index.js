const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🔹 ใช้ Object เก็บ Thread ID ของแต่ละผู้ใช้ชั่วคราว (หรือใช้ฐานข้อมูลแทน)
const userThreads = {};

// ✅ ฟังก์ชันตรวจสอบและจัดการ Thread ID
async function getOrCreateThread(sender_psid) {
  if (userThreads[sender_psid]) {
    const thread_id = userThreads[sender_psid];

    // ✅ ดึงจำนวนข้อความใน Thread
    const messages = await openai.beta.threads.messages.list(thread_id, {
      headers: { "OpenAI-Beta": "assistants=v2" }
    });

    // ✅ ถ้าข้อความเกิน 10 ข้อความ ให้สร้าง Thread ใหม่
    if (messages.data.length >= 10) {
      console.log("🔄 Creating new thread for user:", sender_psid);
      const newThread = await openai.beta.threads.create({}, {
        headers: { "OpenAI-Beta": "assistants=v2" }
      });
      userThreads[sender_psid] = newThread.id; // อัปเดต Thread ใหม่
      return newThread.id;
    }

    return thread_id;
  } else {
    console.log("🆕 Creating first thread for user:", sender_psid);
    const newThread = await openai.beta.threads.create({}, {
      headers: { "OpenAI-Beta": "assistants=v2" }
    });
    userThreads[sender_psid] = newThread.id;
    return newThread.id;
  }
}

// ✅ ฟังก์ชัน ChatGPT
async function getChatGPTResponse(sender_psid, userMessage) {
  try {
    const thread_id = await getOrCreateThread(sender_psid); // ✅ ใช้ฟังก์ชันใหม่

    // ✅ เพิ่มข้อความของผู้ใช้เข้าไปใน Thread
    await openai.beta.threads.messages.create(
      thread_id,
      { role: "user", content: userMessage },
      { headers: { "OpenAI-Beta": "assistants=v2" } }
    );

    // ✅ ดึงจำนวนข้อความทั้งหมดใน Thread
    const messages = await openai.beta.threads.messages.list(thread_id, {
      headers: { "OpenAI-Beta": "assistants=v2" }
    });

    // ✅ นับเฉพาะข้อความที่มาจาก "user" เท่านั้น
    const userMessagesCount = messages.data.filter(msg => msg.role === "user").length;

    console.log(`📩 User ${sender_psid} asked: "${userMessage}"`);
    console.log(`🔄 User messages count: ${userMessagesCount} in thread ${thread_id}`);

    const runResponse = await openai.beta.threads.runs.create(
      thread_id,
      { assistant_id: process.env.OPENAI_ASSISTANT_ID },
      { headers: { "OpenAI-Beta": "assistants=v2" } }
    );

    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      runStatus = await openai.beta.threads.runs.retrieve(
        thread_id,
        runResponse.id,
        { headers: { "OpenAI-Beta": "assistants=v2" } }
      );
    } while (runStatus.status !== "completed");

    const assistantMessages = await openai.beta.threads.messages.list(
      thread_id,
      { headers: { "OpenAI-Beta": "assistants=v2" } }
    );

    const assistantMessage = assistantMessages.data.find(msg => msg.role === "assistant");
    const reply = cleanResponse(assistantMessage?.content[0]?.text?.value || "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้");

    console.log(`✅ Assistant reply: ${reply}`);
    return reply;

  } catch (error) {
    console.error("❌ ChatGPT Error:", error);
    return "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้";
  }
}

function cleanResponse(text) {
  if (!text) return "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้";

  // ลบอ้างอิงที่ไม่จำเป็น
  text = text
    .replace(/\[\d+:\d+†source\]/g, "")
    .replace(/\[\d+†[^\]]+\]/g, "")
    .replace(/【\d+:\d+†source】/g, "")
    .replace(/【\d+†[^\]]+】/g, "");

  // แปลง Markdown URL ให้เหลือแค่ url (เช่น [xxx](https://...) => https://...)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$2");

  // ค้นหาลิงก์ทั้งหมดในข้อความ
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = text.match(urlRegex);

  // ถ้ามีลิงก์มากกว่าหนึ่ง ให้ใช้เฉพาะลิงก์แรก และลบลิงก์ที่ซ้ำกันออก
  if (urls && urls.length > 1) {
    // เลือกลิงก์แรก
    const uniqueUrl = urls[0];
    // ลบลิงก์ทั้งหมด
    text = text.replace(urlRegex, "");
    // วางลิงก์แรกนำหน้าข้อความ
    text = `${uniqueUrl} ${text.trim()}`;
  }

  return text.trim();
}



// ✅ Webhook Messenger
app.post("/webhook", async (req, res) => {
  let body = req.body;

  if (body.object === "page") {
    body.entry.forEach(async function(entry) {
      let webhook_event = entry.messaging[0];
      let sender_psid = webhook_event.sender.id;

      if (webhook_event.message) {
        let userMessage = webhook_event.message.text;
        let aiResponse = await getChatGPTResponse(sender_psid, userMessage);
        sendMessage(sender_psid, aiResponse);
      }
    });
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

function sendMessage(sender_psid, response) {
  if (!response) {
    response = "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้";
  }

  let request_body = {
    recipient: { id: sender_psid },
    message: { text: response },
  };

  axios.post(
    `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
    request_body
  )
  .then(() => console.log("✅ Message sent!"))
  .catch((error) => console.error("❌ Error sending message:", error));
}


// ✅ Verify Webhook
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFIED");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Forbidden: Token mismatch");
    res.sendStatus(403);
  }
});

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
