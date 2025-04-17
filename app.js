import express from "express";
import cors from "cors";

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
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "verse",
      instructions: SYSTEM_PROMPT
    }),
  });
  const data = await r.json();
  

  // Send back the JSON we received from the OpenAI REST API
  res.send(data);
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });