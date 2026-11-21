import assert from 'node:assert/strict';
import test from 'node:test';
import { DiceRoll } from '@dice-roller/rpg-dice-roller';

test('rolls a standard notation and exposes its total and breakdown', () => {
  const roll = new DiceRoll('2d6+3');

  assert.equal(roll.notation, '2d6+3');
  assert.ok(roll.total >= 5 && roll.total <= 15);
  assert.match(roll.output, /^2d6\+3: .* = \d+$/);
});

test('rejects invalid notation with an error instead of returning a result', () => {
  assert.throws(() => new DiceRoll('not-a-die'));
});