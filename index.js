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
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: userMessage }],
    });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("ChatGPT Error:", error);
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
