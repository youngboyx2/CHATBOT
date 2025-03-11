const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const { Configuration, OpenAIApi } = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// Webhook Messenger
app.post("/webhook", async (req, res) => {
  let body = req.body;

  if (body.object === "page") {
    body.entry.forEach(async function(entry) {
      let webhook_event = entry.messaging[0];
      let sender_psid = webhook_event.sender.id;

      if (webhook_event.message) {
        let userMessage = webhook_event.message.text;
        let aiResponse = await getChatGPTResponse(userMessage);
        sendMessage(sender_psid, aiResponse);
      }
    });
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});

// ฟังก์ชัน ChatGPT
async function getChatGPTResponse(userMessage) {
  try {
    const thread = await openai.beta.threads.create({}, {
      headers: { "OpenAI-Beta": "assistants=v2" }
    });

    await openai.beta.threads.messages.create(
      thread.id,
      { role: "user", content: userMessage },
      { headers: { "OpenAI-Beta": "assistants=v2" } }
    );

    const runResponse = await openai.beta.threads.runs.create(
      thread.id,
      { assistant_id: process.env.OPENAI_ASSISTANT_ID },
      { headers: { "OpenAI-Beta": "assistants=v2" } }
    );

    let runStatus;
    do {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      runStatus = await openai.beta.threads.runs.retrieve(
        thread.id,
        runResponse.id,
        { headers: { "OpenAI-Beta": "assistants=v2" } }
      );
    } while (runStatus.status !== "completed");

    const messages = await openai.beta.threads.messages.list(
      thread.id,
      { headers: { "OpenAI-Beta": "assistants=v2" } }
    );

    // ดึงข้อความล่าสุดที่ Assistant ตอบ
    const assistantMessage = messages.data.find(msg => msg.role === "assistant");
    const reply = assistantMessage?.content[0]?.text?.value || "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้";

    console.log("✅ Assistant reply:", reply);
    return reply;

  } catch (error) {
    console.error("❌ ChatGPT Error:", error);
    return "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้";
  }
}


// ฟังก์ชันส่งข้อความกลับไปที่ Messenger
function sendMessage(sender_psid, response) {
  let request_body = {
    recipient: { id: sender_psid },
    message: { text: response },
  };

  axios.post(
    `https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
    request_body
  )
  .then(() => console.log("Message sent!"))
  .catch((error) => console.error("Error sending message:", error));
}

// Verify Webhook
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // ดึงค่า VERIFY_TOKEN จาก .env

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    res.status(200).send(challenge); // คืนค่า challenge ให้ Facebook
  } else {
    console.error("Forbidden: Token mismatch");
    res.sendStatus(403);
  }
});



// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
