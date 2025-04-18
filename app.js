import express from "express";
import cors from "cors";
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({ origin: "http://localhost:8080" }));

const port = 3000;

const key = process.env.OPENAI_API_KEY;


const SYSTEM_PROMPT =
  "Esti un asistent care raspunde la intrebari legate de proprietatea urmatoare The Episode Jacuzzi Penthouses se afla in ClujNapoca la 15 minute de mers pe jos de EXPO Transilvania si ofera WiFi gratuit o terasa si parcare privata gratuita Proprietatea se afla la 33 km de Muzeul Etnografic al Transilvaniei si include vedere la oras si la piscinaAcest apartament cu aer conditionat are 1 dormitor un living o bucatarie complet utilata cu frigider si cafetiera precum si 1 baie cu bideu si dus Baia este dotata cu cada cu hidromasaj si articole de toaleta gratuite Exista de asemenea prosoape si lenjerie de patAcest apartament ofera o cada cu hidromasaj The Episode Jacuzzi Penthouses ofera un gratarThe Episode Jacuzzi Penthouses se afla la 38 km de Palatul Banffy si la 48 km de Cluj Arena Aeroportul International Avram Iancu Cluj se afla la 4 kmCuplurile apreciaza in mod deosebit aceasta locatie Iau dat scorul 98 pentru un sejur pentru 2 persoane";

// An endpoint which would work with the client code above - it returns
// the contents of a REST API request to this protected endpoint
app.get("/session", async (req, res) => {
  
  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "verse",
      instructions: SYSTEM_PROMPT,
      modalities: ["audio", "text"],
      input_audio_transcription: {
        model: "whisper-1",
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
      ],
    }),
  });

//   app.post('/session', async (req, res) => {
//     try {
//       const response = await fetch('https://api.openai.com/v1/realtime', {
//         method: 'POST',
//         headers: {
//           'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
//           'Content-Type': 'application/json',
//           'OpenAI-Beta': 'realtime=v1'
//         },
//         body: JSON.stringify({
//           model: "gpt-4o-realtime-preview-2024-12-17",
//           output_format: "text_and_audio",
//           tools: [{
//             type: "function",
//             function: {
//               name: "end_conversation",
//               description: "End the conversation when the user says goodbye or wants to end the conversation",
//               parameters: {
//                 type: "object",
//                 properties: {
//                   should_end: {
//                     type: "boolean",
//                     description: "Whether to end the conversation"
//                   }
//                 },
//                 required: ["should_end"]
//               }
//             }
//           }]
//         })
//       });
  
//       const data = await response.json();
//       res.json(data);
//     } catch (error) {
//       console.error('Error:', error);
//       res.status(500).json({ error: 'Failed to initialize session' });
//     }
//   });
  const data = await r.json();
  

  // Send back the JSON we received from the OpenAI REST API
  res.send(data);
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });