import { describe, expect, it } from 'vitest';
import {
  BIG_BLIND,
  BUY_IN,
  act,
  bestHand,
  botAction,
  createState,
  handName,
  leave,
  startHand,
} from './game';

// Cards are rank + 13 * suit, with rank 0 a two and rank 12 an ace.
const card = (rank: number, suit = 0) => rank + 13 * suit;
const totalChips = (state: ReturnType<typeof createState>) =>
  state.players.reduce((sum, p) => sum + p.chips + p.inPot, 0);

describe('poker tent', () => {
  it('seats you and three bots with 500 chips each and posts the blinds', () => {
    const state = createState(() => 0.5);
    expect(state.players).toHaveLength(4);
    expect(totalChips(state)).toBe(4 * BUY_IN);
    expect(state.currentBet).toBe(BIG_BLIND);
    expect(state.players.every((p) => p.cards.length === 2)).toBe(true);
  });

  it('names hands and ranks them in the usual order', () => {
    const flush = bestHand([card(0), card(4), card(6), card(8), card(11)]);
    const straight = bestHand([card(3, 1), card(4), card(5), card(6), card(7, 2)]);
    const wheel = bestHand([card(12, 1), card(0), card(1), card(2), card(3, 2)]);
    const pairOfAces = bestHand([card(12), card(12, 1), card(0), card(1), card(2, 2)]);
    const pairOfKings = bestHand([card(11), card(11, 1), card(5), card(6), card(7, 2)]);
    expect(handName(flush)).toBe('Flush');
    expect(handName(straight)).toBe('Straight');
    expect(handName(wheel)).toBe('Straight');
    expect(flush).toBeGreaterThan(straight);
    expect(straight).toBeGreaterThan(wheel);
    expect(pairOfAces).toBeGreaterThan(pairOfKings);
  });

  it('picks the best five of seven cards', () => {
    const hand = [card(12), card(12, 1), card(12, 2), card(5), card(5, 1), card(0, 3), card(1)];
    expect(handName(bestHand(hand))).toBe('Full house');
  });

  it('gives the pot to the last player when everyone else folds', () => {
    const state = createState(() => 0.5);
    while (state.phase === 'betting') act(state, 'fold');
    expect(state.phase).toBe('handOver');
    expect(state.players.filter((p) => !p.folded)).toHaveLength(1);
    expect(totalChips(state)).toBe(4 * BUY_IN);
  });

  it('deals the board and shows down when everyone checks it through', () => {
    const state = createState(() => 0.5);
    while (state.phase === 'betting') act(state, 'call');
    expect(state.board).toHaveLength(5);
    expect(state.shown).toBe(true);
    expect(totalChips(state)).toBe(4 * BUY_IN);
  });

  it('keeps every chip on the table through many hands of bot play', () => {
    let seed = 1;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const state = createState(rng);
    for (let hand = 0; hand < 200 && state.phase !== 'busted'; hand++) {
      for (let moves = 0; state.phase === 'betting' && moves < 200; moves++)
        act(state, botAction(state));
      expect(state.phase).not.toBe('betting');
      const refills = state.players.slice(1).filter((p) => p.chips === 0).length;
      const before = totalChips(state);
      if (state.phase === 'handOver') startHand(state);
      expect(totalChips(state)).toBe(before + refills * BUY_IN);
    }
  });

  it('ends the session when you run out of chips', () => {
    const state = createState(() => 0.5);
    state.players[0].chips = 0;
    while (state.phase === 'betting') act(state, state.turn === 0 ? 'fold' : 'call');
    expect(state.phase).toBe('busted');
  });

  it('lets you leave whenever you like with the chips in front of you', () => {
    const state = createState(() => 0.5);
    leave(state);
    expect(state.phase).toBe('left');
    expect(state.message).toContain(String(state.players[0].chips));
  });
});
