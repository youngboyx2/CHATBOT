const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const dotenv = require("dotenv");
const openai = require("openai");

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openaiClient = new openai.OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // ใช้ API Key จาก .env
});

// ฟังก์ชันใหม่ที่ใช้ Assistant API
async function getChatGPTResponse(userMessage) {
  try {
    // สร้าง Thread ใหม่ก่อน
    const thread = await openaiClient.beta.threads.create();
    if (!thread || !thread.id) {
      throw new Error("Failed to create thread");
    }

    // เพิ่มข้อความลงใน Thread
    await openaiClient.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // สร้าง Run ให้ Assistant ทำงาน
    const runResponse = await openaiClient.beta.threads.runs.create({
      thread_id: thread.id, // ใช้ thread_id ที่สร้างก่อนหน้า
      assistant_id: "asst_ST3twGwQGZKeNqAvGjjG5gem",
      instructions: "กรุณาตอบคำถามตามฐานข้อมูลที่เทรนไว้",
    });

    if (!runResponse || !runResponse.id) {
      throw new Error("Failed to start Assistant run");
    }

    // ตรวจสอบสถานะการทำงานของ Assistant
    let run;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      run = await openaiClient.beta.threads.runs.retrieve(thread.id, runResponse.id);
    } while (run.status !== "completed");

    // ดึงข้อความจาก Assistant
    const messages = await openaiClient.beta.threads.messages.list(thread.id);
    if (!messages.data || messages.data.length === 0) {
      throw new Error("No response from Assistant");
    }

    const reply = messages.data[messages.data.length - 1].content[0].text.value;
    return reply;

  } catch (error) {
    console.error("ChatGPT Error:", error);
    return "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้";
  }
}



// Webhook สำหรับ Messenger
app.post("/webhook", async (req, res) => {
  let body = req.body;

  if (body.object === "page") {
    body.entry.forEach(async (entry) => {
      let webhookEvent = entry.messaging[0];
      let sender_psid = webhookEvent.sender.id;
      let userMessage = webhookEvent.message?.text || "No message received";

      console.log("Received message:", userMessage);

      // ใช้ฟังก์ชัน Assistant API
      let botResponse = await getChatGPTResponse(userMessage);

      // ส่งข้อความกลับไปที่ Messenger
      sendMessage(sender_psid, botResponse);
    });

    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// ฟังก์ชันส่งข้อความกลับไปยัง Messenger
async function sendMessage(sender_psid, response) {
  let request_body = {
    recipient: { id: sender_psid },
    message: { text: response },
  };

  try {
    await axios.post(
      `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
      request_body
    );
    console.log("Message sent!");
  } catch (error) {
    console.error("Error sending message:", error.response ? error.response.data : error.message);
  }
}

// Webhook Verification
app.get("/webhook", (req, res) => {
  let VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
