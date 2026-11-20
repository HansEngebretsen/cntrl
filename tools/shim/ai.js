// Stands in for builder/claude.js and builder/gemini.js in the demo: no model is called.
// The builder's real steps run (triage, draft, the server's own test and 1-bit render, review),
// but every answer comes from CANNED below, picked by words in the request.

export const CLAUDE_MODEL = 'claude-opus-5-5';
export const CLAUDE_FAST_MODEL = 'claude-haiku-5-5';
export const GEMINI_MODEL = 'gemini-3.8-flash';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Each canned screen is a static TRMNL recipe (no data source), so it renders the same anywhere.
const FONT = "Inter,'Helvetica Neue','Liberation Sans','DejaVu Sans',Arial,sans-serif";
const frame = (title, body, foot) => `<div style="position:absolute;inset:0;font-family:${FONT};color:#000;background:#fff;-webkit-font-smoothing:none">
<div style="position:absolute;left:36px;right:36px;top:28px;bottom:66px;display:flex;flex-direction:column;justify-content:center">
${body}
</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:44px;border-top:3px solid #000;display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-size:18px;font-weight:700"><span>${title}</span><span>${foot}</span></div>
</div>`;

const CANNED = [
  {
    match: /mariners|baseball|game|score|team|nba|nfl|soccer|hockey/i,
    slug: 'mariners-next-game', name: 'Mariners Next Game',
    body: `<div style="font-size:28px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Next game</div>
<div style="font-size:92px;font-weight:800;line-height:1">vs Astros</div>
<div style="font-size:36px;font-weight:600;margin-top:12px">Fri · 7:10 PM · T-Mobile Park</div>
<div style="display:flex;gap:40px;margin-top:30px;font-size:28px;font-weight:700"><div>Last: W 5–3 vs TEX</div><div>Record 84–62</div><div>1st AL West</div></div>`,
  },
  {
    match: /train|bart|bus|transit|subway|metro/i,
    slug: 'next-trains', name: 'Next Trains',
    body: `<div style="font-size:28px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">19th St Oakland</div>
${[['Richmond', '3 min', '11 min'], ['Berryessa', '6 min', '21 min'], ['SF Airport', '8 min', '23 min'], ['Antioch', '12 min', '27 min']].map(([d, a, b]) => `<div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #000;padding:10px 0;font-size:40px;font-weight:700"><span>${d}</span><span>${a}<span style="font-weight:500;font-size:28px"> · ${b}</span></span></div>`).join('')}`,
  },
  {
    match: /nasa|space|astronomy|apod|picture of the day/i,
    slug: 'space-picture', name: 'Space Picture',
    body: `<div style="display:flex;gap:36px;align-items:center">
  <div style="width:300px;height:300px;flex:none;background:repeating-radial-gradient(circle at 40% 45%,#000 0 6px,#fff 6px 14px);border:4px solid #000"></div>
  <div><div style="font-size:26px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Picture of the day</div>
  <div style="font-size:58px;font-weight:800;line-height:1.05;margin-top:6px">The Cat's Eye Nebula</div>
  <div style="font-size:26px;line-height:1.35;margin-top:14px">A dying star sheds its outer layers in rings, 3,000 light years away.</div></div>
</div>`,
  },
  {
    match: /moon|lunar|night sky|stars?\b/i,
    slug: 'moon-tonight', name: 'Moon Tonight',
    body: `<div style="display:flex;gap:44px;align-items:center;height:100%">
  <div style="width:250px;height:250px;border:6px solid #000;border-radius:50%;position:relative;overflow:hidden;flex:none">
    <div style="position:absolute;inset:0;left:46%;background:#000"></div>
  </div>
  <div>
    <div style="font-size:30px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Tonight</div>
    <div style="font-size:84px;font-weight:800;line-height:1">Waxing gibbous</div>
    <div style="font-size:30px;font-weight:600;margin-top:18px">78% lit · moonrise 2:41 PM</div>
    <div style="font-size:30px;font-weight:600">Full moon in 4 days</div>
  </div>
</div>`,
  },
  {
    match: /tide|surf|beach|ocean|wave/i,
    slug: 'tides-today', name: 'Tides Today',
    body: `<div style="font-size:30px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Next tide</div>
<div style="font-size:120px;font-weight:800;line-height:1">High 4:12 PM</div>
<div style="font-size:34px;font-weight:600;margin-top:10px">9.8 ft · then low at 10:36 PM, 2.1 ft</div>
<div style="display:flex;gap:16px;margin-top:34px">${[3, 6, 9, 10, 8, 5, 2, 1, 3, 6, 9, 10, 9, 6].map((h) => `<div style="width:30px;height:${h * 10}px;background:#000;align-self:flex-end"></div>`).join('')}</div>`,
  },
  {
    match: /word|vocab|quote|learn|language|spanish|french|japanese/i,
    slug: 'word-of-the-day', name: 'Word of the Day',
    body: `<div style="font-size:30px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Word of the day</div>
<div style="font-size:120px;font-weight:800;line-height:1.05">Serendipity</div>
<div style="font-size:32px;font-weight:600;margin-top:8px">noun · ser·en·dip·i·ty</div>
<div style="font-size:34px;line-height:1.3;margin-top:22px;max-width:680px">Finding something good without looking for it.</div>`,
  },
];

