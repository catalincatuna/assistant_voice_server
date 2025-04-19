import express from "express";
import cors from "cors";
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const port = 3000;

const key = process.env.OPENAI_API_KEY;

// Global variables to store property details
let propertyDetails = {
  name: "",
  location: "",
  description: "",
};

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
Vorbesti intr-un ritm mai rapid si pe un ton calm.
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
  const { Name, Location, Description, sessionId } = req.body;

  if (!Name || !Location || !Description || !sessionId) {
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

  res.status(200).json({
    message: "Property details updated successfully",
    propertyDetails,
    sessionId,
  });
});

// GET endpoint for session
app.get("/session", async (req, res) => {
  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({
      error: "Session ID is required",
    });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(400).json({
      error:
        "Property details not set for this session. Please set property details using POST /property first.",
    });
  }

  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "ash",
      instructions: session.systemPrompt,
      modalities: ["audio", "text"],
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
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
              should_end: {
                type: "string",
                description: "numele clientului",
              },
            },
            required: ["name"],
          },
        },
      ],
      tool_choice: "auto",
      temperature: 0.6,
      max_response_output_tokens: 500,
    }),
  });

  const data = await r.json();
  res.send(data);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running at http://0.0.0.0:${port}`);
});