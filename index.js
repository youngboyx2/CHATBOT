const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const userThreads = {};

async function getOrCreateThread(sender_psid) {
  if (userThreads[sender_psid]) {
    const thread_id = userThreads[sender_psid];
    const { data: messages } = await openai.beta.threads.messages.list(thread_id, { headers: { "OpenAI-Beta": "assistants=v2" } });
    if (messages.length >= 20) {
      const { id } = await openai.beta.threads.create({}, { headers: { "OpenAI-Beta": "assistants=v2" } });
      return userThreads[sender_psid] = id;
    }
    return thread_id;
  } else {
    const { id } = await openai.beta.threads.create({}, { headers: { "OpenAI-Beta": "assistants=v2" } });
    return userThreads[sender_psid] = id;
  }
}

async function getChatGPTResponse(sender_psid, userMessage) {
  try {
    const thread_id = await getOrCreateThread(sender_psid);
    await openai.beta.threads.messages.create(thread_id, { role: "user", content: userMessage }, { headers: { "OpenAI-Beta": "assistants=v2" } });

    const run = await openai.beta.threads.runs.create(thread_id, { assistant_id: process.env.OPENAI_ASSISTANT_ID }, { headers: { "OpenAI-Beta": "assistants=v2" } });
    let status;
    do {
      await new Promise(r => setTimeout(r, 2000));
      status = await openai.beta.threads.runs.retrieve(thread_id, run.id, { headers: { "OpenAI-Beta": "assistants=v2" } });
    } while (status.status !== "completed");

    const { data: msgs } = await openai.beta.threads.messages.list(thread_id, { headers: { "OpenAI-Beta": "assistants=v2" } });
    const reply = cleanResponse(msgs.find(m => m.role === "assistant")?.content[0]?.text?.value);
    return reply;
  } catch (error) {
    console.error("ChatGPT Error:", error);
    return "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้";
  }
}

function cleanResponse(text = "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้") {
  text = text.replace(/\[\d+:\d+†source\]|【\d+:\d+†source】|\[\d+†[^\]]+\]|【\d+†[^\]]+】/g, "");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$2");
  const urls = text.match(/(https?:\/\/[^\s]+)/g);
  if (urls && urls.length > 1) {
    const uniqueUrl = urls[0];
    text = `${text.replace(/(https?:\/\/[^\s]+)/g, "").trim()} ${uniqueUrl}`;
  }
  return text.trim();
}

app.post("/webhook", async (req, res) => {
  if (req.body.object === "page") {
    req.body.entry.forEach(async entry => {
      const event = entry.messaging[0];
      if (event.message) {
        const response = await getChatGPTResponse(event.sender.id, event.message.text);
        sendMessage(event.sender.id, response);
      }
    });
    res.status(200).send("EVENT_RECEIVED");
  } else res.sendStatus(404);
});

const sendMessage = (id, text = "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้") =>
  axios.post(`https://graph.facebook.com/v12.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
    { recipient: { id }, message: { text } })
    .then(() => console.log("✅ Message sent!"))
    .catch(console.error);

app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  mode && token === process.env.VERIFY_TOKEN ? res.send(challenge) : res.sendStatus(403);
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
