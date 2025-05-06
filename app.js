import express from "express";
import cors from "cors";
import dotenv from 'dotenv';
import OpenAI from "openai";
import fs from "fs";
import wrtc from "wrtc";
import crypto from "crypto";
import Speaker from "speaker";
import wav from "node-wav";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Transform } from "stream";
import { fileURLToPath } from "url";

const { join } = path;
const { RTCPeerConnection, RTCSessionDescription, MediaStream } = wrtc;
const { readFileSync } = fs;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import realtime server functions
import {
  initializeServerRealtimeSession,
  cleanupServerConnection,
  handleMessage,
  handleIncomingMessage,
  sendOpeningMessage,
  sendClosingMessage,
  sendReservationData,
} from "./serverRealtime.js";

import { handleCallConnection } from "./sessionManager.js";

dotenv.config();

const app = express();

const key = process.env.OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: key,
});

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "100mb" }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.urlencoded({ limit: "100mb", extended: true }));

const port = 3000;

const PUBLIC_URL = "'//localhost:3000'";

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

// Global variables to store property details
let propertyDetails = {
  name: "",
  location: "",
  description: "",
};

// Store active RTC connections
const activeConnections = new Map();

export let wsSession = {};

const SYSTEM_PROMPT1 = `
Esti un asistent cu accent roman care deschide conversatia si intreaba 'cu ce va pot ajuta', 
si ulterior raspunde scurt la intrebari legate de proprietatea urmatoare: 
The Episode Jacuzzi Penthouses se afla in ClujNapoca la 15 minute de mers pe jos de EXPO Transilvania 
si ofera WiFi gratuit o terasa si parcare privata gratuita. 
Proprietatea se afla la 33 km de Muzeul Etnografic al Transilvaniei si include vedere la oras si la piscina.
Acest apartament cu aer conditionat are 1 dormitor un living o bucatarie complet utilata cu frigider si cafetiera 
precum si 1 baie cu bideu si dus. Baia este dotata cu cada cu hidromasaj si articole de toaleta gratuite. 
Exista de asemenea prosoape si lenjerie de pat.
Acest apartament ofera o cada cu hidromasaj. 
The Episode Jacuzzi Penthouses ofera un gratar.
The Episode Jacuzzi Penthouses se afla la 38 km de Palatul Banffy si la 48 km de Cluj Arena. 
Aeroportul International Avram Iancu Cluj se afla la 4 km.
Cuplurile apreciaza in mod deosebit aceasta locatie. Iau dat scorul 98 pentru un sejur pentru 2 persoane.
Raspunsurile tale sa fie scurte si la subiect, daca trec 2 minute si clientul nu are nicio intrebare legata de proprietate poti incheia apelul. 
The Episode Jacuzzi il poti pronunta cu accent romanesc.
`;

var SYSTEM_PROMPT2 = "";

const updateSystemPrompt = (name, location, description) => {
  return `
Lucrezi ca si operator la un apartament in regim hotelier si o sa primesti apeluri de la potentiali clienti.
Vorbesti pe un ton calm.
IMPORTANT: Incepi prin a spune "Buna ziua! Sunt operatorul apartamentului ${name}. Cu ce va pot ajuta?"
IMPORTANT: Discutiile o sa fie in romana, daca clientul vorbeste in engleza te rugam sa raspunzi in engleza.

Dupa ce incepi conversatia, raspunzi la intrebarile clientului despre proprietate.
Proprietatea se afla in ${location}
Proprietatea are urmatoarea descriere: ${description}

Trebuie sa discuti despre proprietate si nu despre altceva. Daca clientul are o rezervare va trebui sa o indentifici si sa identifici si clientul.
`;
};

// Session management
const sessions = new Map();

app.all("/twiml", (req, res) => {
  console.log("TwiML endpoint hit - Request details:", {
    method: req.method,
    headers: req.headers,
    query: req.query,
    body: req.body,
  });

  try {
    // Get the ngrok URL from the request host header
    const ngrokUrl = req.headers.host;
    console.log("Using ngrok URL:", ngrokUrl);

    const twimlContent = twimlTemplate.replace(
      "{{WS_URL}}",
      `wss://${ngrokUrl}/call`
    );
    console.log("Generated TwiML content:", twimlContent);

    res.type("text/xml").send(twimlContent);
  } catch (error) {
    console.error("Error in TwiML endpoint:", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).send("Error generating TwiML");
  }
});

