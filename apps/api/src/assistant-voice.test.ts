import assert from "node:assert/strict";
import { test } from "node:test";
import { speechConfig, synthesizeAssistantVoice } from "./assistant-voice.js";

const credentials = { key: "fixture", region: "eastus" };

test("uses a supported Russian preset and treats answer text as plain SSML content", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(new URL(url).origin, "https://eastus.tts.speech.microsoft.com");
    assert.equal(init.redirect, "error");
    assert.match(String(init.body), /name="ru-RU-SvetlanaNeural"/);
    assert.match(String(init.body), /Привет, Сонора &lt;break\/&gt; &amp; музыка/);
    return new Response(new Uint8Array([73, 68, 51]), { headers: { "Content-Type": "audio/mpeg" } });
  });
  const audio = await synthesizeAssistantVoice("Привет, SONORA <break/> & музыка", credentials, "alice");
  assert.deepEqual(audio, Buffer.from([73, 68, 51]));
});

test("rejects malformed region and oversized provider responses", async (t) => {
  assert.equal(speechConfig({ SONORA_AZURE_SPEECH_KEY: "fixture", SONORA_AZURE_SPEECH_REGION: "eastus.example.test" }), null);
  t.mock.method(globalThis, "fetch", async (_: string, init: RequestInit) => {
    assert.match(String(init.body), /name="ru-RU-DmitryNeural"/);
    return new Response(new Uint8Array(1024 * 1024 + 1), { headers: { "Content-Type": "audio/mpeg" } });
  });
  await assert.rejects(synthesizeAssistantVoice("Привет", credentials, "__proto__"), /too large/);
});
