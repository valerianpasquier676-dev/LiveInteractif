import { config } from './config.js';

const COOLDOWN_MS = 30000; // un fournisseur en panne est mis de côté 30 s

async function post(url, body, headers, timeoutMs, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const providers = {
  ollama: {
    label: () => `Ollama (${config.ollamaModel})`,
    enabled: () => true,
    async chat(messages, { signal } = {}) {
      const j = await post(`${config.ollamaUrl}/api/chat`, { model: config.ollamaModel, messages, stream: false,
        think: false, // Gemma 4 raisonne sinon : la réflexion mangerait tout le budget de tokens et la réponse serait vide
        keep_alive: '1h', // le modèle reste en mémoire : pas de rechargement (plusieurs secondes) entre deux répliques
        options: { temperature: 0.9, num_predict: 120, num_ctx: 2048 } }, {}, 8000, signal);
      return j.message?.content ?? '';
    },
    // charge le modèle en mémoire à l'avance : la 1re vraie réplique ne paie pas le chargement
    async warmup() {
      await post(`${config.ollamaUrl}/api/chat`, { model: config.ollamaModel, messages: [{ role: 'user', content: 'ok' }], stream: false, think: false,
        keep_alive: '1h', options: { num_predict: 1, num_ctx: 2048 } }, {}, 60000);
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
    async chat(messages, { signal } = {}) {
      const j = await post(`${config.groqUrl}/chat/completions`, { model: config.groqModel, messages,
        temperature: 0.9, max_tokens: 100 }, { authorization: `Bearer ${config.groqKey}` }, 6000, signal);
      return j.choices?.[0]?.message?.content ?? '';
    },
  },
};

/**
 * Cascade de fournisseurs (Gemma/Ollama -> Groq) avec REQUÊTE EN COURSE : si le premier n'a pas répondu après
 * `hedgeMs`, on lance le suivant en parallèle et on prend la première réponse (l'autre est annulée).
 * Un échec lance immédiatement le suivant. Si tous échouent : erreur -> phrases pré-écrites.
 */
export class LlmChain {
  constructor(order = config.llmOrder, impl = providers, { hedgeMs = 2000 } = {}) {
    this.order = order;
    this.impl = impl;
    this.hedgeMs = hedgeMs;
    this.state = Object.fromEntries(order.map((n) => [n, { ok: null, error: null, downUntil: 0, calls: 0, fails: 0, ms: null, avg: null, max: 0 }]));
    this.last = null; // dernier fournisseur utilisé ('ollama' | 'groq' | 'phrases')
    this.stats = { phrases: 0, hedged: 0 };
  }

  noteFallback() { this.last = 'phrases'; this.stats.phrases++; }

  async #run(name, messages, signal) {
    const s = this.state[name], t0 = Date.now();
    try {
      const text = (await this.impl[name].chat(messages, { signal })).trim();
      if (!text) throw new Error('réponse vide');
      const ms = Date.now() - t0;
      Object.assign(s, { ok: true, error: null, ms, avg: s.avg == null ? ms : Math.round(s.avg * 0.7 + ms * 0.3), max: Math.max(s.max, ms) });
      s.calls++;
      return text;
    } catch (err) {
      if (!signal?.aborted) { // une requête annulée parce qu'une autre a gagné n'est pas une panne
        Object.assign(s, { ok: false, error: err.message, downUntil: Date.now() + COOLDOWN_MS });
        s.fails++;
      }
      throw err;
    }
  }

  chat(messages) {
    const names = this.order.filter((n) => this.impl[n]?.enabled() && Date.now() >= this.state[n].downUntil);
    if (!names.length) return Promise.reject(new Error('aucun fournisseur IA disponible'));
    return new Promise((resolve, reject) => {
      const ctl = new AbortController();
      let started = 0, pending = 0, done = false, lastErr = null, hedge = null;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(hedge); ctl.abort(); fn(v); };
      const startNext = () => {
        if (done || started >= names.length) return false;
        const name = names[started++];
        pending++;
        if (started > 1) this.stats.hedged++;
        this.#run(name, messages, ctl.signal).then(
          (text) => { this.last = name; finish(resolve, text); },
          (err) => { pending--; lastErr = err; if (!done && !startNext() && pending === 0) finish(reject, lastErr); });
        clearTimeout(hedge);
        if (started < names.length) hedge = setTimeout(startNext, this.hedgeMs); // trop lent : on lance le suivant en parallèle
        return true;
      };
      startNext();
    });
  }

  async warmup() {
    for (const name of this.order) {
      const p = this.impl[name];
      if (p?.warmup && p.enabled()) { try { await p.warmup(); } catch { /* serveur absent : le health check le dira */ } }
    }
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
      last: this.last, phrases: this.stats.phrases, hedged: this.stats.hedged,
      providers: this.order.map((n) => ({ id: n, label: this.impl[n]?.label() ?? n, enabled: !!this.impl[n]?.enabled(), ...this.state[n] })),
    };
  }
}
