import { afterEach, describe, expect, test } from "bun:test";
import {
  getProviderCapabilities,
  getProviderId,
} from "@/src/providers";

const original = {
  provider: process.env.MODEL_PROVIDER,
  ollama: process.env.OLLAMA_BASE_URL,
  runanywhere: process.env.RUNANYWHERE_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
};

function restore() {
  if (original.provider === undefined) delete process.env.MODEL_PROVIDER;
  else process.env.MODEL_PROVIDER = original.provider;
  if (original.ollama === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = original.ollama;
  if (original.runanywhere === undefined) delete process.env.RUNANYWHERE_API_KEY;
  else process.env.RUNANYWHERE_API_KEY = original.runanywhere;
  if (original.openrouter === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = original.openrouter;
}

afterEach(restore);

describe("Provider selection", () => {
  test("RunAnywhere is selected explicitly and declares no embeddings", () => {
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    process.env.MODEL_PROVIDER = "runanywhere";

    expect(getProviderId()).toBe("runanywhere");
    expect(getProviderCapabilities()).toEqual({
      chat: true,
      tools: true,
      embeddings: false,
    });
  });

  test("OpenRouter and Ollama declare embeddings", () => {
    process.env.MODEL_PROVIDER = "openrouter";
    expect(getProviderCapabilities().embeddings).toBe(true);

    process.env.MODEL_PROVIDER = "ollama";
    expect(getProviderCapabilities().embeddings).toBe(true);
  });

  test("explicit provider wins over ambient credentials", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.RUNANYWHERE_API_KEY = "test-key";
    process.env.MODEL_PROVIDER = "runanywhere";
    expect(getProviderId()).toBe("runanywhere");
  });
});