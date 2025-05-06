import { WebSocket } from "ws";
import { wsSession } from "./app.js";

// interface wsSession {
//   twilioConn?: WebSocket;
//   frontendConn?: WebSocket;
//   modelConn?: WebSocket;
//   streamSid?: string;
//   saved_config?: any;
//   lastAssistantItem?: string;
//   responseStartTimestamp?: number;
//   latestMediaTimestamp?: number;
//   openAIApiKey?: string;
// }

export function handleCallConnection(ws, openAIApiKey) {
  cleanupConnection(wsSession.twilioConn);
  wsSession.twilioConn = ws;
  wsSession.openAIApiKey = openAIApiKey;

  ws.on("message", handleTwilioMessage);
  ws.on("error", ws.close);
  ws.on("close", () => {
    cleanupConnection(wsSession.modelConn);
    cleanupConnection(wsSession.twilioConn);
    wsSession.twilioConn = undefined;
    wsSession.modelConn = undefined;
    wsSession.streamSid = undefined;
    wsSession.lastAssistantItem = undefined;
    wsSession.responseStartTimestamp = undefined;
    wsSession.latestMediaTimestamp = undefined;
  });
}

function handleTwilioMessage(data) {
  const msg = parseMessage(data);
  if (!msg) return;

  switch (msg.event) {
    case "start":
      console.log("Twilio start event received");
      wsSession.streamSid = msg.start.streamSid;
      wsSession.latestMediaTimestamp = 0;
      wsSession.lastAssistantItem = undefined;
      wsSession.responseStartTimestamp = undefined;
      tryConnectModel();
      break;
    case "media":
      wsSession.latestMediaTimestamp = msg.media.timestamp;
      if (isOpen(wsSession.modelConn)) {
        jsonSend(wsSession.modelConn, {
          type: "input_audio_buffer.append",
          audio: msg.media.payload,
        });
      }
      break;
    case "close":
      closeAllConnections();
      break;
  }
}

// Create websocket to openAI
function tryConnectModel() {
  if (
    !wsSession.twilioConn ||
    !wsSession.streamSid ||
    !wsSession.openAIApiKey
  ) {
    console.log("Missing required session data");
    return;
  }
  if (isOpen(wsSession.modelConn)) {
    console.log("Model connection already open");
    return;
  }

  wsSession.modelConn = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
    {
      headers: {
        Authorization: `Bearer ${wsSession.openAIApiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  wsSession.modelConn.on("open", () => {
    console.log("Model connection opened");
    jsonSend(wsSession.modelConn, {
      type: "session.update",
      session: {
        instructions: wsSession.systemPrompt,
        modalities: ["text", "audio"],
        turn_detection: { type: "server_vad" },
        voice: "coral",
        input_audio_transcription: {
          model: "gpt-4o-transcribe",
          language: "ro",
        },
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        tools: [
          {
            type: "function",
            name: "end_conversation",
            description:
              "Inchide conversatia cand clientul spune la revedere sau doreste sa opreasca conversatia",
            parameters: {
              type: "object",
              properties: {
                should_end: {
                  type: "boolean",
                  description: "daca sa inchida conversatia",
                },
              },
              required: ["should_end"],
            },
          },
          {
            type: "function",
            name: "get_reservation",
            description:
              "Daca clientul are o rezervare va trebui sa o indentifici si sa identifici si clientul, intreaba numele clientului",
            parameters: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "numele clientului",
                },
              },
              required: ["name"],
            },
          },
        ],
        tool_choice: "auto",
        temperature: 0.65,
      },
    });
  });

  wsSession.modelConn.on("message", handleModelMessage);
  wsSession.modelConn.on("error", closeModel);
  wsSession.modelConn.on("close", closeModel);
}

function handleModelMessage(data) {
  const event = parseMessage(data);
  if (!event) return;

  console.log("Model message:", event);
  // jsonSend(wsSession.frontendConn, event);

  switch (event.type) {
    case "input_audio_buffer.speech_started":
      handleTruncation();
      break;

    case "response.audio.delta":
      if (wsSession.twilioConn && wsSession.streamSid) {
        if (wsSession.responseStartTimestamp === undefined) {
          wsSession.responseStartTimestamp =
            wsSession.latestMediaTimestamp || 0;
        }
        if (event.item_id) wsSession.lastAssistantItem = event.item_id;

        jsonSend(wsSession.twilioConn, {
          event: "media",
          streamSid: wsSession.streamSid,
          media: { payload: event.delta },
        });

        jsonSend(wsSession.twilioConn, {
          event: "mark",
          streamSid: wsSession.streamSid,
        });
      }
      break;

    case "response.output_item.done": {
      const { item } = event;
      if (item.type === "function_call") {
        //   handleFunctionCall(item)
        //     .then((output) => {
        //       if (wsSession.modelConn) {
        //         jsonSend(wsSession.modelConn, {
        //           type: "conversation.item.create",
        //           item: {
        //             type: "function_call_output",
        //             call_id: item.call_id,
        //             output: JSON.stringify(output),
        //           },
        //         });
        //         jsonSend(wsSession.modelConn, { type: "response.create" });
        //       }
        //     })
        //     .catch((err) => {
        //       console.error("Error handling function call:", err);
        //     });
        console.log("Function call:", item);
      }
      break;
    }
  }
}

function handleTruncation() {
  if (
    !wsSession.lastAssistantItem ||
    wsSession.responseStartTimestamp === undefined
  )
    return;

  const elapsedMs =
    (wsSession.latestMediaTimestamp || 0) -
    (wsSession.responseStartTimestamp || 0);
  const audio_end_ms = elapsedMs > 0 ? elapsedMs : 0;

  if (isOpen(wsSession.modelConn)) {
    jsonSend(wsSession.modelConn, {
      type: "conversation.item.truncate",
      item_id: wsSession.lastAssistantItem,
      content_index: 0,
      audio_end_ms,
    });
  }

  if (wsSession.twilioConn && wsSession.streamSid) {
    jsonSend(wsSession.twilioConn, {
      event: "clear",
      streamSid: wsSession.streamSid,
    });
  }

  wsSession.lastAssistantItem = undefined;
  wsSession.responseStartTimestamp = undefined;
}

function closeModel() {
  cleanupConnection(wsSession.modelConn);
  wsSession.modelConn = undefined;
  if (!wsSession.twilioConn && !wsSession.frontendConn) wsSession = {};
}

function cleanupConnection(ws) {
  if (isOpen(ws)) ws.close();
}

function parseMessage(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function jsonSend(ws, obj) {
  if (!isOpen(ws)) return;
  ws.send(JSON.stringify(obj));
}

function isOpen(ws) {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

function closeAllConnections() {
  if (wsSession.twilioConn) {
    wsSession.twilioConn.close();
    wsSession.twilioConn = undefined;
  }
  if (wsSession.modelConn) {
    wsSession.modelConn.close();
    wsSession.modelConn = undefined;
  }
  if (wsSession.frontendConn) {
    wsSession.frontendConn.close();
    wsSession.frontendConn = undefined;
  }
  wsSession.streamSid = undefined;
  wsSession.lastAssistantItem = undefined;
  wsSession.responseStartTimestamp = undefined;
  wsSession.latestMediaTimestamp = undefined;
  wsSession.saved_config = undefined;
}