function cannedFor(prompt) {
  const hit = CANNED.find((c) => c.match.test(prompt));
  if (hit) return hit;
  // Anything else: a screen that says what was asked for, so the demo still ends with something new on the carousel.
  const name = titleCase(String(prompt).replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ')).slice(0, 30) || 'My Screen';
  return {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-screen', name,
    body: `<div style="font-size:30px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Made for you</div>
<div style="font-size:80px;font-weight:800;line-height:1.05;margin-top:6px">${name.replace(/[<&]/g, '')}</div>
<div style="font-size:30px;line-height:1.35;margin-top:24px;max-width:700px">This is a demo, so the AI step is faked. In the real app Claude finds a live data source for this and designs the screen around it.</div>`,
  };
}

function recipe(c) {
  const full = frame(c.name, c.body, 'cntrl');
  return {
    slug: c.slug, name: c.name, values: [], shared_liquid: '',
    settings_yml: `name: ${c.name}\nstrategy: static\nframework_version: 3.2.0\ncustom_fields:\n- keyname: about\n  field_type: author_bio\n  name: About This Plugin\n  description: Made in the cntrl demo (the AI answer is canned).\n  category: custom\n`,
    full_liquid: full, half_vertical_liquid: full,
    snapshot_reason: '', next_steps: '', key_field: '', reference_notes: '',
  };
}

function fake(name, label, model) {
  let asked = '';
  return {
    name, label,
    async test() { await wait(600); },
    async structured({ schema, user, fast }) {
      const keys = Object.keys(schema.properties || {});
      const usage = { model: fast ? (name === 'claude' ? CLAUDE_FAST_MODEL : GEMINI_MODEL) : model, input: 2400, cached: 0, output: 900 };
      if (keys.includes('simple')) { // triage
        asked = String(user || '');
        await wait(1800);
        return { data: { title: cannedFor(asked).name, simple: true, source_url: '', reason: 'Demo: canned answer.' }, usage };
      }
      if (keys.includes('full_liquid')) { // draft
        await wait(4200);
        return { data: recipe(cannedFor(asked || user)), usage: { ...usage, output: 3800 } };
      }
      // review of the 1-bit render
      await wait(1500);
      return { data: { ok: true, problem: '' }, usage };
    },
    init(system, user) { asked = String(user || ''); return { messages: [] }; },
    async next() { return { calls: [], text: '', usage: { model, input: 0, cached: 0, output: 0 } }; },
    nudge() {}, addResults() {},
  };
}

export const claudeProvider = ({ model = CLAUDE_MODEL } = {}) => fake('claude', 'Claude', model);
export const geminiProvider = ({ model = GEMINI_MODEL } = {}) => fake('gemini', 'Gemini', model);
