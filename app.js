import express from "express";
import cors from "cors";
import dotenv from 'dotenv';
import OpenAI from "openai";
import fs from "fs";
import { WebSocket } from "ws";
import wrtc from "wrtc";
import crypto from "crypto";
const { RTCPeerConnection, RTCSessionDescription } = wrtc;

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

dotenv.config();

const app = express();

const key = process.env.OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: key,
});

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const port = 3000;

// Global variables to store property details
let propertyDetails = {
  name: "",
  location: "",
  description: "",
};

// Store active RTC connections
const activeConnections = new Map();

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
  sessions.set(sessionId, {
    propertyDetails,
    systemPrompt: updateSystemPrompt(Name, Location, Description),
  });

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

// Endpoint to handle client's offer
app.post("/start-stream", async (req, res) => {
  console.log("POST /start-stream - Request received");
  const { sdp, type, sessionId } = req.body;

  const pc = new RTCPeerConnection();

  try {
    const data = await handleSessionRequest(sessionId);

    // Get the session and its token
    const session = sessions.get(sessionId);
    console.log("POST /start-stream - Sessions:", sessions);
    console.log("POST /start-stream - Session:", session);
    console.log("POST /start-stream - Session token:", session.sessionToken);
    if (!session || !session.sessionToken) {
      throw new Error(
        "No valid session token found. Please create a session first."
      );
    }

    // Initialize OpenAI RTC connection with the session token
    const {
      pc: openaiPC,
      dc: openaiDC,
      ws: openaiWS,
    } = await initializeServerRealtimeSession(
      handleMessage,
      session.sessionToken
    );
    console.log("POST /start-stream - Initialized OpenAI RTC connection");
    const openaiConnection = { pc: openaiPC, dc: openaiDC, ws: openaiWS };

    pc.ontrack = (event) => {
      console.log(
        "POST /start-stream - Received remote track:",
        event.track.kind
      );
      if (event.track.kind === "audio") {
        // Add the received audio track to OpenAI's connection
        openaiPC.addTrack(event.track);
        console.log(
          "POST /start-stream - Added audio track to OpenAI connection"
        );
      }
    };

    // Send opening message when connection is established
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        console.log(
          "POST /start-stream - Client connection established, sending opening message"
        );
        sendOpeningMessage(openaiDC);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "disconnected" ||
        pc.iceConnectionState === "failed"
      ) {
        console.log(
          "POST /start-stream - Client connection closed, sending closing message"
        );
        sendClosingMessage(openaiDC);
        pc.close();
        cleanupServerConnection(openaiConnection);
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
      openaiConnection,
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

app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
});