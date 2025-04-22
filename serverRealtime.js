import { WebSocket } from "ws";
import wrtc from "wrtc";
const { RTCPeerConnection, RTCSessionDescription } = wrtc;

// Generate a random session token for security
const DEFAULT_SESSION_TOKEN = crypto.randomUUID();

// Function to send opening message
export const sendOpeningMessage = function (dc) {
  try {
    var message = {
      type: "response.create",
      response: {
        instructions:
          "te rog spune-i buna ziua clientului, unde a sunat si ce poti face pentru el",
      },
    };
    dc.send(JSON.stringify(message));
    console.log("Sent opening message:", message);
  } catch (error) {
    console.error("Error sending opening message:", error);
  }
};

// Function to send closing message
export const sendClosingMessage = function (dc) {
  try {
    var message = {
      type: "response.create",
      response: {
        instructions: "te rog ia ti ramas bun de la client",
      },
    };
    dc.send(JSON.stringify(message));
    console.log("Sent closing message:", message);
  } catch (error) {
    console.error("Error sending closing message:", error);
  }
};

// Function to send reservation data
export const sendReservationData = function (dc, reservation) {
  try {
    // First send the reservation event
    var event_1 = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "rezervare gasita\n                     nume: "
              .concat(reservation.name, "\n                     data: ")
              .concat(reservation.date),
          },
        ],
      },
    };
    dc.send(JSON.stringify(event_1));
    console.log("Sent reservation data:", event_1);
    // Then send the response request
    var response = {
      type: "response.create",
      response: {
        instructions: "te rog spune-i clientului ce rezervare ai gasit",
      },
    };
    dc.send(JSON.stringify(response));
    console.log("Sent reservation response request:", response);
  } catch (error) {
    console.error("Error sending reservation data:", error);
  }
};

// Function to handle incoming messages
export const handleIncomingMessage = (data) => {
  try {
    const response = JSON.parse(data);
    console.log("Parsed response:", response);

    // Handle different message types
    if (
      response.type === "conversation.item.input_audio_transcription.completed"
    ) {
      console.log("Received user transcription:", response.transcript);
      return { type: "transcription", data: response.transcript };
    }

    if (response.type === "response.audio_transcript.done") {
      console.log("Received assistant response:", response.transcript);
      return { type: "assistant", data: response.transcript };
    }

    if (response.type === "response.done") {
      if (response.response?.output?.[0]?.type === "function_call") {
        const functionCall = response.response.output[0];

        if (functionCall.arguments === '{"should_end":true}') {
          console.log("Received conversation end signal");
          return { type: "end", data: null };
        }

        if (functionCall.name === "get_reservation") {
          console.log("Received get_reservation function call");
          const args = JSON.parse(functionCall.arguments);
          return { type: "reservation", data: args };
        }
      }
    }

    return { type: "unknown", data: response };
  } catch (error) {
    console.error("Error handling incoming message:", error);
    return { type: "error", data: error };
  }
};

export const initializeServerRealtimeSession = async (
  onMessage,
  sessionToken
) => {
  try {
    // Create WebSocket connection to OpenAI
    const url = "wss://api.openai.com/v1/realtime?intent=transcription";
    const ws = new WebSocket(url, {
      headers: {
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    ws.on("open", function open() {
      console.log("Connected to server.");
    });

    ws.on("message", function incoming(message) {
      console.log(JSON.parse(message.toString()));
    });

    // Create RTCPeerConnection
    const pc = new RTCPeerConnection();

    // Create data channel
    const dc = pc.createDataChannel("oai-events", {
      ordered: true,
    });

    // Set up message handlers
    if (onMessage) {
      dc.onmessage = (event) => {
        console.log("Data channel message received:", event.data);
        onMessage(event.data);
      };

      ws.on("message", (data) => {
        console.log("WebSocket message received:", data.toString());
        onMessage(data.toString());
      });
    }

    // Create and set local description (SDP offer)
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
    });
    await pc.setLocalDescription(offer);

    // Initialize session with OpenAI
    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/sdp",
      },
    });

    // Set remote description with OpenAI's answer
    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(new RTCSessionDescription(answer));

    return { pc, dc, ws };
  } catch (error) {
    console.error("Error initializing server realtime session:", error);
    throw error;
  }
};

