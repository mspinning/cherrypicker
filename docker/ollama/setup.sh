#!/bin/bash
# Local models for the CRM, all served by Ollama on this machine and reached
# through Bifrost (provider "ollama", http://host.docker.internal:11434).
# Safe to run again: models that are already there are only checked.
set -euo pipefail
cd "$(dirname "$0")"

# Knowledge base: embeddings (EMBEDDING_MODEL=ollama/bge-m3:latest, 1024 dimensions)
ollama pull bge-m3

# Mail import and voice agent (LLM_MODEL=ollama/qwen3.8:latest): needs tool calling
ollama pull qwen3.8

# Voice calls, speech-to-text (VOICE_STT_MODEL=ollama/cherrypick-stt:latest):
# Gemma 4 E4B hears audio; the alias only gives it a smaller context
ollama pull gemma4:e4b
ollama create cherrypick-stt -f cherrypick-stt.Modelfile

# Bifrost reads Ollama's model list on start; a virtual key only lets known models through
if docker compose ps --status running bifrost 2>/dev/null | grep -q bifrost; then
  docker compose restart bifrost
fi

ollama list
