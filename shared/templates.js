// Starter flows offered on the flows page. Every API here allows anonymous
// access and needs no key.
// Nodes: { id, type, name, x, y, config, settings }. Edges: { id, from, port, to }.

const node = (id, type, name, x, y, config = {}, settings = {}) =>
  ({ id, type, name, x, y, config, settings: { retries: 0, timeout_ms: '', notes: '', ...settings } });
const edge = (from, port, to) => ({ id: `${from}.${port}>${to}`, from, port, to });

export const TEMPLATES = [
  {
    key: 'pokemon',
    title: 'Pokémon type sorter',
    description: 'Repeat 6× → random id → HTTP → Edit Fields → Switch on type → cards. Shows a for LoopStep, retries and SwitchStep/Case.',
    options: { exit_on_error: true },
    graph: {
      nodes: [
        node('t', 'manual', 'Start', 0, 220, { json: '{ "party": "random" }' }),
        node('r', 'repeat', 'Draw 6', 240, 220, { times: 6 }),
        node('n', 'random', 'Pick a number', 500, 100, { field: 'id', min: 1, max: 1025 }),
        node('h', 'http', 'Fetch Pokémon', 760, 100, { method: 'GET', url: 'https://pokeapi.co/api/v2/pokemon/{{id}}' }, { retries: 2, timeout_ms: 10000 }),
        node('s', 'set', 'Keep the basics', 1020, 100, {
          mode: 'replace',
          assignments: 'name = {{name}}\ntype = {{types[0].type.name}}\nsprite = {{sprites.front_default}}\nhp = {{stats[0].base_stat}}\nslot = {{$item.index}}',
        }),
        node('w', 'switch', 'By type', 1280, 100, {
          path: 'type',
          cases: [{ op: '===', value: 'fire' }, { op: '===', value: 'water' }, { op: 'in', value: 'grass, bug' }],
        }),
        node('d1', 'output', 'Fire card', 1560, -60, { title: '{{name}}', image: '{{sprite}}', text: 'fire · HP {{hp}}', tone: 'red' }),
        node('d2', 'output', 'Water card', 1560, 60, { title: '{{name}}', image: '{{sprite}}', text: 'water · HP {{hp}}', tone: 'blue' }),
        node('d3', 'output', 'Leafy card', 1560, 180, { title: '{{name}}', image: '{{sprite}}', text: '{{type}} · HP {{hp}}', tone: 'green' }),
        node('d4', 'output', 'Other card', 1560, 300, { title: '{{name}}', image: '{{sprite}}', text: '{{type}} · HP {{hp}}', tone: 'slate' }),
        node('c', 'transform', 'Total HP', 500, 400, { op: 'sum', path: '', field: 'hp' }),
        node('d5', 'output', 'Summary', 760, 400, { title: 'Party drawn', text: 'six Pokémon, {{$}} HP in total', tone: 'violet' }),
      ],
      edges: [
        edge('t', 'main', 'r'), edge('r', 'each', 'n'), edge('n', 'main', 'h'), edge('h', 'main', 's'),
        edge('s', 'main', 'w'), edge('w', 'case-0', 'd1'), edge('w', 'case-1', 'd2'), edge('w', 'case-2', 'd3'),
        edge('w', 'default', 'd4'), edge('r', 'done', 'c'), edge('c', 'main', 'd5'),
      ],
    },
  },

  {
    key: 'weather',
    title: 'Weather board',
    description: 'Loop over cities → Open-Meteo → If warm → cards, then sort the results. Shows a for_each LoopStep and ConditionalStep.',
    options: { exit_on_error: true },
    graph: {
      nodes: [
        node('t', 'manual', 'Cities', 0, 160, {
          json: JSON.stringify({
            cities: [
              { name: 'London', lat: 51.51, lon: -0.13 },
              { name: 'Cairo', lat: 30.04, lon: 31.24 },
              { name: 'Reykjavík', lat: 64.15, lon: -21.94 },
              { name: 'Singapore', lat: 1.35, lon: 103.82 },
              { name: 'Denver', lat: 39.74, lon: -104.99 },
            ],
          }, null, 2),
        }),
        node('l', 'loop', 'Each city', 240, 160, { path: 'cities' }),
        node('h', 'http', 'Open-Meteo', 500, 40, {
          method: 'GET',
          url: 'https://api.open-meteo.com/v1/forecast?latitude={{lat}}&longitude={{lon}}&current=temperature_2m,wind_speed_10m',
        }, { retries: 2, timeout_ms: 10000 }),
        node('s', 'set', 'Shape', 760, 40, {
          mode: 'replace',
          assignments: 'city = {{$item.name}}\ntemp = {{current.temperature_2m}}\nwind = {{current.wind_speed_10m}}',
        }),
        node('i', 'if', 'Warm?', 1020, 40, { path: 'temp', op: '>', value: '18' }),
        node('d1', 'output', 'Warm card', 1280, -60, { title: '{{city}}', text: '{{temp}} °C · wind {{wind}} km/h', tone: 'amber' }),
        node('d2', 'output', 'Cool card', 1280, 120, { title: '{{city}}', text: '{{temp}} °C · wind {{wind}} km/h', tone: 'blue' }),
        node('x', 'transform', 'Warmest last', 500, 320, { op: 'sort', path: '', field: 'temp' }),
        node('y', 'transform', 'Pick last', 760, 320, { op: 'last', path: '', n: 1 }),
        node('d3', 'output', 'Winner', 1020, 320, { title: 'Warmest: {{[0].city}}', text: '{{[0].temp}} °C', tone: 'violet' }),
      ],
      edges: [
        edge('t', 'main', 'l'), edge('l', 'each', 'h'), edge('h', 'main', 's'), edge('s', 'main', 'i'),
        edge('i', 'true', 'd1'), edge('i', 'false', 'd2'), edge('l', 'done', 'x'), edge('x', 'main', 'y'),
        edge('y', 'main', 'd3'),
      ],
    },
  },

  {
    key: 'dogs',
    title: 'Dog gallery',
    description: 'HTTP → loop over photo URLs → regex the breed → Wait → cards. Shows a relative DelayStep.',
    options: { exit_on_error: true },
    graph: {
      nodes: [
        node('t', 'manual', 'Start', 0, 140, { json: '{}' }),
        node('h', 'http', 'Six dogs', 240, 140, { method: 'GET', url: 'https://dog.ceo/api/breeds/image/random/6' }, { retries: 1 }),
        node('l', 'loop', 'Each photo', 500, 140, { path: 'message' }),
        node('b', 'set', 'Wrap URL', 760, 40, { mode: 'replace', assignments: 'url = {{$}}' }),
        node('m', 'transform', 'Breed from URL', 1020, 40, { op: 'match', path: 'url', field: 'breeds/([^/]+)/', into: 'breed' }),
        node('w', 'wait', 'Suspense', 1280, 40, { ms: 400 }),
        node('d', 'output', 'Photo', 1540, 40, { title: '{{breed}}', image: '{{url}}', text: '', tone: 'green' }),
        node('c', 'transform', 'Count', 760, 280, { op: 'length' }),
        node('d2', 'output', 'Done', 1020, 280, { title: 'Gallery done', text: '{{$}} dogs shown', tone: 'violet' }),
      ],
      edges: [
        edge('t', 'main', 'h'), edge('h', 'main', 'l'), edge('l', 'each', 'b'), edge('b', 'main', 'm'),
        edge('m', 'main', 'w'), edge('w', 'main', 'd'), edge('l', 'done', 'c'), edge('c', 'main', 'd2'),
      ],
    },
  },

  {
    key: 'flaky',
    title: 'Flaky API (retries + filter)',
    description: 'Eight calls to an unreliable service with retries; low scores are filtered out. Shows max_retries, break FlowControlStep and exit_on_error: false.',
    options: { exit_on_error: false },
    graph: {
      nodes: [
        node('t', 'manual', 'Start', 0, 160, { json: '{ "calls": "eight" }' }),
        node('r', 'repeat', 'Eight calls', 240, 160, { times: 8 }),
        node('c', 'chaos', 'Unreliable API', 500, 40, { fail_pct: 45, latency_ms: 250 }, { retries: 2 }),
        node('n', 'random', 'Score', 760, 40, { field: 'score', min: 1, max: 10 }),
        node('s', 'stop', 'Drop low scores', 1020, 40, { path: 'score', op: '<', value: '4' }),
        node('d', 'output', 'Result', 1280, 40, { title: 'Call #{{index}}', text: 'score {{score}}', tone: 'green' }),
        node('x', 'transform', 'Count kept', 500, 320, { op: 'length', path: '' }),
        node('d2', 'output', 'Summary', 760, 320, { title: '{{$}} of 8 calls kept', text: 'failed calls and scores under 4 were dropped', tone: 'amber' }),
      ],
      edges: [
        edge('t', 'main', 'r'), edge('r', 'each', 'c'), edge('c', 'main', 'n'), edge('n', 'main', 's'),
        edge('s', 'main', 'd'), edge('r', 'done', 'x'), edge('x', 'main', 'd2'),
      ],
    },
  },

  {
    key: 'webhook',
    title: 'Webhook echo API',
    description: 'A tiny HTTP endpoint: Webhook → If has a name → Respond. Activate it, then POST {"name":"Ada"} to /webhook/greet.',
    options: { exit_on_error: true },
    graph: {
      nodes: [
        node('t', 'webhook', 'Incoming', 0, 120, { path: 'greet', method: 'POST', sample: '{ "name": "Ada" }' }),
        node('i', 'if', 'Has a name?', 260, 120, { path: 'body.name', op: 'not_empty', value: '' }),
        node('ok', 'respond', 'Greet', 520, 20, { status: 200, body: '{ "greeting": "Hello, {{body.name}}!" }', content_type: 'application/json' }),
        node('no', 'respond', 'Complain', 520, 220, { status: 400, body: 'Send JSON with a "name" field.', content_type: 'text/plain' }),
        node('log', 'log', 'Note it', 780, 20, { message: 'greeted {{body.name}}', level: 'info' }),
      ],
      edges: [edge('t', 'main', 'i'), edge('i', 'true', 'ok'), edge('i', 'false', 'no'), edge('ok', 'main', 'log')],
    },
  },
];