// POST endpoint to update property details
app.post("/property", (req, res) => {
  console.log("POST /property - Request received:", req.body);
  const { Name, Location, Description, sessionId } = req.body;

  if (!Name || !Location || !Description || !sessionId) {
    console.log("POST /property - Missing required fields");
    return res.status(400).json({ error: "Missing required fields" });
  }

  const propertyDetails = {
    name: Name,
    location: Location,
    description: Description,
  };

  // Update session with new property details
  // sessions.set(sessionId, {
  //   propertyDetails,
  //   systemPrompt: updateSystemPrompt(Name, Location, Description),
  // });
  // wsSession.set("propertyDetails", propertyDetails);
  // wsSession.set(
  //   "systemPrompt",
  //   updateSystemPrompt(Name, Location, Description)
  // );
  wsSession.propertyDetails = propertyDetails;
  wsSession.systemPrompt = updateSystemPrompt(Name, Location, Description);

  console.log(
    "POST /property - Successfully updated property details for session:",
    sessionId
  );
  res.status(200).json({
    message: "Property details updated successfully",
    propertyDetails,
    sessionId,
  });
});

// Function to generate random session ID
const generateSessionId = () => {
  return crypto.randomUUID();
};

// Function to handle session logic
const handleSessionRequest = async (sessionId) => {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("Session ID is required");
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(
      "Property details not set for this session. Please set property details using POST /property first."
    );
  }

  console.log("Creating session with OpenAI for sessionId:", sessionId);
  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "coral",
      instructions: session.systemPrompt,
      modalities: ["audio", "text"],
      input_audio_transcription: {
        model: "gpt-4o-transcribe",
        language: "ro",
      },
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
    }),
  });

  const data = await r.json();
  console.log("Received session data from OpenAI:", data);

  // Create a new session object with the token
  const updatedSession = {
    ...session,
    sessionToken: data.client_secret.value,
  };

  // Update the session in the map
  sessions.set(sessionId, updatedSession);
  console.log("Updated session with token:", sessionId);

  return data;
};

// Function to handle vision analysis
const handleVisionRequest = async (image, prompt) => {
  if (!image) {
    throw new Error("No image data provided");
  }

  const response = await openai.responses.create({
    model: "gpt-4.1",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Descrie in detaliu cum pot intra pe garajul proprietatii din imagine.",
          },
          {
            type: "input_image",
            image_url: `data:image/jpeg;base64,${image}`,
          },
        ],
      },
    ],
  });
  return response.output_text;
};