// Helper function to clean up the connection
export const cleanupServerConnection = (connection) => {
  try {
    if (connection.pc) {
      connection.pc.close();
    }
    if (connection.dc) {
      connection.dc.close();
    }
    if (connection.ws) {
      connection.ws.close();
    }
  } catch (error) {
    console.error("Error cleaning up server connection:", error);
  }
};

// Message handler function
export const handleMessage = (event) => {
  console.log("=== Message Event Received ===");

  try {
    const response = JSON.parse(event.data);
    console.log("Parsed response:", response);

    // Handle user transcription
    if (
      response.type === "conversation.item.input_audio_transcription.completed"
    ) {
      console.log("Adding user message:", response.transcript);
      addMessage(response.transcript, true);
    }

    // Handle assistant response
    if (response.type === "response.audio_transcript.done") {
      console.log("Adding assistant message:", response.transcript);
      addMessage(response.transcript, false);
    }

    // Handle conversation end message
    if (response.type === "response.done") {
      if (response.response.output[0].type === "function_call") {
        console.log("Parsed response:", response);
        if (response.response.output[0].arguments === '{"should_end":true}') {
          let response = {
            type: "response.create",
            response: {
              instructions: "te rog ia ti ramas bun de la client ",
            },
          };

          // WebRTC data channel and WebSocket both have .send()
          dcRef.current.send(JSON.stringify(response));

          console.log("Sent response:", response);
          console.log("Received conversation end signal");
          addMessage("Conversatie incheiata...", false);

          // Add delay before stopping to ensure all messages are processed
          setTimeout(() => {
            // Stop recording first
            if (isRecording) {
              setIsRecording(false);
              setIsProcessing(false);
            }

            // Save the conversation to history before cleanup
            if (messages.length > 1) {
              const conversationMessages = messages.filter(
                (msg) => msg.id !== "welcome"
              );
              if (conversationMessages.length > 0) {
                chatHistoryService.addSession(
                  conversationMessages,
                  propertyInfo?.name || "Unknown Property"
                );
              }
            }

            // Then clean up the connection
            cleanupConnection();
          }, 4000);

          return;
        } else if (response.response.output[0].name === "get_reservation") {
          console.log("Received get_reservation function call");
          // Parse the arguments to get reservation data
          const args = JSON.parse(response.response.output[0].arguments);
          setReservation(args);
          addMessage("Rezervare gasita...", false);
          // Send the reservation data through the data channel
          sendReservationData();
        }
      }
    }
  } catch (error) {
    console.error("Error parsing message:", error);
    console.error("Raw data that failed to parse:", event.data);
  }
};

// Example usage in an Express endpoint:
/*
import express from 'express';
import { initializeServerRealtimeSession, cleanupServerConnection } from './utils/serverRealtime';

const app = express();

app.post('/start-session', async (req, res) => {
  try {
    const connection = await initializeServerRealtimeSession((data) => {
      // Handle incoming messages
      console.log('Received message:', data);
    });

    // Store the connection somewhere (e.g., in a Map or database)
    // connections.set(sessionId, connection);

    res.json({ success: true, message: 'Session started' });
  } catch (error) {
    console.error('Failed to start session:', error);
    res.status(500).json({ success: false, error: 'Failed to start session' });
  }
});

app.post('/end-session/:sessionId', (req, res) => {
  try {
    const connection = connections.get(req.params.sessionId);
    if (connection) {
      cleanupServerConnection(connection);
      connections.delete(req.params.sessionId);
      res.json({ success: true, message: 'Session ended' });
    } else {
      res.status(404).json({ success: false, error: 'Session not found' });
    }
  } catch (error) {
    console.error('Failed to end session:', error);
    res.status(500).json({ success: false, error: 'Failed to end session' });
  }
});
*/
