const personas = {
  alice: { voice: "ru-RU-SvetlanaNeural", rate: "-2%" },
  jarvis: { voice: "ru-RU-DmitryNeural", rate: "-5%" },
  dj: { voice: "ru-RU-DmitryNeural", rate: "+9%" }
} as const;
export type VoicePersona = keyof typeof personas;

const MAX_SPEECH_BYTES = 1024 * 1024;

export function speechConfig(env: NodeJS.ProcessEnv) {
  const key = env.SONORA_AZURE_SPEECH_KEY?.trim();
  const region = env.SONORA_AZURE_SPEECH_REGION?.trim();
  return key && region && /^[a-z0-9]{2,32}$/.test(region) ? { key, region } : null;
}

export async function synthesizeAssistantVoice(text: string, config: NonNullable<ReturnType<typeof speechConfig>>, persona: unknown = "jarvis") {
  const selected = typeof persona === "string" && Object.hasOwn(personas, persona) ? personas[persona as VoicePersona] : personas.jarvis;
  const escape: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  const spoken = text.replace(/\bSONORA\b/gi, "Сонора").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (character) => escape[character]);
  const response = await fetch(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3"
    },
    body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ru-RU"><voice name="${selected.voice}"><prosody rate="${selected.rate}">${spoken}</prosody></voice></speak>`,
    signal: AbortSignal.timeout(6500),
    redirect: "error"
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/") || !response.body) {
    await response.body?.cancel();
    throw new Error("Speech provider unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SPEECH_BYTES) { await reader.cancel(); throw new Error("Speech response too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("Empty speech response");
  return Buffer.concat(chunks, size);
}
