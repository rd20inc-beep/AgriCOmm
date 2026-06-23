/**
 * Reusable AI helper (OpenAI Chat Completions, or any OpenAI-compatible gateway).
 *
 * Enable by setting OPENAI_API_KEY in the environment (see docker-compose.yml +
 * config/index.js). When the key is absent, `enabled()` is false and callers
 * should fall back to their non-AI default — no feature should hard-depend on AI.
 *
 * Usage:
 *   const ai = require('../ai/ai.service');
 *   if (ai.enabled()) {
 *     const obj = await ai.complete({ system, prompt, json: true });
 *   }
 *
 * Uses global fetch (Node 18+); no SDK dependency.
 */
const config = require('../../config');

function enabled() {
  return !!config.ai.openaiKey;
}

async function complete({ system, prompt, json = false, model, temperature = 0.2, maxTokens = 1200 } = {}) {
  if (!enabled()) throw new Error('AI is not configured (set OPENAI_API_KEY).');
  if (!prompt) throw new Error('prompt is required.');

  const body = {
    model: model || config.ai.model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
    temperature,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };

  // Guard against a hung upstream — never let an AI call stall a request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.openaiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!json) return content;
  try {
    return JSON.parse(content);
  } catch {
    // Tolerate a fenced or prefixed JSON blob.
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI did not return valid JSON.');
  }
}

module.exports = { enabled, complete };