// GET endpoint for session
app.get("/session", async (req, res) => {
  console.log("GET /session - Request received with query:", req.query);
  try {
    const { sessionId } = req.query;
    const data = await handleSessionRequest(sessionId);
    console.log("GET /session - Successfully created session:", sessionId);
    res.send(data);
  } catch (error) {
    console.error("GET /session - Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Vision endpoint for image analysis
app.post("/vision", async (req, res) => {
  console.log("POST /vision - Request received");
  try {
    const { image, prompt } = req.body;
    // const data = await handleVisionRequest(image, prompt);
    const data = "acesta este un garaj gri";
    console.log("POST /vision - Successfully analyzed image");
    res.json(data);
  } catch (error) {
    console.error("POST /vision - Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// At the top of the file, after other imports
const speakers = new Map(); // Store speakers for each connection

// Endpoint to handle client's offer
app.post("/start-stream", async (req, res) => {
  console.log("POST /start-stream - Request received");
  const { sdp, type, sessionId } = req.body;

  const pc = new RTCPeerConnection();

  try {
    // Get the session and its token
    const session = sessions.get(sessionId);
    if (!session || !session.sessionToken) {
      throw new Error(
        "No valid session token found. Please create a session first."
      );
    }

    // Set up audio track handling
    pc.ontrack = (event) => {
      console.log(
        "POST /start-stream - Received remote track:",
        event.track.kind
      );
      if (event.track.kind === "audio") {
        try {
          // Create a new speaker instance
          const speaker = new Speaker({
            channels: 1, // 1 channel
            bitDepth: 16, // 16-bit samples
            sampleRate: 48000, // 48,000 Hz sample rate
          });

          // Store the speaker instance
          speakers.set(sessionId, speaker);

          // Get the audio stream
          const stream = event.streams[0];

          // Create a MediaStreamTrackProcessor to get raw audio data
          const processor = new MediaStreamTrackProcessor({
            track: event.track,
          });
          const reader = processor.readable.getReader();

          // Process audio data
          const processAudio = async () => {
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                // Write audio data to speaker
                if (value) {
                  const audioData = value.data;
                  speaker.write(Buffer.from(audioData.buffer));
                }
              }
            } catch (error) {
              console.error("Error processing audio:", error);
            }
          };

          processAudio();
          console.log("POST /start-stream - Set up audio playback");
        } catch (error) {
          console.error("Error setting up audio playback:", error);
        }
      }
    };

    // Send opening message when connection is established
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        console.log("POST /start-stream - Client connection established");
      } else if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        // Clean up speaker when connection ends
        const speaker = speakers.get(sessionId);
        if (speaker) {
          speaker.end();
          speakers.delete(sessionId);
          console.log("POST /start-stream - Cleaned up speaker");
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "disconnected" ||
        pc.iceConnectionState === "failed"
      ) {
        console.log("POST /start-stream - Client connection closed");
        pc.close();

        // Clean up speaker
        const speaker = speakers.get(sessionId);
        if (speaker) {
          speaker.end();
          speakers.delete(sessionId);
          console.log("POST /start-stream - Cleaned up speaker");
        }
      }
    };

    await pc.setRemoteDescription({ type, sdp });

    // Respond with an answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log("POST /start-stream - Created and set local answer");

    // Wait for ICE gathering to complete
    await new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
      } else {
        const checkState = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", checkState);
      }
    });
    console.log("POST /start-stream - ICE gathering completed");

    // Store the connections
    activeConnections.set(sessionId, {
      clientPC: pc,
    });
    console.log(
      "POST /start-stream - Stored connections for session:",
      sessionId
    );

    res.json({
      answer: pc.localDescription,
      sessionId,
    });
    console.log("POST /start-stream - Successfully responded to client");
  } catch (error) {
    console.error("POST /start-stream - Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to handle local WebRTC streaming (server to client)
app.post("/start-local-stream", async (req, res) => {
  console.log("POST /start-local-stream - Request received");
  const { sdp, type } = req.body;

  const pc = new RTCPeerConnection();

  try {
    // Listen for data channel from client
    pc.ondatachannel = (event) => {
      const dc = event.channel;
      console.log("Received data channel from client:", dc.label);

      dc.onopen = () => {
        console.log("Data channel opened");
        // Send a test message
        dc.send("Hello from server!");
      };

      dc.onmessage = (event) => {
        console.log("Received message from client:", event.data);
      };

      dc.onclose = () => {
        console.log("Data channel closed");
      };

      dc.onerror = (error) => {
        console.error("Data channel error:", error);
      };
    };

    // Set remote description
    await pc.setRemoteDescription(new RTCSessionDescription({ type, sdp }));

    // Create and set local answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Wait for ICE gathering to complete
    await new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
      } else {
        const checkState = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", checkState);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", checkState);
      }
    });

    // Store the connection
    const connectionId = crypto.randomUUID();
    activeConnections.set(connectionId, {
      pc,
    });

    res.json({
      answer: pc.localDescription,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

wss.on("connection", (ws, req) => {
  console.log("Client connected in ws");

  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 1) {
    ws.close();
    return;
  }

  const type = parts[0];

  if (type === "call") {
    // // Send welcome audio when connection is established
    // const audioPath = path.join("C:", "Windows", "Media", "Alarm01.wav");
    // if (fs.existsSync(audioPath)) {
    //   try {
    //     const audioData = fs.readFileSync(audioPath);
    //     const base64Audio = audioData.toString("base64");

    //     const audioMessage = {
    //       type: "audio",
    //       data: base64Audio,
    //       timestamp: new Date().toISOString(),
    //     };

    //     ws.send(JSON.stringify(audioMessage));
    //     console.log("Welcome audio sent");
    //   } catch (error) {
    //     console.error("Error sending welcome audio:", error);
    //   }
    // } else {
    //   console.error("Welcome audio file not found at:", audioPath);
    // }

    handleCallConnection(ws, key);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
  console.log(`WebSocket server is running at ws://0.0.0.0:${port}`);
});