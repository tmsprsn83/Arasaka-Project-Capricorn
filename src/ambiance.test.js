const test = require('node:test');
const assert = require('node:assert');
const { analyse, neon, neonOf, createSuivi } = require('./ambiance');

const W = 64, H = 36;
// Image BGRA unie, ou dont `paint(x, y)` donne la couleur [r, g, b].
function image(paint) {
  const bmp = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = paint(x, y);
    const i = (y * W + x) * 4;
    bmp[i] = b; bmp[i + 1] = g; bmp[i + 2] = r; bmp[i + 3] = 255;
  }
  return bmp;
}
const border = (x, y) => x < W * 0.12 || x >= W * 0.88 || y < H * 0.15 || y >= H * 0.85;

test('couleur dominante d’une scène cyan, poussée en néon', () => {
  const a = analyse(image(() => [10, 120, 140]), W, H);
  assert.ok(a.vivid > 0.02);
  assert.deepStrictEqual(a.color.map((c) => c > 128), [false, true, true]);
  assert.strictEqual(Math.max(...a.color), 255);
});

test('une scène grise ne donne pas de couleur', () => {
  const a = analyse(image(() => [90, 90, 90]), W, H);
  assert.ok(a.vivid < 0.02);
});

test('néon : noir reste noir', () => {
  assert.deepStrictEqual(neon([0, 0, 0]), [0, 0, 0]);
});

test('dégâts : les bords virent au rouge, une seule fois', () => {
  let t = 0;
  const suivi = createSuivi({ now: () => t });
  const calme = image(() => [40, 60, 80]);
  const touche = image((x, y) => (border(x, y) ? [200, 20, 30] : [40, 60, 80]));
  assert.ok(!suivi(calme, W, H).degats);
  t = 200; assert.ok(suivi(touche, W, H).degats);
  t = 400; assert.ok(!suivi(touche, W, H).degats); // toujours rouge : pas de nouvel éclair
});

test('écran entièrement rouge (menu, décor) : pas de dégâts', () => {
  const suivi = createSuivi({ now: () => 0 });
  assert.ok(!suivi(image(() => [200, 20, 30]), W, H).degats);
});

test('teinte ramenée au néon le plus proche', () => {
  assert.strictEqual(neonOf([255, 75, 31]).name, 'orange');
  assert.strictEqual(neonOf([37, 222, 229]).name, 'cyan');
  assert.strictEqual(neonOf([185, 104, 251]).name, 'violet');
  assert.strictEqual(neonOf([255, 0, 40]).name, 'rouge');
});

test('la couleur ne change qu’après 2 s stables', () => {
  const suivi = createSuivi({ now: () => 0 });
  const orange = image(() => [255, 90, 20]), cyan = image(() => [20, 220, 230]);
  assert.strictEqual(suivi(orange, W, H).color.join(), '255,90,0');
  for (let i = 0; i < 5; i++) suivi(cyan, W, H);
  assert.strictEqual(suivi(orange, W, H).color.join(), '255,90,0'); // un passage bref ne change rien
  let last;
  for (let i = 0; i < 25; i++) last = suivi(cyan, W, H).color.join();
  assert.strictEqual(last, '0,240,255');
});

test('coupure brutale : glitch', () => {
  let t = 0;
  const suivi = createSuivi({ now: () => t });
  suivi(image(() => [10, 10, 10]), W, H);
  t = 200; assert.ok(suivi(image(() => [250, 250, 250]), W, H).glitch);
  t = 400; assert.ok(!suivi(image(() => [10, 10, 10]), W, H).glitch); // pas deux de suite
});
