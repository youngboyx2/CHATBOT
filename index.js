const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();
const {OpenAI} = require("openai");

const app = express();
const PORT = process.PORT || 3000;

app.use(bodyParser.json());

const openai = new OpenAI({apiKey: process.OPENAI_API_KEY});


const userThreads = {};


async function getOrCreateThread(sender_psid) {
  if (userThreads[sender_psid]) {
    const thread_id = userThreads[sender_psid];


    const messages = await openai.beta.threads.messages.list(thread_id, {
      headers: { "OpenAI-Beta": "assistants=v2" }
    });

    if (messages.data.length >= 10) {
      console.log("Creating new thread for user:", sender_psid);
      const newThread = await openai.beta.threads.create({}, {
        headers: { "OpenAI-Beta": "assistants=v2" }
      });
      userThreads[sender_psid] = newThread.id;
      return newThread.id;
    }

    return thread_id;
  } else {
    console.log("Creating first thread for user:", sender_psid);
    const newThread = await openai.beta.threads.create({}, {
      headers: { "OpenAI-Beta": "assistants=v2" }
    });
    userThreads[sender_psid] = newThread.id;
    return newThread.id;
  }
}


async function getChatGPTResponse(sender_psid, userMessage) {
  try {
    const thread_id = await getOrCreateThread(sender_psid);


    await openai.beta.threads.messages.create(
      thread_id,
      { role: "user", content: userMessage },
      { headers: { "OpenAI-Beta": "assistants=v2" } }
    );


    const messages = await openai.beta.threads.messages.list(thread_id, {
      headers: { "OpenAI-Beta": "assistants=v2" }
    });


    const userMessagesCount = messages.data.filter(msg => msg.role === "user").length;

    console.log(`User ${sender_psid} asked: "${userMessage}"`);
    console.log(`User messages count: ${userMessagesCount} in thread ${thread_id}`);

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

    console.log(`Assistant reply: ${reply}`);
    return reply;

  } catch (error) {
    console.error("ChatGPT Error:", error);
    return "ขออภัย ฉันไม่สามารถตอบคำถามได้ในขณะนี้";
  }
}



function cleanResponse(text) {
  return text
    .replace(/\[\d+:\d+†source\]/g, "")
    .replace(/\[\d+†[^\]]+\]/g, "")
    .replace(/【\d+:\d+†source】/g, "")
    .replace(/【\d+†[^\]]+】/g, "")
    .trim();
}


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


app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    res.status(200).send(challenge);
  } else {
    console.error("Forbidden: Token mismatch");
    res.sendStatus(403);
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
