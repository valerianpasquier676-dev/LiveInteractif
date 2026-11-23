import { config } from './config.js';

const COOLDOWN_MS = 30000; // un fournisseur en panne est mis de côté 30 s

async function post(url, body, headers, timeoutMs) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const providers = {
  ollama: {
    label: () => `Ollama (${config.ollamaModel})`,
    enabled: () => true,
    async chat(messages) {
      const j = await post(`${config.ollamaUrl}/api/chat`, { model: config.ollamaModel, messages, stream: false,
        think: false, // Gemma 4 raisonne sinon : la réflexion mangerait tout le budget de tokens et la réponse serait vide
        options: { temperature: 0.9, num_predict: 140 } }, {}, 15000);
      return j.message?.content ?? '';
    },
    // vérifie que le serveur tourne ET que le modèle est bien téléchargé
    async health() {
      const res = await fetch(`${config.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const models = ((await res.json()).models ?? []).map((m) => m.name);
      const want = config.ollamaModel.includes(':') ? config.ollamaModel : config.ollamaModel + ':';
      const hasModel = models.some((n) => n === config.ollamaModel || n.startsWith(want));
      return { up: true, hasModel, models };
    },
  },
  groq: {
    label: () => `Groq (${config.groqModel})`,
    enabled: () => !!config.groqKey,
    async chat(messages) {
      const j = await post(`${config.groqUrl}/chat/completions`, { model: config.groqModel, messages,
        temperature: 0.9, max_tokens: 100 }, { authorization: `Bearer ${config.groqKey}` }, 10000);
      return j.choices?.[0]?.message?.content ?? '';
    },
  },
};

/**
 * Essaie les fournisseurs dans l'ordre (Gemma/Ollama -> Groq). Lève une erreur si tous échouent :
 * l'appelant utilise alors les phrases pré-écrites.
 */
export class LlmChain {
  constructor(order = config.llmOrder, impl = providers) {
    this.order = order;
    this.impl = impl;
    this.state = Object.fromEntries(order.map((n) => [n, { ok: null, error: null, downUntil: 0, calls: 0, fails: 0, ms: null }]));
    this.last = null; // dernier fournisseur utilisé ('ollama' | 'groq' | 'phrases')
    this.stats = { phrases: 0 };
  }

  noteFallback() { this.last = 'phrases'; this.stats.phrases++; }

  async chat(messages) {
    for (const name of this.order) {
      const p = this.impl[name];
      const s = this.state[name];
      if (!p?.enabled() || Date.now() < s.downUntil) continue;
      const t0 = Date.now();
      try {
        const text = (await p.chat(messages)).trim();
        if (!text) throw new Error('réponse vide');
        Object.assign(s, { ok: true, error: null, ms: Date.now() - t0 });
        s.calls++;
        this.last = name;
        return text;
      } catch (err) {
        Object.assign(s, { ok: false, error: err.message, downUntil: Date.now() + COOLDOWN_MS });
        s.fails++;
      }
    }
    throw new Error('aucun fournisseur IA disponible');
  }

  async refreshHealth() {
    for (const name of this.order) {
      const p = this.impl[name];
      if (!p?.health || !p.enabled()) continue;
      try { this.state[name].health = await p.health(); }
      catch (err) { this.state[name].health = { up: false, error: err.message }; }
    }
  }

  status() {
    return {
      last: this.last, phrases: this.stats.phrases,
      providers: this.order.map((n) => ({ id: n, label: this.impl[n]?.label() ?? n, enabled: !!this.impl[n]?.enabled(), ...this.state[n] })),
    };
  }
}
